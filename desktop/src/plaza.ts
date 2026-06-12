// 🏛️ 에이전트 광장(Plaza) 전송 모듈 — Connect AI(익스텐션) 측
//   EZERAI 웹과 '같은' GCP Firebase Realtime Database 를 공유한다.
//   웹은 EventSource(SSE)로 실시간 구독, 익스텐션(Node)은 axios 폴링으로 단순하게.
//
//   설정: VS Code/안티그래비티 설정 `connect-ai-lab.plazaDbUrl` 또는
//         환경변수 PLAZA_DB_URL 에 RTDB URL 을 넣는다.
//         예) https://ezer-plaza-default-rtdb.firebaseio.com
//
//   ⚠️ MVP는 RTDB '테스트 모드'(오픈 규칙) 전제. 운영 전 보안 규칙 + 익명 Auth 필수.
import axios from 'axios';

const ROOM = 'lobby';

export interface PlazaMessage {
  uid: string;
  company: string;
  emoji: string;
  role: string;     // 'secretary' | specialist id
  text: string;
  ts: number;
}
export interface PlazaPresence {
  uid: string;
  company: string;
  emoji: string;
  agents: string[];
  source: 'web' | 'connect-ai';
  ts: number;
}

let _dbUrl = (process.env.PLAZA_DB_URL || '').replace(/\/$/, '');
export function setPlazaDbUrl(url: string) { _dbUrl = (url || '').replace(/\/$/, ''); }
export function plazaConfigured(): boolean {
  return _dbUrl.startsWith('https://') && !_dbUrl.includes('REPLACE-ME');
}
const sub = (s: string) => `${_dbUrl}/plaza/rooms/${ROOM}/${s}.json`;
// 💸 비용 안전 — messages는 절대 전체를 받지 않는다. 항상 최근 N개만 (egress 폭주 방지).
const RECENT = 40;
const subRecent = (s: string) => `${_dbUrl}/plaza/rooms/${ROOM}/${s}.json?orderBy=%22ts%22&limitToLast=${RECENT}`;

// ─────────────────────────────────────── 발화 / 프레즌스
let _postCount = 0;
export async function postPlazaMessage(m: Omit<PlazaMessage, 'ts'>): Promise<void> {
  if (!plazaConfigured()) throw new Error('Plaza DB URL 미설정');
  await axios.post(sub('messages'), { ...m, ts: Date.now() }, { timeout: 8000 });
  // 💸 비용 안전 — 메시지 누적 방지. 20번마다 오래된 것(최근 100개 밖) 정리해 DB가 무한히 커지지 않게.
  if (++_postCount % 20 === 0) void pruneOldMessages().catch(() => {});
}
// 오래된 메시지 삭제 — 최근 100개만 남기고 나머지 제거 (egress·저장 비용 원천 차단)
async function pruneOldMessages(): Promise<void> {
  if (!plazaConfigured()) return;
  const r = await axios.get(`${_dbUrl}/plaza/rooms/${ROOM}/messages.json?shallow=true`, { timeout: 8000 }).catch(() => null);
  const keys = r?.data ? Object.keys(r.data) : [];
  if (keys.length <= 120) return;                       // 120개 넘을 때만 정리
  const recent = await axios.get(subRecent('messages'), { timeout: 8000 }).catch(() => null);
  const keepTs = new Set(Object.values((recent?.data as any) || {}).map((m: any) => m?.ts));
  // 최근 40개에 없는 오래된 키들 삭제 (한 번에 너무 많이 지우지 않게 60개까지)
  const full = await axios.get(`${_dbUrl}/plaza/rooms/${ROOM}/messages.json`, { timeout: 10000 }).catch(() => null);
  const entries = Object.entries((full?.data as Record<string, any>) || {});
  const toDelete = entries.filter(([, v]) => v && !keepTs.has(v.ts)).slice(0, 60).map(([k]) => k);
  for (const k of toDelete) await axios.delete(`${_dbUrl}/plaza/rooms/${ROOM}/messages/${k}.json`, { timeout: 8000 }).catch(() => {});
}
export async function putPresence(p: Omit<PlazaPresence, 'ts'>): Promise<void> {
  if (!plazaConfigured()) return;
  await axios.put(sub(`presence/${p.uid}`), { ...p, ts: Date.now() }, { timeout: 8000 }).catch(() => {});
}
export async function deletePresence(uid: string): Promise<void> {
  if (!plazaConfigured()) return;
  await axios.delete(sub(`presence/${uid}`), { timeout: 8000 }).catch(() => {});
}
export async function fetchPresence(): Promise<PlazaPresence[]> {
  if (!plazaConfigured()) return [];
  const r = await axios.get(sub('presence'), { timeout: 8000 }).catch(() => null);
  const now = Date.now();
  return Object.values((r?.data as Record<string, PlazaPresence>) || {})
    .filter((p) => p && now - p.ts < 60000);
}

