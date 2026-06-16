/* panels/task-tree.ts — 사이드바 할일 트리뷰 (tracker.json 시각화).
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: vscode + ../tracker(데이터·변경이벤트·우선순위) + ../agents(이모지).
 * onTrackerChanged 구독으로 자동 새로고침. 싱글톤 _taskTreeProvider 와 인라인 명령
 * (markDone/cancel/setPriority)은 extension.ts 에 남고, 여기선 클래스만 제공. */
import * as vscode from 'vscode';
import { TrackerTask, TaskPriority, readTracker, _coercePriority, TASK_PRIORITY_LABEL, onTrackerChanged } from '../tracker';
import { AGENTS } from '../agents';

/* ── Task Tree View (sidebar) ─────────────────────────────────────────────
   P0-1: visualizes tracker.json as a clickable tree. Top level = status
   groups (진행중 / 대기 / 완료 / 취소). Children = task entries with
   priority chip, owner emoji, due, recurrence indicator. Inline actions
   (✅ / ✖️) come from package.json menus → registered commands.
   The tree auto-refreshes via onTrackerChanged. */
export class TaskTreeItem extends vscode.TreeItem {
    constructor(
        public readonly task: TrackerTask | null,
        public readonly groupKey: TaskGroupKey | null,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

/* TaskGroup key now expanded to support priority-grouping mode. The tree
   groups by PRIORITY (urgent/high/normal/low) for open tasks since that's
   what the user actually scans for. Closed tasks (done/cancelled) collapse
   into a single "이력" group so they don't dominate the view. */
export type TaskGroupKey = TaskPriority | 'closed';

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    /* Periodic light refresh so due-imminent visual cues update without
       waiting for a tracker write — tasks transition into "임박" zone purely
       by clock advancing. 5min cadence is plenty (window resolution is hour). */
    private _ticker: NodeJS.Timeout | null = null;

    constructor() {
        onTrackerChanged(() => this.refresh());
        this._ticker = setInterval(() => this.refresh(), 5 * 60_000);
    }
    dispose() { if (this._ticker) { clearInterval(this._ticker); this._ticker = null; } }

    refresh() { this._onDidChangeTreeData.fire(); }

    getTreeItem(el: TaskTreeItem): vscode.TreeItem { return el; }

    getChildren(parent?: TaskTreeItem): TaskTreeItem[] {
        const all = readTracker().tasks;
        if (!parent) {
            /* Top level — priority groups for open tasks + a single "이력"
               group for closed. Hide empty groups so we don't show
               "🔴 긴급 (0)" noise on a fresh install. Counts include the
               #stale flag (overdue user tasks) as a small adornment. */
            const open = all.filter(t => t.status !== 'done' && t.status !== 'cancelled');
            const closed = all.filter(t => t.status === 'done' || t.status === 'cancelled');
            const prioOrder: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];
            const items: TaskTreeItem[] = [];
            for (const p of prioOrder) {
                const inGroup = open.filter(t => _coercePriority(t.priority) === p);
                if (inGroup.length === 0) continue;
                const overdue = inGroup.filter(t => t.dueAt && new Date(t.dueAt).getTime() < Date.now()).length;
                const overdueChip = overdue > 0 ? ` 🔴${overdue}` : '';
                const it = new TaskTreeItem(
                    null, p,
                    `${TASK_PRIORITY_LABEL[p]}  (${inGroup.length})${overdueChip}`,
                    /* Expand urgent + high by default — those are the ones the user
                       must act on. Normal + low collapsed unless they're the only
                       group present (handled below). */
                    (p === 'urgent' || p === 'high')
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.Collapsed
                );
                it.contextValue = 'taskGroup';
                /* Group icon + theme color — visual hierarchy at a glance. */
                it.iconPath = _priorityGroupIcon(p);
                items.push(it);
            }
            /* If only normal/low have tasks, expand them so the view isn't empty-feeling. */
            if (items.length > 0 && items.every(it => it.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed)) {
                items[0].collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            }
            if (closed.length > 0) {
                const histIt = new TaskTreeItem(
                    null, 'closed',
                    `📁 이력  (${closed.length})`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                histIt.contextValue = 'taskGroup';
                histIt.iconPath = new vscode.ThemeIcon('archive');
                items.push(histIt);
            }
            if (items.length === 0) {
                const empty = new TaskTreeItem(null, null, '아직 등록된 할 일이 없어요. 텔레그램에 자연어로 말하거나 사이드바에 명령하면 비서가 만들어요.', vscode.TreeItemCollapsibleState.None);
                empty.contextValue = 'emptyHint';
                empty.iconPath = new vscode.ThemeIcon('lightbulb');
                return [empty];
            }
            return items;
        }
        if (!parent.groupKey) return [];
        let tasks: TrackerTask[];
        if (parent.groupKey === 'closed') {
            tasks = all.filter(t => t.status === 'done' || t.status === 'cancelled');
            tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            tasks = tasks.slice(0, 30); /* don't load infinite history */
        } else {
            tasks = all.filter(t => t.status !== 'done' && t.status !== 'cancelled' && _coercePriority(t.priority) === parent.groupKey);
            /* Within group: due-imminent first, then stale, then newest. */
            const now = Date.now();
            const score = (t: TrackerTask) => {
                if (t.dueAt) {
                    const dt = new Date(t.dueAt).getTime();
                    if (dt < now) return -1e12 + dt; /* overdue: most negative first */
                    return dt;                       /* upcoming: nearest first */
                }
                return 1e15 - new Date(t.createdAt).getTime();
            };
            tasks.sort((a, b) => score(a) - score(b));
        }
        return tasks.map(t => {
            const prio = _coercePriority(t.priority);
            const ownerEmoji = t.owner === 'user' ? '👤'
                : t.owner === 'mixed' ? '👥'
                : (t.agentIds && t.agentIds[0] ? (AGENTS[t.agentIds[0]]?.emoji || '🤖') : '🤖');
            const recur = t.recurrence ? ` 🔁` : '';
            const item = new TaskTreeItem(t, null, `${ownerEmoji} ${t.title}${recur}`, vscode.TreeItemCollapsibleState.None);
            /* Status / urgency icon — mapped through ThemeIcon so it adapts to
               the user's color theme (light/dark/high-contrast). The colored
               'urgent' / 'overdue' variants use the same red the editor uses
               for errors, so the visual hierarchy matches what users already
               read as "needs attention". */
            item.iconPath = _taskStatusIcon(t);
            const desc: string[] = [];
            if (t.dueAt) {
                const due = _formatDueLabel(t.dueAt);
                desc.push(due);
            }
            desc.push(`id ${t.id.slice(-9)}`);
            const aged = (Date.now() - new Date(t.createdAt).getTime()) / 86_400_000;
            if (t.status === 'pending' && aged > 1) desc.push('🟡 오래됨');
            item.description = desc.join(' · ');
            const tip = new vscode.MarkdownString();
            tip.appendMarkdown(`**${t.title}**\n\n`);
            tip.appendMarkdown(`- 우선순위: ${TASK_PRIORITY_LABEL[prio]}\n`);
            tip.appendMarkdown(`- 상태: ${t.status}\n`);
            tip.appendMarkdown(`- 소유: ${t.owner}${t.agentIds?.length ? ' (' + t.agentIds.join(', ') + ')' : ''}\n`);
            if (t.dueAt) tip.appendMarkdown(`- 기한: ${t.dueAt}\n`);
            if (t.recurrence) tip.appendMarkdown(`- 반복: ${t.recurrence}\n`);
            tip.appendMarkdown(`- 생성: ${t.createdAt}\n`);
            if (t.description) tip.appendMarkdown(`\n_${t.description.slice(0, 200)}_\n`);
            item.tooltip = tip;
            item.contextValue = (t.status === 'done' || t.status === 'cancelled') ? 'closedTask' : 'openTask';
            item.id = t.id;
            return item;
        });
    }
}

/* Map a priority level to a colored ThemeIcon for the group header. */
export function _priorityGroupIcon(p: TaskPriority): vscode.ThemeIcon {
    switch (p) {
        case 'urgent': return new vscode.ThemeIcon('error',     new vscode.ThemeColor('errorForeground'));
        case 'high':   return new vscode.ThemeIcon('warning',   new vscode.ThemeColor('list.warningForeground'));
        case 'normal': return new vscode.ThemeIcon('circle-outline');
        case 'low':    return new vscode.ThemeIcon('chevron-down', new vscode.ThemeColor('descriptionForeground'));
    }
}

/* Per-task icon — encodes status + due-urgency. We use VS Code's built-in
   codicon names so the look stays consistent with the rest of the IDE. */
export function _taskStatusIcon(t: TrackerTask): vscode.ThemeIcon {
    if (t.status === 'done')      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    if (t.status === 'cancelled') return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground'));
    /* Open task — visual urgency derived from due. Codicon 'sync~spin' is
       VS Code's native spinner — used for in_progress to show "AI is on it". */
    if (t.dueAt) {
        const dt = new Date(t.dueAt).getTime();
        const ms = dt - Date.now();
        if (ms < 0)             return new vscode.ThemeIcon('flame', new vscode.ThemeColor('errorForeground')); // overdue
        if (ms < 60 * 60_000)   return new vscode.ThemeIcon('clock', new vscode.ThemeColor('errorForeground')); // <1h
        if (ms < 24 * 3600_000) return new vscode.ThemeIcon('clock', new vscode.ThemeColor('list.warningForeground')); // <1d
    }
    if (t.status === 'in_progress') return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.green'));
    return new vscode.ThemeIcon('circle-outline');
}

/* Friendly relative-time formatter — "지금부터 3시간", "내일 09:00", "3일 지남". */
export function _formatDueLabel(iso: string): string {
    try {
        const dt = new Date(iso);
        const ms = dt.getTime() - Date.now();
        const abs = Math.abs(ms);
        const m = Math.floor(abs / 60_000);
        const h = Math.floor(abs / 3600_000);
        const d = Math.floor(abs / 86_400_000);
        if (ms < 0) {
            if (d >= 1) return `🔴 ${d}일 지남`;
            if (h >= 1) return `🔴 ${h}시간 지남`;
            return `🔴 ${m}분 지남`;
        }
        if (d >= 7)  return `📅 ${dt.toISOString().slice(5, 10)}`;
        if (d >= 1)  return `📅 ${d}일 후`;
        if (h >= 1)  return `⏰ ${h}시간 후`;
        return `⚡ ${Math.max(1, m)}분 후`;
    } catch { return iso.slice(0, 16); }
}
