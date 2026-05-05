#!/usr/bin/env python3
"""Google Calendar — secretary_calendar_v1 (iCal read-only).

비서가 Google Calendar의 다가오는 일정을 가져와서 회사 _shared/calendar_cache.md
에 저장합니다. 다음 사이클부터 모든 에이전트가 일정을 자동으로 참고할 수 있어요.

사용자는 ⚙️에서 ICAL_URL 한 줄 입력하면 끝. OAuth·API 키 모두 불필요.
"""
import os, json, sys, re, datetime, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "google_calendar.json")
BRAIN_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.path.join(BRAIN_ROOT, "_shared", "calendar_cache.md")

def main():
    if not os.path.exists(CONFIG):
        print("❌ google_calendar.json이 없어요. 먼저 ⚙️ 클릭해서 ICAL_URL 입력해주세요.")
        sys.exit(1)
    try:
        with open(CONFIG, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        print(f"❌ 설정 파일 파싱 실패: {e}")
        sys.exit(1)
    url = (cfg.get("ICAL_URL") or "").strip()
    days_ahead = int(cfg.get("DAYS_AHEAD", 14))
    if not url:
        print("❌ ICAL_URL이 비어있어요.")
        print("   가져오는 법: Google Calendar → 설정 → 일정 → '캘린더 통합' → '비공개 주소(iCal 형식)' 복사")
        sys.exit(1)
    if not (url.startswith("http://") or url.startswith("https://")):
        print("❌ URL이 http:// 또는 https://로 시작하지 않아요.")
        sys.exit(1)

    print(f"📅 Google Calendar 가져오는 중… (다가오는 {days_ahead}일)")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP {e.code} — URL이 잘못됐거나 만료됐을 수 있어요.")
        print("   Google Calendar에서 비공개 주소를 다시 복사해보세요.")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 다운로드 실패: {e}")
        sys.exit(1)

    # Parse ICS — minimal, no library dependency. Unfolds long lines first.
    raw = re.sub(r"\r?\n[ \t]", "", raw)
    events = []
    cur = None
    for line in raw.split("\n"):
        line = line.rstrip("\r")
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            key, val = line.split(":", 1)
            base = key.split(";", 1)[0]
            if base in ("SUMMARY", "DESCRIPTION", "LOCATION", "DTSTART", "DTEND"):
                cur[base] = val.strip()
                if base in ("DTSTART", "DTEND") and ";VALUE=DATE" in key:
                    cur[base + "_DATE_ONLY"] = True

    def parse_dt(s):
        if not s: return None
        s = s.strip().rstrip("Z")
        try:
            if "T" in s:
                return datetime.datetime.strptime(s, "%Y%m%dT%H%M%S")
            return datetime.datetime.strptime(s, "%Y%m%d")
        except Exception:
            return None

    now = datetime.datetime.now()
    cutoff = now + datetime.timedelta(days=days_ahead)
    upcoming = []
    for ev in events:
        dt = parse_dt(ev.get("DTSTART", ""))
        if not dt:
            continue
        if dt < now - datetime.timedelta(hours=1):
            continue
        if dt > cutoff:
            continue
        upcoming.append({
            "start": dt,
            "summary": (ev.get("SUMMARY") or "(제목 없음)").replace("\\,", ",").replace("\\n", " "),
            "location": (ev.get("LOCATION") or "").replace("\\,", ",").replace("\\n", " "),
            "all_day": ev.get("DTSTART_DATE_ONLY", False),
        })
    upcoming.sort(key=lambda e: e["start"])

    if not upcoming:
        print(f"📭 다음 {days_ahead}일 안에 일정 없음.")
    else:
        print(f"✅ {len(upcoming)}개 일정 가져옴:")
        for ev in upcoming[:10]:
            ts = ev["start"].strftime("%m/%d %a") if ev["all_day"] else ev["start"].strftime("%m/%d %a %H:%M")
            loc = f" @ {ev['location']}" if ev["location"] else ""
            print(f"  • {ts} — {ev['summary']}{loc}")

    # Persist to brain so all agents see it
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    lines = [
        "# 📅 다가오는 일정 (Google Calendar)",
        f"_업데이트: {now.strftime('%Y-%m-%d %H:%M')} · 향후 {days_ahead}일_",
        "",
    ]
    if not upcoming:
        lines.append("_없음_")
    else:
        for ev in upcoming:
            ts = ev["start"].strftime("%Y-%m-%d (%a)") if ev["all_day"] else ev["start"].strftime("%Y-%m-%d (%a) %H:%M")
            loc = f" — 📍 {ev['location']}" if ev["location"] else ""
            lines.append(f"- **{ts}** · {ev['summary']}{loc}")
    with open(CACHE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\n💾 회사 컨텍스트에 저장: {CACHE}")
    print("   다음 사이클부터 모든 에이전트가 이 일정을 자동으로 참고합니다.")

if __name__ == "__main__":
    main()
