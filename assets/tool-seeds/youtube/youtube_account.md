# 🔑 계정 / 채널 (공유 설정)

여기 한 번만 채워두면 다른 모든 YouTube 도구(트렌드 스나이퍼·내 영상 체크·댓글 수집기·경쟁 채널 분석·텔레그램 보고)가 이 값을 그대로 가져다 씁니다. 매번 도구마다 같은 키를 넣지 않아도 돼요.

## 채워야 하는 항목

| 키 | 설명 | 채우는 법 |
|---|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 키 | [console.cloud.google.com](https://console.cloud.google.com/) → 프로젝트 → "YouTube Data API v3" 사용 설정 → 사용자 인증 정보 → API 키. 무료 한도 충분(하루 10,000 단위). |
| `MY_CHANNEL_HANDLE` | 본인 채널 @핸들 | 예: `@mychannel`. 핸들 또는 ID 둘 중 하나만 채우면 됨. |
| `MY_CHANNEL_ID` | 본인 채널 ID (UCxxxx) | 핸들로 못 잡힐 때 백업용. studio.youtube.com → 설정 → 채널에서 확인. |
| `WATCHED_CHANNELS` | 댓글 수집 대상 채널 핸들 목록 | 예: `["@channel_a", "@channel_b"]`. 댓글 수집기가 이 채널들 최근 영상의 댓글을 메모리로 가져옵니다. |
| `COMPETITOR_CHANNELS` | 경쟁 채널 분석 대상 | 같은 형식. 경쟁 채널 분석 도구가 패턴을 뽑아 다음 액션을 추천합니다. |
| `TELEGRAM_BOT_TOKEN` | (선택) 봇 토큰 | **권장: 비서(Secretary) 에이전트의 `_agents/secretary/config.md`에 입력하세요.** 거기 넣으면 모든 에이전트가 공유. 여기 입력해도 동작은 하지만 fallback일 뿐. |
| `TELEGRAM_CHAT_ID` | (선택) chat_id | 위와 같음 — Secretary가 우선. |
| `OLLAMA_URL` | 로컬 LLM 주소 | 기본 `http://127.0.0.1:11434`. LM Studio면 보통 `http://127.0.0.1:1234`. |
| `MODEL` | 분석에 쓸 모델 이름 | 비워두면 첫 번째로 발견된 모델을 자동 선택. |

## 실행하면?
입력값이 제대로 들어왔는지 확인 리포트만 출력합니다 (실제 데이터 호출 X). 키가 비어있으면 알려줍니다.

## 텔레그램은 따로 — 비서(Secretary)에 입력
텔레그램 토큰은 비서 담당이에요. `_agents/secretary/config.md`에 `TELEGRAM_BOT_TOKEN: <토큰>` 한 줄 + `TELEGRAM_CHAT_ID: <id>` 한 줄 넣으면 **모든 에이전트가 공유**합니다 (YouTube 도구 포함). 여기 youtube_account.json에 같이 넣어도 동작하지만 비서 쪽이 우선이에요.

## 어디 저장되나?
`youtube_account.json`은 `.gitignore`에 의해 git에 안 올라갑니다 (API 키·토큰 보호).
