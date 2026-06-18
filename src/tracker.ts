/* tracker.ts — 할일 추적 데이터 레이어 (타입·영속·CRUD·변경이벤트·마크다운).
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: vscode(EventEmitter)·fs·path + paths(회사 폴더) + agents(이모지).
 *
 * 캘린더 결합 차단(DI): addTrackerTask/updateTrackerTask 는 due 변경 시 구글 캘린더
 * 이벤트를 만들/고치/지웠는데, 캘린더 함수가 다시 TrackerTask 타입을 받아 순환 결합이었다.
 * 이제 캘린더 동작을 훅으로 주입받는다(setTrackerCalendarHooks, activate 에서 연결).
 * 미주입(null)이면 캘린더 연동은 조용히 no-op — tracker 단독으로 완결. */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getCompanyDir } from './paths';
import { AGENTS } from './agents';

/* 캘린더 연동 훅 — 실제 구현은 extension.ts(activate)가 구글 캘린더 함수로 주입. */
export interface TrackerCalendarHooks {
  isConnected(): boolean;
  createForTask(task: TrackerTask): Promise<string | null>;
  updateForTask(task: TrackerTask): Promise<boolean>;
  deleteEvent(eventId: string): Promise<boolean>;
}
let _calHooks: TrackerCalendarHooks | null = null;
export function setTrackerCalendarHooks(h: TrackerCalendarHooks) { _calHooks = h; }

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';
export const TASK_PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: '🔴 긴급',
  high:   '🟠 높음',
  normal: '⚪ 보통',
  low:    '🔵 낮음',
};

export interface TrackerTask {
  id: string;
  title: string;
  description?: string;
  owner: 'agent' | 'user' | 'mixed';
  agentIds?: string[];
  createdAt: string;
  dueAt?: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  completedAt?: string;
  sessionDir?: string;
  nudges?: number; /* how many telegram nudges sent for stale user tasks */
  evidence?: string;
  calendarEventId?: string; /* Google Calendar event id (when auto-created) */
  priority?: TaskPriority; /* added v2.78 — defaults to 'normal' on read */
  /* P1-6: recurrence — when set, the task is a template that auto-spawns
     fresh copies after each completion. cadence is a simple semantic key,
     nextRunAt is computed by the recurrence loop. */
  recurrence?: 'daily' | 'weekly' | 'monthly';
  nextRunAt?: string;
  /* P1-7: pre-alarms — track which "due-N" reminders we've already sent
     so the alarm loop doesn't re-fire every cycle. 't1d' = "1 day before",
     't1h' = "1 hour before". */
  preAlarmsSent?: string[];
}

export function _coercePriority(v: unknown): TaskPriority {
  return v === 'urgent' || v === 'high' || v === 'low' ? v : 'normal';
}

export function _trackerPath(): string {
  return path.join(getCompanyDir(), '_shared', 'tracker.json');
}

export function readTracker(): { tasks: TrackerTask[] } {
  try {
    const p = _trackerPath();
    if (!fs.existsSync(p)) return { tasks: [] };
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch { return { tasks: [] }; }
}

/* Module-level event emitter so the sidebar Task TreeView auto-refreshes
   whenever the tracker file is modified through writeTracker (no matter who
   calls it — Secretary, autoMark, edit commands, recurrence loop). */
export const _trackerChangeEmitter = new vscode.EventEmitter<void>();
export const onTrackerChanged = _trackerChangeEmitter.event;

export function writeTracker(t: { tasks: TrackerTask[] }) {
  try {
    const dir = path.join(getCompanyDir(), '_shared');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_trackerPath(), JSON.stringify(t, null, 2));
    try { _trackerChangeEmitter.fire(); } catch { /* no listeners — fine */ }
  } catch { /* never let tracker errors break flow */ }
}

export function _trackerNewId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
}

export function addTrackerTask(partial: Partial<TrackerTask> & { title: string; owner: TrackerTask['owner'] }): TrackerTask {
  const t = readTracker();
  const task: TrackerTask = {
    id: partial.id || _trackerNewId(),
    title: partial.title.slice(0, 200),
    description: partial.description?.slice(0, 1000),
    owner: partial.owner,
    agentIds: partial.agentIds,
    createdAt: partial.createdAt || new Date().toISOString(),
    dueAt: partial.dueAt,
    status: partial.status || (partial.owner === 'agent' ? 'in_progress' : 'pending'),
    sessionDir: partial.sessionDir,
    nudges: 0,
    priority: _coercePriority(partial.priority),
    recurrence: partial.recurrence,
    nextRunAt: partial.nextRunAt,
    preAlarmsSent: partial.preAlarmsSent || [],
  };
  t.tasks.push(task);
  /* Keep file from growing unbounded — drop very old completed/cancelled. */
  const cutoff = Date.now() - 30 * 86_400_000;
  t.tasks = t.tasks.filter(x => {
    if (x.status === 'done' || x.status === 'cancelled') {
      const at = new Date(x.completedAt || x.createdAt).getTime();
      return at >= cutoff;
    }
    return true;
  });
  writeTracker(t);
  /* Auto-create Google Calendar event when due is set + Calendar is wired.
     Fire-and-forget — never blocks tracker creation. Updates the tracker
     entry with the eventId once the API call returns. */
  const _h = _calHooks;
  if (task.dueAt && _h && _h.isConnected()) {
    _h.createForTask(task).then(eventId => {
      if (eventId) {
        updateTrackerTask(task.id, { calendarEventId: eventId });
      }
    }).catch(() => { /* silent — calendar errors shouldn't break tracker */ });
  }
  return task;
}

