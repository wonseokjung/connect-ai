# 📨 텔레그램 보고

다른 도구가 보고를 메신저로 보낼 때 호출하는 통신선. ▶ 실행하면 **연결 테스트** — 받으면 OK, 안 오면 토큰/chat_id 다시 확인.

## 토큰은 어디에 넣나요? — **Secretary 비서가 정답**

회사 아키텍처상 비서(Secretary) 에이전트가 메신저 담당이에요. 거기 한 번만 넣으면 모든 에이전트가 공유합니다:

```
_agents/secretary/config.md
```

이 파일에 다음 두 줄:
```
- TELEGRAM_BOT_TOKEN: <토큰>
- TELEGRAM_CHAT_ID: <chat_id>
```

(이 파일은 `.gitignore`에 의해 git에 안 올라갑니다.)

### 구버전 호환 (선택)
이전 버전에서 `youtube_account.json`에 텔레그램 입력하셨다면 그것도 fallback으로 동작합니다 — 다만 비서 쪽이 우선이고 캐노니컬이에요.

## 어떻게 도와주나요?
- ✅ 연결 확인 핑 (인자 없이 실행)
- 📨 모든 에이전트(YouTube, Secretary 등)가 자동 보고 보내는 채널
- 🔕 토큰/chat_id 미설정이면 다른 도구는 텔레그램 단계만 건너뜁니다

## 봇 만드는 법 (한 번만)
1. 텔레그램 [@BotFather](https://t.me/BotFather) → `/newbot` → 토큰 받음
2. 봇에게 `/start` 등 메시지 1회 보내기
3. `https://api.telegram.org/bot<TOKEN>/getUpdates` 열어 `chat.id` 확인
4. `_agents/secretary/config.md`의 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`에 입력
5. 이 도구 [▶ 실행] → 핑 메시지 도착하면 완료

## 다른 도구에서 어떻게 쓰이나?
- "내 영상 체크" → 떡상/부진 요약 푸시
- "경쟁 채널 분석" → 다음 액션 브리프 푸시
- 비서의 전사 데일리 브리핑도 같은 라인 사용
