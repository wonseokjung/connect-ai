# 🗺️ Connect AI — v3 로드맵 (진단 + 방향성)

> 2026-07 기준. 현재 버전 v2.89.157 코드베이스(`src/extension.ts` 21,836줄, agents/plaza/system-specs 분리 모듈) 분석 결과.

---

## 1. 현재 상태 진단 (한 줄 요약)

**"CEO + 9명 전문 에이전트가 로컬 LLM으로 굴러가는 1인 기업 워크스페이스"는 완성 단계.
하지만 두뇌(LLM 계층)가 로컬 전용·중복 코드이고, 자율 실행의 신뢰성(계획→실행→검증 루프)과 기반 품질(모듈화·테스트·시크릿 보안)이 다음 성장의 병목.**

잘 되어 있는 것:
- 에이전트 페르소나 시스템 (`src/agents.ts`) — CEO 오케스트레이터 + 9 전문가, 페르소나/보이스 주입
- 모델 자동 오케스트레이션 — 설치 모델 tier 분류(`_classifyModel`) + 메모리 예산 필터 + 역할별 선호 tier 매칭
- 세컨드 브레인 (markdown + git 자동 동기화), 텔레그램 연동, 가상 사무실 시각화, 광장(Plaza)
- Gemini 키트(사용자 프로덕트에 inline 주입) — 단, 이건 에이전트 두뇌가 아니라 산출물용

---

## 2. 부족한 것 — 백엔드

### B1. LLM 호출 계층이 로컬 전용 + 4곳 이상 중복 (최우선)
- `extension.ts` 내 `isLMStudio ? '/v1/chat/completions' : '/api/chat'` 분기가 2009, 8051, 8093, 8167, 18673, 18910, 20805 등에 복붙되어 있음
- 엔진 판별이 URL 포트 휴리스틱(1234 vs 11434) — 외부 API를 끼워 넣을 자리가 없음
- **→ `src/llm/` 프로바이더 추상화 모듈로 통합이 v3의 관문**

### B2. 외부 API 프로바이더 미지원
- 현재 에이전트 두뇌는 Ollama/LM Studio만. 로컬 7B급 모델로는 CEO의 strict-JSON 라우팅, 개발자 에이전트(코다리)의 대규모 코드 작업 신뢰성에 한계
- Hermes Agent에서 검증한 패턴(skill 자동승격)은 이식됐지만, 외부 모델 호출 자체는 없음

### B3. 자율 실행 신뢰성
- corporate dispatch가 "CEO가 JSON으로 라우팅 → 전문가 1회 응답" 구조. 계획→실행→검증→재시도 루프, 작업 큐, 장기 작업 체크포인트/이어하기 없음
- 실패 시 사용자에게 조용히 묻히는 경로 존재

### B4. 지식 검색 (RAG) 부재
- 세컨드 브레인이 markdown 파일 나열이라 컨텍스트 주입이 파일 단위. 임베딩 검색 없음 → 지식이 쌓일수록 오히려 컨텍스트 낭비
- Ollama `nomic-embed-text` + 로컬 벡터 인덱스(sqlite-vec 또는 단순 JSON cosine)로 100% 로컬 유지 가능

### B5. 시크릿 보안
- API 키가 `gemini_account.json` 등 평문 파일로 저장·git 동기화 경로 근처에 있음
- 외부 API를 추가하는 순간 유료 키가 들어오므로 **VS Code `SecretStorage` 이전 필수**

### B6. 테스트/품질 인프라 제로
- 테스트 0개, `extension.ts` 21,836줄 단일 파일. 지금까지는 속도를 위해 감수했지만, 외부 API·과금이 얽히면 회귀 방지가 필요
- 전면 리팩터링 대신 **"새 코드는 새 모듈로"** 원칙: `llm/`, `orchestrator/`, `tools/` 신설 모듈에만 유닛 테스트

