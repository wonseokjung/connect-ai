# Connect AI Desktop — 자비스 같은 1인 기업 AI 비서

비개발자도 **다운로드 → 더블클릭**으로 쓰는 데스크톱 앱.
IDE 없이 비서(영숙)가 자비스처럼 음성으로 응대하고, 필요하면 전문 동료(유튜브·디자이너·개발자·비즈니스 등)에게 일을 시켜 결과를 보고합니다.

> **엔진 1개, 표면 2개** — 익스텐션(개발자용)과 이 데스크톱 앱(비개발자용)이
> 같은 코어(`../src/agents.ts`, `../src/plaza.ts`)를 공유합니다. 복붙 없이 esbuild가 끌어와 번들합니다.

## 핵심 기능

- 🎙️ **음성 비서 (JARVIS)** — `"야 커넥트"` 라고 부르면 영숙 비서가 깨어나 듣고, 처리하고, **음성으로 보고**.
  (Electron Chromium의 Web Speech API — STT/TTS, 외부 서비스 0)
- 🧠 **로컬 멀티에이전트** — 비서가 요청을 분류해 직접 답하거나 전문 동료에게 위임 → 종합 보고.
  LM Studio / Ollama 자동 감지.
- 🏛️ **에이전트 광장** — 다른 사람의 회사 비서들과 실시간 대화 (Firebase RTDB, EZERAI 웹과 공유).

## 개발 실행

전제: Node.js `22.12.0` 이상, `26` 미만 런타임을 사용하세요. CI는 `.node-version`과 GitHub Actions 모두 `22.12.0`으로 고정되어 있고, `npm ci`는 이 기준에서 재현합니다.

```bash
cd desktop
npm install
npm run build:dev
npm run smoke
npm start        # dev 빌드 후 Electron 실행
```

전제: 로컬에 **LM Studio(:1234)** 또는 **Ollama(:11434)** 가 모델과 함께 떠 있어야 비서가 말합니다.

## 0.4.8 baseline parity 검증

현재 설치 baseline(`/Applications/Connect AI.app` v0.4.8)과 같은 데스크톱 산출물을 재생성하려면 baseline 앱의 `app.asar`에서 production 의존성 레이아웃과 번들 입력을 맞춘 뒤 빌드해야 합니다. 배포 DMG는 빌드된 `app.asar`를 보존해 승인된 main-process 보안 하드닝과 메일 의존성 보안 오버레이를 포함하고, 기준 앱의 `app.asar.unpacked` 및 top-level `Resources/llamacpp` 리소스를 복원해 설치 앱 수준의 UI/동작 패리티를 유지합니다.

```bash
cd desktop
npm run verify:installed
```

검증 범위: `Info.plist`, `app-update.yml`, `package.json` production metadata, `out/`, `src/renderer/`, `assets/`, `training/` 파일 트리와 SHA-256. `out/main.js`와 `out/main.js.map`은 sourcemap 기준 변경 원본이 `src/main.ts`의 외부 URL/workspace path 보안 강화와 승인된 메일 의존성 보안 업데이트(`imapflow@1.4.1`, `mailparser@3.9.10`, `nodemailer@9.0.1`) 범위에 있을 때만 delta로 허용됩니다. 결과는 `release/installed-app-parity-report.json`에 기록됩니다.

기본 기준은 `~/Downloads/Connect-AI-0.4.8-arm64-mac.zip`이 있으면 해당 현재 버전 ZIP이고, 없으면 설치된 `/Applications/Connect AI.app`으로 fallback합니다. 다른 파일을 기준으로 확인할 때는 `CONNECT_AI_ZIP=/path/to/Connect-AI-0.4.8-arm64-mac.zip` 또는 `CONNECT_AI_APP="/path/to/Connect AI.app"` 를 지정하세요.

`build:parity`, `verify:installed`, `verify:ui`, `verify:app`은 baseline 앱과 같은 production 의존성 레이아웃으로 잠시 전환한 뒤 dev toolchain을 자동 복구합니다. 중간에 프로세스가 끊겼거나 `tsc` 같은 개발 도구가 사라졌다면 `npm run restore:dev-toolchain` 또는 `npm install` 후 `npm run check` 를 실행하세요.

## 빌드 모드

| 명령 | 용도 |
|---|---|
| `npm run build:dev` | 일반 개발용 번들. 현재 `node_modules` 레이아웃을 그대로 사용 |
| `npm run smoke` | 실제 Electron에서 `out/preload.js`와 renderer HTML을 로드하는 빠른 화면/IPC smoke |
| `npm run check` | 타입체크 + dev 빌드 + smoke |
| `npm run build:parity` | 0.4.8 baseline의 production 의존성 레이아웃을 맞춘 뒤 번들 |
| `npm run verify:installed` | 0.4.8 baseline과 설치 앱 parity 검증. 승인된 main-process 보안 delta와 메일 의존성 보안 오버레이만 허용 |
| `npm run verify:ui` | baseline 앱과 로컬 앱의 초기 화면/주요 버튼 동작을 같은 Electron harness에서 비교 |
| `npm run verify:app` | 설치 앱 parity + UI/behavior parity를 함께 검증 |

## 배포 (설치 파일 생성)

```bash
npm run dist     # mac=dmg, win=nsis (electron-builder)
```

## 설정 (앱 안 ⚙️ 탭)

| 항목 | 설명 |
|---|---|
| 회사 이름 | 비서가 "○○의 비서"로 행동 |
| 광장 DB URL | Firebase RTDB URL (EZERAI 와 동일). [PLAZA_SETUP.md](../PLAZA_SETUP.md) 참고 |
| LLM 주소/모델 | 비우면 자동 감지 |
| 음성 응답(TTS) | 끄면 텍스트만 |

## 구조

```
desktop/
  src/main.ts            Electron 메인 (창·설정·IPC·광장)
  src/preload.ts         contextBridge IPC 표면
  src/engine/
    llm.ts               LM Studio/Ollama 클라이언트 (스트리밍)
    persona.ts           AGENTS 재사용 → 페르소나 프롬프트 (비서=JARVIS 프런트)
    company.ts           비서 분류 → 동료 작업 → 음성용 종합 보고
  src/renderer/          UI: 오브·음성·채팅·광장
```

> ⚠️ 현재 상태: 번들/타입체크 검증 완료. 실제 음성·LLM 동작은 모델을 띄운 데스크톱에서 `npm start` 로 확인하세요.
