# 🏢 1인 AI 기업 셋업 가이드 (Setup AI Company)

> **자동 1인 AI 기업**을 운영하기 위한 원페이지 셋업 가이드.
> 사용자가 한 줄 명령으로 **신규 오더**를 내리면, 시스템이 **①아이디어 → ②화면기획 → ③화면구현 → ④개발 → ⑤운영** 5단계를 자동 수행하고, 사용자가 자리 비운 동안 **24시간 자율 사이클**이 회사 가치를 한 걸음씩 진전시킵니다.

---

## ⚡ 빠른 시작 (3단계)

### 1단계 — 인프라 셋업 (한 번만)
```bash
cd /path/to/connect-ai
bash scripts/init-ai-company.sh          # 브레인 폴더 + 시드 + VS Code 설정 + launchd 등록 (한 번에)
brew install ollama && brew services start ollama
ollama pull qwen2.5:14b                   # ~9GB, 수 분 소요 (M1 Max 64GB 기준)
```
> `init-ai-company.sh`는 node 바이너리 경로까지 자동 해석해 launchd plist를 생성·등록합니다 (asdf shim이 아닌 실제 바이너리 사용).

### 2단계 — 자율 사이클 확인 (init이 자동 등록)
```bash
# init 스크립트가 launchctl load 까지 수행. 상태 확인:
launchctl list | grep connectai
# → 30분마다 회사가 스스로 한 걸음 실행 (IDE 꺼도 동작)
# 자율 사이클 실패 시 ~/.connect-ai-brain/cycle.health 에 기록 →
# 연속 3회 실패하면 cycle.alert 생성, 확장/데스크톱 활성화 시 알림 표시
```

### 3단계 — 신규 오더 내리기
VS Code 에서 Connect AI 사이드바 열고:
```
/order 강아지 용품 쇼핑몰 랜딩페이지 하나 만들어줘
```
또는 명령 팔레트 (`Cmd+Shift+P`):
- **Connect AI: 🚀 신규 오더 등록** (`connectAiLab.order.new`)
- **Connect AI: 오더 목록** (`connectAiLab.order.list`)

---

## 🔄 신규 오더 파이프라인 (5단계)

`/order <명령>` 을 내리면 시스템이 하나의 **오더(WorkOrder)** 를 만들고 5단계를 순차 실행합니다.
각 단계 산출물은 **다음 단계로 명시적으로 전달(핸드오프)** 되며, 상태는 `orders.json` 에 영속됩니다.

| 단계 | 담당 에이전트 | 산출물 |
|------|--------------|--------|
| **① 아이디어 도출** | researcher + business | 콘셉트·차별점·수익모델·KPI (`idea.md`) |
| **② 화면 기획** | designer + writer | 와이어프레임·UX플로우·카피 (`design.md`) |
| **③ 화면 구현** | developer (코다리) | 실제 UI/화면 파일 (`build.md` + `site/` 폴더) |
| **④ 개발** | developer | 로직·통합·**자기검증** (tsc/node check) (`develop.md`) |
| **⑤ 운영** | business + secretary | 배포계획·실행명령·KPI·수익화 (`operate.md`) |

**실패 처리**: 단계 실패 시 1회 재시도 → 그래도 실패면 오더 중단 (상태 `aborted`).
**산출물 위치**: `~/.connect-ai-brain/_company/orders/<오더ID>/`
- `idea.md`, `design.md`, `build.md`, `develop.md`, `operate.md`
- `site/` (③build 에서 생성한 실제 파일)
- `_report.md` (최종 종합 보고서)

---

## 🌙 24시간 자율 사이클

IDE 가 꺼져 있어도 `scripts/cycle.js` 가 launchd/cron 으로 주기 실행되어:
1. `goals.md` (회사 목표) · `identity.md` · `decisions.md` 를 읽고
2. LLM이 "지금 가장 가치 있는 단일 작업 1개" 를 결정·실행
3. 산출물을 `sessions/auto-<시각>/_report.md` + 대화록에 누적

**주기 변경**: plist 의 `<key>StartInterval</key><integer>1800</integer>` (초 단위, 1800=30분).

---

## 📁 주요 파일 맵

### 신규 오더 파이프라인 (이번에 추가)
| 파일 | 역할 |
|------|------|
| `src/orders.ts` | 오더 데이터 모델 + 저장소 (createOrder/updateStage/...) — VS Code 확장용 |
| `desktop/src/orders.ts` | 동일 모델 (데스크톱용, vscode 의존 제거) |
| `src/extension.ts` `_runOrderPipeline()` | 5단계 순차 실행 엔진 (`_callAgentLLM`/`_executeActions` 재사용) |
| `desktop/src/engine/company.ts` `runOrderPipeline()` | 데스크톱용 실행 엔진 (`runSpecialist` 재사용) |
| `assets/prompts/pipeline-{idea,design,build,develop,operate}.md` | 단계별 프롬프트 |
| `desktop/assets/prompts/pipeline-*.md` | 데스크톱용 복사본 |
| `scripts/init-ai-company.sh` | 인프라 부트스트랩 (idempotent) |
| `scripts/demo-order.mjs` | 엔드투엔드 데모 검증 스크립트 |
| `scripts/cycle.js` | IDE 외부 자율 사이클 |

### 기존 인프라
| 파일 | 역할 |
|------|------|
| `src/extension.ts` | VS Code 확장 메인 (21,800+ 줄, CEO 플래너 + 9 에이전트) |
| `desktop/src/main.ts` | Electron 메인 프로세스 |
| `desktop/src/preload.ts` | IPC 브릿지 (`order:list` 등) |
| `~/.connect-ai-brain/_company/_shared/` | identity.md · goals.md · decisions.md · tracker.json · **orders.json** |

---