### B7. 관측성 (Observability)
- 토큰 사용량·지연·비용·실패율 로깅 없음. 외부 API(과금) 도입 시 비용 가드레일의 전제 조건

---

## 3. 부족한 것 — UI/UX

### U1. "일하는 척"은 화려한데 "실제 일"의 가시성이 약함
- 사무실 시네마틱(walk, 광선, 파티클)은 훌륭하나, 정작 **작업 큐·진행률·산출물(diff/파일) 미리보기**가 없음
- → **미션 보드**: 진행 중 작업 카드(담당 에이전트, 단계, 경과시간, 중간 산출물 링크), 완료 시 결과물 diff/파일 프리뷰

### U2. 모델 라우팅 보드의 확장
- 현재 라우팅 UI는 로컬 모델 드롭다운만. 외부 프로바이더 도입 시:
  - 프로바이더별 상태 뱃지 (🟢 로컬-무료 / 🔵 외부-플랜 / 잔여 쿼터·이번 달 사용량)
  - 에이전트 카드에 "이 작업은 어느 두뇌가 처리하는지" 실시간 표시
  - 오프라인 폴백 상태 표시 ("외부 연결 끊김 → 로컬 워커로 대체 중")

### U3. 승인(Approval) UX
- 파일 삭제·터미널 명령·외부 API 과금 호출은 위험도가 다른데 승인 UI가 단일 톤
- → 위험도 3단계(읽기=자동 / 쓰기=인라인 승인 / 삭제·과금·push=명시 확인 + 미리보기)

### U4. 결과물 중심 대시보드
- "오늘 회사가 뭘 만들었나"를 한눈에: 생성 파일, 커밋, 발행 콘텐츠, 사용 토큰/비용. 텔레그램 데일리 브리핑과 동일 데이터 소스 공유

### U5. 온보딩 간소화
- 연결 진단은 좋으나, 첫 실행 시 "권장 모델 2개 자동 pull 제안 → 자동 라우팅 → 첫 미션 실행"까지 이어지는 원클릭 시나리오 부재

---

## 4. 모델 아키텍처 — 3-슬롯 하이브리드 (요청 사항 반영)

```
┌─────────────────────────────────────────────────────┐
│                  LLM Provider Layer (src/llm/)       │
│                                                      │
│  Slot A: Ollama-Fast (라우터)    예) qwen3:4b        │
│   └ CEO 라우팅·분류·요약·짧은 응답 — 항상 로컬·무료   │
│                                                      │
│  Slot B: Ollama-Worker (일꾼)   예) qwen3:14b        │
│   └ 전문 에이전트 일반 작업 — 로컬·무료              │
│                                                      │
│  Slot C: External API (외부 두뇌)                    │
│   ├ OpenAI-호환:   Hermes(Nous)/OpenRouter/Together  │
│   ├ Anthropic-호환: 코딩 플랜 (GLM Coding Plan,      │
│   │                 Claude Code 플랜형 엔드포인트)    │
│   └ 개발자(코다리)·리서처 등 고난도 장문 작업 전담    │
└─────────────────────────────────────────────────────┘
```

### 프로바이더 인터페이스 (신규 `src/llm/provider.ts`)
```ts
interface LLMProvider {
  id: string;                                  // 'ollama-fast' | 'ollama-worker' | 'ext-hermes' | 'ext-coding-plan'
  kind: 'ollama' | 'openai-compat' | 'anthropic-compat';
  baseUrl: string;
  apiKey?: string;                             // SecretStorage에서 로드
  model: string;
  chat(messages, opts): AsyncIterable<Chunk>;  // 스트리밍 통일
  health(): Promise<{ ok: boolean; latencyMs: number }>;
}
```
- 기존 7곳의 fetch 복붙을 이 인터페이스 하나로 수렴 (`isLMStudio` 분기는 `kind: 'openai-compat'`로 흡수 — LM Studio도 그냥 openai-compat 프로바이더가 됨)
- `anthropic-compat`는 `/v1/messages` 형식 — GLM Coding Plan, Kimi 등 코딩 플랜 API가 이 형식 제공

