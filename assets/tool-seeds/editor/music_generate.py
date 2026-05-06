#!/usr/bin/env python3
"""ACE-Step 1.5 BGM 생성기.

프롬프트 → MP3. music_studio_setup.py 가 먼저 설치돼있어야 함.
설정에서 PROMPT, DURATION, GENRE 변경 가능. config 파일에 저장된 LAST_PROMPT 자동 반복 가능.

출력: ~/connect-ai-music/output/<timestamp>.mp3
"""
import os, sys, json, subprocess, time

HERE = os.path.dirname(os.path.abspath(__file__))
SETUP_CONFIG = os.path.join(HERE, "music_studio_setup.json")
GEN_CONFIG = os.path.join(HERE, "music_generate.json")


def _log(msg, kind="info"):
    prefix = {"info": "🎵", "ok": "✅", "warn": "⚠️ ", "err": "❌"}.get(kind, "•")
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
    setup = _load(SETUP_CONFIG)
    if not setup.get("INSTALLED_AT"):
        print("❌ ACE-Step 음악 스튜디오 미설치.")
        print("  먼저 같은 폴더의 'music_studio_setup.py' 실행해주세요 (▶ 클릭).")
        sys.exit(1)

    install_dir = setup.get("INSTALL_DIR")
    venv_python = setup.get("VENV_PYTHON")
    if not (install_dir and os.path.isdir(install_dir) and venv_python and os.path.exists(venv_python)):
        print("❌ 설치 정보가 깨졌어요. music_studio_setup.py 다시 실행해주세요.")
        sys.exit(1)

    cfg = _load(GEN_CONFIG)
    prompt = (cfg.get("PROMPT") or "calm korean YouTube intro music, gentle piano, hopeful").strip()
    duration = int(cfg.get("DURATION_SEC") or 30)
    genre = (cfg.get("GENRE") or "").strip()
    if genre:
        prompt = f"{prompt}, genre: {genre}"

    output_dir = cfg.get("OUTPUT_DIR") or os.path.expanduser("~/connect-ai-music/output")
    os.makedirs(output_dir, exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    output_path = os.path.join(output_dir, f"bgm_{timestamp}.mp3")

    _log(f"프롬프트: {prompt}")
    _log(f"길이: {duration}초")
    _log(f"출력: {output_path}")

    # ACE-Step infer 호출 — 실제 명령은 ACE-Step repo의 infer 스크립트에 따라 조정 필요
    # 첫 실행은 weight 다운로드 (~10GB) 발생 → 5~30분
    infer_script = os.path.join(install_dir, "infer.py")
    if not os.path.exists(infer_script):
        # ACE-Step repo의 실제 entry point 자동 탐색
        candidates = ["infer.py", "src/infer.py", "scripts/infer.py", "ace_step/infer.py"]
        infer_script = None
        for c in candidates:
            full = os.path.join(install_dir, c)
            if os.path.exists(full):
                infer_script = full
                break
    if not infer_script:
        print("❌ ACE-Step infer.py를 못 찾음. 설치 디렉토리 점검 필요.")
        print(f"  위치: {install_dir}")
        print(f"  README 참고: https://github.com/ace-step/ACE-Step-1.5")
        sys.exit(1)

    cmd = [
        venv_python, infer_script,
        "--prompt", prompt,
        "--duration", str(duration),
        "--output", output_path,
    ]
    _log("음악 생성 중... (첫 실행은 모델 다운로드로 시간 걸림)")
    _log(f"$ {' '.join(cmd)}")

    proc = subprocess.run(cmd, cwd=install_dir, capture_output=True, text=True)
    if proc.stdout.strip():
        for line in proc.stdout.splitlines():
            _log(f"  {line}")
    if proc.stderr.strip():
        for line in proc.stderr.splitlines():
            _log(f"  {line}")

    if proc.returncode != 0:
        print(f"❌ 생성 실패 (exit {proc.returncode})")
        print("  ACE-Step 설치 상태 점검 필요. music_studio_setup.py 다시 실행해보세요.")
        sys.exit(1)

    if not os.path.exists(output_path):
        print(f"❌ 출력 파일 없음 — ACE-Step 명령 형식이 다를 수 있어요.")
        print(f"  README: https://github.com/ace-step/ACE-Step-1.5")
        sys.exit(1)

    file_size = os.path.getsize(output_path)
    print(f"✅ BGM 생성 완료")
    print(f"  📁 {output_path}")
    print(f"  📊 {file_size // 1024} KB · {duration}초")
    print(f"  🎵 프롬프트: {prompt}")
    print(f"  💡 영상에 합치려면: 같은 폴더의 'music_to_video.py' 실행")

    # 마지막 출력 파일 기록 → music_to_video.py가 자동으로 사용
    cfg["LAST_OUTPUT"] = output_path
    cfg["LAST_PROMPT"] = prompt
    with open(GEN_CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
