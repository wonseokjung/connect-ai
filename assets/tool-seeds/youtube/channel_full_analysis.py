#!/usr/bin/env python3
"""Channel Full Analysis — comprehensive overview of your YouTube channel.

Input: just YOUTUBE_API_KEY + MY_CHANNEL_ID/HANDLE from youtube_account.json.
No additional config needed. Output: full report with stats, patterns, and
data-driven recommendations.
"""
import os, json, sys, time, datetime, statistics, re
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ACCOUNT = os.path.join(HERE, "youtube_account.json")
REPORT  = os.path.join(HERE, "channel_full_analysis_report.md")

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

def _parse_iso_duration(d):
    """ISO 8601 duration (PT4M30S) → seconds."""
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m: return 0
    h, mi, s = m.groups()
    return int(h or 0) * 3600 + int(mi or 0) * 60 + int(s or 0)

def _fmt_duration(sec):
    if sec < 60: return f"{sec}s"
    if sec < 3600: return f"{sec//60}m {sec%60}s"
    return f"{sec//3600}h {(sec%3600)//60}m"

def _resolve_telegram(account):
    """Same fallback chain as my_videos_check.py."""
    import json as _json
    token = (account.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat  = (account.get("TELEGRAM_CHAT_ID") or "").strip()
    if token and chat:
        return token, chat
    brain_root = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
    sec_json = os.path.join(brain_root, "_agents", "secretary", "tools", "telegram_setup.json")
    if (not token or not chat) and os.path.exists(sec_json):
        try:
            with open(sec_json, "r", encoding="utf-8") as f:
                cfg = _json.load(f)
            if not token: token = (cfg.get("TELEGRAM_BOT_TOKEN") or "").strip()
            if not chat:  chat  = (cfg.get("TELEGRAM_CHAT_ID") or "").strip()
        except Exception:
            pass
    return token, chat

def _push_telegram(account, text):
    token, chat = _resolve_telegram(account)
    if not token or not chat:
        return
    try:
        import requests
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": text, "parse_mode": "Markdown"},
            timeout=10,
        )
        print("📨 텔레그램으로 보고 전송")
    except Exception as e:
        print(f"⚠️  텔레그램 전송 실패: {e}")

