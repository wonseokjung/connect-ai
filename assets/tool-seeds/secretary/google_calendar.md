# 📥 캘린더 다가오는 일정 가져오기 (가벼운 읽기, iCal)

> **이미 옆의 "📅 일정 자동 등록 (OAuth)" 도구를 셋업하셨다면 이 도구는 필요 없습니다.** OAuth가 읽기까지 다 처리해요. 이 도구는 OAuth 셋업 없이 빠르게 일정만 가져오고 싶을 때 쓰는 가벼운 대안이에요.

비서가 본인의 Google Calendar에서 다가오는 일정을 가져와 회사 컨텍스트에 추가합니다 — 이렇게 하면 모든 에이전트가 "오늘/이번주 어떤 일정 있는지" 알고 일을 분배·계획해요.

## 어떻게 도와주나요?
- 📅 다가오는 N일치 일정 자동 수집 (**읽기 전용**)
- 💾 회사 `_shared/calendar_cache.md`에 저장 (모든 에이전트가 참조)
- 🧭 데일리 브리핑·작업 스케줄링·빈 슬롯 추천에 활용
- 🔓 OAuth 불필요 — iCal 비공개 URL 1개만 입력하면 끝

## 셋업 (3분)

1. Google Calendar 웹에서 [calendar.google.com/calendar/u/0/r/settings](https://calendar.google.com/calendar/u/0/r/settings) 들어가기
2. 왼쪽 사이드바에서 본인 캘린더 이름 클릭 → "캘린더 통합" 섹션으로 스크롤
3. **"비공개 주소(iCal 형식)"** 옆 복사 버튼 — `https://calendar.google.com/calendar/ical/.../private-XXX/basic.ics` 형태
4. 이 도구 ⚙️ 클릭 → `ICAL_URL` 칸에 붙여넣기 → 저장
5. ▶ 실행 → 콘솔에 일정 목록 + `calendar_cache.md` 생성되면 완료

## 설정값
- `ICAL_URL` — 비공개 iCal URL (위 단계에서 복사한 것)
- `DAYS_AHEAD` — 며칠치 가져올지 (기본 14)

## 보안 주의
- 이 URL을 가진 사람은 본인 캘린더 모든 일정을 볼 수 있어요. **공개 X**
- `google_calendar.json`은 `.gitignore` 처리되어 GitHub에 안 올라갑니다
- 노출됐다 싶으면 같은 설정 페이지에서 "재설정" 버튼 눌러서 옛 URL 무효화 가능

## 한계 (v1)
- **읽기 전용** — 일정 추가·수정·삭제는 안 됨
- 새로고침 없음 — 일정 보고 싶을 때마다 ▶ 실행하거나, 24시간 업무 사이클이 자동으로 주기 실행하게 둠
- 쓰기까지 원하시면 OAuth 버전 v2 별도 추가 필요 (요청 주세요)

## 다른 에이전트는 어떻게 사용?
`_shared/calendar_cache.md`가 회사 공동 컨텍스트라서 `readAgentSharedContext`가 자동으로 끌어와 모든 에이전트 프롬프트에 넣어줍니다 — "이번 주 화/목 14:00-16:00 비어있으니 영상 편집 시간 잡을까요?" 같은 추론이 가능해져요.
