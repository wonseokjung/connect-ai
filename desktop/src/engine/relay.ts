// 🌍 외부 접속 릴레이 — Firebase RTDB를 중계로 폰 웹 리모컨이 어디서든 회사를 지휘.
// 구조: 앱이 cai-remote/<pair>/state 에 상태를 쓰고, cmd 를 3.5초마다 읽어 실행.
//       폰 페이지(remote-web.html)는 state 를 읽고 cmd 를 쓴다. (광장과 같은 공개 RTDB 사용)
// 보안: pair = 랜덤 코드(경로 = 능력 키). 주소를 아는 사람만 접근.
import axios from 'axios';

export interface RelayDeps {
  db: () => string;                                       // RTDB URL (plazaDbUrl)
  pair: () => string;                                     // 페어링 코드
  company: () => string;
  status: () => any;                                      // opsPublic()
  startCycle: () => Promise<any>;
  execute: (titles: string[], humanTitles: string[]) => Promise<any>;
  stop: () => any;
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastCmdId = '';
let lastStateHash = '';
let lastPushAt = 0;

const node = (db: string, pair: string, p: string) => `${db.replace(/\/+$/, '')}/cai-remote/${pair}/${p}.json`;

// 상태를 폰이 보기 좋은 크기로 다듬는다 (RTDB 쓰기 비용·속도)
function slimState(deps: RelayDeps): any {
  const s = deps.status() || {};
  return {
    company: deps.company(), t: Date.now(),
    ops: {
      running: !!s.running, busy: !!s.busy, phase: s.phase || 'idle', cycle: s.cycle || 0,
      summary: (s.summary || '').slice(0, 160), executingTitle: (s.executingTitle || '').slice(0, 80),
      actions: (s.actions || []).slice(0, 8).map((a: any) => ({ title: a.title, assignee: a.assignee || 'agent', risk: a.risk || 'safe' })),
      shipped: (s.shipped || []).slice(0, 8).map((x: any) => ({ title: x.title, ok: !!x.ok, artifacts: (x.artifacts || []).slice(0, 5) })),
      feed: (s.feed || []).slice(0, 8).map((f: any) => ({ icon: f.icon, text: f.text })),
    },
  };
}

async function pushState(deps: RelayDeps, force = false): Promise<void> {
  const db = deps.db(), pair = deps.pair(); if (!db || !pair) return;
  const slim = slimState(deps);
  const hash = JSON.stringify([slim.ops.phase, slim.ops.cycle, slim.ops.executingTitle, slim.ops.feed[0]?.text, slim.ops.actions.length, slim.ops.shipped.length]);
  if (!force && hash === lastStateHash && Date.now() - lastPushAt < 25000) return;   // 변화 없으면 25초 하트비트만
  lastStateHash = hash; lastPushAt = Date.now();
  await axios.put(node(db, pair, 'state'), JSON.stringify(slim), { timeout: 8000 }).catch(() => undefined);
}

async function tick(deps: RelayDeps): Promise<void> {
  const db = deps.db(), pair = deps.pair(); if (!db || !pair) return;
  // ① 명령 읽기 — 폰이 쓴 cmd 처리 (id 중복 가드)
  const r = await axios.get(node(db, pair, 'cmd'), { timeout: 8000 }).catch(() => null);
  const cmd = r?.data;
  if (cmd && cmd.id && cmd.id !== lastCmdId) {
    lastCmdId = cmd.id;
    axios.delete(node(db, pair, 'cmd'), { timeout: 8000 }).catch(() => undefined);   // 처리 표시(삭제)
    try {
      if (cmd.kind === 'run') await deps.startCycle();
      else if (cmd.kind === 'execute') await deps.execute(cmd.titles || [], cmd.humanTitles || []);
      else if (cmd.kind === 'stop') deps.stop();
    } catch { /* 다음 상태 push가 결과를 알려줌 */ }
    await pushState(deps, true);
    return;
  }
  // ② 상태 하트비트
  await pushState(deps);
}

export function startRelay(deps: RelayDeps): void {
  if (timer) return;
  timer = setInterval(() => { tick(deps).catch(() => undefined); }, 3500);
}
export function stopRelay(): void { if (timer) clearInterval(timer); timer = null; }
export function relayPush(deps: RelayDeps): void { pushState(deps, true).catch(() => undefined); }   // 상태 바뀔 때 즉시
