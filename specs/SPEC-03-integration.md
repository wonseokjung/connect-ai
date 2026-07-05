# SPEC-03 — extension.ts 통합 (앵커 기반 최소 수정)

> 선행 조건: SPEC-01, SPEC-02 완료 (`src/llm/index.ts`가 `initLLM`, `routeChat`, `slotForAgent`, `getLLMStatus`를 export)

## 목표
extension.ts를 **딱 4곳만** 수정해서 새 LLM 계층을 연결한다.
- CEO 라우팅·분류(`_quickLLMCall`) → `fast` 슬롯
- corporate 에이전트 호출(`_callAgentLLM`) → external 슬롯 에이전트만 외부 두뇌 경유, 나머지는 기존 코드 그대로
- **외부 두뇌 미설정 사용자에게는 동작 변화가 0이어야 한다** (하위 호환 절대 규칙)

## 수정 금지 구역
`_callAgentLLM`의 기존 본문(LM Studio/Ollama 스트리밍, jsonMode 재시도, `_consumeLLMStream`)은
**한 글자도 건드리지 않는다.** 지정된 위치에 블록을 *삽입*만 한다.

---

## 수정 1: import 추가

**앵커 (이 줄을 grep으로 찾는다):**
```
import { SystemSpecs, getSystemSpecs, estimateModelMemoryGB } from './system-specs';
```
**작업:** 이 줄 **바로 아래에** 다음 한 줄 추가:
```ts
import { initLLM, routeChat, slotForAgent, getLLMStatus } from './llm';
```

---

## 수정 2: activate()에서 초기화

**앵커:**
```
export function activate(context: vscode.ExtensionContext) {
```
(7852행 부근, 파일에 정확히 1번 등장)

**작업:** 여는 중괄호 바로 다음 줄에 추가:
```ts
    /* v3.0 — LLM 슬롯 라우터 초기화 + '외부 두뇌 연결' 명령 등록 */
    initLLM(context);
```

---

## 수정 3: `_quickLLMCall` 본문 교체 → fast 슬롯

**앵커:**
```
async function _quickLLMCall(systemPrompt: string, userMsg: string, maxTokens = 64): Promise<string> {
```
(2005행 부근, 파일에 정확히 1번 등장)

**작업:** 이 함수 전체(여는 중괄호부터 짝이 맞는 닫는 중괄호까지, 약 17줄)를 아래로 교체.
현재 본문은 `const { ollamaBase, defaultModel, timeout } = getConfig();`로 시작하고
`return r.data?.message?.content?.toString().trim() || '';`로 끝난다 — 이 범위만 교체한다.

```ts
async function _quickLLMCall(systemPrompt: string, userMsg: string, maxTokens = 64): Promise<string> {
    /* v3.0 — fast 슬롯 경유. llm.fastModel 미설정 시 라우터가 기존
       defaultModel+엔진 감지로 폴백하므로 이전 동작과 동일. */
    const { timeout } = getConfig();
    const res = await routeChat({
        slot: 'fast',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg }
        ],
        opts: {
            maxTokens,
            temperature: 0.2,
            timeoutMs: Math.min(timeout || 60000, 60000)
        }
    });
    return res.text.trim();
}
```

---

## 수정 4: `_callAgentLLM`에 external 슬롯 분기 삽입

**앵커 (함수 서두, 파일에 정확히 1번 등장):**
```ts
        const overrideModel = getAgentModel(agentId, '');
        if (overrideModel) modelName = overrideModel;
```

**작업:** 위 두 줄 **바로 아래**, `let isLMStudio = _isLMStudioEngine(ollamaBase);` **바로 위에**
아래 블록을 그대로 삽입한다. (들여쓰기는 주변 코드와 동일하게 8칸)

```ts
        /* v3.0 — 슬롯 라우팅. external 슬롯 에이전트(developer·researcher)는
           외부 두뇌(코딩 플랜/Hermes 등)가 연결된 경우에만 routeChat 경유.
           routeChat 내부에서 외부 실패·일일 한도 초과 시 로컬(worker→fast)로
           자동 폴백. 외부 두뇌 미설정 사용자는 이 블록이 no-op — 아래 기존
           로컬 경로가 그대로 실행된다. */
        try {
            const llmStatus = await getLLMStatus();
            if (slotForAgent(agentId) === 'external' && llmStatus.slots.external) {
                let firstExtToken = false;
                const res = await routeChat({
                    agentId,
                    modelOverride: overrideModel || undefined,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMsg }
                    ],
                    opts: {
                        signal: this._abortController?.signal,
                        temperature: this._temperature,
                        topP: this._topP,
                        timeoutMs: timeout,
                        onToken: (token) => {
                            if (!firstExtToken) { firstExtToken = true; try { opts?.onFirstToken?.(); } catch { /* ignore */ } }
                            if (broadcast) this._broadcastCorporate({ type: 'agentChunk', agent: agentId, value: token });
                        }
                    }
                });
                return res.text;
            }
        } catch (e: any) {
            /* 사용자 취소는 그대로 전파, 그 외엔 기존 로컬 경로로 폴백 */
            if (this._abortController?.signal?.aborted) throw e;
            console.warn('[llm:v3] external 라우팅 실패 — 기존 로컬 경로 폴백:', e?.message || e);
        }
```

> **주의**: 이 블록은 `timeout` 변수를 사용한다. 함수 첫 줄
> `const { ollamaBase, defaultModel, timeout } = getConfig();` 는 이 블록보다 위에 있으므로 그대로 사용 가능.
> 만약 삽입 위치가 그 줄보다 위라면 잘못 삽입한 것이다.

---

## 검증 절차 (전부 통과해야 완료)

1. `npm run compile` → 에러 0
2. **회귀 (외부 두뇌 미설정 상태에서):**
   - F5 (Extension Development Host) → 사이드바 채팅에 "안녕" → 기존처럼 로컬 모델 응답
   - 명령 팔레트 → `Connect AI: 연결 진단` → 이전과 동일 결과
   - corporate 모드에서 "유튜브 트렌드 분석해줘" 류 지시 → CEO 라우팅 → 전문가 응답 정상
3. **신규 (외부 두뇌 설정 후):**
   - 명령 팔레트 → `Connect AI: 🧠 외부 두뇌 연결` → 프리셋 선택·키 입력 → "연결 완료" 알림
   - 개발자 에이전트(코다리)에게 코드 작업 지시 → 응답 생성 (외부 모델 사용)
   - 네트워크를 끊고 같은 지시 → 로컬 모델로 자동 폴백해 응답 (콘솔에 `[llm:router] external... 실패 → 다음 폴백 시도` 로그)
4. `LC_ALL=C rg --text -c "routeChat\\(\\{" src/extension.ts` → 정확히 2 (수정 3, 수정 4 각 1회)
   - `src/extension.ts`에는 NUL 문자를 포함한 기존 정규식 리터럴이 있어 일반 `rg`가 binary로 오인할 수 있으므로 `--text`를 붙인다.

## 완료 기준
- [ ] extension.ts 수정은 위 4곳뿐 (`git diff --stat`으로 확인: extension.ts 1개 파일, +약 60줄 / -약 15줄)
- [ ] 검증 1~4 통과
- [ ] 외부 두뇌 미설정 시 diff 경로가 전혀 실행되지 않음 (no-op 확인)
