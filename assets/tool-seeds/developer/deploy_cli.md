# deploy_cli — Vercel/Netlify 공개 배포

정적 사이트(`site/` 폴더)를 Vercel 또는 Netlify로 배포해 공개 URL을 얻는다.

## 사용

```
python deploy_cli.py --provider vercel --dir <site 폴더>
python deploy_cli.py --provider netlify --dir <site 폴더>
python deploy_cli.py --dir <site 폴더>            # 자동: 토큰 있는 쪽
```

## 환경변수 (둘 중 하나)

- `VERCEL_TOKEN` — [vercel.com/account/tokens](https://vercel.com/account/tokens)에서 발급
- `NETLIFY_AUTH_TOKEN` — [app.netlify.com/user/applications](https://app.netlify.com/user/applications)에서 발급

## 결과

- 성공 시 stdout 마지막 줄에 공개 URL (`https://xxx.vercel.app` 또는 `.netlify.app`)
- 토큰 없으면 친화적 안내 후 exit 0 (운영 단계 중단 방지)
- Node.js(npx) 필요 — Vercel/Netlify CLI를 자동 설치(`npx --yes`)

## 오더 파이프라인에서

⑤운영 단계에서 `<run_command>python deploy_cli.py --dir .../site</run_command>`로 호출.
성공 URL은 `orders.json`의 `liveUrl`에 기록된다.
