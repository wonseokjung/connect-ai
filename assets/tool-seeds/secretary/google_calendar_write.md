# 📅 Google Calendar

비서가 본인의 Google Calendar와 양방향 연결됩니다 — 다가오는 일정 자동 동기화 + 마감일(due) 있는 추적 작업을 자동으로 캘린더에 등록 (5분 전·1시간 전 알림 자동).

## 무엇을 추가로 하나요? (vs iCal 읽기 전용)
- ✍️ **자동 일정 생성** — 추적기에 due 들어가면 즉시 캘린더에 일정 만듦
- 🔁 일정 수정·삭제도 가능 (작업 완료/취소 시 캘린더 정리)
- 🔔 알림 자동 셋팅 (5분 전, 1시간 전 팝업)
- 📥 동시에 읽기도 가능 (별도 iCal 셋업 불필요)

## 셋업 (한 번만, 5~10분)

명령 팔레트 → **`Connect AI: Google Calendar 자동 일정 연결 📅`** 실행하면 마법사가 안내합니다:

1. Google Cloud Console에서 OAuth 클라이언트 만들기 (가이드 따라 클릭)
2. Client ID + Secret 붙여넣기
3. 브라우저로 로그인 → 끝

## 동작 방식
- 사용자: *"내일까지 광고주 자료 정리해야 해"* 라고 텔레그램으로 시킴
- 비서: 추적기 등록 + 자동으로 `내일 09:00` Google Calendar에 일정 생성
- 알림: 5분 전, 1시간 전 자동 팝업

## 설정 (⚙️에서 조정 가능)
- `CALENDAR_ID` — 기본 `primary` (본인 메인 캘린더). 다른 캘린더 ID 가능
- `DEFAULT_DURATION_MINUTES` — 기본 60분. 작업 일정 길이가 명시 안 됐을 때 사용

## ▶ 실행하면?
현재 연결 상태와 설정값을 진단 출력합니다 (이벤트 생성 X). 진짜 일정 등록은 추적 작업이 들어올 때 자동.

## 보안
- Client ID/Secret/Refresh Token은 `google_calendar_write.json` 한 파일에. `.gitignore` 처리되어 git에 안 올라갑니다
- 권한 범위: `calendar.events`만 (캘린더 일정 읽기/쓰기). 메일·드라이브·연락처 다 못 봅니다
- 연결 해제: 명령 팔레트에서 같은 명령 → "연결 해제" 선택. 또는 [myaccount.google.com/permissions](https://myaccount.google.com/permissions)에서 직접 권한 회수
