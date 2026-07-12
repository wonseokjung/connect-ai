#!/usr/bin/env python3
"""Web Search — real-time web search using You.com Search API.
Appends formatted results to the researcher's memory so agents can
reference live data in their next think cycle.

Reads from web_search.json (you_com_api_key, max_results).
Writes results to memory.md in the researcher agent folder."""
import os
import json
import sys
import urllib.request
import urllib.parse
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "web_search.json")
MEMORY = os.path.join(HERE, "..", "memory.md")
REPORT = os.path.join(HERE, "web_search_report.md")


def _load(p):
    if not os.path.exists(p):
        return {}
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def _youcom_search(query, api_key, max_results=10):
    """Call You.com Search API and return list of result dicts."""
    url = f"https://api.you.com/v1/search?query={urllib.parse.quote(query)}"
    req = urllib.request.Request(url, headers={
        "X-API-Key": api_key,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; ConnectAI/1.0)",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            print("❌ Invalid You.com API key. Get one at https://api.you.com/apiKey")
        else:
            print(f"❌ HTTP error {e.code}: {e.reason}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"❌ Network error: {e.reason}")
        sys.exit(1)

    results = []
    # /v1/search returns { results: { web: [], news: [] } }
    raw_results = data.get("results", {}) if isinstance(data, dict) else {}
    web_results = raw_results.get("web", []) if isinstance(raw_results, dict) else []
    news_results = raw_results.get("news", []) if isinstance(raw_results, dict) else []
    combined = (web_results + news_results)[:max_results]
    for item in combined:
        if isinstance(item, dict):
            snippets = item.get("snippets", [])
            snippet = snippets[0] if isinstance(snippets, list) and snippets else item.get("snippet", "")
            results.append({
                "title": item.get("title", "Untitled"),
                "url": item.get("url", ""),
                "description": item.get("description", ""),
                "snippet": snippet,
            })
    return results


def main():
    if len(sys.argv) < 2:
        print("사용법: python web_search.py <검색어>")
        sys.exit(1)

    query = " ".join(sys.argv[1:]).strip()
    if not query:
        print("❌ 검색어가 비어있습니다.")
        sys.exit(1)

    cfg = _load(CONFIG)
    api_key = (cfg.get("you_com_api_key") or "").strip()
    if not api_key:
        print("❌ you_com_api_key가 설정되지 않았습니다.")
        print("   web_search.json 파일에 API 키를 추가해주세요.")
        print("   https://api.you.com/apiKey 에서 무료로 발급받을 수 있습니다.")
        sys.exit(1)

    max_results = int(cfg.get("max_results", 10))

    print(f"🔍 You.com 검색 중: {query}")
    results = _youcom_search(query, api_key, max_results)

    if not results:
        print("⚠️  결과 없음.")
        sys.exit(0)

    print(f"✅ {len(results)}개 결과\n")

    import datetime
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    md_lines = [f"\n## 🔍 웹 검색 결과 — {ts}", f"**검색어:** {query}\n"]
    for i, r in enumerate(results, 1):
        md_lines.append(f"{i}. **[{r['title']}]({r['url']})**")
        if r["description"]:
            md_lines.append(f"   {r['description']}")
        if r["snippet"] and r["snippet"] != r["description"]:
            md_lines.append(f"   > {r['snippet']}")
        md_lines.append("")

    block = "\n".join(md_lines)

    # Append to researcher memory
    os.makedirs(os.path.dirname(MEMORY), exist_ok=True)
    if not os.path.exists(MEMORY):
        with open(MEMORY, "w", encoding="utf-8") as f:
            f.write("# Researcher 에이전트 — 메모리\n\n")
    with open(MEMORY, "a", encoding="utf-8") as f:
        f.write("\n" + block + "\n")

    # Write report
    with open(REPORT, "a", encoding="utf-8") as f:
        f.write("\n" + block + "\n---\n")

    print(block)
    print(f"\n✅ 메모리에 저장: {MEMORY}")
    print(f"✅ 보고서: {REPORT}")


if __name__ == "__main__":
    main()
