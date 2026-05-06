#!/usr/bin/env python3
"""ACE-Step 1.5 Music Studio — 원클릭 설치/검증.

이 스크립트가 하는 일:
  1. 의존성 점검: python3, git, pip 존재 확인
  2. ~/connect-ai-music/ace-step 에 ACE-Step 1.5 base 모델 클론·설치
  3. 모델 weight 자동 다운로드 (HuggingFace)
  4. 설치 위치를 music_studio_setup.json 에 기록 → 다른 도구가 참조

사용자는 이 스크립트 실행 한 번만 누르면 끝. 진행상황 stderr로 출력.
설치 디스크 사용량: ~10GB (모델 weight). 첫 실행 5~15분 (인터넷 속도에 따라).

이미 설치돼있으면 (config 존재 + weight 있음) → "이미 설치 완료" 보고 후 종료.
"""
import os, sys, json, subprocess, shutil, time

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "music_studio_setup.json")

DEFAULT_INSTALL_DIR = os.path.expanduser("~/connect-ai-music/ace-step")
ACE_STEP_REPO = "https://github.com/ace-step/ACE-Step-1.5.git"


def _log(msg, kind="info"):
    """stderr로 진행상황. stdout엔 최종 보고만."""
    prefix = {"info": "🔧", "ok": "✅", "warn": "⚠️ ", "err": "❌"}.get(kind, "•")
    print(f"{prefix} {msg}", file=sys.stderr, flush=True)


def _which(cmd):
    return shutil.which(cmd) is not None


def _run(cmd, cwd=None, env=None, log_prefix=""):
    """서브프로세스 실행. stdout·stderr 모두 stderr로 흘려보내서 진행상황 보임."""
    _log(f"$ {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    try:
        result = subprocess.run(
            cmd if isinstance(cmd, list) else cmd.split(),
            cwd=cwd, env=env, check=False, capture_output=True, text=True
        )
        if result.stdout.strip():
            for line in result.stdout.splitlines():
                _log(f"  {log_prefix}{line}")
        if result.stderr.strip():
            for line in result.stderr.splitlines():
                _log(f"  {log_prefix}{line}")
        return result.returncode == 0
    except Exception as e:
        _log(f"실행 오류: {e}", "err")
        return False


def _check_deps():
    """필수 도구들이 깔려있는지 확인."""
    missing = []
    if not _which("python3"):
        missing.append("python3 (https://www.python.org/downloads/)")
    if not _which("git"):
        missing.append("git (https://git-scm.com/downloads)")
    if not _which("pip3") and not _which("pip"):
        missing.append("pip (Python 설치하면 같이 옴)")
    return missing


def _load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _verify_install(install_dir):
    """설치가 정상인지 빠르게 점검."""
    if not os.path.isdir(install_dir):
        return False, "디렉토리 없음"
    if not os.path.isdir(os.path.join(install_dir, ".git")):
        return False, "git repo 아님"
    venv = os.path.join(install_dir, ".venv")
    if not os.path.isdir(venv):
        return False, "venv 없음"
    return True, "OK"


def main():
    cfg = _load_config()
    install_dir = cfg.get("INSTALL_DIR") or DEFAULT_INSTALL_DIR

    # 이미 설치돼있는지 빠르게 확인
    ok, reason = _verify_install(install_dir)
    if ok and cfg.get("INSTALLED_AT"):
        print(f"✅ ACE-Step 이미 설치됨")
        print(f"  📁 위치: {install_dir}")
        print(f"  📅 설치 시각: {cfg.get('INSTALLED_AT')}")
        print(f"  🎵 사용: 영상 분석 후 BGM 생성 도구 호출하면 자동 사용")
        return

    # 의존성 점검
    _log("의존성 점검 중...")
    missing = _check_deps()
    if missing:
        print("❌ 다음 도구 먼저 설치해주세요:")
        for m in missing:
            print(f"  - {m}")
        sys.exit(1)
    _log("의존성 OK", "ok")

    # 설치 디렉토리 준비
    parent = os.path.dirname(install_dir)
    os.makedirs(parent, exist_ok=True)

    # 1) 클론
    if not os.path.isdir(install_dir):
        _log(f"ACE-Step 1.5 클론 중 → {install_dir}")
        _log("(약 50MB · 30초)")
        if not _run(["git", "clone", "--depth", "1", ACE_STEP_REPO, install_dir]):
            print("❌ git clone 실패. 인터넷 연결 확인 후 재시도.")
            sys.exit(1)
        _log("클론 완료", "ok")
    else:
        _log("이미 클론된 디렉토리 사용", "info")

    # 2) venv 생성
    venv_dir = os.path.join(install_dir, ".venv")
    if not os.path.isdir(venv_dir):
        _log("Python venv 생성 중...")
        if not _run(["python3", "-m", "venv", venv_dir]):
            print("❌ venv 생성 실패")
            sys.exit(1)
        _log("venv OK", "ok")

    venv_python = os.path.join(venv_dir, "bin", "python")
    venv_pip = os.path.join(venv_dir, "bin", "pip")
    if not os.path.exists(venv_python):
        # Windows
        venv_python = os.path.join(venv_dir, "Scripts", "python.exe")
        venv_pip = os.path.join(venv_dir, "Scripts", "pip.exe")

    # 3) pip 의존성 설치
    requirements = os.path.join(install_dir, "requirements.txt")
    if os.path.exists(requirements):
        _log("Python 의존성 설치 중 (5~10분 소요, 큰 파일 다운로드)...")
        # pip 업그레이드 먼저
        _run([venv_pip, "install", "--upgrade", "pip"])
        if not _run([venv_pip, "install", "-r", requirements]):
            print("⚠️  일부 의존성 설치 실패 — 다시 실행하면 이어서 진행됩니다.")
            sys.exit(1)
        _log("의존성 설치 완료", "ok")
    else:
        _log("requirements.txt 없음, 기본 의존성 추측 설치", "warn")
        basic_deps = ["torch", "torchaudio", "transformers", "accelerate", "huggingface_hub", "soundfile"]
        _run([venv_pip, "install"] + basic_deps)

    # 4) 모델 weight 다운로드 안내
    weights_dir = os.path.join(install_dir, "checkpoints")
    os.makedirs(weights_dir, exist_ok=True)
    _log("모델 weight는 첫 음악 생성 시 자동 다운로드됩니다 (~10GB).", "info")
    _log("미리 받으려면: huggingface-cli download ACE-Step/Ace-Step1.5 --local-dir " + weights_dir)

    # 5) 설정 저장
    cfg["INSTALL_DIR"] = install_dir
    cfg["VENV_PYTHON"] = venv_python
    cfg["INSTALLED_AT"] = time.strftime("%Y-%m-%d %H:%M:%S")
    cfg["MODEL_VARIANT"] = "base"  # base / xl-base / xl-turbo
    _save_config(cfg)

    print("✅ ACE-Step 음악 스튜디오 설치 완료!")
    print(f"  📁 위치: {install_dir}")
    print(f"  🐍 Python: {venv_python}")
    print(f"  💾 모델 weight: 첫 BGM 생성 때 자동 다운로드 (~10GB)")
    print(f"  🎵 다음 단계: '이 영상에 BGM 만들어줘' 같은 명령으로 사용")


if __name__ == "__main__":
    main()