### 라우팅 정책 (`src/llm/router.ts`)
| 작업 유형 | 1순위 | 폴백 |
|---|---|---|
| CEO 라우팅·분류·요약 | Slot A (로컬 fast) | Slot B |
| 일반 전문가 응답 (콘텐츠·카피·전략) | Slot B (로컬 worker) | Slot A |
| 코드 작성·디버깅·긴 계획 (코다리) | Slot C (외부/코딩 플랜) | Slot B |
| 리서치·장문 분석 | Slot C | Slot B |
| 오프라인 감지 시 | 전부 로컬 (A/B) | — |

- 기존 `_autoOrchestrateModelMap`의 tier 개념을 슬롯 개념으로 승격: "에이전트→모델" 매핑이 아니라 "에이전트→슬롯" 매핑 + 슬롯별 모델 지정
- 비용 가드레일: 외부 호출 일일 한도(요청 수·추정 토큰) 설정, 초과 시 자동 로컬 폴백 + 사무실 UI 알림

### 설정 스키마 추가
```
connectAiLab.llm.fastModel        // Slot A ollama 모델
connectAiLab.llm.workerModel      // Slot B ollama 모델
connectAiLab.llm.external.kind    // 'openai-compat' | 'anthropic-compat'
connectAiLab.llm.external.baseUrl
connectAiLab.llm.external.model
connectAiLab.llm.external.dailyBudget   // 일일 호출 한도
// API 키는 설정이 아니라 SecretStorage (명령: Connect AI: 외부 두뇌 연결)
```

---

## 5. 실행 로드맵 (4 페이즈)

### Phase 1 — 기반 (LLM 계층 통합) · ~2주
1. `src/llm/` 신설: provider.ts(인터페이스) + ollama.ts + openai-compat.ts + anthropic-compat.ts + router.ts
2. extension.ts의 7개 호출부를 router 경유로 교체 (동작 동일성 확인 후 한 곳씩)
3. `SecretStorage` 기반 키 관리 + `Connect AI: 외부 두뇌 연결` 명령
4. llm 모듈 유닛 테스트 (요청 변환·스트림 파싱·폴백)

### Phase 2 — 3-슬롯 라우팅 + UI · ~2주
1. 슬롯 개념 도입, 자동 오케스트레이션을 슬롯 배정으로 확장
2. 모델 라우팅 보드 개편 (프로바이더 뱃지, 실시간 사용 두뇌 표시, 폴백 상태)
3. 비용 가드레일 + 오프라인 자동 폴백
4. 온보딩: 권장 Ollama 모델 2개 자동 pull 제안 플로우

### Phase 3 — 자율성 신뢰도 · ~3주
1. 계획→실행→검증→재시도 루프 (특히 코다리: 외부 두뇌로 계획, 로컬로 검증 반복)
2. 작업 큐 + 체크포인트 (VS Code 재시작 후 이어하기)
3. 미션 보드 UI (작업 카드·진행률·산출물 diff 프리뷰)
4. 승인 UX 3단계 위험도 분리

### Phase 4 — 지식·관측성 · ~3주
1. 세컨드 브레인 임베딩 검색 (로컬 임베딩 + sqlite-vec) → 에이전트 컨텍스트 주입 품질 향상
2. 토큰/비용/지연 로깅 + 결과물 대시보드 ("오늘 회사가 만든 것")
3. 평가 하네스: 대표 미션 10개 회귀 테스트 (모델 교체 시 품질 확인용)

---

## 6. 하지 않을 것 (Non-goals)
- extension.ts 전면 리팩터링 — 새 기능을 새 모듈로 빼는 방식으로 점진 축소
- 클라우드 서버 구축 — "100% 로컬 우선 + 외부 API는 opt-in" 정체성 유지
- 에이전트 수 늘리기 — 10명으로 충분. 깊이(신뢰성)가 폭보다 우선
