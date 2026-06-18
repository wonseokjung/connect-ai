/* approvals.ts — 위험 액션 승인 게이트 (파일기반 pending/history/executor).
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: fs·path·child_process(spawnSync) + paths·agents·conversation-log + runtime holder
 *   (activeChatProvider.pulseAgent·approvalsPanelProvider.refresh). 패널 클래스는 본문 잔류. */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { getCompanyDir } from './paths';
import { AGENTS } from './agents';
import { appendConversationLog } from './conversation-log';
import { runtime } from './runtime-state';

/* 승인 대기 알림 훅 — createApproval 이 사용자에게 "승인 필요" 카드를 띄울 때 호출.
 * 실제 구현(텔레그램 sendTelegramReport)은 activate 에서 주입 — approvals 가 telegram 을
 * 직접 의존하지 않도록 역전(IoC). 미주입이면 no-op. */
let _approvalNotifier: ((text: string) => void) | null = null;
export function setApprovalNotifier(fn: (text: string) => void) { _approvalNotifier = fn; }

/* ── P0-4: Approval gate ──────────────────────────────────────────────────
   When an agent wants to do something risky (deploy, send, post, delete)
   the action lands as a markdown file in approvals/pending/ instead of
   executing. Secretary fires a Telegram card; user types /approve <id> or
   /reject <id> (or taps in the sidebar) to release or kill the action.
   File-based on purpose:
     - Survives restarts (no in-memory state)
     - Visible in git history (audit log)
     - User can grep/edit before approving */
export interface PendingApproval {
    id: string;
    agentId: string;
    title: string;          /* one-line description */
    summary: string;        /* short rationale */
    payload: any;           /* opaque blob the executor needs */
    kind: string;           /* e.g. 'youtube.comment_reply', 'deploy.prod', 'instagram.post' */
    createdAt: string;
}

export function _approvalsPendingDir(): string {
    return path.join(getCompanyDir(), 'approvals', 'pending');
}
export function _approvalsHistoryDir(): string {
    return path.join(getCompanyDir(), 'approvals', 'history');
}
export function _approvalsExecutorsDir(): string {
    /* Optional executors (`{kind}.js`) — when an approval is ✅, we look
       here for a script to run. Keeps the gate decoupled from any specific
       integration; agents register an executor when they ship. */
    return path.join(getCompanyDir(), 'approvals', 'executors');
}

export function _approvalNewId(): string {
    const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 6);
    return `apr-${stamp}-${rand}`;
}

export function createApproval(req: Omit<PendingApproval, 'id' | 'createdAt'>): PendingApproval {
    const dir = _approvalsPendingDir();
    fs.mkdirSync(dir, { recursive: true });
    const ap: PendingApproval = {
        id: _approvalNewId(),
        createdAt: new Date().toISOString(),
        ...req,
    };
    /* Markdown front for human-readable preview (so opening the file in VS
       Code shows what's about to happen), JSON fence for the executor. */
    const a = AGENTS[ap.agentId];
    const ownerLine = a ? `${a.emoji} ${a.name}` : ap.agentId;
    const md = `# ⏳ 승인 대기 — ${ap.title}

- **에이전트:** ${ownerLine}
- **종류:** \`${ap.kind}\`
- **요청 시각:** ${ap.createdAt}
- **id:** \`${ap.id.slice(-9)}\`

## 요약

${ap.summary || '_(없음)_'}

## 사용자 결정

텔레그램에서 \`/approve ${ap.id.slice(-9)}\` 또는 \`/reject ${ap.id.slice(-9)}\` —
사이드바 "승인 대기" 패널에서도 가능합니다.

## payload (실행기에 전달)

\`\`\`json
${JSON.stringify(ap.payload, null, 2)}
\`\`\`
`;
    fs.writeFileSync(path.join(dir, `${ap.id}.md`), md);
    fs.writeFileSync(path.join(dir, `${ap.id}.json`), JSON.stringify(ap, null, 2));
    /* Telegram card so the user knows something needs them — only fires
       when bot is configured. Daily briefing also surfaces this list. */
    _approvalNotifier?.(`⏳ *승인 대기 (${ownerLine})*\n\n${ap.title}\n\n${ap.summary.slice(0, 300)}\n\n_승인: \`/approve ${ap.id.slice(-9)}\` · 거부: \`/reject ${ap.id.slice(-9)}\`_`);
    try { appendConversationLog({ speaker: ownerLine, emoji: '⏳', section: '승인 요청', body: `${ap.title} (${ap.kind})\n${ap.summary.slice(0, 300)}` }); } catch { /* ignore */ }
    /* Office indicator — secretary's desk gets ⏳ pulse since secretary owns
       the user-facing approval workflow. The originating agent ALSO pulses
       so user sees who requested it. Both decay quickly so the office
       doesn't get cluttered. */
    try {
        runtime.activeChatProvider?.pulseAgent?.(ap.agentId, '⏳', 3500, `${ap.title} 승인 요청`);
        runtime.activeChatProvider?.pulseAgent?.('secretary', '🔔', 3500);
    } catch { /* ignore */ }
    /* v2.82: removed chat sidebar injection — approvals now surface via
       (1) telegram card, (2) status bar "⚠️ 승인 N건" badge, (3) dashboard
       "⏳ 승인 대기" section. Chat stays clean for actual conversation. */
    /* Refresh the dedicated approvals webview if it's open. */
    try { runtime.approvalsPanelProvider?.refresh(); } catch { /* ignore */ }
    return ap;
}