def main():
    if not os.path.exists(ACCOUNT):
        print("❌ youtube_account.json이 없어요. 외부 연결 패널에서 YouTube API 키와 채널 ID 입력해주세요.")
        sys.exit(1)
    acct = _load(ACCOUNT)
    api_key = (acct.get("YOUTUBE_API_KEY") or "").strip()
    handle  = (acct.get("MY_CHANNEL_HANDLE") or "").strip()
    chan_id = (acct.get("MY_CHANNEL_ID") or "").strip()
    if not api_key:
        print("❌ YOUTUBE_API_KEY가 비어있어요. 외부 연결 패널 → YouTube Data API 카드에 입력해주세요.")
        sys.exit(1)
    if not (handle or chan_id):
        print("❌ MY_CHANNEL_HANDLE 또는 MY_CHANNEL_ID 필요. 외부 연결 패널 → 채널 ID 입력해주세요.")
        sys.exit(1)

    try:
        from googleapiclient.discovery import build
    except ImportError:
        print("❌ google-api-python-client 미설치.")
        print("   터미널에서 한 줄: pip3 install google-api-python-client requests")
        sys.exit(1)
    youtube = build("youtube", "v3", developerKey=api_key)

    cid = _resolve_channel_id(youtube, handle, chan_id)
    if not cid:
        print("❌ 채널 ID를 찾지 못했어요. 외부 연결 패널의 채널 ID 확인.")
        sys.exit(1)

    print(f"📈 [채널 완전 분석] 채널 {handle or cid} 분석 중...")
    print()

    # 1. 채널 메타
    ch = youtube.channels().list(part="snippet,statistics,brandingSettings", id=cid).execute()
    if not ch.get("items"):
        print("❌ 채널 데이터를 가져오지 못했어요. API 키·할당량 확인.")
        sys.exit(1)
    c = ch["items"][0]
    sn = c.get("snippet", {})
    st = c.get("statistics", {})
    title = sn.get("title", "(이름 없음)")
    subs = int(st.get("subscriberCount", 0))
    total_views = int(st.get("viewCount", 0))
    video_count = int(st.get("videoCount", 0))
    pub_at = sn.get("publishedAt", "")[:10]

    print("─── 1. 채널 개요 ───")
    print(f"  채널: {title}")
    print(f"  핸들: {sn.get('customUrl', handle or '(없음)')}")
    print(f"  구독자: {subs:,}명")
    print(f"  총 조회수: {total_views:,}회")
    print(f"  업로드 영상: {video_count}개")
    print(f"  채널 가입: {pub_at}")
    avg_per_video = total_views // max(1, video_count)
    print(f"  영상당 평균 조회: {avg_per_video:,}회")
    print()

    # 2. 최근 30일 영상 분석 (uploads playlist 사용 — search보다 quota 절약)
    uploads = c.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads") if "contentDetails" in c else None
    if not uploads:
        # contentDetails 없으면 search로 폴백
        cd = youtube.channels().list(part="contentDetails", id=cid).execute()
        if cd.get("items"):
            uploads = cd["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]

    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)
    recent_video_ids = []
    if uploads:
        next_token = None
        while len(recent_video_ids) < 50:
            args = {"part": "snippet,contentDetails", "playlistId": uploads, "maxResults": 50}
            if next_token: args["pageToken"] = next_token
            pi = youtube.playlistItems().list(**args).execute()
            for item in pi.get("items", []):
                pub = item["snippet"]["publishedAt"]
                pub_dt = datetime.datetime.fromisoformat(pub.replace("Z", "+00:00"))
                if pub_dt < cutoff:
                    break
                recent_video_ids.append(item["contentDetails"]["videoId"])
            next_token = pi.get("nextPageToken")
            if not next_token: break
            if recent_video_ids and datetime.datetime.fromisoformat(pi["items"][-1]["snippet"]["publishedAt"].replace("Z", "+00:00")) < cutoff:
                break

    if not recent_video_ids:
        print("⚠️  최근 30일 동안 업로드한 영상이 없어요. 영상 업로드 후 다시 분석해주세요.")
        sys.exit(0)

    # 3. 영상별 통계 (50개씩 나눠서)
    all_vids = []
    for i in range(0, len(recent_video_ids), 50):
        chunk = recent_video_ids[i:i+50]
        st_resp = youtube.videos().list(part="snippet,statistics,contentDetails", id=",".join(chunk)).execute()
        for v in st_resp.get("items", []):
            stats = v.get("statistics", {})
            sn_v = v.get("snippet", {})
            cd_v = v.get("contentDetails", {})
            views = int(stats.get("viewCount", 0))
            likes = int(stats.get("likeCount", 0))
            comments = int(stats.get("commentCount", 0))
            duration_sec = _parse_iso_duration(cd_v.get("duration", ""))
            pub = sn_v.get("publishedAt", "")
            pub_dt = datetime.datetime.fromisoformat(pub.replace("Z", "+00:00"))
            all_vids.append({
                "id": v["id"],
                "title": sn_v.get("title", ""),
                "views": views,
                "likes": likes,
                "comments": comments,
                "duration_sec": duration_sec,
                "pub_dt": pub_dt,
                "engagement_rate": (likes + comments) / views if views > 0 else 0,
            })

    all_vids.sort(key=lambda x: x["views"], reverse=True)
    views_list = [v["views"] for v in all_vids]
    median_views = statistics.median(views_list) if views_list else 0
    mean_views = statistics.mean(views_list) if views_list else 0

    print("─── 2. 최근 30일 업로드 패턴 ───")
    print(f"  업로드 횟수: {len(all_vids)}개 (월평균 {len(all_vids):.1f}개)")
    weekday_counts = Counter(v["pub_dt"].strftime("%A") for v in all_vids)
    weekday_kr = {"Monday":"월","Tuesday":"화","Wednesday":"수","Thursday":"목","Friday":"금","Saturday":"토","Sunday":"일"}
    top_day = weekday_counts.most_common(1)
    if top_day:
        print(f"  주로 업로드한 요일: {weekday_kr.get(top_day[0][0], top_day[0][0])}요일 ({top_day[0][1]}회)")
    avg_duration = sum(v["duration_sec"] for v in all_vids) / len(all_vids)
    print(f"  평균 영상 길이: {_fmt_duration(int(avg_duration))}")
    print()

    print("─── 3. 성과 통계 ───")
    print(f"  중간값 조회수: {int(median_views):,}회")
    print(f"  평균 조회수: {int(mean_views):,}회")
    avg_eng = sum(v["engagement_rate"] for v in all_vids) / len(all_vids) * 100 if all_vids else 0
    print(f"  평균 참여율 (좋아요+댓글)/조회: {avg_eng:.2f}%")
    print()

    # 떡상 / 부진 분류
    hot = [v for v in all_vids if v["views"] >= median_views * 1.5]
    cold = [v for v in all_vids if v["views"] < median_views * 0.5]

    print("─── 4. 🔥 떡상 영상 (중간값 × 1.5 이상) ───")
    if not hot:
        print("  (없음 — 모든 영상이 평균 근처)")
    else:
        for v in hot[:5]:
            print(f"  🔥 {v['views']:>8,}회 · 참여 {v['engagement_rate']*100:.2f}% · {_fmt_duration(v['duration_sec'])} · {v['title'][:50]}")
    print()

    print("─── 5. 🥶 부진 영상 (중간값 × 0.5 미만) ───")
    if not cold:
        print("  (없음 — 모든 영상이 평균 근처)")
    else:
        for v in cold[:5]:
            print(f"  🥶 {v['views']:>8,}회 · 참여 {v['engagement_rate']*100:.2f}% · {_fmt_duration(v['duration_sec'])} · {v['title'][:50]}")
    print()

    # 6. 패턴 비교 — 떡상 vs 부진의 차이
    print("─── 6. 떡상 vs 부진 — 패턴 비교 ───")
    if hot and cold:
        hot_avg_dur = sum(v["duration_sec"] for v in hot) / len(hot)
        cold_avg_dur = sum(v["duration_sec"] for v in cold) / len(cold)
        hot_avg_title = sum(len(v["title"]) for v in hot) / len(hot)
        cold_avg_title = sum(len(v["title"]) for v in cold) / len(cold)
        print(f"  떡상 영상 평균 길이: {_fmt_duration(int(hot_avg_dur))}")
        print(f"  부진 영상 평균 길이: {_fmt_duration(int(cold_avg_dur))}")
        if abs(hot_avg_dur - cold_avg_dur) > 60:
            longer = "떡상" if hot_avg_dur > cold_avg_dur else "부진"
            print(f"  → {longer} 영상이 평균 {abs(int(hot_avg_dur - cold_avg_dur))}초 더 길어요")
        print(f"  떡상 영상 평균 제목 길이: {hot_avg_title:.0f}자")
        print(f"  부진 영상 평균 제목 길이: {cold_avg_title:.0f}자")
    else:
        print("  (떡상 또는 부진 데이터 부족 — 영상이 더 쌓이면 다시 분석)")
    print()

    # 7. 자동 추천 (LLM 없이 데이터만으로)
    print("─── 7. 🧭 다음 액션 추천 (데이터 기반) ───")
    actions = []
    if hot:
        actions.append(f"🔥 떡상한 {len(hot)}개 영상의 제목·후크 패턴을 다음 영상에 적용 — 가장 잘 된 후크는 \"{hot[0]['title'][:50]}\"")
    if cold:
        actions.append(f"🥶 부진한 {len(cold)}개는 썸네일 A/B 테스트 또는 제목 리네이밍 후보")
    if avg_eng < 2.0:
        actions.append(f"💗 평균 참여율 {avg_eng:.2f}% — 영상 끝에 명확한 CTA(좋아요·구독) 추가 추천 (보통 3% 이상이 건강함)")
    elif avg_eng > 5.0:
        actions.append(f"💗 참여율 {avg_eng:.2f}% — 매우 좋음. 시청자와 강한 연결 구축됨, 상품·멤버십 도입 고려 시점")
    if len(all_vids) < 4:
        actions.append("📅 월 4개 미만 업로드 — 알고리즘 노출 위해 최소 주 1회 권장")
    elif len(all_vids) > 12:
        actions.append("📅 월 12개 이상 업로드 — 양은 충분, 영상별 품질·후크에 집중 추천")
    if not actions:
        actions.append("✅ 채널 상태 안정적 — 현재 패턴 유지하며 시청자 댓글에서 다음 콘텐츠 아이디어 수집")
    for a in actions:
        print(f"  • {a}")
    print()

    # 8. 보고서 .md 저장
    summary_lines = [
        f"# 📈 채널 완전 분석 — {time.strftime('%Y-%m-%d %H:%M')}",
        f"채널: **{title}** · 구독자 **{subs:,}** · 영상 **{video_count}**개",
        "",
        "## 최근 30일 통계",
        f"- 업로드: {len(all_vids)}개",
        f"- 조회수 중간값: **{int(median_views):,}**",
        f"- 평균 참여율: **{avg_eng:.2f}%**",
        f"- 평균 영상 길이: **{_fmt_duration(int(avg_duration))}**",
        "",
        f"## 🔥 떡상 영상 ({len(hot)}개)",
    ]
    for v in hot[:5]:
        summary_lines.append(f"- {v['views']:,}회 · {v['title']}")
    summary_lines.append(f"\n## 🥶 부진 영상 ({len(cold)}개)")
    for v in cold[:5]:
        summary_lines.append(f"- {v['views']:,}회 · {v['title']}")
    summary_lines.append("\n## 🧭 다음 액션 (자동 추천)")
    for a in actions:
        summary_lines.append(f"- {a}")

    summary = "\n".join(summary_lines)
    with open(REPORT, "a", encoding="utf-8") as f:
        f.write("\n\n" + summary + "\n\n---\n")
    print(f"✅ 보고서: {REPORT}")
    _push_telegram(acct, summary)

if __name__ == "__main__":
    main()
