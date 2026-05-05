# 📨 텔레그램 연결

비서(Secretary)가 텔레그램 메신저로 보고를 보내려면 봇 토큰과 chat_id가 필요해요. **⚙️ 버튼을 누르고 폼에 입력**하면 끝 — config.md를 열 필요 없습니다.

## 어떻게 도와주나요?
- ⚙️ 폼에 입력 → `telegram_setup.json`에 저장 (`.gitignore`로 git에서 제외)
- ▶ 실행 → 텔레그램에 연결 테스트 메시지 1발 발송
- 모든 에이전트(YouTube 도구 포함)가 이 설정을 자동으로 공유

## 봇 만드는 법 (한 번만, 약 2분)
1. 텔레그램에서 [@BotFather](https://t.me/BotFather) 검색 → `/newbot` 입력
2. 봇 이름·핸들 정하면 `123456789:ABC...` 형식 토큰을 줍니다 → ⚙️의 `TELEGRAM_BOT_TOKEN`에 입력
3. 새로 만든 봇한테 `/start` 같은 메시지 1번 보내기 (chat_id 활성화)
4. 브라우저에서 `https://api.telegram.org/bot<토큰>/getUpdates` 열어 `chat.id` 숫자 복사
5. ⚙️의 `TELEGRAM_CHAT_ID`에 입력 → 저장
6. ▶ 실행 → 텔레그램에서 "✅ 비서 연결 정상" 메시지 도착하면 끝

## 이 설정을 누가 사용하나?
- 비서 자체 (데일리 브리핑·할 일 알림 등)
- YouTube 도구 (내 영상 체크·경쟁 채널 분석 보고서 푸시)
- 향후 추가될 모든 에이전트의 텔레그램 알림

## 안전
- 토큰은 `.gitignore` 처리되어 GitHub에 안 올라갑니다
- 폼은 토큰 칸을 자동으로 password 형식으로 가립니다 (다른 사람 화면 공유해도 노출 X)
- 토큰 노출됐다 싶으면 [@BotFather](https://t.me/BotFather) → `/revoke`로 즉시 폐기 가능