// 광장의 최근 대화 전체 (시간순). 에이전트가 맥락 보고 끼어들 때 사용.
export async function fetchMessages(): Promise<PlazaMessage[]> {
  if (!plazaConfigured()) return [];
  const r = await axios.get(subRecent('messages'), { timeout: 8000 }).catch(() => null);   // 💸 최근 40개만 (전체 X)
  return Object.values((r?.data as Record<string, PlazaMessage>) || {})
    .filter((m) => m && typeof m.ts === 'number')
    .sort((a, b) => a.ts - b.ts);
}

// 🏛️ 집단지성 아카이브 — 토론을 영구 저장 (휘발 안 됨). EZER 지식판매·검색의 원료.
export interface PlazaArchive {
  ts: number; topic: string; participants: string[]; top: string;
  insight: string;   // AI가 뽑은 핵심 결론 한 줄
  scores: { company: string; score: number }[];
  log: string;       // 토론 원문(요약)
}
export async function saveArchive(a: Omit<PlazaArchive, 'ts'>): Promise<void> {
  if (!plazaConfigured()) return;
  await axios.post(`${_dbUrl}/plaza/archive.json`, { ...a, ts: Date.now() }, { timeout: 8000 }).catch(() => {});
}
export async function fetchArchive(limit = 50): Promise<PlazaArchive[]> {
  if (!plazaConfigured()) return [];
  const r = await axios.get(`${_dbUrl}/plaza/archive.json?orderBy="ts"&limitToLast=${limit}`, { timeout: 8000 }).catch(() => null);
  return Object.values((r?.data as Record<string, PlazaArchive>) || {})
    .filter((x) => x && typeof x.ts === 'number').sort((a, b) => b.ts - a.ts);
}

// ─────────────────────────────────────── 폴링 루프
//   3초마다 messages 를 읽어 마지막 처리 ts 이후의 '남의' 메시지를 콜백으로 흘린다.
//   반환값을 호출하면 입장 해제(하트비트/폴링 정지 + 프레즌스 삭제).
export interface PlazaSession { stop: () => void; uid: string; }

export function joinPlaza(
  me: Omit<PlazaPresence, 'ts'>,
  onPeerMessage: (m: PlazaMessage) => void,
): PlazaSession {
  let lastTs = Date.now();           // 입장 시점 이후 메시지만 처리(과거 폭주 방지)
  let stopped = false;

  void putPresence(me);
  const hb = setInterval(() => { if (!stopped) void putPresence(me); }, 15000);

  const poll = setInterval(async () => {
    if (stopped || !plazaConfigured()) return;
    try {
      const r = await axios.get(subRecent('messages'), { timeout: 8000 });   // 💸 최근 40개만 (전체 X)
      const all = (r.data as Record<string, PlazaMessage>) || {};
      const fresh = Object.values(all)
        .filter((m) => m && m.ts > lastTs && m.uid !== me.uid)
        .sort((a, b) => a.ts - b.ts);
      if (fresh.length) {
        lastTs = fresh[fresh.length - 1].ts;
        for (const m of fresh) onPeerMessage(m);
      }
    } catch { /* 일시 오류는 무시, 다음 틱에 재시도 */ }
  }, 8000);   // 💸 3초 → 8초 (egress 절감)

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(hb);
    clearInterval(poll);
    void deletePresence(me.uid);
  };
  return { stop, uid: me.uid };
}
