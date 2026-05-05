#!/usr/bin/env python3
"""Google Calendar 자동 일정 등록 — secretary_calendar_write_v1.

이 스크립트는 OAuth와 실제 이벤트 생성을 직접 하지 않습니다 — VS Code
호스트(extension.ts)에서 직접 처리해요. 이 도구의 역할은:
  1) 설정 상태를 확인해서 사용자에게 알려주기 (▶ 클릭 시)
  2) ⚙️ 폼에서 CALENDAR_ID / DEFAULT_DURATION_MINUTES 같은 보조 설정 노출

연결 자체는 명령 팔레트에서:
  Cmd+Shift+P → 'Connect AI: Google Calendar 자동 일정 연결 📅'
"""
import os, json, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "google_calendar_write.json")

def main():
    if not os.path.exists(CONFIG):
        print("⚠️ 아직 설정이 없어요.")
        print("   명령 팔레트(Cmd+Shift+P) → 'Connect AI: Google Calendar 자동 일정 연결' 실행")
        sys.exit(1)
    try:
        with open(CONFIG, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        print(f"❌ 설정 파일 파싱 실패: {e}")
        sys.exit(1)
    cid = (cfg.get("CLIENT_ID") or "").strip()
    cs  = (cfg.get("CLIENT_SECRET") or "").strip()
    rt  = (cfg.get("REFRESH_TOKEN") or "").strip()
    cal = (cfg.get("CALENDAR_ID") or "primary").strip()
    dur = int(cfg.get("DEFAULT_DURATION_MINUTES") or 60)
    who = (cfg.get("_CONNECTED_AS") or "").strip()
    when = (cfg.get("_CONNECTED_AT") or "").strip()
    print("─── Google Calendar 자동 일정 등록 상태 ───")
    print(f"  Client ID         : {'설정됨 (' + cid[:8] + '…)' if cid else '(없음)'}")
    print(f"  Client Secret     : {'설정됨' if cs else '(없음)'}")
    print(f"  Refresh Token     : {'유효 ✓' if rt else '(없음)'}")
    print(f"  Calendar ID       : {cal}")
    print(f"  기본 일정 길이     : {dur}분")
    if who:
        print(f"  연결 계정          : {who}")
    if when:
        print(f"  연결 시각          : {when[:19]}")
    if not (cid and cs and rt):
        print()
        print("⚠️ 셋업이 완료되지 않았어요.")
        print("   명령 팔레트(Cmd+Shift+P) → 'Connect AI: Google Calendar 자동 일정 연결'")
        sys.exit(1)
    print()
    print("✅ 연결 정상. 마감일(due) 있는 추적 작업이 등록되면 자동으로 캘린더에 일정이 생성됩니다.")

if __name__ == "__main__":
    main()
