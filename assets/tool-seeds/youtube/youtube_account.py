#!/usr/bin/env python3
"""YouTube Account / Channels — shared config for every YouTube tool.

This script doesn't fetch anything by itself. It's listed in the agent panel
so you can click ⚙️ once and fill in your API key, channel, watched
channels, etc. — and every other tool will read from here.

Running it just prints a sanity-check report so you can confirm the values
are loaded correctly (without leaking the full API key)."""
import os, json, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "youtube_account.json")

def load():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def main():
    cfg = load()
    api = (cfg.get("YOUTUBE_API_KEY") or "").strip()
    masked = (api[:4] + "…" + api[-3:]) if len(api) >= 8 else ("(빈 값)" if not api else "(짧음)")
    print("─── YouTube 계정 / 채널 설정 ───")
    print(f"  API 키            : {masked}")
    print(f"  내 채널 핸들       : {cfg.get('MY_CHANNEL_HANDLE') or '(없음)'}")
    print(f"  내 채널 ID        : {cfg.get('MY_CHANNEL_ID') or '(없음)'}")
    watched = cfg.get('WATCHED_CHANNELS') or []
    print(f"  감시 채널 ({len(watched)}개) : {', '.join(watched) if watched else '(없음)'}")
    competitors = cfg.get('COMPETITOR_CHANNELS') or []
    print(f"  경쟁 채널 ({len(competitors)}개): {', '.join(competitors) if competitors else '(없음)'}")
    tg_bot = (cfg.get('TELEGRAM_BOT_TOKEN') or '').strip()
    tg_chat = (cfg.get('TELEGRAM_CHAT_ID') or '').strip()
    if tg_bot and tg_chat:
        print(f"  텔레그램          : 연결됨 (chat {tg_chat})")
    else:
        print(f"  텔레그램          : 미설정 (보고 알림 비활성)")
    print(f"  Ollama URL        : {cfg.get('OLLAMA_URL') or 'http://127.0.0.1:11434'}")
    print(f"  분석 모델          : {cfg.get('MODEL') or '(자동 선택)'}")
    if not api:
        print("\n⚠️  API 키가 비어있어요. 다른 도구들이 동작하지 않습니다.")
        print("   발급: https://console.cloud.google.com/ → YouTube Data API v3")
        sys.exit(1)
    print("\n✅ 공유 설정 로드 OK. 다른 도구들이 이 값을 자동으로 사용합니다.")

if __name__ == "__main__":
    main()
