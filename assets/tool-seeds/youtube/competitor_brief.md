# 🔭 경쟁 채널 분석

`youtube_account.json`의 `COMPETITOR_CHANNELS`에 적은 경쟁 채널들의 최근 떡상 영상을 모아서, 로컬 LLM에게 **지시문 형식**의 다음 액션 브리프를 받아옵니다 — "이거 해야합니다 / 저거 해야합니다 / 이건 절대 하지 마세요" 형태로 나옵니다.

## 어떻게 도와주나요?
- 🔭 경쟁 채널마다 최근 N개 인기 영상(view 기준) 수집
- 🧠 로컬 LLM이 패턴을 읽고 4섹션으로 브리프 작성:
  - 1) 지금 당장 해야 하는 것 3개
  - 2) 이번 주 시도할 것 3개 (제목 후보 포함)
  - 3) 절대 하지 말 것 1개
  - 4) 다음 영상 핵심 한 줄
- 📨 텔레그램 설정돼있으면 자동 푸시

## 시작하기 전 체크
- `youtube_account.json`의 `COMPETITOR_CHANNELS` 채워두기
- 로컬 LLM(Ollama/LM Studio)이 켜져 있어야 함

## 설정값 (competitor_brief.json)
- `TOP_N_PER_CHANNEL` — 채널마다 상위 영상 몇 개 (기본 5)
- `LOOKBACK_DAYS` — 며칠치 (기본 30)
