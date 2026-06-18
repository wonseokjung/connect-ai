/* schedulers.ts — 백그라운드 주기 작업 (할일 nudge·데일리 브리핑·매출 감시·반복·사전알람·날짜유틸).
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: vscode·fs·path + runtime holder(extCtx·activeChatProvider) + 이미 분리된 모듈들
 *   (tracker·telegram-send·conversation-log·calendar·company·paths). LLM 결합 없음.
 * 타이머 핸들(_*Timer)은 이 모듈 내부 전용 — start/stop 함수로만 제어. */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runtime } from './runtime-state';
import { getCompanyDir } from './paths';
import { AGENTS } from './agents';
import { _safeReadText } from './core/fs-safe';
import { _pythonCmd } from './core/proc';
import { readCompanyName } from './company/company';
import { readTracker, writeTracker, addTrackerTask, trackerToMarkdown, _coercePriority } from './tracker';
import { readTelegramConfig, sendTelegramReport, sendTelegramLong } from './telegram-send';
import { appendConversationLog, getConversationsDir } from './conversation-log';
import { isCalendarWriteConnected, refreshCalendarCacheViaOAuth } from './calendar';

export function stopTrackerNudge() {
    if (_trackerNudgeTimer) {
        clearInterval(_trackerNudgeTimer);
        _trackerNudgeTimer = null;
    }
}


/* Stale-task nudge — Secretary scans the tracker every hour for user-owned
   tasks that have been pending >24h or are past their due date, and sends
   a single nudge per task via Telegram. Conservative: 1 ping per task max
   per ~24h, no spam. */
let _trackerNudgeTimer: NodeJS.Timeout | null = null;
export const _NUDGE_WINDOW_MS = 23 * 60 * 60 * 1000; /* re-ping no more than once per ~day */
export async function _runTrackerNudgeOnce() {
    /* Piggyback: refresh calendar_cache.md via OAuth if connected. This means
       OAuth users don't have to also configure the iCal tool — every hour
       we pull fresh events. Failure is silent. */
    if (isCalendarWriteConnected()) {
        refreshCalendarCacheViaOAuth(14).catch(() => { /* never let this break nudges */ });
    }
    try {
        const { token, chatId } = readTelegramConfig();
        if (!token || !chatId) return; // can't nudge without channel
        const tracker = readTracker();
        const now = Date.now();
        let changed = false;
        const nudges: string[] = [];
        for (const t of tracker.tasks) {
            if (t.status === 'done' || t.status === 'cancelled') continue;
            if (t.owner !== 'user' && t.owner !== 'mixed') continue;
            const lastNudge = (t as any)._lastNudgeAt ? new Date((t as any)._lastNudgeAt).getTime() : 0;
            if (now - lastNudge < _NUDGE_WINDOW_MS) continue;
            const ageDays = (now - new Date(t.createdAt).getTime()) / 86_400_000;
            const overdue = t.dueAt && new Date(t.dueAt).getTime() < now;
            if (!overdue && ageDays < 1) continue; /* not stale yet */
            nudges.push(`• \`${t.id.slice(-9)}\` ${t.title}${t.dueAt ? ` ⏰${t.dueAt.slice(0, 10)}` : ''}${overdue ? ' 🔴' : ''}`);
            (t as any)._lastNudgeAt = new Date().toISOString();
            t.nudges = (t.nudges || 0) + 1;
            changed = true;
        }
        if (changed) writeTracker(tracker);
        if (nudges.length > 0) {
            const body = `👀 *비서: 확인해주세요*\n\n진행되지 않은 사용자 작업이 있어요:\n\n${nudges.slice(0, 8).join('\n')}\n\n_완료: \`/done <id>\` · 취소: \`/cancel <id>\`_`;
            await sendTelegramReport(body);
        }
    } catch { /* never let nudge errors break anything */ }
}
export function startTrackerNudgeLoop() {
    if (_trackerNudgeTimer) return;
    /* First check after 5 min, then hourly. Light interval keeps batterylcheap. */
    setTimeout(_runTrackerNudgeOnce, 5 * 60 * 1000);
    _trackerNudgeTimer = setInterval(_runTrackerNudgeOnce, 60 * 60 * 1000);
}

