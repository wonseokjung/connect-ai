# 🎵 음악 스튜디오 설치 (ACE-Step 1.5)

영상 BGM을 직접 생성하는 로컬 음악 모델 설치. 클릭 한 번으로 끝.

## 무엇이 깔리나?
- **ACE-Step 1.5 base** (3.5B 파라미터, 음악 생성 모델)
- 위치: `~/connect-ai-music/ace-step/`
- Python venv + 의존성 (torch, transformers 등)
- 모델 weight (~10GB, 첫 음악 생성 때 자동 다운로드)

## 시스템 요구사항
- macOS (Apple Silicon 권장) / Linux / Windows
- 디스크 여유 ~15GB
- RAM 16GB 이상 권장 (Mac Apple Silicon은 unified memory 효율적)
- Python 3.10+, git 이미 깔려있어야 함

## 사용 흐름
1. ▶ 클릭으로 이 도구 실행
2. 진행상황 채팅창에 표시 (5~15분)
3. 완료 후 다른 도구(`music_generate.py`, `music_to_video.py`)가 자동으로 이 모델 사용

## 비용
- 100% 로컬 / 오프라인 / 무료
- API 키·인증·구독 0개

## 클라우드 모드 (선택)
설치 안 하고 [acemusic.ai](https://acemusic.ai) 무료 웹서비스 쓰기 → 다음 버전에서 `MODE: 'cloud'` 옵션 예정

## 트러블슈팅
**git/python3 없다고 함** → 먼저 설치:
- macOS: `brew install python git`
- Windows: python.org / git-scm.com에서 다운

**venv 생성 실패** → Python 버전 확인 (3.10 이상)

**용량 부족** → `~/connect-ai-music/` 위치를 외장 디스크로 옮길 수 있음. 설치 디렉토리는 `music_studio_setup.json` 의 `INSTALL_DIR` 수정.
