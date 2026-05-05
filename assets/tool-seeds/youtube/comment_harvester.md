# 💬 댓글 수집기

`youtube_account.json`의 `WATCHED_CHANNELS`에 적은 채널들의 최근 영상에서 인기 댓글을 가져와 YouTube 에이전트의 `memory.md`에 누적 저장합니다. 시청자가 실제로 어떤 단어·반응을 쓰는지가 메모리에 쌓이면, 에이전트가 다음 영상 후크나 제목을 짤 때 그 표현을 자연스럽게 참고하게 됩니다.

## 어떻게 도와주나요?
- 📡 감시 채널마다 최근 N개 영상 → 인기 댓글 M개 가져오기
- 🧠 결과를 `_agents/youtube/memory.md`에 자동 추가 (에이전트가 다음 사이클에 자동 참조)
- 📒 같은 폴더에 `comment_harvester_report.md`로 누적 백업

## 시작하기 전 체크
- `youtube_account.json`에 `WATCHED_CHANNELS` 배열 채워두기 (예: `["@channel_a","@channel_b"]`)
- 댓글이 꺼진 영상은 자동 스킵
- API 비용: 채널당 search 1회 + 영상마다 commentThreads 1회 (가벼움)

## 설정값 (comment_harvester.json)
- `VIDEOS_PER_CHANNEL` — 채널마다 영상 몇 개 (기본 5)
- `COMMENTS_PER_VIDEO` — 영상마다 댓글 몇 개 (기본 20)
- `LOOKBACK_DAYS` — 며칠치 영상까지 (기본 14)

## 어떻게 활용되나?
메모리에 쌓인 댓글을 에이전트가 다음 한 스텝에서 자연스럽게 참고합니다. 직접 보고 싶으면 `memory.md` 또는 같은 폴더의 `comment_harvester_report.md`를 열면 돼요.