/* ── P0-3: Daily briefing auto-fire ─────────────────────────────────────
   Once per day at the user's configured time (default 09:00), Secretary
   builds and sends a "good morning" brief to Telegram covering:
     - Today's calendar (from calendar_cache.md)
     - Open tracker tasks (priority-sorted, top 5)
     - Yesterday's company highlights (last conversation log entries)
   Single-fire: tracks last-fired date in extension globalState so a VS Code
   restart at 09:30 doesn't double-send. */
let _dailyBriefingTimer: NodeJS.Timeout | null = null;
export const _DAILY_BRIEFING_KEY = 'dailyBriefingLastSentDate';

export function _parseBriefingTime(raw: string): { hour: number; minute: number } | null {
    if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'off') return null;
    const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
}

export async function _runDailyBriefingOnce(force = false): Promise<void> {
    try {
        const cfg = vscode.workspace.getConfiguration('connectAiLab');
        const time = _parseBriefingTime(cfg.get<string>('dailyBriefingTime') || '09:00');
        if (!time && !force) return; // off
        const { token, chatId } = readTelegramConfig();
        if (!token || !chatId) return; // no channel
        const today = new Date().toISOString().slice(0, 10);
        const lastSent = runtime.extCtx?.globalState.get<string>(_DAILY_BRIEFING_KEY, '');
        if (!force && lastSent === today) return; // already sent today

        /* Build the brief — kept text-only so the prompt stays small. */
        const dir = getCompanyDir();
        const company = readCompanyName() || '1인 기업';
        const dateStr = new Date().toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        /* 1. Calendar */
        let calBlock = '';
        try {
            const cal = _safeReadText(path.join(dir, '_shared', 'calendar_cache.md')).trim();
            if (cal) {
                const calLines = cal.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 6);
                if (calLines.length > 0) calBlock = `\n*📅 오늘 일정*\n${calLines.join('\n')}\n`;
            }
        } catch { /* ignore */ }
        if (!calBlock) calBlock = '\n*📅 오늘 일정*\n_등록된 일정이 없어요._\n';

        /* 2. Open tasks (top 5 by priority) */
        let taskBlock = '';
        try {
            const md = trackerToMarkdown({ onlyOpen: true, max: 5 });
            taskBlock = md ? `\n*✅ 우선순위 할 일 (상위 5)*\n${md}\n` : '\n*✅ 할 일*\n_진행 중인 작업이 없어요._\n';
        } catch { /* ignore */ }

        /* 3. Yesterday highlights — last 800 chars of yesterday's log */
        let yhBlock = '';
        try {
            const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            const ypath = path.join(getConversationsDir(), `${yest}.md`);
            const txt = _safeReadText(ypath);
            if (txt.trim()) {
                const tail = txt.slice(-700);
                yhBlock = `\n*📝 어제 회사 활동 (요약 컨텍스트)*\n${tail.slice(0, 700)}\n`;
            }
        } catch { /* ignore */ }

        /* 4. v2.89.136 — 어제 PayPal 매출 (가능하면). business/tools/paypal_revenue.py
           를 LOOKBACK_DAYS=1 으로 동기 실행 → 어제 총 매출·거래수만 한 줄 추출.
           paypal 설정 안 됐거나 실패 시 silently skip — 브리핑 자체는 항상 발송. */
        let revBlock = '';
        try {
            const ppToolDir = path.join(getCompanyDir(), '_agents', 'business', 'tools');
            const ppScript = path.join(ppToolDir, 'paypal_revenue.py');
            const ppJson = path.join(ppToolDir, 'paypal_revenue.json');
            if (fs.existsSync(ppScript) && fs.existsSync(ppJson)) {
                const env = { ...process.env, LOOKBACK_DAYS: '1' };
                const r = await new Promise<{ exitCode: number; output: string }>((resolve) => {
                    const cp = require('child_process');
                    const p = cp.spawn(_pythonCmd(), [ppScript], { cwd: ppToolDir, env });
                    let out = '';
                    p.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
                    p.on('close', (code: number) => resolve({ exitCode: code, output: out }));
                    setTimeout(() => { try { p.kill(); } catch {} resolve({ exitCode: -1, output: out }); }, 15000);
                });
                if (r.exitCode === 0 && r.output) {
                    /* 출력 마크다운에서 첫 통화 행 추출 — 예: "| **USD** | 14.95 | -0 | ..." */
                    const m = r.output.match(/\|\s*\*\*([A-Z]{3})\*\*\s*\|\s*([\d.,]+)\s*\|[^|]+\|[^|]+\|\s*\*\*([\d.,]+)\*\*\s*\|\s*(\d+)건/);
                    if (m) {
                        revBlock = `\n*💰 어제 매출*\n  ${m[1]} ${m[2]} (순매출 ${m[3]}, ${m[4]}건)\n`;
                    } else if (/거래가 없어요/.test(r.output)) {
                        revBlock = '\n*💰 어제 매출*\n  _거래 0건_\n';
                    }
                }
            }
        } catch { /* ignore — briefing 자체는 항상 진행 */ }

        const body = `🌅 *${company} — 아침 브리핑*\n_${dateStr}_\n${calBlock}${taskBlock}${revBlock}${yhBlock}\n_명령: \`/today\` 다시 보기 · \`/tools\` 도구 상태_`;
        await sendTelegramReport(body);
        if (runtime.extCtx) {
            runtime.extCtx.globalState.update(_DAILY_BRIEFING_KEY, today);
        }
        try { appendConversationLog({ speaker: '비서', emoji: '🌅', section: '데일리 브리핑', body: body.slice(0, 1000) }); } catch { /* ignore */ }
        /* v2.82: removed the system-note injection into chat. Daily briefing
           now lives only in: (1) telegram, (2) company dashboard "회사
           활동 로그" + KPI strip, (3) conversation log file. The chat is
           kept as a clean conversation surface — no auto-injected cards. */
    } catch { /* never let briefing errors break the extension */ }
}

