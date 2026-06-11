#!/bin/zsh
# ☁️ 원클릭 학습 백엔드 배포 — Blaze 업그레이드 후 이 스크립트 한 번
# 1) HF_TOKEN 시크릿(앱 설정에서 자동 추출) 2) 함수 배포 3) URL 출력
set -e
cd "$(dirname "$0")"
node -e "const c=require(process.env.HOME+'/Library/Application Support/connect-ai-desktop/connect-ai-config.json');process.stdout.write((c.apiConn.huggingface.HF_TOKEN||'').trim())" \
  | firebase functions:secrets:set HF_TOKEN --data-file -
firebase deploy --only functions
echo "\n✅ 위 출력의 train 함수 URL을 desktop/src/main.ts 의 DEFAULT_TRAIN_BACKEND 에 넣으세요 (도메인까지만, /train 제외)"
