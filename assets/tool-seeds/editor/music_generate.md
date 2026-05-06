# 🎵 BGM 생성 — ACE-Step

영상에 어울리는 BGM을 텍스트 프롬프트로 생성. ACE-Step 1.5 로컬 모델 사용.

## 사용 전 체크
- `music_studio_setup.py` 가 먼저 실행돼야 함 (한 번만)
- 첫 BGM 생성 시 모델 weight 다운로드 (~10GB, 인터넷 필요)
- 이후엔 100% 오프라인

## 설정 (⚙️ 클릭해서 변경)
- `PROMPT` — 음악 묘사 (영어가 모델에 더 잘 듣음). 기본: 차분한 한국 유튜브 인트로
- `DURATION_SEC` — 길이 초 (기본 30)
- `GENRE` — 장르 힌트 (lo-fi, ambient, cinematic, edm 등)
- `OUTPUT_DIR` — 저장 위치 (기본 ~/connect-ai-music/output/)

## 출력
- MP3 파일 (~/connect-ai-music/output/bgm_<timestamp>.mp3)
- 다음 단계 도구(`music_to_video.py`)가 자동으로 이 파일 사용

## 좋은 프롬프트 팁
- ✓ "calm intro music, soft piano, 90 BPM, hopeful mood"
- ✓ "energetic synth lead, cyberpunk, fast tempo, electronic drums"
- ✗ "음악" (너무 추상)

## 첫 실행 시간
- 모델 다운로드: 5~30분 (인터넷 속도)
- 30초 BGM 생성: 30~120초 (Mac M1/M2/M3/M5 기준)
- 두 번째부터는 다운로드 없이 바로

## 비용
완전 무료, 오프라인. API 키 X.
