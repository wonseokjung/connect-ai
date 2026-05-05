#!/usr/bin/env python3
"""Telegram 연결 — secretary_telegram_v2.

Secretary 에이전트의 텔레그램 연결 도구. 토큰·chat_id를 Skills의 ⚙️ 폼에
입력하면 `telegram_setup.json`에 저장되고, 이 스크립트가 메시지 1발 보내서
연결을 테스트합니다. 회사의 모든 에이전트(YouTube 포함)가 이 설정을
공유합니다."""
import os, json, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "telegram_setup.json")

def main():
    if not os.path.exists(CONFIG):
        print("❌ telegram_setup.json이 없어요. 먼저 ⚙️ 클릭해서 토큰을 입력해주세요.")
        sys.exit(1)
    try:
        with open(CONFIG, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        print(f"❌ 설정 파일 파싱 실패: {e}")
        sys.exit(1)
    token = (cfg.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat  = (cfg.get("TELEGRAM_CHAT_ID") or "").strip()
    if not token or not chat:
        print("❌ TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 비어있어요.")
        print("   봇 만들기: Telegram → @BotFather → /newbot → 토큰 받기")
        print("   chat_id  : 봇에 메시지 1번 → https://api.telegram.org/bot<TOKEN>/getUpdates 에서 chat.id")
        sys.exit(1)
    try:
        import requests
    except ImportError:
        print("❌ pip install requests")
        sys.exit(1)
    body = f"✅ 비서(Secretary) 텔레그램 연결 정상 — {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n이 메시지가 보이면 모든 에이전트가 이 채널로 보고를 보낼 수 있어요."
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": body, "parse_mode": "Markdown"},
            timeout=15,
        )
        r.raise_for_status()
        print(f"✅ 전송 OK — 텔레그램에서 확인하세요. ({len(body)}자)")
    except Exception as e:
        print(f"❌ 전송 실패: {e}")
        if "Bad Request" in str(e):
            print("   chat_id가 정확한지, 봇과 한 번이라도 대화를 시작했는지 확인하세요.")
        sys.exit(1)

if __name__ == "__main__":
    main()
