# Connect AI Desktop Security Release Status

현재 체크아웃은 설치된 Connect AI 0.4.8 앱과 기능/UI/번들 패리티를 유지하면서, 릴리스 런타임은 보안 패치가 반영된 Electron 42 계열로 올리는 것을 기본 릴리스 기준으로 둡니다.

## 현재 통과 기준

```bash
npm run release:security-audit
npm audit --omit=dev
npm audit
```

프로덕션 및 전체 JavaScript 의존성 audit은 `0` vulnerabilities입니다. `release:security-audit`는 이 결과를 `release/security-audit-report.json`에 기록하고, `verify:release:local`과 `verify:release`는 해당 리포트를 릴리스 증적으로 검사합니다.

## 릴리스 보안 증적

```bash
npm run release:evidence
```

`release/security-audit-report.json`은 production dependency tree와 전체 설치 dependency tree 모두를 검사합니다. 이 리포트는 GitHub Release에 첨부되는 checksum-pinned 증적이며, `release/release-manifest.json`, `release/provenance.json`, `RELEASE_NOTES.md`, `SHA256SUMS.txt`, `SHA512SUMS.txt`에 함께 반영됩니다.

현재 패리티/릴리스 기준:

- Baseline app content: Connect AI `0.4.8`
- Electron runtime: `42.4.1`
- Electron Builder: `26.15.3`
- esbuild parity compiler: `0.24.2`

## Electron 42 확인 결과

Electron `42.4.1` smoke test와 UI parity test는 통과해야 하며, UI parity는 surgery card와 full-page screenshot similarity가 모두 `99%` 이상이어야 합니다. 설치 앱 parity는 baseline과 파일 해시를 비교하되, 외부 URL과 workspace path 접근을 제한하는 main-process 보안 강화와 승인된 메일 의존성 보안 업데이트(`imapflow@1.4.1`, `mailparser@3.9.10`, `nodemailer@9.0.1`)는 `release/installed-app-parity-report.json`에서 승인된 delta로 기록될 때만 허용합니다.

```bash
cd /tmp
npx --yes --package electron@42.4.1 electron /path/to/desktop/scripts/smoke-electron.cjs
```

초기 테스트에서는 screenshot stabilization이 두 창을 같은 최종 모달 상태로 고정하지 못해 `74.07%`가 나왔습니다. 안정화 로직을 보강한 뒤 `CONNECT_AI_ELECTRON_VERSION=42.4.1 npm run verify:ui`는 surgery card와 full-page screenshot similarity를 모두 `99%` 이상으로 통과해야 합니다.

## 상용 보안 완성 조건

상용 보안 기준까지 완료하려면 다음을 유지해야 합니다.

1. `npm run release:security-audit` 결과를 0 blocker로 유지합니다.
2. `npm run smoke`, `npm run verify:app`, `npm run verify:release`를 통과시킵니다.
3. Electron major 변경 후에도 UI screenshot similarity `99%` 이상을 유지합니다.
4. Developer ID 서명과 Apple notarization을 통과시킵니다.

현재 unsigned DMG는 내부 검증용입니다. Developer ID 서명/노타라이즈가 끝나야 상용 보안 완료 상태로 볼 수 있습니다.
