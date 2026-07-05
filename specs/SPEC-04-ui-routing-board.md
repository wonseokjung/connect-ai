# SPEC-04 — 모델 라우팅 보드 UI 확장 (슬롯/프로바이더 가시화)

> 선행 조건: SPEC-01~03 완료. 이 스펙은 회사 대시보드 웹뷰 자산까지 수정하는 유일한 스펙이다 — 탐색 범위와 계약(contract)을 아래에 못박아 뒀으니 그 밖으로 나가지 말 것.

## 목표
기존 "모델 오케스트레이션" 패널(에이전트별 모델 드롭다운)에 다음을 추가한다:
1. 상단 **슬롯 요약 바**: 🚀 Fast / 🏗️ Worker / 🧠 External 각 슬롯의 모델명 + 상태 뱃지
2. **외부 사용량 표시**: `오늘 외부 호출 N / 한도 M` (한도 0이면 "무제한")
3. 에이전트 행에 **슬롯 뱃지**: 이 에이전트가 어느 슬롯을 쓰는지 (`slotForAgent` 기준)

## 탐색 앵커 (이 지점만 수정)

라우팅 패널의 데이터 흐름은 이미 존재한다:
- **데이터 전송부**: `src/extension.ts` 에서 `type: 'agentModelRoutingData'` 로 postMessage 하는 곳.
  payload: `{ installed, map, defaultModel, agents }`
- **웹뷰 수신부**: `assets/webview/dashboard.js` 의 `showAgentModelRoutingModal(data)` 와
  `agentModelRoutingData` 메시지 핸들러
- **웹뷰 스타일**: `assets/webview/dashboard.css` 의 `.amr-*` 모달 스타일 블록
- 자동 추천: `agentModelRoutingAuto`, 저장: `agentModelRoutingSaved` (건드리지 말 것)

## 메시지 계약 확장 (이대로 구현)

### (a) 전송부 — payload에 `llmStatus` 필드 추가
`agentModelRoutingData`를 postMessage 하기 전에:
```ts
const llmStatus = await getLLMStatus(); /* v3.0 — 슬롯 요약 (SPEC-02 index.ts) */
```
을 호출하고 payload에 `llmStatus`를 추가한다. `getLLMStatus()` 반환 형태 (변경 금지):
```ts
{
  slots: {
    fast:     { model: string, kind: 'ollama'|'openai-compat'|'anthropic-compat' } | null,
    worker:   { model: string, kind: ... } | null,
    external: { model: string, kind: ... } | null
  },
  externalToday: number,
  externalDailyLimit: number
}
```
에이전트별 슬롯도 같이 보낸다:
```ts
slotByAgent: Object.fromEntries(agents.map((a: any) => [a.id, slotForAgent(a.id)]))
```
(`agents`는 기존 payload에 이미 있는 배열을 재사용)

현재 코드처럼 `AGENT_ORDER.map(...)`으로 `agents` 배열을 inline 생성하는 구조라면, 같은 id 목록으로
`slotByAgent: Object.fromEntries(AGENT_ORDER.map((id: string) => [id, slotForAgent(id)]))`
를 써도 된다.

### (b) 수신부 — 렌더링 규칙
`agentModelRoutingData` 핸들러에서, 기존 에이전트 목록 렌더링 **위에** 슬롯 요약 바를 삽입:

| 슬롯 | 아이콘 | 뱃지 규칙 |
|---|---|---|
| fast | 🚀 | `slots.fast` null → `⚪ 미설정 (defaultModel 폴백)`, 있으면 `🟢 로컬 · {model}` |
| worker | 🏗️ | 동일 규칙 |
| external | 🧠 | null → `⚪ 미연결 — "Connect AI: 외부 두뇌 연결" 명령으로 연결`, 있으면 `🔵 외부 · {model} · 오늘 {externalToday}/{limit>0?limit:'∞'}` |

- 각 에이전트 행 이름 옆에 작은 뱃지: `🚀`(fast) / `🏗️`(worker) / `🧠`(external) — `slotByAgent[id]` 기준
- 스타일: `assets/webview/dashboard.css`에 `.amr-slots`, `.amr-slot`, `.amr-slottag`를 추가하고 기존 CSS 변수(`--line`, `--bg-2`, `--dim`, `--ok`, `--accent-2`)를 재사용한다. **JS inline style과 새 컬러 하드코딩 금지**.
- `llmStatus`가 payload에 없으면(구버전 캐시) 요약 바를 그리지 않고 기존 렌더링만 — 에러 던지지 말 것.

## 하지 말 것
- 드롭다운 저장 로직(`agentModelRoutingSaved`), 자동 추천(`agentModelRoutingAuto`) 수정 금지
- 다른 패널(사무실, 채팅) HTML 수정 금지
- 웹뷰에 외부 스크립트/CDN 추가 금지

## 검증 절차
1. `npm run compile` → 에러 0
2. F5 → 모델 오케스트레이션 패널 열기:
   - 외부 두뇌 미설정: 요약 바에 fast/worker 로컬 뱃지 + external `⚪ 미연결`
   - `Connect AI: 🧠 외부 두뇌 연결` 실행 후 패널 재오픈: external `🔵 외부 · {model} · 오늘 N/M`
   - 개발자·리서처 행에 🧠 뱃지, CEO·비서 행에 🚀 뱃지
3. 기존 기능 회귀: 드롭다운으로 모델 변경 → 저장 → 재오픈 시 유지 (이전과 동일)

## 완료 기준
- [ ] 수정 파일은 `src/extension.ts`, `assets/webview/dashboard.js`, `assets/webview/dashboard.css`로 제한
- [ ] 검증 1~3 통과