export function startDailyBriefingLoop() {
    if (_dailyBriefingTimer) return;
    /* Check every minute — cheap, gives ±60s precision on the configured time.
       The single-fire guard via globalState makes this safe to over-tick. */
    _dailyBriefingTimer = setInterval(() => {
        try {
            const cfg = vscode.workspace.getConfiguration('connectAiLab');
            const time = _parseBriefingTime(cfg.get<string>('dailyBriefingTime') || '09:00');
            if (!time) return;
            const now = new Date();
            if (now.getHours() === time.hour && now.getMinutes() === time.minute) {
                _runDailyBriefingOnce().catch(() => { /* silent */ });
            }
        } catch { /* ignore */ }
    }, 60 * 1000);
}

export function stopDailyBriefingLoop() {
    if (_dailyBriefingTimer) {
        clearInterval(_dailyBriefingTimer);
        _dailyBriefingTimer = null;
    }
}

/* ── v2.89.137 — Revenue Watcher (PayPal polling) ──────────────────────────
   5분마다 paypal_revenue.py OUTPUT=json 호출 → 마지막 본 transaction id 와
   비교 → 새 결제 발견 시 텔레그램 푸시 + 사무실 영숙 책상 펄스. paypal 미설정
   시 silently skip. 이게 진짜 "AI 회사가 자고 있어도 결제 알아차림" 의 코어. */
let _revenueWatcherTimer: NodeJS.Timeout | null = null;
export const _REVENUE_LAST_SEEN_KEY = 'revenueLastSeenTxId';
export const _REVENUE_LAST_SEEN_TS_KEY = 'revenueLastSeenTxTs';
export const REVENUE_POLL_INTERVAL_MS = 5 * 60 * 1000; /* 5분 */

