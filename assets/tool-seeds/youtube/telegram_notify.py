#!/usr/bin/env python3
"""Telegram Notify — small wrapper that sends a message to your Telegram bot.

Two modes:
  1. No CLI arg → sends a connectivity test ("✅ 텔레그램 연결 정상").
  2. With CLI arg(s) → sends those as the message body. Other tools can call
     this script to push their summaries.

telegram_v3 — Secretary's tools/telegram_setup.json is the canonical
UI-managed home (input via Skills ⚙️). Falls back to legacy config.md
and finally to youtube_account.json so older setups keep working."""
import os, json, sys, time, re

HERE = os.path.dirname(os.path.abspath(__file__))
ACCOUNT = os.path.join(HERE, "youtube_account.json")
# tools/ → youtube/ → _agents/ → brain root
BRAIN_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SECRETARY_TOOL_JSON = os.path.join(BRAIN_ROOT, "_agents", "secretary", "tools", "telegram_setup.json")
SECRETARY_CFG = os.path.join(BRAIN_ROOT, "_agents", "secretary", "config.md")

def _resolve_telegram():
    """Secretary tool JSON > Secretary legacy md > youtube_account.json."""
    token, chat = "", ""
    if os.path.exists(SECRETARY_TOOL_JSON):
        try:
            with open(SECRETARY_TOOL_JSON, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            token = (cfg.get("TELEGRAM_BOT_TOKEN") or "").strip()
            chat  = (cfg.get("TELEGRAM_CHAT_ID") or "").strip()
        except Exception:
            pass
    if (not token or not chat) and os.path.exists(SECRETARY_CFG):
        try:
            with open(SECRETARY_CFG, "r", encoding="utf-8") as f:
                txt = f.read()
            if not token:
                m = re.search(r"TELEGRAM_BOT_TOKEN\s*[:：=]\s*([A-Za-z0-9:_\-]+)", txt)
                if m: token = m.group(1).strip()
            if not chat:
                m = re.search(r"TELEGRAM_CHAT_ID\s*[:：=]\s*(-?\d+)", txt)
                if m: chat = m.group(1).strip()
        except Exception:
            pass
    if (not token or not chat) and os.path.exists(ACCOUNT):
        try:
            with open(ACCOUNT, "r", encoding="utf-8") as f:
                acct = json.load(f)
            if not token: token = (acct.get("TELEGRAM_BOT_TOKEN") or "").strip()
            if not chat:  chat  = (acct.get("TELEGRAM_CHAT_ID") or "").strip()
        except Exception:
            pass
    return token, chat

def main():
    token, chat = _resolve_telegram()
    if not token or not chat:
        print("❌ TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID를 못 찾았어요.")
        print("   권장: 비서(Secretary) 클릭 → Skills → 📨 텔레그램 연결 ⚙️ → 폼에 입력")
        print("   봇 만들기: Telegram → @BotFather → /newbot")
        print("   chat_id: 봇에 메시지 1회 → https://api.telegram.org/bot<TOKEN>/getUpdates 에서 chat.id 확인")
        sys.exit(1)

    if len(sys.argv) > 1:
        body = " ".join(sys.argv[1:])
    else:
        body = f"✅ 텔레그램 연결 정상 — {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n비서(Secretary) 또는 YouTube 도구가 이 채널로 보고를 보낼 수 있습니다."

    try:
        import requests
    except ImportError:
        print("❌ pip install requests")
        sys.exit(1)
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": body, "parse_mode": "Markdown"},
            timeout=15,
        )
        r.raise_for_status()
        print(f"✅ 전송 OK ({len(body)}자)")
    except Exception as e:
        print(f"❌ 전송 실패: {e}")
        if "Bad Request" in str(e):
            print("   chat_id가 정확한지, 봇과 한 번이라도 대화를 시작했는지 확인하세요.")
        sys.exit(1)

if __name__ == "__main__":
    main()
