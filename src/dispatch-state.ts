/* dispatch-state.ts — 활성 디스패치(중복감지·진행추적) 공유 상태.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존 없음(순수 Map/TTL). telegram 핸들러와 SidebarChatProvider 가 공유하는 상태라
 * 양쪽이 import 할 수 있도록 leaf 로 분리(순환 방지). */

/* v2.88 — 디스패치 중복 감지 + 진행 상태 추적. 사용자가 "유튜브 분석"을
   30초 안에 두 번 보내면 두 번 다 디스패치되고 둘 다 "처리 중" 답해서
   AI가 멍청해 보임. 활성 디스패치를 키(prompt+5분 ts)로 추적하고, 같은
   요청이 들어오면 새로 시작 안 하고 진행 상황만 알림. */
export interface ActiveDispatch {
  promptKey: string;
  startedAt: number;
  step: string;        /* 현재 단계 — "계획 중", "에이전트 분배 중", etc */
  heartbeatTimer: NodeJS.Timeout | null;
  heartbeatCount: number;
  fromTelegram: boolean;
}
export const _activeDispatches: Map<string, ActiveDispatch> = new Map();
export const ACTIVE_DISPATCH_TTL_MS = 5 * 60 * 1000; /* 5분 */
export function _normalizeForDispatchKey(s: string): string {
  /* 공백·구두점 제거하고 첫 80자만 — 사용자가 "유튜브 분석" / "유튜브  분석!"
     를 같은 의도로 묶기 위해. 너무 짧으면 다른 요청도 충돌해서 80자. */
  return (s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 80);
}
export function _findActiveDispatch(prompt: string): ActiveDispatch | null {
  const now = Date.now();
  const key = _normalizeForDispatchKey(prompt);
  /* TTL 청소 */
  for (const [k, v] of _activeDispatches.entries()) {
    if (now - v.startedAt > ACTIVE_DISPATCH_TTL_MS) {
      if (v.heartbeatTimer) clearInterval(v.heartbeatTimer);
      _activeDispatches.delete(k);
    }
  }
  return _activeDispatches.get(key) || null;
}
export function _startActiveDispatch(prompt: string, fromTelegram: boolean): ActiveDispatch {
  const key = _normalizeForDispatchKey(prompt);
  /* 같은 키가 이미 있으면 우선 정리 (방어) */
  const old = _activeDispatches.get(key);
  if (old?.heartbeatTimer) clearInterval(old.heartbeatTimer);
  const entry: ActiveDispatch = {
    promptKey: key,
    startedAt: Date.now(),
    step: '준비 중',
    heartbeatTimer: null,
    heartbeatCount: 0,
    fromTelegram,
  };
  _activeDispatches.set(key, entry);
  return entry;
}
export function _updateActiveDispatchStep(prompt: string, step: string) {
  const key = _normalizeForDispatchKey(prompt);
  const entry = _activeDispatches.get(key);
  if (entry) entry.step = step;
}
export function _endActiveDispatch(prompt: string) {
  const key = _normalizeForDispatchKey(prompt);
  const entry = _activeDispatches.get(key);
  if (entry?.heartbeatTimer) clearInterval(entry.heartbeatTimer);
  _activeDispatches.delete(key);
}