export async function _runRevenueWatcherOnce(): Promise<void> {
    try {
        const ppToolDir = path.join(getCompanyDir(), '_agents', 'business', 'tools');
        const ppScript = path.join(ppToolDir, 'paypal_revenue.py');
        const ppJson = path.join(ppToolDir, 'paypal_revenue.json');
        if (!fs.existsSync(ppScript) || !fs.existsSync(ppJson)) return;
        const cfg = JSON.parse(_safeReadText(ppJson) || '{}');
        if (!cfg.CLIENT_ID || !cfg.CLIENT_SECRET) return; /* 미설정 — silent */

        const env = { ...process.env, OUTPUT: 'json', LOOKBACK_DAYS: '2' };
        const r = await new Promise<{ exitCode: number; output: string }>((resolve) => {
            const cp = require('child_process');
            const p = cp.spawn(_pythonCmd(), [ppScript], { cwd: ppToolDir, env });
            let out = '';
            p.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
            p.on('close', (code: number) => resolve({ exitCode: code, output: out }));
            setTimeout(() => { try { p.kill(); } catch {} resolve({ exitCode: -1, output: out }); }, 20000);
        });
        if (r.exitCode !== 0 || !r.output) return;

        let data: any;
        try { data = JSON.parse(r.output); } catch { return; }
        const txs: any[] = Array.isArray(data?.transactions) ? data.transactions : [];
        if (txs.length === 0) return;

        const lastSeenTs = Number(runtime.extCtx?.globalState.get<number>(_REVENUE_LAST_SEEN_TS_KEY, 0) || 0);
        const lastSeenId = String(runtime.extCtx?.globalState.get<string>(_REVENUE_LAST_SEEN_KEY, '') || '');

        /* 첫 실행 — 알림 보내지 말고 baseline 만 기록 (사용자 폭주 방지) */
        if (lastSeenTs === 0) {
            const newest = txs[0];
            runtime.extCtx?.globalState.update(_REVENUE_LAST_SEEN_TS_KEY, newest.ts_epoch);
            runtime.extCtx?.globalState.update(_REVENUE_LAST_SEEN_KEY, newest.id);
            return;
        }

        /* 새 거래 = lastSeenTs 보다 ts 큰 것 (refund 포함, 사용자에게 다 알림). */
        const fresh = txs.filter(t => t.ts_epoch > lastSeenTs && t.id !== lastSeenId);
        if (fresh.length === 0) return;

        /* 가장 최신부터 역순 정렬 → 알림은 옛 → 신순 */
        fresh.sort((a, b) => a.ts_epoch - b.ts_epoch);
        for (const tx of fresh) {
            const isRefund = !!tx.is_refund;
            const arrow = isRefund ? '↩️ 환불' : '💰 새 결제';
            const sign = isRefund ? '-' : '+';
            const amount = `${sign}${Math.abs(tx.value).toFixed(2)} ${tx.currency}`;
            const subj = tx.subject || '(설명 없음)';
            const monthTotal = data?.totals?.by_period?.month || 0;
            const cur = (data?.totals?.by_currency && Object.keys(data.totals.by_currency)[0]) || tx.currency;
            const body = `${arrow} 도착!\n*${subj}*\n${amount}\n_30일 누적: ${monthTotal.toFixed(2)} ${cur}_`;
            try { await sendTelegramReport(body); } catch { /* ignore */ }
            try {
                appendConversationLog({
                    speaker: '비서', emoji: isRefund ? '↩️' : '💰',
                    section: isRefund ? '환불 감지' : '새 결제',
                    body: `${arrow}: ${subj} ${amount}`
                });
            } catch { /* ignore */ }
            /* 사무실 영숙 책상 펄스 + 알림 */
            try {
                runtime.activeChatProvider?.pulseAgent?.('secretary', isRefund ? '↩️' : '💰', 6000, `${arrow}: ${amount}`);
            } catch { /* ignore */ }
        }

        /* baseline 업데이트 — 가장 최신 거래로 */
        const newest = fresh[fresh.length - 1];
        runtime.extCtx?.globalState.update(_REVENUE_LAST_SEEN_TS_KEY, newest.ts_epoch);
        runtime.extCtx?.globalState.update(_REVENUE_LAST_SEEN_KEY, newest.id);
    } catch (e: any) {
        console.warn('[Connect AI] revenue watcher tick 실패:', e?.message || e);
    }
}

export function startRevenueWatcherLoop() {
    if (_revenueWatcherTimer) return;
    /* 첫 tick: activate 후 30초. 그 뒤 5분마다. */
    setTimeout(() => { _runRevenueWatcherOnce(); }, 30_000);
    _revenueWatcherTimer = setInterval(() => {
        _runRevenueWatcherOnce();
    }, REVENUE_POLL_INTERVAL_MS);
}

export function stopRevenueWatcherLoop() {
    if (_revenueWatcherTimer) {
        clearInterval(_revenueWatcherTimer);
        _revenueWatcherTimer = null;
    }
}

