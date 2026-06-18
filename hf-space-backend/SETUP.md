# 🚀 Connect AI 백엔드 (HF Space) 셋업

## 1) Space 만들기
- huggingface.co → **New Space**
- Owner: `WonseokJayJung` · name: `connectai`
- SDK: **Docker** → 템플릿 **Blank**
- Hardware: **Free** · Visibility: **Public** · Storage bucket: 연결 안 함
- **Create Space**

## 2) 코드 올리기 (둘 중 하나)
**A. 터미널에서 푸시 (추천 — 한 번에)**
```bash
huggingface-cli login            # 본인 HF write 토큰 붙여넣기 (1회)
cd hf-space-backend
git init && git remote add space https://huggingface.co/spaces/WonseokJayJung/connectai
git add app.py train_uv.py merge_uv.py requirements.txt Dockerfile README.md
git commit -m "Connect AI 백엔드 (학습·합성 문지기)"
git push space main --force
```
**B. 웹 업로드** — Space의 Files → Add file → 위 6개 파일 드래그

## 3) 시크릿 넣기 (Settings → Variables and secrets)
- `HF_TOKEN` = 제공자 HF **write/Pro** 토큰  ← **필수**
- (선택) `ACCESS_CODE`=`0101`, `TRAIN_MONTHLY`=`1`, `MERGE_MONTHLY`=`3`

## 4) 빌드 끝나면 확인
- Space 주소: `https://WonseokJayJung-connectai.hf.space`
- 브라우저로 그 주소 열면 `{"ok": true, ...}` 가 떠야 정상

## 5) 데스크톱 연결
- 앱 백엔드 URL을 위 Space 주소로 교체 → v0.4.4 빌드 (내가 처리)
