#!/usr/bin/env python3
"""Professional YouTube Channel Analysis — pro_v4.

채널 메타 · 영상별 상세 (조회수·좋아요율·댓글율·길이·요일) · 상위/하위 영상의 패턴 ·
인기 댓글 샘플 · 발행 요일 분석 · 제목 키워드 · 우선순위 액션 추천. 모든 분석은
실제 YouTube Data API 호출 결과 기반.

Reads YOUTUBE_API_KEY + MY_CHANNEL_HANDLE/ID from youtube_account.json.
Reads LOOKBACK_DAYS / TOP_N / COMMENT_SAMPLES from my_videos_check.json."""
import os, json, sys, time, datetime, re, statistics, warnings, html as html_lib
from collections import Counter
# v2.89.49 — DeprecationWarning(utcnow 등) 노이즈 제거. 사용자 채팅창 출력에 끼면 못생김.
warnings.filterwarnings("ignore", category=DeprecationWarning)

HERE = os.path.dirname(os.path.abspath(__file__))
ACCOUNT = os.path.join(HERE, "youtube_account.json")
CONFIG  = os.path.join(HERE, "my_videos_check.json")
REPORT  = os.path.join(HERE, "my_videos_check_report.md")

def _load(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def _resolve_channel_id(youtube, handle, channel_id):
    if channel_id:
        return channel_id
    if not handle:
        return None
    h = handle.lstrip("@")
    try:
        r = youtube.search().list(part="snippet", q=h, type="channel", maxResults=1).execute()
        items = r.get("items", [])
        if items:
            return items[0]["snippet"]["channelId"]
    except Exception as e:
        print(f"⚠️  채널 ID 조회 실패: {e}")
    return None

def _resolve_telegram(account):
    """telegram_v3 — Secretary's tools/telegram_setup.json is the canonical
    UI-managed home (input via Skills ⚙️). Fallback chain:
      1) youtube_account.json (this tool's local override, back-compat)
      2) _agents/secretary/tools/telegram_setup.json (UI-managed, canonical)
      3) _agents/secretary/config.md (legacy markdown, back-compat)
    """
    import re, json as _json
    token = (account.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat  = (account.get("TELEGRAM_CHAT_ID") or "").strip()
    if token and chat:
        return token, chat
    brain_root = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
    # 2) Secretary's tool JSON
    sec_json = os.path.join(brain_root, "_agents", "secretary", "tools", "telegram_setup.json")
    if (not token or not chat) and os.path.exists(sec_json):
        try:
            with open(sec_json, "r", encoding="utf-8") as f:
                cfg = _json.load(f)
            if not token: token = (cfg.get("TELEGRAM_BOT_TOKEN") or "").strip()
            if not chat:  chat  = (cfg.get("TELEGRAM_CHAT_ID") or "").strip()
        except Exception:
            pass
    # 3) Legacy config.md
    sec_cfg = os.path.join(brain_root, "_agents", "secretary", "config.md")
    if (not token or not chat) and os.path.exists(sec_cfg):
        try:
            with open(sec_cfg, "r", encoding="utf-8") as f:
                txt = f.read()
            if not token:
                m = re.search(r"TELEGRAM_BOT_TOKEN\s*[:：=]\s*([A-Za-z0-9:_\-]+)", txt)
                if m: token = m.group(1).strip()
            if not chat:
                m = re.search(r"TELEGRAM_CHAT_ID\s*[:：=]\s*(-?\d+)", txt)
                if m: chat = m.group(1).strip()
        except Exception:
            pass
    return token, chat

def _push_telegram(account, text):
    """v2.89.49 — 마크다운 모드는 *,[,(,),# 같은 특수문자 많은 보고서에서 자주 400 거부.
    이전엔 그래도 'sent' print해서 사용자한테 가짜 성공 보고. 이제 plain text 모드로
    안전하게 보내고 HTTP status 체크해서 진짜 성공/실패 정확히 알려줌."""
    token, chat = _resolve_telegram(account)
    if not token or not chat:
        print("⚠️  텔레그램 토큰/chat_id 미설정 — 전송 안 함", file=sys.stderr)
        return
    try:
        import requests
        # plain text (parse_mode 없음) — 어떤 특수문자든 통과
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": text[:4000]},
            timeout=10,
        )
        if r.status_code == 200:
            print("📨 텔레그램 전송 성공", file=sys.stderr)
        else:
            try:
                err = r.json().get("description", r.text[:200])
            except Exception:
                err = r.text[:200]
            print(f"⚠️  텔레그램 전송 실패 (HTTP {r.status_code}): {err}", file=sys.stderr)
    except Exception as e:
        print(f"⚠️  텔레그램 전송 에러: {e}", file=sys.stderr)

def _fmt_num(n):
    if n >= 1_000_000: return f"{n/1_000_000:.1f}M"
    if n >= 1_000: return f"{n/1_000:.1f}K"
    return f"{n:,}"

def _parse_duration(iso):
    """ISO 8601 duration (PT5M30S) → seconds"""
    m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', iso or '')
    if not m: return 0
    h, mn, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mn * 60 + s

def _fmt_duration(secs):
    if secs >= 3600: return f"{secs//3600}시간 {(secs%3600)//60}분"
    if secs >= 60: return f"{secs//60}분 {secs%60}초"
    return f"{secs}초"

def _korean_weekday(dt):
    return ["월","화","수","목","금","토","일"][dt.weekday()]

def main():
    if not os.path.exists(ACCOUNT):
        print("❌ youtube_account.json이 없어요. 직원 에이전트 보기 → YouTube → 도구 ⚙️에서 API 키와 채널 ID를 입력하세요.")
        sys.exit(1)
    acct = _load(ACCOUNT)
    cfg  = _load(CONFIG) if os.path.exists(CONFIG) else {}
    api_key = (acct.get("YOUTUBE_API_KEY") or "").strip()
    handle  = (acct.get("MY_CHANNEL_HANDLE") or "").strip()
    chan_id = (acct.get("MY_CHANNEL_ID") or "").strip()
    if not api_key:
        print("❌ YOUTUBE_API_KEY 미설정. youtube_account.json에 채워주세요.")
        sys.exit(1)
    if not (handle or chan_id):
        print("❌ MY_CHANNEL_HANDLE 또는 MY_CHANNEL_ID 필요.")
        sys.exit(1)
    lookback = int(cfg.get("LOOKBACK_DAYS", 30))
    top_n    = int(cfg.get("TOP_N", 15))
    comment_samples = int(cfg.get("COMMENT_SAMPLES", 5))

    try:
        from googleapiclient.discovery import build
    except ImportError:
        print("❌ google-api-python-client 미설치. pip install google-api-python-client requests")
        sys.exit(1)
    youtube = build("youtube", "v3", developerKey=api_key)

    cid = _resolve_channel_id(youtube, handle, chan_id)
    if not cid:
        print("❌ 채널 ID를 찾지 못했어요. youtube_account.json의 핸들/ID 확인.")
        sys.exit(1)

    # === 1. 채널 메타 ===
    print(f"🔍 채널 정보 가져오는 중...", file=sys.stderr)
    cr = youtube.channels().list(part="snippet,statistics,contentDetails,brandingSettings", id=cid).execute()
    cit = cr.get("items", [])
    if not cit:
        print(f"❌ 채널 데이터 없음 (ID: {cid})")
        sys.exit(1)
    ch = cit[0]
    snip = ch.get("snippet", {})
    cstats = ch.get("statistics", {})
    # v2.89.55 — YouTube API가 가끔 &amp; / &#39; 같은 HTML entity로 인코딩된 제목 반환.
    # 이걸 그대로 출력하면 채팅창에서 "&#39;" 가 literal로 보임. 미리 디코드.
    ch_title = html_lib.unescape(snip.get("title", "") or "")
    custom_url = snip.get("customUrl", "")
    published = (snip.get("publishedAt", "") or "")[:10]
    country = snip.get("country", "")
    sub_count = int(cstats.get("subscriberCount", 0))
    subs_hidden = cstats.get("hiddenSubscriberCount", False)
    view_count_total = int(cstats.get("viewCount", 0))
    video_count_total = int(cstats.get("videoCount", 0))
    if published:
        try:
            age_days = (datetime.date.today() - datetime.date.fromisoformat(published)).days
        except Exception:
            age_days = 0
    else:
        age_days = 0
    age_years = age_days / 365.25 if age_days > 0 else 0
    avg_views_per_video_alltime = view_count_total // video_count_total if video_count_total else 0

    # === 2. 최근 영상 목록 ===
    print(f"🔍 최근 {lookback}일 영상 가져오는 중...", file=sys.stderr)
    after = (datetime.datetime.utcnow() - datetime.timedelta(days=lookback)).isoformat("T") + "Z"
    sr = youtube.search().list(part="snippet", channelId=cid, maxResults=top_n,
                                order="date", publishedAfter=after, type="video").execute()
    vids = [(it["id"]["videoId"], it["snippet"]["title"], it["snippet"]["publishedAt"])
            for it in sr.get("items", [])]
    if not vids:
        # Fallback to most recent regardless of lookback window
        sr = youtube.search().list(part="snippet", channelId=cid, maxResults=top_n,
                                    order="date", type="video").execute()
        vids = [(it["id"]["videoId"], it["snippet"]["title"], it["snippet"]["publishedAt"])
                for it in sr.get("items", [])]
    if not vids:
        # v2.89.55 — 빈 영상 시 stderr로. stdout이 비어 있어야 TS shortcut이 실패로 정확히 처리.
        print(f"⚠️  업로드된 영상이 없어요.", file=sys.stderr)
        sys.exit(0)

    # === 3. 영상 상세 통계 ===
    print(f"🔍 영상 {len(vids)}개 상세 통계 + 길이·태그 가져오는 중...", file=sys.stderr)
    vstats = youtube.videos().list(
        part="statistics,contentDetails,snippet",
        id=",".join(v[0] for v in vids)
    ).execute()
    sm = {it["id"]: it for it in vstats.get("items", [])}
    rows = []
    for vid, vtitle, pub in vids:
        item = sm.get(vid, {})
        s = item.get("statistics", {})
        cd = item.get("contentDetails", {})
        sn = item.get("snippet", {})
        views = int(s.get("viewCount", 0))
        likes = int(s.get("likeCount", 0))
        comments = int(s.get("commentCount", 0))
        dur_sec = _parse_duration(cd.get("duration", "PT0S"))
        like_rate = (likes / views * 100) if views > 0 else 0
        comment_rate = (comments / views * 100) if views > 0 else 0
        try:
            pub_dt = datetime.datetime.fromisoformat(pub.replace("Z", "+00:00"))
            weekday = _korean_weekday(pub_dt)
            hour = pub_dt.hour
        except Exception:
            weekday, hour = "-", 0
        rows.append({
            # v2.89.55 — title HTML entity 디코드 (&#39; → ', &amp; → & 등)
            "id": vid, "title": html_lib.unescape(vtitle or ""), "pub": pub[:10],
            "weekday": weekday, "hour": hour,
            "views": views, "likes": likes, "comments": comments,
            "duration_sec": dur_sec,
            "like_rate": like_rate, "comment_rate": comment_rate,
            "tags": sn.get("tags", []) or [],
            "is_short": dur_sec <= 60,
        })

    # === 4. 집계 ===
    views_list = [r["views"] for r in rows]
    median_views = int(statistics.median(views_list)) if views_list else 0
    avg_views = int(statistics.mean(views_list)) if views_list else 0
    avg_likes = int(statistics.mean([r["likes"] for r in rows])) if rows else 0
    avg_comments = int(statistics.mean([r["comments"] for r in rows])) if rows else 0
    avg_duration = int(statistics.mean([r["duration_sec"] for r in rows])) if rows else 0
    avg_like_rate = statistics.mean([r["like_rate"] for r in rows]) if rows else 0
    avg_comment_rate = statistics.mean([r["comment_rate"] for r in rows]) if rows else 0
    title_lengths = [len(r["title"]) for r in rows]
    avg_title_len = int(statistics.mean(title_lengths)) if title_lengths else 0
    shorts_count = sum(1 for r in rows if r["is_short"])

    rows_sorted = sorted(rows, key=lambda r: r["views"], reverse=True)
    top_videos = rows_sorted[:3]
    bottom_videos = rows_sorted[-3:][::-1] if len(rows_sorted) >= 4 else []

    # 요일·시간대 패턴
    weekday_views = {}
    for r in rows:
        weekday_views.setdefault(r["weekday"], []).append(r["views"])
    weekday_avg = {wd: int(statistics.mean(vs)) for wd, vs in weekday_views.items()}

    # 상위 영상 제목 키워드
    top_title_words = Counter()
    stop_kr = {'그리고','근데','너무','진짜','정말','내가','지금','이거','저는','제가','우리'}
    stop_en = {'this','that','and','the','for','with','have','will','your','from','about'}
    for r in top_videos:
        words = re.findall(r'[가-힣]+|[a-zA-Z]+', r["title"])
        top_title_words.update(w for w in words if len(w) >= 2 and w.lower() not in stop_en and w not in stop_kr)
    top_keywords = [w for w, _ in top_title_words.most_common(8)]

    # === 5. 인기 댓글 샘플 (상위 3개 영상) ===
    print(f"💬 상위 영상의 인기 댓글 가져오는 중...", file=sys.stderr)
    comments_by_video = {}
    for r in top_videos[:3]:
        try:
            cr_resp = youtube.commentThreads().list(
                part="snippet", videoId=r["id"], maxResults=comment_samples, order="relevance"
            ).execute()
            comments_by_video[r["id"]] = [
                {
                    # v2.89.55 — author/text도 HTML entity 디코드
                    "author": html_lib.unescape(c["snippet"]["topLevelComment"]["snippet"].get("authorDisplayName", "") or ""),
                    "text": html_lib.unescape(c["snippet"]["topLevelComment"]["snippet"].get("textOriginal", "") or "")[:200],
                    "likes": int(c["snippet"]["topLevelComment"]["snippet"].get("likeCount", 0)),
                }
                for c in cr_resp.get("items", [])
            ]
        except Exception:
            comments_by_video[r["id"]] = []  # 댓글 비활성 영상이면 403

    # === 6. 종합 보고서 ===
    # v2.89.50 — 시각적으로 더 멋진 레이아웃. 블록인용·이모지 평가·시각 분리선 활용.
    sub_str = "비공개" if subs_hidden else f"{_fmt_num(sub_count)}명"
    like_rating = "🟢 좋음" if avg_like_rate >= 2.0 else ("🟡 보통" if avg_like_rate >= 1.0 else "🔴 개선")
    comment_rating = "🟢 좋음" if avg_comment_rate >= 0.5 else ("🟡 보통" if avg_comment_rate >= 0.2 else "🔴 개선")
    L = []
    L.append(f"# 🎬 {ch_title}")
    L.append(f"_{time.strftime('%Y-%m-%d %H:%M')} · 최근 {lookback}일 분석 · 영상 {len(rows)}개_")
    L.append("")
    # 채널 메타 — 인용 블록으로 한눈에
    L.append(f"> **{sub_str}** 구독자 · **{_fmt_num(view_count_total)}** 누적 조회 · **{video_count_total:,}개** 영상" + (f" · **{age_years:.1f}년** 운영" if age_years > 0 else ""))
    L.append(f"> 핸들 `{custom_url or handle or '-'}`" + (f" · 🌍 {country}" if country else "") + f" · 영상당 평균 **{_fmt_num(avg_views_per_video_alltime)}** 조회")
    L.append("")
    L.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    L.append("")

    # 최근 성과 요약 — 카드 스타일
    L.append(f"## 📊 최근 {lookback}일 성과 한눈에")
    L.append("")
    L.append("| 지표 | 값 | 평가 |")
    L.append("|---|---|---|")
    pace = (len(rows) * 30 / lookback) if lookback > 0 else 0
    pace_rating = "🟢 활발" if pace >= 4 else ("🟡 보통" if pace >= 2 else "🔴 저조")
    L.append(f"| 업로드 | {len(rows)}개 (월 {pace:.1f}개) | {pace_rating} |")
    if rows:
        L.append(f"| 조회수 중간값 | **{_fmt_num(median_views)}** | 최고 {_fmt_num(rows_sorted[0]['views'])} · 최저 {_fmt_num(rows_sorted[-1]['views'])} |")
    L.append(f"| 좋아요율 | **{avg_like_rate:.2f}%** | {like_rating} (업계 2~5%) |")
    L.append(f"| 댓글율 | **{avg_comment_rate:.2f}%** | {comment_rating} (업계 0.3~1%) |")
    L.append(f"| 평균 길이 | {_fmt_duration(avg_duration)} | 제목 평균 {avg_title_len}자 |")
    if shorts_count:
        L.append(f"| Shorts | {shorts_count}개 / {len(rows)} | - |")
    L.append("")
    L.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    L.append("")

    # 영상별 상세 표
    L.append("## 📺 영상별 상세 (조회수 순)")
    L.append("| # | 조회수 | 좋아요 (율) | 댓글 (율) | 길이 | 발행 | 제목 |")
    L.append("|---|---|---|---|---|---|---|")
    for i, r in enumerate(rows_sorted, 1):
        marker = "🔥" if r["views"] >= median_views * 1.5 else ("👍" if r["views"] >= median_views else "🥶")
        title_short = r['title'].replace('|', '\\|')[:60]
        L.append(f"| {i}{marker} | {_fmt_num(r['views'])} | {_fmt_num(r['likes'])} ({r['like_rate']:.1f}%) | {_fmt_num(r['comments'])} ({r['comment_rate']:.1f}%) | {_fmt_duration(r['duration_sec'])} | {r['pub']}({r['weekday']}) | {title_short} |")
    L.append("")

    # 상위 영상 심층 분석 — 카드 스타일 + 메달 이모지
    L.append("## 🏆 TOP 3 — 무엇이 잘 됐나")
    L.append("")
    medals = ["🥇", "🥈", "🥉"]
    for idx, r in enumerate(top_videos):
        medal = medals[idx] if idx < 3 else "👍"
        L.append(f"### {medal} {_fmt_num(r['views'])}회 · {r['title']}")
        L.append("")
        L.append(f"> 📅 {r['pub']} ({r['weekday']}요일 {r['hour']:02d}시) · ⏱ {_fmt_duration(r['duration_sec'])} · 👍 {r['like_rate']:.2f}% · 💬 {r['comment_rate']:.2f}%")
        if r['tags']:
            tag_str = ' '.join(f"`{t}`" for t in r['tags'][:5])
            L.append(f"> 🏷 {tag_str}" + (' …' if len(r['tags']) > 5 else ''))
        L.append(f"> 🔗 [영상 보기](https://youtu.be/{r['id']}) · 🖼 [썸네일](https://i.ytimg.com/vi/{r['id']}/mqdefault.jpg)")
        cs = comments_by_video.get(r["id"], [])
        if cs:
            L.append("")
            L.append("**💬 인기 댓글:**")
            for c in cs[:3]:
                txt = c['text'].replace(chr(10), ' ').replace(chr(13), ' ')[:140]
                L.append(f"> _{c['author']}_ (👍{c['likes']}): {txt}")
        L.append("")

    # 하위 영상 — 시각적으로 부진 강조
    if bottom_videos:
        L.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        L.append("")
        L.append("## 🥶 하위 영상 — 개선 필요")
        L.append("")
        for r in bottom_videos:
            gap_pct = int((1 - r['views'] / median_views) * 100) if median_views else 0
            L.append(f"- **{_fmt_num(r['views'])}회** · 중간값 대비 **-{gap_pct}%** ↓")
            L.append(f"  - {r['title']}")
            L.append(f"  - 📅 {r['pub']}({r['weekday']}, {r['hour']:02d}시) · ⏱ {_fmt_duration(r['duration_sec'])} · 🔗 [영상](https://youtu.be/{r['id']})")
        L.append("")

    # 패턴
    L.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    L.append("")
    L.append("## 🔍 패턴 분석")
    L.append("")
    if weekday_avg and len(weekday_avg) >= 2:
        best_day = max(weekday_avg.items(), key=lambda x: x[1])
        worst_day = min(weekday_avg.items(), key=lambda x: x[1])
        ratio = best_day[1] / worst_day[1] if worst_day[1] else 1
        L.append(f"- 📅 **최고 요일**: {best_day[0]}요일 (평균 {_fmt_num(best_day[1])}회) — 최저 대비 **{ratio:.1f}배**")
        L.append(f"- 📅 **최저 요일**: {worst_day[0]}요일 (평균 {_fmt_num(worst_day[1])}회)")
    if top_keywords:
        L.append(f"- 🔑 **상위 영상 키워드**: {' '.join('`'+k+'`' for k in top_keywords)}")
    if title_lengths:
        L.append(f"- 📝 **제목 길이**: 평균 {avg_title_len}자 (최단 {min(title_lengths)}자 · 최장 {max(title_lengths)}자)")
    if avg_duration > 0:
        L.append(f"- ⏱ **영상 길이**: 평균 {_fmt_duration(avg_duration)}" + (f" · Shorts(60초 이하) {shorts_count}/{len(rows)}개" if shorts_count else ""))
    L.append("")

    # 액션 추천 — 카드 스타일
    L.append("")
    L.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    L.append("")
    L.append("## 🎯 다음 액션 (우선순위)")
    L.append("")
    recs = []
    if bottom_videos:
        worst = bottom_videos[0]
        recs.append(("🔴", f"**부진 영상 살리기** — `{worst['title'][:40]}` ({_fmt_num(worst['views'])}회). 썸네일 A/B 또는 제목 리네이밍."))
    if top_videos:
        winner = top_videos[0]
        recs.append(("🔥", f"**떡상 패턴 복제** — `{winner['title'][:40]}` ({_fmt_num(winner['views'])}회). 같은 후크/포맷으로 후속편."))
    if weekday_avg and len(weekday_avg) >= 3:
        best_day = max(weekday_avg.items(), key=lambda x: x[1])[0]
        recs.append(("📅", f"**발행 요일 최적화** — {best_day}요일 영상이 평균 가장 잘 됨. 다음 업로드 {best_day}요일 추천."))
    if avg_like_rate < 2.0 and avg_views > 100:
        recs.append(("👍", f"**좋아요율 개선** — 현재 {avg_like_rate:.2f}% (업계 2~5%). 영상 끝 콜아웃 강화."))
    if avg_comment_rate < 0.3 and avg_views > 100:
        recs.append(("💬", f"**댓글 유도 강화** — 현재 {avg_comment_rate:.2f}% (업계 0.3~1%). 영상 중간 시청자 의견 질문 삽입."))
    if top_keywords:
        recs.append(("🔑", f"**제목 키워드 활용** — 상위 영상의 `{', '.join(top_keywords[:3])}` 키워드를 다음 제목에 통합."))
    if shorts_count == 0 and len(rows) >= 5:
        recs.append(("📱", f"**Shorts 시도** — 최근 {lookback}일에 Shorts 0개. 신규 유입 채널로 좋음."))
    if pace < 2:
        recs.append(("⏰", f"**업로드 빈도 점검** — 월 {pace:.1f}개 페이스. 알고리즘 친화적 페이스는 주 1회+."))
    if not recs:
        recs.append(("ℹ️", "데이터 부족 — 더 많은 영상 업로드 후 재분석 권장"))
    for i, (icon, rec) in enumerate(recs, 1):
        L.append(f"**{i}. {icon} {rec}**" if i == 1 else f"{i}. {icon} {rec}")
    L.append("")

    # 시청자 반응 키워드 (상위 영상 댓글 기반)
    all_comments = []
    for cs in comments_by_video.values():
        all_comments.extend(c["text"] for c in cs)
    if all_comments:
        L.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        L.append("")
        L.append("## 💬 시청자가 남긴 키워드")
        L.append("")
        all_text = " ".join(all_comments)
        words = re.findall(r'[가-힣]{2,}|[a-zA-Z]{3,}', all_text)
        # URL 조각·도메인은 의미 없으니 제외
        url_noise = {'https', 'http', 'youtu', 'www', 'com'}
        words = [w for w in words if w.lower() not in stop_en and w not in stop_kr and w.lower() not in url_noise and not re.match(r'^[a-zA-Z0-9_]{8,}$', w)]
        word_freq = Counter(words).most_common(8)
        if word_freq:
            kw_line = ' · '.join(f"`{w}`({c})" for w, c in word_freq)
            L.append(kw_line)
            L.append("")
            L.append("> 시청자 머릿속에 남은 단어. 다음 영상 제목·썸네일·후크에 활용.")
        L.append("")

    summary = chr(10).join(L)
    # v2.89.49 — stdout은 보고서 markdown만. 메타·진단 메시지는 stderr로.
    print(summary)
    with open(REPORT, "a", encoding="utf-8") as f:
        f.write(chr(10) + chr(10) + summary + chr(10) + chr(10) + "---" + chr(10))
    print(f"\n✅ 보고서 저장: {REPORT}", file=sys.stderr)
    # Telegram (4096자 제한 — plain text라 마크다운 특수문자 그대로 보내도 통과)
    tg_lines = []
    tg_lines.append(f"📊 {ch_title} — 채널 분석")
    tg_lines.append(f"({time.strftime('%Y-%m-%d %H:%M')} · 최근 {lookback}일 · 영상 {len(rows)}개)")
    tg_lines.append("")
    tg_lines.append(f"구독자 {sub_str} · 누적 {_fmt_num(view_count_total)} · 총 {video_count_total}개")
    if rows:
        tg_lines.append(f"중간값 {_fmt_num(median_views)}회 · 최고 {_fmt_num(rows_sorted[0]['views'])} · 최저 {_fmt_num(rows_sorted[-1]['views'])}")
    tg_lines.append(f"좋아요율 {avg_like_rate:.2f}% · 댓글율 {avg_comment_rate:.2f}%")
    tg_lines.append("")
    if top_videos:
        tg_lines.append(f"🏆 최고: {_fmt_num(top_videos[0]['views'])} {top_videos[0]['title'][:40]}")
    if bottom_videos:
        tg_lines.append(f"🥶 부진: {_fmt_num(bottom_videos[0]['views'])} {bottom_videos[0]['title'][:40]}")
    tg_lines.append("")
    if recs:
        tg_lines.append("🎯 액션:")
        for i, (icon, rec) in enumerate(recs[:3], 1):
            # 마크다운 ** 제거하고 plain text로
            clean = re.sub(r'\*\*|`', '', rec.split(' — ')[0] if ' — ' in rec else rec)
            tg_lines.append(f"{i}. {icon} {clean[:80]}")
    tg_lines.append("")
    tg_lines.append("(전체 분석은 IDE 채팅창 확인)")
    tg_text = chr(10).join(tg_lines)
    _push_telegram(acct, tg_text)

if __name__ == "__main__":
    main()