export function _parseLooseDate(input: string): Date | null {
    const s = input.trim();
    if (!s) return null;
    /* +Nh / +Nm / +Nd offset */
    const off = s.match(/^\+(\d+)\s*(h|m|d|시간|분|일)$/i);
    if (off) {
        const n = parseInt(off[1], 10);
        const u = off[2].toLowerCase();
        const ms = (u === 'h' || u === '시간') ? n * 3600_000
                 : (u === 'm' || u === '분')   ? n * 60_000
                 : (u === 'd' || u === '일')   ? n * 86_400_000
                 : 0;
        if (ms > 0) return new Date(Date.now() + ms);
    }
    /* "내일 [HH:MM]" / "오늘 [HH:MM]" */
    const rel = s.match(/^(내일|오늘|모레)\s*(\d{1,2}):(\d{2})?$/);
    if (rel) {
        const offsetDays = rel[1] === '내일' ? 1 : rel[1] === '모레' ? 2 : 0;
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        const hh = parseInt(rel[2], 10);
        const mm = rel[3] ? parseInt(rel[3], 10) : 0;
        d.setHours(hh, mm, 0, 0);
        return d;
    }
    /* Bare "내일" / "오늘" / "모레" → 09:00 default */
    if (/^(내일|오늘|모레)$/.test(s)) {
        const offsetDays = s === '내일' ? 1 : s === '모레' ? 2 : 0;
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        d.setHours(9, 0, 0, 0);
        return d;
    }
    /* ISO-ish — let Date constructor try. Reject NaN. */
    const iso = new Date(s.replace(/[ T]/, 'T'));
    if (!isNaN(iso.getTime())) return iso;
    return null;
}

/* P1-6: Compute the next run time for a recurring task based on cadence.
   Uses local time so "매일 09:00" lands at 09:00 in the user's timezone,
   which is what the user expects when they say "매일 아침". */
export function _computeNextRunAt(prev: Date, cadence: 'daily' | 'weekly' | 'monthly'): Date {
  const next = new Date(prev);
  if (cadence === 'daily')   next.setDate(next.getDate() + 1);
  if (cadence === 'weekly')  next.setDate(next.getDate() + 7);
  if (cadence === 'monthly') next.setMonth(next.getMonth() + 1);
  return next;
}

/* P1-6: Recurrence loop — every minute, scans tracker for tasks whose
   nextRunAt has passed. For each, spawns a fresh "instance" copy in
   pending status and bumps the template's nextRunAt forward. The original
   task acts as the template; the spawned copies are what the user actually
   completes. Templates have status='in_progress' permanently — they're
   never marked done by the user. */
let _recurrenceTimer: NodeJS.Timeout | null = null;

export function _runRecurrenceTickOnce() {
    try {
        const tracker = readTracker();
        const now = Date.now();
        let anySpawned = false;
        for (const t of tracker.tasks) {
            if (!t.recurrence) continue;
            if (t.status === 'cancelled') continue;
            if (!t.nextRunAt) {
                /* First time we've seen this template — schedule from createdAt
                   so freshly-added recurring tasks don't fire immediately. */
                const baseline = new Date(t.createdAt);
                t.nextRunAt = _computeNextRunAt(baseline, t.recurrence).toISOString();
                continue;
            }
            const due = new Date(t.nextRunAt).getTime();
            if (now < due) continue;
            /* Spawn a fresh instance (without recurrence — only the template
               is recurring). Owner inherits from template. */
            addTrackerTask({
                title: t.title,
                description: t.description,
                owner: t.owner,
                agentIds: t.agentIds,
                priority: _coercePriority(t.priority),
                dueAt: t.nextRunAt,
                status: t.owner === 'agent' ? 'in_progress' : 'pending',
            });
            /* Advance template's nextRunAt — handles the "machine was off
               overnight, multiple cycles missed" case by jumping forward
               until we're back in the future. */
            let advance = new Date(t.nextRunAt);
            while (advance.getTime() <= now) {
                advance = _computeNextRunAt(advance, t.recurrence);
            }
            t.nextRunAt = advance.toISOString();
            anySpawned = true;
        }
        if (anySpawned) writeTracker(tracker);
    } catch { /* never let recurrence break anything */ }
}

