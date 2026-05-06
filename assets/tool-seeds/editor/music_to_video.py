#!/usr/bin/env python3
"""생성된 BGM을 영상에 합치기 (ffmpeg 래퍼).

설정에서 VIDEO_PATH 지정 (또는 LAST_GENERATED 자동 사용).
영상 길이에 BGM 자동 맞춤 (loop 또는 fade out).
"""
import os, sys, json, subprocess, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
GEN_CONFIG = os.path.join(HERE, "music_generate.json")
MERGE_CONFIG = os.path.join(HERE, "music_to_video.json")


def _log(msg, kind="info"):
    prefix = {"info": "🎬", "ok": "✅", "warn": "⚠️ ", "err": "❌"}.get(kind, "•")
    print(f"{prefix} {msg}", file=sys.stderr, flush=True)


def _load(p):
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def main():
    if not shutil.which("ffmpeg"):
        print("❌ ffmpeg가 설치돼있지 않아요.")
        print("  macOS: brew install ffmpeg")
        print("  Windows: https://ffmpeg.org/download.html")
        sys.exit(1)

    cfg = _load(MERGE_CONFIG)
    gen = _load(GEN_CONFIG)

    video_path = (cfg.get("VIDEO_PATH") or "").strip()
    if not video_path:
        print("❌ VIDEO_PATH 미설정. ⚙️ 클릭해서 영상 파일 경로 입력해주세요.")
        sys.exit(1)
    video_path = os.path.expanduser(video_path)
    if not os.path.exists(video_path):
        print(f"❌ 영상 파일 없음: {video_path}")
        sys.exit(1)

    # BGM 파일: 명시적 또는 마지막 생성된 거 자동
    music_path = (cfg.get("MUSIC_PATH") or "").strip()
    if not music_path:
        music_path = gen.get("LAST_OUTPUT") or ""
    if not music_path or not os.path.exists(music_path):
        print("❌ BGM 파일 없음. 먼저 'music_generate.py' 실행해서 BGM 생성하거나,")
        print("  ⚙️에서 MUSIC_PATH 직접 지정.")
        sys.exit(1)

    bgm_volume = float(cfg.get("BGM_VOLUME", 0.3))  # 0.0~1.0, 디폴트 30%
    output_path = cfg.get("OUTPUT_PATH") or video_path.rsplit(".", 1)[0] + "_with_bgm.mp4"

    _log(f"영상: {video_path}")
    _log(f"BGM: {music_path}")
    _log(f"BGM 볼륨: {int(bgm_volume * 100)}%")
    _log(f"출력: {output_path}")

    # ffmpeg: 영상 + BGM 믹싱. 영상 길이에 BGM 맞춤 (BGM이 짧으면 loop, 길면 자름)
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-stream_loop", "-1",  # BGM 무한 loop (영상 길이까지)
        "-i", music_path,
        "-filter_complex",
        f"[0:a]volume=1.0[orig];[1:a]volume={bgm_volume}[bgm];[orig][bgm]amix=inputs=2:duration=first[a]",
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "copy",  # 영상 코덱 그대로 (재인코딩 없음 = 빠름)
        "-c:a", "aac",
        "-shortest",
        output_path,
    ]
    _log("ffmpeg 실행 중...")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"❌ ffmpeg 실패 (exit {proc.returncode})")
        print(proc.stderr[-1000:])
        sys.exit(1)

    if not os.path.exists(output_path):
        print(f"❌ 출력 파일 없음")
        sys.exit(1)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"✅ 영상 + BGM 합성 완료")
    print(f"  📁 {output_path}")
    print(f"  📊 {size_mb:.1f} MB")
    print(f"  🎵 BGM 볼륨 {int(bgm_volume * 100)}%로 믹싱됨")


if __name__ == "__main__":
    main()
