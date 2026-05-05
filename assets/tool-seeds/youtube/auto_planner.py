#!/usr/bin/env python3
"""Auto Planner — runs trend_sniper.py on a fixed interval for a chosen
duration (e.g. overnight). Reads its config from auto_planner.json."""
import os, json, time, datetime, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "auto_planner.json")
SNIPER_PATH = os.path.join(HERE, "trend_sniper.py")

def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ 설정 파일을 읽을 수 없어요: {CONFIG_PATH}\n{e}")
        sys.exit(1)

def main():
    cfg = load_config()
    interval_h = float(cfg.get("INTERVAL_HOURS", 2))
    total_h = float(cfg.get("TOTAL_RUN_HOURS", 8))
    print(f"\n🚀 [오토 플래너] {total_h}시간 동안 {interval_h}시간마다 트렌드 분석 실행")
    if not os.path.exists(SNIPER_PATH):
        print(f"❌ trend_sniper.py를 찾을 수 없어요: {SNIPER_PATH}")
        sys.exit(1)
    start = time.time()
    loop = 0
    while True:
        if time.time() - start > total_h * 3600:
            print("\n☀️ 목표 가동 시간을 채웠어요. 종료합니다.")
            break
        loop += 1
        ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"\n[{ts}] 🤖 {loop}회차 트렌드 스나이핑")
        try:
            subprocess.run([sys.executable, SNIPER_PATH], check=False)
        except Exception as e:
            print(f"❌ 실행 실패: {e}")
        print(f"⏳ 다음 실행: {interval_h}시간 후")
        time.sleep(interval_h * 3600)

if __name__ == "__main__":
    main()
