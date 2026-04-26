# 🧠 Connect AI — Brain-GitHub 동기화 아키텍처 레퍼런스

> **이 문서는 어떤 AI든 이 코드베이스의 깃허브 동기화 구조를 즉시 파악할 수 있도록 만든 레퍼런스입니다.**

---

## 1. 프로젝트 위치 및 핵심 파일

```
/Users/jay/로컬테스트/local-ai-coder/
├── package.json          ← 설정 스키마 (contributes.configuration)
├── src/
│   └── extension.ts      ← 모든 로직이 담긴 단일 파일 (2600+ lines)
├── out/
│   └── extension.js      ← 빌드 결과물 (esbuild)
├── brain-viz.html        ← 지식 네트워크 시각화 HTML
└── system_schema.json    ← AI 에이전트 도구 스키마
```

**핵심 파일은 딱 2개:**
- `package.json` — VS Code 설정 스키마 선언
- `src/extension.ts` — 모든 동기화 로직

---

## 2. VS Code 설정 키 (Configuration)

`package.json` → `contributes.configuration.properties`에 선언됨:

| 설정 키 | 용도 | 기본값 |
|---------|------|--------|
| `connectAiLab.localBrainPath` | 로컬 지식 폴더 절대 경로 | `""` (비면 `~/.connect-ai-brain`) |
| `connectAiLab.secondBrainRepo` | 깃허브 저장소 URL | `""` |
| `connectAiLab.ollamaUrl` | AI 서버 주소 | `http://127.0.0.1:11434` |
| `connectAiLab.defaultModel` | AI 모델 이름 | `gemma4:e2b` |
| `connectAiLab.requestTimeout` | AI 응답 대기 시간(초) | `300` |

**⚠️ 설정은 `vscode.ConfigurationTarget.Global`로 저장됨** (워크스페이스가 아닌 전역)

---

## 3. 핵심 코드 섹션 (extension.ts 내 위치)

### 3-A. 설정 읽기 함수들 (상단)

```typescript
getConfig()                  // 모든 설정값을 한 번에 읽음
_getBrainDir()               // 로컬 지식 폴더 경로 반환 (미설정 시 ~/.connect-ai-brain)
_isBrainDirExplicitlySet()   // 사용자가 명시적으로 폴더를 지정했는지 boolean
_ensureBrainDir()            // 폴더 미설정 시 OS 폴더선택 다이얼로그 강제 팝업
```

### 3-B. _safeGitAutoSync

**Brain Pack 주입 후 자동으로 호출되는 동기화 함수 (동기/Blocking)**

호출되는 곳:
- `/api/brain-inject` 엔드포인트 (웹에서 주입)
- `_handleInjectLocalBrain` (⚡ 버튼 주입)
- P-Reinforce 구조화 완료 후

동작 순서:
1. `git status` → git repo인지 확인 (아니면 조용히 리턴)
2. `git remote get-url origin` → remote 등록 여부 확인
3. remote 없으면 → `secondBrainRepo` 설정에서 가져와서 자동 등록
4. `git branch -M main` → 브랜치명 통일
5. `git add .` → `git commit`
6. `git pull origin main` (충돌 시 로컬 우선: `-X ours`)
7. `git push -u origin main` (실패 시 force push 시도)

### 3-C. _syncSecondBrain

**사용자가 🧠 메뉴 → "깃허브 동기화" 클릭 시 호출 (비동기/Async)**

동작 순서:
1. 폴더 미설정 → `_ensureBrainDir()` 강제
2. `secondBrainRepo` 미설정 → URL 입력창 팝업
3. `.git` 없으면 → `git init`
4. `git branch -M main`
5. `git remote remove origin` → `git remote add origin`
6. `git add .` → `git commit`
7. `git fetch` → `git pull` (충돌 시 로컬 우선)
8. `git push -u origin main`
9. 성공 시 → 지식 모드 자동 ON

### 3-D. _handleBrainMenu

**🧠 아이콘 클릭 시 QuickPick 메뉴:**

| 메뉴 | action 키 | 하는 일 |
|------|-----------|---------|
| 📂 내 지식 목록 | `listFiles` | .md 파일 목록 보여줌 |
| 🔄 깃허브 동기화 | `githubSync` | `_syncSecondBrain()` 호출 |
| 🔗 깃허브 주소 변경 | `changeGithub` | `secondBrainRepo` 설정 변경 |
| 📁 폴더 위치 바꾸기 | `changeFolder` | `localBrainPath` 변경 + git re-init |
| 🌐 지식 지도 | `viewGraph` | brain-viz.html 네트워크 시각화 |

