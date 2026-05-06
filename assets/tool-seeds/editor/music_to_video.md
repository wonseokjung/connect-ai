# 🎬 영상 + BGM 합성

생성한 BGM을 영상에 자동으로 합쳐서 새 mp4 만들기. ffmpeg 사용.

## 사용 흐름
1. `music_generate.py`로 BGM 먼저 생성 (LAST_OUTPUT 자동 기록됨)
2. ⚙️에서 VIDEO_PATH 입력 (영상 파일 절대 경로)
3. ▶ 실행
4. 같은 폴더에 `<영상이름>_with_bgm.mp4` 생성

## 시스템 요구
- ffmpeg 설치 필수
  - macOS: `brew install ffmpeg`
  - Windows: https://ffmpeg.org

## 설정 (⚙️ 클릭)
- `VIDEO_PATH` — 합성할 영상 파일 (mp4, mov 등). 절대 경로
- `MUSIC_PATH` — 사용할 BGM 파일. 비워두면 마지막 생성한 BGM 자동 사용
- `BGM_VOLUME` — BGM 볼륨 0.0~1.0 (디폴트 0.3 = 30%)
- `OUTPUT_PATH` — 결과 영상 경로 (비워두면 원본 옆에 `_with_bgm.mp4`)

## 동작 원리
- 원본 영상의 오디오는 100% 볼륨 유지
- BGM은 30%(또는 설정값)로 깔림
- BGM이 영상보다 짧으면 자동 loop
- 영상보다 길면 자동 cut (영상 길이에 맞춤)
- 영상 코덱 그대로 (재인코딩 X = 빠름)

## 출력
mp4 (H.264 영상 + AAC 오디오 믹싱)