export function listPendingApprovals(): PendingApproval[] {
    const dir = _approvalsPendingDir();
    if (!fs.existsSync(dir)) return [];
    const out: PendingApproval[] = [];
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
            const txt = fs.readFileSync(path.join(dir, f), 'utf-8');
            const ap = JSON.parse(txt);
            if (ap && ap.id) out.push(ap);
        } catch { /* skip malformed */ }
    }
    out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return out;
}

export function findApprovalByShortId(short: string): PendingApproval | null {
    const all = listPendingApprovals();
    return all.find(a => a.id === short) || all.find(a => a.id.endsWith(short)) || null;
}

export async function resolveApproval(id: string, decision: 'approved' | 'rejected', reason: string = ''): Promise<{ ok: boolean; message: string; ap?: PendingApproval }> {
    const ap = findApprovalByShortId(id);
    if (!ap) return { ok: false, message: '해당 id 승인 요청을 찾지 못했어요.' };
    const pendingDir = _approvalsPendingDir();
    const histDir = _approvalsHistoryDir();
    fs.mkdirSync(histDir, { recursive: true });
    /* Move both files (md + json) to history with decision suffix. */
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const tag = decision === 'approved' ? 'OK' : 'NO';
    const baseSrc = path.join(pendingDir, ap.id);
    const baseDst = path.join(histDir, `${stamp}_${tag}_${ap.id}`);
    let executorOutput = '';
    let executorOk = true;
    if (decision === 'approved') {
        /* Try to dispatch the executor — file `approvals/executors/{kind}.js`.
           Best-effort: if missing or it throws, we still record the approval
           but warn the user. No executor means "approval recorded, do it
           manually" — useful for early stage when integrations land in
           waves. */
        const execPath = path.join(_approvalsExecutorsDir(), `${ap.kind}.js`);
        if (fs.existsSync(execPath)) {
            try {
                /* Use spawnSync for isolation — no shared module cache. */
                const res = spawnSync('node', [execPath], {
                    cwd: getCompanyDir(),
                    encoding: 'utf-8',
                    timeout: 60000,
                    input: JSON.stringify(ap.payload),
                });
                executorOutput = (res.stdout || '') + (res.stderr ? `\n[stderr]\n${res.stderr}` : '');
                executorOk = res.status === 0;
            } catch (e: any) {
                executorOk = false;
                executorOutput = `executor error: ${e?.message || e}`;
            }
        } else {
            executorOutput = `(no executor for ${ap.kind} — approval recorded, manual follow-up)`;
        }
    }
    /* Append decision to the markdown for audit. */
    try {
        const mdPath = `${baseSrc}.md`;
        if (fs.existsSync(mdPath)) {
            const append = `\n---\n\n## 결정: **${decision === 'approved' ? '✅ 승인' : '✖️ 거부'}**\n- 시각: ${new Date().toISOString()}\n- 사유: ${reason || '_(없음)_'}\n${decision === 'approved' ? `- 실행 결과: ${executorOk ? 'OK' : 'FAIL'}\n\n\`\`\`\n${executorOutput.slice(0, 1500)}\n\`\`\`\n` : ''}`;
            fs.appendFileSync(mdPath, append);
        }
    } catch { /* ignore */ }
    /* Move pending → history. */
    try {
        for (const ext of ['.md', '.json']) {
            const src = `${baseSrc}${ext}`;
            const dst = `${baseDst}${ext}`;
            if (fs.existsSync(src)) fs.renameSync(src, dst);
        }
    } catch { /* ignore */ }
    const a = AGENTS[ap.agentId];
    const ownerLine = a ? `${a.emoji} ${a.name}` : ap.agentId;
    try { appendConversationLog({ speaker: ownerLine, emoji: decision === 'approved' ? '✅' : '✖️', section: '승인 결과', body: `${ap.title} (${ap.kind}) → ${decision}${reason ? '\n사유: ' + reason : ''}${decision === 'approved' && !executorOk ? '\n실행 실패' : ''}` }); } catch { /* ignore */ }
    return { ok: true, ap, message: decision === 'approved'
        ? `✅ 승인됨 — ${ap.title}${executorOutput ? `\n\n${executorOutput.slice(0, 600)}` : ''}`
        : `✖️ 거부됨 — ${ap.title}` };
}