export function updateTrackerTask(id: string, patch: Partial<TrackerTask>): TrackerTask | null {
  const t = readTracker();
  const idx = t.tasks.findIndex(x => x.id === id);
  if (idx < 0) return null;
  const prev = t.tasks[idx];
  t.tasks[idx] = { ...prev, ...patch };
  const cur = t.tasks[idx];
  if ((patch.status === 'done' || patch.status === 'cancelled') && !cur.completedAt) {
    cur.completedAt = new Date().toISOString();
  }
  writeTracker(t);
  /* Mirror tracker state to Google Calendar so the user's calendar isn't
     stuck on stale plans. Cancelled → delete event; status/title/due change
     while still active → patch event. Best-effort, never blocks. */
  const _h = _calHooks;
  if (cur.calendarEventId && _h && _h.isConnected()) {
    const becameCancelled = patch.status === 'cancelled' && prev.status !== 'cancelled';
    const titleOrDueChanged = (patch.title && patch.title !== prev.title) || (patch.dueAt && patch.dueAt !== prev.dueAt);
    const becameDone = patch.status === 'done' && prev.status !== 'done';
    if (becameCancelled) {
      _h.deleteEvent(cur.calendarEventId).then(ok => {
        if (ok) updateTrackerTask(cur.id, { calendarEventId: undefined });
      }).catch(() => { /* silent */ });
    } else if (becameDone || titleOrDueChanged) {
      _h.updateForTask(cur).catch(() => { /* silent */ });
    }
  }
  return t.tasks[idx];
}

export function listOpenTrackerTasks(): TrackerTask[] {
  return readTracker().tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
}

export function trackerToMarkdown(opts: { onlyOpen?: boolean; max?: number } = {}): string {
  const all = readTracker().tasks;
  const tasks = opts.onlyOpen ? all.filter(t => t.status !== 'done' && t.status !== 'cancelled') : all;
  if (tasks.length === 0) return '';
  /* Sort: status (in_progress > pending > done) → priority (urgent > high > normal > low)
     → newest createdAt within ties. Status before priority means a 'done urgent'
     still falls below an open 'low' — open work always surfaces first. */
  const order = (s: TrackerTask['status']) => s === 'in_progress' ? 0 : s === 'pending' ? 1 : s === 'done' ? 2 : 3;
  tasks.sort((a, b) => {
    const o = order(a.status) - order(b.status);
    if (o !== 0) return o;
    const pa = TASK_PRIORITY_ORDER[_coercePriority(a.priority)];
    const pb = TASK_PRIORITY_ORDER[_coercePriority(b.priority)];
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const max = opts.max || 25;
  const lines: string[] = [];
  for (const t of tasks.slice(0, max)) {
    const icon = t.status === 'done' ? '✅'
      : t.status === 'in_progress' ? '🔄'
      : t.status === 'pending' ? '⏳'
      : '✖️';
    const ownerEmoji = t.owner === 'user' ? '👤'
      : t.owner === 'mixed' ? '👥'
      : (t.agentIds && t.agentIds[0] ? (AGENTS[t.agentIds[0]]?.emoji || '🤖') : '🤖');
    const due = t.dueAt ? ` ⏰${t.dueAt.slice(0, 10)}` : '';
    const aged = (Date.now() - new Date(t.createdAt).getTime()) / 86_400_000;
    const stale = (t.status === 'pending' && aged > 1) ? ' 🟡' : '';
    const prio = _coercePriority(t.priority);
    /* Show priority chip only for non-default — keeps the line short for
       the common 'normal' case while still surfacing urgent/high visually. */
    const prioChip = prio === 'normal' ? '' : ` ${TASK_PRIORITY_LABEL[prio].split(' ')[0]}`;
    const recur = t.recurrence ? ` 🔁${t.recurrence}` : '';
    lines.push(`- ${icon}${prioChip} ${ownerEmoji} \`${t.id.slice(-9)}\` ${t.title}${due}${recur}${stale}`);
  }
  return lines.join('\n');
}