## 🔧 설정 키 (VS Code settings.json)

| 키 | 기본값 | 설명 |
|----|--------|------|
| `connectAiLab.localBrainPath` | `~/.connect-ai-brain` | 브레인/회사 폴더 루트 |
| `connectAiLab.ollamaUrl` | `http://127.0.0.1:11434` | Ollama 엔진 주소 |
| `connectAiLab.defaultModel` | `qwen2.5:14b` | 기본 LLM 모델 |
| `connectAiLab.autoCycleEnabled` | `true` | 24시간 자율 사이클 (확장 내장 15분) |

---

## 🧪 검증 (데모)

데모 오더를 실제 LLM으로 끝까지 돌려보기:
```bash
node scripts/demo-order.mjs "고양이 간식 구독 서비스 랜딩페이지"
# → 5단계 순차 실행, site/ 폴더에 실제 파일 생성, orders.json 영속 확인
```

**검증된 결과 (2026-07-03, qwen2.5:14b)**:
- ① 아이디어 (29s) → ② 기획 (76s) → ③ 구현 (136s, **파일 5개 생성**) → ④ 개발 (137s, 자기검증 포함) → ⑤ 운영 (79s)
- 총 ~7.5분, 5개 `.md` + `site/index.html` + `site/src/components/*.tsx` + `_report.md` 생성

---

## 🛡️ 파이프라인 강화 (v2.89.159)

오더 파이프라인의 신뢰성·정확도·가시성을 강화한 작업. 원래 단순 구현에서 발견된 11개 약점을 해소.

### 동시성·안전
- **orders.json 원자적 쓰기 + lockfile** — `withOrdersLock`(O_EXCL lockfile) + tmp→rename atomic write. 동시 `/order`·자율사이클이 같은 파일에 써도 손실 없음 (50개 병렬 createOrder 테스트로 0손실 검증).
- **다중 오더 동시 실행 방지** — 이미 active 오더가 있으면 차단. 두 파이프라인이 LLM을 동시에 잡는 메모리 경합 방지.
- **stop 버튼 abort 보강** — `_runOrderPipeline`이 자급식 AbortController 생성. 중단 시 진행 중 단계를 pending으로 되돌려 재개 가능.
- **`<create_file>` 닫는태그 폴백** — 모델이 여는 태그만 내고 끝내도(닫는 태그 누락) 파일 생성. 빈 파일 검증 포함.

### 정확도
- **develop 단계 자기검증 강제 게이트** — 검증 명령(`node --check`/`tsc`) 누락 또는 에러 시 1회 강제 재생성. 모델이 검증을 건너뛰는 걸 시스템이 잡음.
- **단계 산출물 캡 일관성** — `STAGE_HANDOFF_CAP` 단계별 차등 (design→build 8000자, idea→design 4000자). 설계가 잘려 구현 품질이 떨어지던 문제 해소.

### 인프라·가시성
- **launchd node 경로 안정화** — init 스크립트가 asdf shim이 아닌 실제 바이너리 경로 해석.
- **자율 사이클 health** — `cycle.health`/`cycle.alert`로 실패 추적. 연속 3회 실패 시 확장·데스크톱이 알림.
- **데모 데이터 정리** — `scripts/clean-demo-orders.sh`로 검증용 오더+sessions 정리 (dry-run 기본, 백업 포함).

### UI·테스트
- **vitest 단위 테스트** — `npm test`로 orders 로직 19케이스 회귀 확인 (동시성·cutoff·상태전이).
- **파이프라인 진행 도트 바** — 확장 webview 상단에 5단계 진행률 표시 (`pipelineProgress` 이벤트).

## 🧪 단위 테스트

```bash
npm test                # vitest run — orders.ts 19케이스
npm run test:watch      # watch 모드
```
테스트는 `src/orders.test.ts` + `test/vscode-stub.ts`(vscode 목)로 구성. 동시성(50개 병렬 createOrder 무손실), 90일 cutoff 정리, 상태 전이, lock 직렬화 검증.

## 🧹 데모 데이터 정리

검증용으로 만든 데모 오더·자율사이클 잔재를 정리:
```bash
bash scripts/clean-demo-orders.sh              # dry-run (대상만 표시)
bash scripts/clean-demo-orders.sh --confirm    # 실제 삭제 (백업 포함)
```
데모 오더(title 키워드 매칭) + `sessions/auto-*` + `cycle.*` 파일 제거.

## ❓ 트러블슈팅

| 증상 | 해결 |
|------|------|
| `No local LLM detected` | `brew services start ollama` 후 `ollama list` 에 모델 있는지 확인 |
| 오더가 파일을 안 만듦 | ③build 프롬프트의 `<create_file>` 닫는태그 규칙 확인 (`assets/prompts/pipeline-build.md`) |
| cycle.js `Brain folder not initialized` | `BRAIN_DIR` 를 `~/.connect-ai-brain/_company` 로 지정 (nested 레이아웃) |
| 느림 | 더 작은 모델 (`qwen2.5:7b`) 또는 `num_predict` 축소. 64GB RAM 에서 14b 권장 |

---

## 📐 아키텍처 노트

- **확장과 데스크톱은 독립 코드베이스** — 동일 로직을 각각 포팅 (`src/orders.ts` ↔ `desktop/src/orders.ts`).
- **기존 CEO 단발성 분배는 그대로 유지** — `/order` 접두사만 새 파이프라인 경로로 분기 (위험 최소화).
- **모듈 추출 관용 준수** — `orders.ts` 는 `agents.ts`/`paths.ts` 패턴, 프롬프트는 `assets/prompts/*.md` 외부 파일.
- **데스크톱 v0.4.8 안정성 보존** — `release/`·코드사인 건드리지 않고 `out/` 만 리빌드.