---

## 4. 데이터 흐름 (Brain Pack 주입 ~ GitHub 동기화)

```
[웹사이트] POST http://127.0.0.1:4825/api/brain-inject
    │   { title: "MrBeast 전략", markdown: "..." }
    ▼
[extension.ts] HTTP 서버 (Port 4825)
    │
    ├─ 1. 폴더 체크: _isBrainDirExplicitlySet()
    │     └─ NO → _ensureBrainDir() → OS 폴더 선택 다이얼로그
    │
    ├─ 2. 파일 저장: {brainDir}/00_Raw/2026-04-26/MrBeast_전략.md
    │
    ├─ 3. UI 피드백: 매트릭스 터미널 애니메이션 + "I know {title}" 메시지
    │
    └─ 4. _safeGitAutoSync() 호출
          │
          ├─ git status (git repo인가?)
          ├─ git remote get-url origin (remote 있나?)
          │     └─ 없으면 → secondBrainRepo 설정에서 가져와 등록
          ├─ git add . → git commit
          ├─ git pull origin main (원격 변경사항 병합)
          └─ git push -u origin main (클라우드 백업)
```

---

## 5. 로컬 지식 폴더 구조

```
{brainDir}/                     ← localBrainPath 설정값
├── .git/                       ← git init으로 생성됨
├── 00_Raw/                     ← Brain Pack 원본 저장소
│   ├── 2026-04-22/
│   │   └── MrBeast_전략.md
│   └── 2026-04-26/
│       └── 유튜브_알고리즘.md
├── 10_Wiki/                    ← P-Reinforce 구조화된 지식
│   ├── 💡 Topics/
│   ├── 🛠️ Projects/
│   ├── ⚖️ Decisions/
│   └── 🚀 Skills/
└── README.md
```

---

## 6. 근본 전제조건 & 디버깅 체크리스트

### Git 동기화가 되려면 반드시 필요한 것:

1. **수강생 PC에 git이 설치되어 있어야 함**
2. **깃허브 인증(credential)이 설정되어 있어야 push 가능**
   - macOS: Keychain 또는 `gh auth login`
   - Windows: Git Credential Manager
3. **깃허브 저장소가 존재해야 함** (빈 repo도 OK)

### 디버깅 시 터미널에서 확인할 명령어:

```bash
# 1. 폴더가 명시적으로 설정되어 있는지?
# VS Code Settings → connectAiLab.localBrainPath 값 확인

# 2. 깃허브 URL이 저장되어 있는지?
# VS Code Settings → connectAiLab.secondBrainRepo 값 확인

# 3. 지식 폴더에 git이 초기화되어 있는지?
ls -la {brainDir}/.git

# 4. remote origin이 등록되어 있는지?
cd {brainDir} && git remote -v

# 5. 브랜치 이름이 main인지?
cd {brainDir} && git branch

# 6. git 인증이 되어있는지? (가장 근본적)
cd {brainDir} && git push --dry-run origin main
```

---

## 7. 빌드 & 배포

```bash
# 컴파일
npm run compile
# → esbuild src/extension.ts → out/extension.js

# VSIX 패키징
npx vsce package --no-dependencies
# → connect-ai-lab-{version}.vsix

# GitHub 릴리즈
gh release create v{version} connect-ai-lab-{version}.vsix -t "Release v{version}"

# 버전은 package.json의 "version" 필드
```

---

## 8. 관련 외부 프로젝트

| 프로젝트 | 경로 | 역할 |
|---------|------|------|
| EZERAI | `/Users/jay/EZERAI` | 웹사이트 (Brain Pack 스토어) |
| firstclass | `/Users/jay/Desktop/aicitybuilders/firstclass` | 수강 플랫폼 |
| memory | `https://github.com/wonseokjung/memory` | 실제 지식 저장소 예시 |

EZERAI 웹사이트의 `AgentMarketplace.tsx`에서 Brain Pack "주입하기" 버튼을 누르면,
`fetch('http://127.0.0.1:4825/api/brain-inject', ...)` 로 이 익스텐션에 POST 요청을 보냄.
