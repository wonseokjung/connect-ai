# ✦ Connect AI LAB

**100% 로컬 · 100% 오프라인 · 100% 무료**  
VS Code / Cursor / Antigravity에서 작동하는 프리미엄 AI 코딩 에이전트

---

## ✨ 핵심 기능

| 기능 | 설명 |
|:--|:--|
| 📁 **파일 자동 생성** | "포트폴리오 사이트 만들어줘" → 폴더/파일 자동 생성 및 에디터 오픈 |
| ✏️ **기존 파일 편집** | "배경색 바꿔줘" → 해당 코드를 찾아 정확히 교체 |
| 🖥️ **터미널 명령 실행** | "express 설치해줘" → `npm install express` 자동 실행 |
| 🔍 **프로젝트 자동 분석** | 파일 구조 + 핵심 파일 내용을 AI가 자동으로 읽고 이해 |
| 💾 **대화 기록 저장** | VS Code를 닫았다 열어도 이전 대화가 그대로 유지 |
| 🎨 **코드 구문 강조** | highlight.js 기반 전문 코드 하이라이팅 |

## 📥 설치 방법

### 방법 1: VSIX 파일 설치 (가장 간단)

1. [Releases](https://github.com/YOUR_REPO/releases)에서 `.vsix` 파일 다운로드
2. VS Code / Cursor / Antigravity 열기
3. `Cmd+Shift+P` (Mac) 또는 `Ctrl+Shift+P` (Windows)  
4. `Extensions: Install from VSIX` 검색 → 다운받은 파일 선택
5. 완료! 🎉

### 방법 2: 소스에서 빌드

```bash
git clone https://github.com/YOUR_REPO/connect-ai-lab.git
cd connect-ai-lab
npm install
npm run compile
```

## ⚙️ 사전 준비: Ollama 설치

Connect AI LAB은 로컬 AI 서버인 **Ollama**를 사용합니다.

### 1. Ollama 설치
```bash
# Mac (Homebrew)
brew install ollama

# 또는 공식 사이트에서 다운로드
# https://ollama.com
```

### 2. AI 모델 다운로드
```bash
# Gemma 4 (추천, Google 최신 모델)
ollama pull gemma4:e2b

# 또는 다른 모델
ollama pull llama3.3
ollama pull deepseek-r1
ollama pull codestral
```

### 3. Ollama 서버 실행
```bash
ollama serve
```

## 🚀 사용 방법

1. **폴더 열기**: `File → Open Folder` → 프로젝트 폴더 선택
2. **사이드바 클릭**: 왼쪽 로봇 아이콘 (🤖)  
3. **대화 시작**: 자연어로 요청하면 AI가 자동으로 파일을 만들고 편집합니다!

### 예시 프롬프트:
```
간단한 Express 서버를 만들어줘
이 프로젝트에 라우터 추가해줘
package.json의 description을 바꿔줘
express 패키지 설치해줘
```

## ⚙️ 설정 변경

`File > Preferences > Settings`에서 "Connect AI LAB" 검색:

| 설정 | 기본값 | 설명 |
|:--|:--|:--|
| `ollamaUrl` | `http://127.0.0.1:11434` | Ollama 서버 주소 |
| `defaultModel` | `gemma4:e2b` | 기본 AI 모델 |
| `maxContextFiles` | `200` | 컨텍스트에 포함할 최대 파일 수 |
| `requestTimeout` | `300` | AI 응답 대기 시간 (초) |

## 🔒 프라이버시

- ❌ 클라우드 서버 없음
- ❌ 데이터 수집 없음  
- ❌ 인터넷 연결 불필요
- ✅ 모든 데이터는 내 컴퓨터 안에서만 처리

## 🤝 기여

Pull Request와 Issue를 환영합니다!

## 📄 라이선스

MIT License — 자유롭게 사용, 수정, 배포 가능합니다.

---

**Made with ❤️ by Connect AI LAB — 여러분의 AI 멘토 Jay**
