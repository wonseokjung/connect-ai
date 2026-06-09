# Connect AI — 클라우드 학습 백엔드 (Firebase)

유저 앱이 직접 HF 토큰을 갖지 않게, **네(제공자) HF Pro 토큰을 이 함수의 secret으로** 보관하고
유저는 이 함수만 호출한다. 무료 **월 1회** 게이트는 Realtime Database에 기록.

```
유저 앱  ──POST /train {userId, jsonl}──►  이 함수(토큰 보관)  ──►  HF Jobs(네 Pro로 실행)
유저 앱  ◄──────── jobId ───────────────                         결과 모델 = public repo
유저 앱  ──GET /trainStatus?userId──►  진행상황  →  완료되면 public 모델 GGUF 다운로드
```

## 배포 (한 번만)

```bash
# 0) Firebase CLI
npm i -g firebase-tools && firebase login

# 1) 이 폴더에서 프로젝트 연결 (네 Firebase 프로젝트 ID)
cd train-backend
firebase use --add            # 프로젝트 선택 (RTDB 켜져 있어야 함)

# 2) 의존성
cd functions && npm install && cd ..

# 3) 🔑 HF Pro write 토큰을 secret으로 (앱엔 절대 안 들어감)
firebase functions:secrets:set HF_TOKEN
#   → 프롬프트에 hf_... 붙여넣기

# 4) 배포
firebase deploy --only functions,database
```

배포 끝나면 함수 URL 2개가 출력됨:
```
https://<region>-<project>.cloudfunctions.net/train
https://<region>-<project>.cloudfunctions.net/trainStatus
```
→ 이 `train` 의 base URL(`.../train` 에서 `/train` 뗀 것)을 데스크톱 앱
   `🗂️ 연동 → 학습 서버` 또는 설정의 `trainBackendUrl` 에 넣으면 끝.
   (앱은 `{base}/train`, `{base}/trainStatus` 를 호출)

## 비용 가드(이미 적용)
- 무료 월 1회/유저 (RTDB `trainGate/{userId}`)
- GPU = L4(`l4x1`), 모델 ≤3B, MAX_STEPS=120, timeout 1h
- 더 조이려면 `functions/index.js` 의 `FREE_FLAVOR`/`MAX_STEPS`/`MONTH_MS` 수정

## 글로벌 일일 상한(선택, 폭주 방지)
`train` 함수 앞에 RTDB `trainGate/_dailyCount` 같은 카운터를 더해 하루 N건 넘으면 큐잉/거절하도록 확장 가능.

## 주의
- HF **Jobs는 Pro($9/월)·Team·Enterprise** 계정에서만 실행됨 → secret 토큰이 그 계정 것이어야 함.
- 결과 모델 repo는 **public** 으로 만들어 유저가 토큰 없이 받게 한다(개인정보 민감하면 서명 URL 프록시로 확장).
