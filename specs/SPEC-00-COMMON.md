# SPEC-00 — 공통 컨텍스트 (모든 스펙 앞에 반드시 포함)

당신은 Connect AI(VS Code 확장, v2.89.x)에 기능을 추가하는 시니어 엔지니어다.
아래 사실관계와 규칙을 벗어나는 행동은 전부 금지다.

## 저장소 사실관계 (검증됨 — 다시 조사하지 말 것)

- 언어/빌드: TypeScript, esbuild 번들. 빌드 명령: `npm run compile`
  (`esbuild src/extension.ts --bundle --platform=node --external:vscode --outfile=out/extension.js`)
- HTTP 클라이언트: `axios@^1.15.0` (이미 dependencies에 있음. fetch 쓰지 말 것)
- 소스 구조:
  - `src/extension.ts` — 약 22k줄 모놀리스. **스펙이 지정한 앵커 지점 외 절대 수정 금지**
  - `assets/webview/dashboard.js`, `assets/webview/dashboard.css` — 회사 대시보드 웹뷰 자산. SPEC-04에서만 수정 허용
  - `src/agents.ts` — 에이전트 정의. `AGENTS` 맵, id 목록: `ceo, youtube, instagram, designer, developer, business, secretary, editor, writer, researcher`
  - `src/plaza.ts`, `src/system-specs.ts`, `src/paths.ts` — 수정 금지
- 기존 LLM 백엔드: Ollama(`{base}/api/chat`) 와 LM Studio(`{base}/v1/chat/completions`, OpenAI 호환).
  엔진 판별 함수: `_isLMStudioEngine(ollamaBase)` — baseUrl에 `1234` 또는 `v1` 포함 시 LM Studio.
- 기존 설정 키 (package.json `contributes.configuration`, 네임스페이스 `connectAiLab`):
  `connectAiLab.ollamaUrl` (기본 `http://127.0.0.1:11434`), `connectAiLab.defaultModel` (기본 `""`),
  `connectAiLab.requestTimeout` (초), `connectAiLab.localBrainPath`
- 설정 읽기 함수: `getConfig()` (extension.ts 659행 부근) — `{ ollamaBase, defaultModel, timeout(ms), ... }` 반환
- 에이전트별 모델 오버라이드: `getAgentModel(agentId, fallback)` — `~/...agent_models.json` 기반
- 명령 네임스페이스: `connect-ai-lab.*` (예: `connect-ai-lab.newChat`)
- 코멘트 스타일: 한국어 + `/* v2.89.x — 이유 */` 형식. 새 코드도 이 스타일을 따른다.

## 절대 규칙

1. **스펙에 명시된 파일만 생성/수정한다.** extension.ts는 앵커로 지정된 지점만 수정.
2. **스펙에 포함된 코드 블록은 그대로 쓴다.** 변수명·시그니처·에러 메시지 임의 변경 금지.
3. `src/llm/` 밑의 파일은 **`config.ts`를 제외하고 `vscode` 모듈을 import하지 않는다.**
   (스모크 테스트를 VS Code 밖 node에서 돌리기 위함)
4. 하위 호환 최우선: **새 설정이 전부 비어 있으면 기존 동작(ollamaUrl + defaultModel)과 100% 동일**해야 한다.
5. API 키는 어떤 경우에도 파일·설정(JSON)에 평문 저장 금지. VS Code `SecretStorage`만 사용.
6. 리팩터링·개선 제안 금지. 스펙 밖 아이디어는 구현하지 말고 보고만.
7. 완료 후 `npm run compile` 실행 → 에러 0 확인 → 수정 파일 목록 보고.

## 결정 규칙 (모호할 때)

- 타입이 애매하면 `any` 대신 스펙의 인터페이스를 따른다.
- 에러는 삼키지 말고 `throw new Error('[llm:<provider-id>] <원인>')` 형식으로 던진다.
- 타임아웃 기본값: 300_000ms. 스트리밍 여부: `opts.onToken` 존재 여부로 판단.
- 낯선 외부 API 응답 필드는 방어적으로 옵셔널 체이닝(`?.`)으로 접근.