export function startRecurrenceLoop() {
    if (_recurrenceTimer) return;
    /* First check after 1 minute, then every minute. The 1-min granularity
       is the same as the daily-briefing loop, so the two cooperate cleanly
       without needing a shared scheduler. */
    setTimeout(_runRecurrenceTickOnce, 60 * 1000);
    _recurrenceTimer = setInterval(_runRecurrenceTickOnce, 60 * 1000);
}
export function stopRecurrenceLoop() {
    if (_recurrenceTimer) { clearInterval(_recurrenceTimer); _recurrenceTimer = null; }
}

/* P1-7: Pre-alarms — sends a Telegram nudge 1 day before and 1 hour before
   each task's dueAt. Tracked via preAlarmsSent[] so each window only fires
   once per task. Independent from stale-task nudges (which fire AFTER due).
   Tick is hourly — finer granularity wastes battery, the 1d-before window
   has 24h of slack so the user gets the reminder on a sensible cadence. */
let _preAlarmTimer: NodeJS.Timeout | null = null;
export const _PRE_ALARM_WINDOWS: Array<{ key: string; ms: number; label: string }> = [
    { key: 't1d', ms: 24 * 60 * 60_000, label: '내일' },
    { key: 't1h', ms:  1 * 60 * 60_000, label: '1시간 후' },
];

export async function _runPreAlarmTickOnce(): Promise<void> {
    try {
        const { token, chatId } = readTelegramConfig();
        if (!token || !chatId) return;
        const tracker = readTracker();
        const now = Date.now();
        let changed = false;
        const lines: string[] = [];
        for (const t of tracker.tasks) {
            if (t.status === 'done' || t.status === 'cancelled') continue;
            if (!t.dueAt) continue;
            const due = new Date(t.dueAt).getTime();
            if (isNaN(due) || due < now) continue;
            const remaining = due - now;
            const sent = t.preAlarmsSent || [];
            for (const w of _PRE_ALARM_WINDOWS) {
                if (sent.includes(w.key)) continue;
                /* Fire when the remaining time has dropped below the window
                   threshold but the task is still in the future. So a 1d
                   alarm fires when due is within 24h, 1h alarm fires within
                   60min. The "below" condition (not "equal") is what makes
                   this work even if the tick lands a few minutes late. */
                if (remaining <= w.ms) {
                    const a = (t.agentIds && t.agentIds[0]) ? AGENTS[t.agentIds[0]] : null;
                    const owner = a ? `${a.emoji} ${a.name}` : (t.owner === 'user' ? '👤 사용자' : '🤖 에이전트');
                    lines.push(`• ⏰${w.label} \`${t.id.slice(-9)}\` ${owner}: ${t.title}`);
                    sent.push(w.key);
                    t.preAlarmsSent = sent;
                    changed = true;
                }
            }
        }
        if (changed) writeTracker(tracker);
        if (lines.length > 0) {
            const body = `🔔 *사전 알림*\n\n${lines.slice(0, 8).join('\n')}\n\n_미루기: \`/reschedule <id> <시간>\` · 완료: \`/done <id>\`_`;
            await sendTelegramReport(body);
        }
    } catch { /* silent */ }
}

export function startPreAlarmLoop() {
    if (_preAlarmTimer) return;
    /* First tick after 2 min, then hourly. The 2-min initial gives the
       extension time to fully boot before we start firing user alerts. */
    setTimeout(_runPreAlarmTickOnce, 2 * 60 * 1000);
    _preAlarmTimer = setInterval(_runPreAlarmTickOnce, 60 * 60 * 1000);
}
export function stopPreAlarmLoop() {
    if (_preAlarmTimer) { clearInterval(_preAlarmTimer); _preAlarmTimer = null; }
}

/* P1-5: Pull markdown checkbox items out of an agent's output. We accept
   `- [ ]`, `* [ ]`, and numbered `1. [ ]` forms so different agents'
   formatting all flow into one tracker. Only unchecked items count —
   `[x]` is already-done, and we don't try to retroactively register
   completed work. Capped to 5 per output to prevent runaway lists. */
export function _harvestActionItems(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s*\[\s\]\s+(.{4,200})$/);
    if (m) {
      const title = m[1].trim().replace(/\s+/g, ' ');
      if (title && !out.includes(title)) out.push(title);
      if (out.length >= 5) break;
    }
  }
  return out;
}
