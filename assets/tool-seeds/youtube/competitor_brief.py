#!/usr/bin/env python3
"""Competitor Brief — for every channel in COMPETITOR_CHANNELS, pulls their
recent top-performing videos and asks the local LLM for a *prescriptive*
brief: what should YOU do next, given what's working for them.

Reads youtube_account.json (api key, competitors, ollama, model) and
competitor_brief.json (volume)."""
import os, json, sys, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ACCOUNT = os.path.join(HERE, "youtube_account.json")
CONFIG  = os.path.join(HERE, "competitor_brief.json")
REPORT  = os.path.join(HERE, "competitor_brief_report.md")

def _load(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def _resolve_channel_id(youtube, handle):
    h = handle.lstrip("@")
    try:
        r = youtube.search().list(part="snippet", q=h, type="channel", maxResults=1).execute()
        items = r.get("items", [])
        if items:
            return items[0]["snippet"]["channelId"], items[0]["snippet"]["title"]
    except Exception:
        pass
    return None, None

def _push_telegram(account, text):
    token = (account.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat  = (account.get("TELEGRAM_CHAT_ID") or "").strip()
    if not token or not chat:
        return
    try:
        import requests
        requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      json={"chat_id": chat, "text": text[:4000], "parse_mode": "Markdown"},
                      timeout=10)
    except Exception:
        pass

def main():
    if not os.path.exists(ACCOUNT):
        print("❌ youtube_account.json이 없어요.")
        sys.exit(1)
    acct = _load(ACCOUNT)
    cfg  = _load(CONFIG) if os.path.exists(CONFIG) else {}
    api_key = (acct.get("YOUTUBE_API_KEY") or "").strip()
    competitors = acct.get("COMPETITOR_CHANNELS") or []
    if not api_key:
        print("❌ YOUTUBE_API_KEY 비어있음.")
        sys.exit(1)
    if not competitors:
        print("❌ COMPETITOR_CHANNELS가 비어있어요. youtube_account.json에 채워주세요.")
        sys.exit(1)
    top_n = int(cfg.get("TOP_N_PER_CHANNEL", 5))
    lookback = int(cfg.get("LOOKBACK_DAYS", 30))
    ollama_url = (acct.get("OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")
    model = acct.get("MODEL") or ""

    try:
        from googleapiclient.discovery import build
        import requests
    except ImportError:
        print("❌ pip install google-api-python-client requests")
        sys.exit(1)
    youtube = build("youtube", "v3", developerKey=api_key)
    after = (datetime.datetime.utcnow() - datetime.timedelta(days=lookback)).isoformat("T") + "Z"

    snapshot = []
    for ch in competitors:
        cid, ctitle = _resolve_channel_id(youtube, ch)
        if not cid:
            print(f"⚠️  {ch} 채널 못 찾음")
            continue
        print(f"🔭 [{ch}] 최근 영상 분석 중...")
        sr = youtube.search().list(part="snippet", channelId=cid, maxResults=top_n,
                                    order="viewCount", publishedAfter=after, type="video").execute()
        ids = [it["id"]["videoId"] for it in sr.get("items", [])]
        if not ids:
            continue
        st = youtube.videos().list(part="statistics,snippet", id=",".join(ids)).execute()
        for it in st.get("items", []):
            stats = it.get("statistics", {})
            snip = it.get("snippet", {})
            snapshot.append({
                "channel": ctitle,
                "title": snip.get("title", ""),
                "views": int(stats.get("viewCount", 0)),
                "published": snip.get("publishedAt", "")[:10],
            })

    if not snapshot:
        print("❌ 데이터 수집 실패.")
        sys.exit(1)

    snapshot.sort(key=lambda r: r["views"], reverse=True)
    data_text = "\n".join(f"[{r['channel']}] {r['views']:,}회 · {r['published']} · {r['title']}"
                           for r in snapshot[:25])

    if not model:
        try:
            r = requests.get(f"{ollama_url}/api/tags", timeout=5)
            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
            if not models:
                print("❌ 로컬 LLM에 모델이 없어요.")
                sys.exit(1)
            model = models[0]
        except Exception as e:
            print(f"❌ LLM 연결 실패: {e}")
            sys.exit(1)

    prompt = f"""당신은 유튜브 알고리즘 전략가입니다. 아래는 경쟁 채널들의 최근 {lookback}일간 상위 영상 데이터입니다.

[경쟁 데이터]
{data_text}

이 채널 운영자에게 **지시문 형식**으로 다음을 작성하세요. 모호한 조언 금지, 구체적이고 실행 가능한 지시.

## 1) 지금 당장 해야 하는 것 (3개)
- 각 항목: "~을(를) 하세요. 왜냐하면 …"

## 2) 이번 주 안에 시도해야 하는 것 (3개)
- 각 항목: 구체적 영상 제목 후보 또는 후크 문장 포함

## 3) 절대 하지 말아야 할 것 (1개)
- 경쟁사 데이터에서 보이는 함정 패턴

## 4) 한 줄 요약
- 다음 영상의 핵심 컨셉을 한 문장으로
"""
    print("🧠 [LLM 분석 중...]")
    try:
        r = requests.post(f"{ollama_url}/api/generate",
                          json={"model": model, "prompt": prompt, "stream": False},
                          timeout=240)
        r.raise_for_status()
        brief = r.json().get("response", "").strip()
    except Exception as e:
        print(f"❌ LLM 실패: {e}")
        sys.exit(1)

    ts = time.strftime('%Y-%m-%d %H:%M')
    out = f"# 🔭 경쟁 채널 브리프 — {ts}\n\n채널: {', '.join(competitors)} · 최근 {lookback}일\n\n{brief}\n"
    print("\n" + "="*60)
    print(out)
    print("="*60)
    with open(REPORT, "a", encoding="utf-8") as f:
        f.write("\n\n" + out + "\n---\n")
    print(f"\n✅ 보고서: {REPORT}")
    _push_telegram(acct, out)

if __name__ == "__main__":
    main()
