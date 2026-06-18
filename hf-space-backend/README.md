---
title: Connect AI Backend
emoji: 🧬
colorFrom: green
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# 🧬 Connect AI — 무료 학습·합성 백엔드 (문지기)

제공자(사장님) HF Pro 토큰을 **Space 시크릿**으로 보관하고, 회원 검증 후 **HF Job**을 대신 실행합니다.
토큰은 앱에 안 들어가고, GPU 계산은 100% HF Jobs가 합니다. **GCP 불필요.**

## 엔드포인트 (데스크톱 앱이 호출)
- `POST /train` · `POST /merge` · `GET /trainStatus?userId=` · `GET /mergeStatus?userId=`

## 필요한 시크릿 (Settings → Variables and secrets)
- `HF_TOKEN` (필수) — 제공자 HF **write/Pro** 토큰
- `ACCESS_CODE` (선택, 기본 `0101`) — 멤버십 코드
- `TRAIN_MONTHLY`(기본 1) · `MERGE_MONTHLY`(기본 3) — 회원당 월 캡

회원당 월 캡은 `{provider}/connect-ai-gates` 데이터셋에 기록됩니다. 비용 최종 방어는 **HF Jobs 지출 캡**.
