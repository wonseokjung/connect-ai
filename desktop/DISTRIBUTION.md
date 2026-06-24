# Connect AI Desktop Distribution

이 문서는 현재 체크아웃을 설치된 Connect AI 0.4.8 앱 수준으로 빌드하고 검증하는 기준입니다.

## 현재 기준

- 기준 앱: `/Applications/Connect AI.app`
- 기준 버전: `0.4.8`
- 기준 `app.asar` SHA-256: `34ec1a57065395c8d83d47054b3bdabf0f1bfb3ff97b906c993379aa1cdc3d0b`
- 번들 ID: `ai.ezer.connect-desktop`
- Apple Team ID: `2PX39M2HZ9` (`APPLE_TEAM_ID` 또는 App Store Connect API key 설정으로 전달)

기본 기준은 `~/Downloads/Connect-AI-0.4.8-arm64-mac.zip`이 있으면 해당 현재 버전 ZIP이고, 없으면 설치된 `/Applications/Connect AI.app`으로 fallback합니다. 기준 앱이 다른 위치에 있으면 `CONNECT_AI_APP=/path/to/Connect AI.app`을 지정하세요. 다른 ZIP을 기준으로 검증해야 하면 `CONNECT_AI_ZIP=/path/to/Connect-AI-0.4.8-arm64-mac.zip`을 지정할 수 있습니다. 현재 설치 기준 앱을 CI에서 내려받을 수 있는 baseline ZIP으로 만들려면 `npm run release:baseline-export && npm run verify:baseline-export:strict:report`를 실행합니다. 이 명령은 `release/Connect-AI-0.4.8-baseline-arm64-mac.zip`, `release/baseline-export-report.json`, `release/baseline-export-report-verification.strict.json`, `release/BASELINE_EXPORT.md`를 만들거나 검증하고, 보고서의 ZIP SHA-256을 `CONNECT_AI_BASELINE_SHA256`과 `CONNECT_AI_ZIP_SHA256`에 사용합니다.

## 로컬 검증

```bash
cd desktop
npm install
npm run release:preflight
npm run typecheck
npm run smoke
npm run verify:app
npm run verify:release:local
```

`release:preflight`는 빌드 전에 macOS 도구, package 설정, 기준 앱, GitHub Actions workflow, signing/notarization 입력, 기존 release artifact 상태를 점검합니다. `verify:app`은 설치된 0.4.8 앱과 로컬 소스/번들/UI 흐름이 같은지 확인합니다. `verify:release:local`은 상용 배포에 필요한 설정, 기준 앱 해시, macOS 보안 계약, release env readiness, secret hygiene, DMG 설치 경험, 패키징된 앱 런치 스모크, DMG 내부 앱 런치 스모크, 자동 업데이트 채널 메타데이터, 프로덕션 보안 감사, 서명/노타라이즈 입력, 생성된 산출물을 점검합니다.

## 로컬 DMG 빌드

```bash
cd desktop
npm run dist
```

결과물은 `desktop/release/`에 생성됩니다. macOS의 asdf `python` shim 문제를 피하기 위해 Electron Builder 실행 시 `/usr/bin/python3`을 `PYTHON_PATH`로 자동 지정합니다.

`dist`는 기준 앱과 같은 sourcemap을 만들기 위해 먼저 패리티용 `node_modules` overlay로 번들링한 뒤, 승인된 메일 의존성 보안 업데이트(`imapflow@1.4.1`, `mailparser@3.9.10`, `nodemailer@9.0.1`)를 다시 적용합니다. 패키징 직전에도 기준 앱의 원래 `node_modules`를 복원한 뒤 같은 보안 오버레이를 적용합니다. 패키징 후에는 빌드된 `app.asar`를 보존하고 기준 앱의 `app.asar.unpacked` native/unpacked 리소스와 top-level `Resources/llamacpp` 실행 리소스를 복원합니다. 이 구조는 설치 앱의 UI/동작 패리티를 유지하면서 main-process 외부 URL/workspace path 보안 하드닝과 메일 의존성 보안 패치를 실제 DMG에 포함하기 위한 기준입니다.

Developer ID 인증서나 production signing 입력이 없을 때의 로컬 `dist`는 앱 번들에 ad-hoc hardened-runtime 서명을 적용합니다. 이 서명은 `codesign --verify --deep --strict` 리소스 seal과 entitlement 추출을 검증하기 위한 진단용이며, Gatekeeper/노타라이즈/상용 publish gate를 통과시키는 production 서명이 아닙니다.

## 상용 배포 게이트

정식 릴리스 직전에는 아래 명령이 통과해야 합니다.

```bash
cd desktop
npm run release:preflight:strict:report
npm run release:preflight:strict
npm run dist
npm run verify:release
```

`verify:release`는 strict 모드로 실행되며 다음이 없으면 실패합니다.

- Developer ID Application 코드서명 인증서
- Apple notarization credential (`APPLE_KEYCHAIN_PROFILE` 또는 Apple ID/API key 환경 변수)
- 기준 앱과 동일한 `app.asar`이거나 `release.appAsarPolicy`에서 승인된 main-process 보안 하드닝 및 메일 의존성 보안 업데이트 delta
- hardened runtime, entitlement allowlist, broad ATS arbitrary loads 비활성화, local-only ATS 예외, privacy usage 보안 계약 통과
- DMG checksum, Applications shortcut, drag-install copy simulation 통과
- 패키징된 `Connect AI.app` 런치 스모크 통과
- DMG를 마운트한 뒤 내부 `Connect AI.app` 런치 스모크 통과
- Gatekeeper/codesign/stapler 검증 가능한 릴리스 앱과 DMG
- `Connect-AI-0.4.8-mac-arm64.dmg`
- 프로덕션 의존성 보안 감사 통과

현재 이 머신에는 유효한 Developer ID Application 코드서명 ID가 없으면 정식 상용 릴리스는 완료 상태가 아닙니다. unsigned DMG는 내부 검증용으로만 사용하세요.

## 필요한 서명/노타라이즈 입력

Apple Developer 계정과 Developer ID Application 인증서를 준비한 뒤 다음 중 하나를 설정합니다.
환경 변수 이름은 [.env.release.example](.env.release.example)을 기준으로 맞추면 됩니다. 실제 secret 값은 commit하지 않습니다.
로컬에서는 먼저 `npm run release:env-bootstrap && npm run verify:env-bootstrap:strict:report`로 현재 baseline SHA와 필요한 key를 반영한 secret-free bootstrap pack을 생성합니다. 결과는 `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.strict.json`에 기록됩니다. 이후 `release/release-env.local.template`을 `.env.release.local`로 복사해 값을 채우고 `*:env` 스크립트로 실행할 수 있습니다. `CONNECT_AI_RELEASE_AUDIT_TOKEN`을 넣으면 wrapper가 값을 출력하지 않고 `GH_TOKEN`으로 전달해 GitHub CLI 기반 readiness와 Release asset 검증도 같은 파일로 재현합니다. `.env.release.local`을 만들었으면 먼저 `npm run verify:release-env-contract`를 실행해 `.env.release.example`, env verifier, GitHub setup, CI workflow, 운영 문서가 같은 변수 계약을 공유하는지 확인합니다. 결과는 `release/release-env-contract-report.json`에 기록됩니다. 그 다음 `npm run release:env-check`를 실행해 ignored 파일 여부, 파일 권한, placeholder 잔존 여부, baseline URL/SHA 형식, base64 디코딩 가능 여부, 인증서/노타라이즈/GitHub token 입력 그룹을 점검합니다. `npm run verify:release-env-validation`은 임시 env 파일로 정상/오류 케이스를 실행해 이 검증 로직과 GitHub setup dry-run이 계속 작동하는지 확인하고 기존 release report를 복원합니다. 실제 릴리스 직전에는 `npm run release:env-check:strict` 또는 CI 환경 변수 기반의 `npm run release:env-check:process:strict`를 사용합니다. 실패 코드 없이 최신 실패 리포트만 남겨야 할 때는 `npm run release:env-check:strict:report` 또는 `npm run release:env-check:process:strict:report`를 사용합니다. 이 리포트는 secret 값을 쓰지 않고 key 이름과 통과/누락 상태만 `release/release-env-report*.json`에 기록합니다.

현재 머신의 준비 상태 확인:

```bash
node --version   # v22.12.0 이상, v26 미만
npm --version
```

CI는 `actions/setup-node`에서 Node `22.12.0`을 사용합니다. `package.json`, `package-lock.json`, `.node-version`, preflight가 같은 Node engine 계약(`>=22.12.0 <26`)을 검사합니다.

```bash
cd desktop
npm run signing:doctor
```

이 명령은 secret 값을 출력하지 않고 `release/signing-readiness.json`에 Developer ID identity, `.p12` import 입력, notarization 입력 그룹의 통과/누락 상태를 기록합니다. `.env.release.local` 값을 함께 확인하려면 `npm run signing:doctor:env` 또는 실패 코드까지 필요한 `npm run signing:check:env`를 사용합니다. 실패 코드 없이 최신 strict signing 리포트만 남겨야 할 때는 `npm run signing:check:report` 또는 `.env.release.local` 기반의 `npm run signing:check:report:env`를 사용합니다.

Developer ID `.p12` 인증서를 로컬 keychain으로 가져오고 App Store Connect API key 파일을 복원하려면:

```bash
export BUILD_CERTIFICATE_PATH="/absolute/path/DeveloperIDApplication.p12"
export P12_PASSWORD="p12-password"
export KEYCHAIN_PASSWORD="temporary-keychain-password"
export APPLE_API_KEY_BASE64="$(base64 -i /absolute/path/AuthKey_XXXX.p8)"
export APPLE_API_KEY_ID="KEYID"
export APPLE_API_ISSUER="ISSUER-UUID"
npm run signing:import
```

`.env.release.local` 파일을 사용할 경우:

```bash
npm run release:operator-runbook
npm run release:env-check:strict
npm run release:operator-checklist:github:strict:env
npm run release:preflight:strict:report:env
npm run release:preflight:strict:env
npm run release:operator-checklist:strict:env
npm run signing:import:env
npm run verify:release:env
npm run release:publish-assets:plan:env
```

Apple ID 방식의 notarytool profile을 로컬 keychain에 저장하려면:

```bash
export APPLE_ID="apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="2PX39M2HZ9"
export APPLE_KEYCHAIN_PROFILE="connect-ai-notary"
npm run signing:notary-profile
# 실패 코드 없이 readiness artifact만 남기려면:
npm run signing:notary-profile:report
```

```bash
export APPLE_KEYCHAIN_PROFILE="notarytool-profile"
```

또는:

```bash
export APPLE_ID="apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="2PX39M2HZ9"
```

또는:

```bash
export APPLE_API_KEY="/absolute/path/AuthKey_XXXX.p8"
export APPLE_API_KEY_ID="KEYID"
export APPLE_API_ISSUER="ISSUER-UUID"
```

## GitHub Actions 릴리스

자동 릴리스 워크플로는 [.github/workflows/build-desktop.yml](../.github/workflows/build-desktop.yml)에 있습니다. 이 워크플로는 macOS arm64 runner에서 기준 ZIP을 다운로드하고, signing import 전후 operator checklist, 패리티 검증, DMG 빌드, strict release 검증, promotion plan 생성, artifact 업로드, 태그 릴리스 첨부, 원격 GitHub Release asset 검증까지 수행합니다.

필수 repository variable:

- `CONNECT_AI_BASELINE_URL`: `Connect-AI-0.4.8-arm64-mac.zip`을 받을 수 있는 `https` `.zip` URL. 현재 package version 문자열을 포함해야 합니다.
- `CONNECT_AI_BASELINE_SHA256`: 기준 ZIP SHA-256. 64자리 hex 값이어야 하며 `CONNECT_AI_ZIP_SHA256`도 함께 쓸 경우 두 값이 같아야 합니다.
- `CONNECT_AI_ZIP_SHA256`: CI workflow 입력에서 쓰는 기준 ZIP SHA-256 alias. `CONNECT_AI_BASELINE_SHA256`과 함께 설정하면 두 값이 같아야 합니다.

기준 ZIP이 아직 없으면 먼저 `npm run release:baseline-export && npm run verify:baseline-export:strict:report`를 실행하고 `release/baseline-export-report.json`의 `export.sha256` 값을 사용하세요. 생성된 ZIP은 private storage 또는 GitHub Release draft asset처럼 CI가 접근 가능한 HTTPS 위치에 올린 뒤 그 URL을 `CONNECT_AI_BASELINE_URL`로 설정합니다. `release/baseline-export-report-verification.strict.json`은 ZIP bytes/SHA-256, source `app.asar`, baseline freshness cross-check를 기록합니다.

필수/선택 secret:

- `CONNECT_AI_BASELINE_TOKEN`: 기준 ZIP URL이 private일 때 사용하는 bearer token
- `CONNECT_AI_RELEASE_AUDIT_TOKEN`: GitHub Actions variable/secret 이름 목록을 점검하는 fine-grained token. repository `Variables: read`, `Secrets: read`, `Metadata: read` 권한이 필요합니다. process env에서는 같은 계약의 fallback으로 `GH_TOKEN`도 허용됩니다.
- `BUILD_CERTIFICATE_BASE64`: Developer ID Application `.p12` 파일을 base64로 인코딩한 단일 라인 값. 검증 스크립트가 디코딩 가능 여부만 확인하고 값은 출력하지 않습니다.
- `CONNECT_AI_CERTIFICATE_PATH` 또는 `CONNECT_AI_CERTIFICATE_BASE64`: `BUILD_CERTIFICATE_PATH`/`BUILD_CERTIFICATE_BASE64`의 Connect AI 전용 alias
- `P12_PASSWORD`: `.p12` 비밀번호
- `CONNECT_AI_CERTIFICATE_PASSWORD`: `P12_PASSWORD`의 Connect AI 전용 alias
- `KEYCHAIN_PASSWORD`: CI 임시 keychain 비밀번호
- `CONNECT_AI_KEYCHAIN_PASSWORD`: `KEYCHAIN_PASSWORD`의 Connect AI 전용 alias
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: Apple ID 방식 notarization
- 또는 `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`: App Store Connect API key 방식 notarization
- 또는 `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`: `.p8` API key를 base64 단일 라인 값으로 저장하는 방식. 검증 스크립트가 디코딩 가능 여부만 확인하고 값은 출력하지 않습니다.
- 또는 `APPLE_KEYCHAIN_PROFILE`: runner에 미리 구성된 notarytool profile

수동 실행:

```bash
GitHub → Actions → Build Connect AI Desktop → Run workflow
```

태그 릴리스:

```bash
git tag desktop-v0.4.8
git push origin desktop-v0.4.8
```

`package.json`의 updater/publish 메타데이터는 `wonseokjung/connect-ai`를 가리킵니다. 태그 또는 `publish_release=true`로 실행하면 워크플로가 DMG, blockmap, `latest-mac.yml`, release manifest/tag/UI/performance/macOS security/IPC security/DMG install/launch/update/provenance/SBOM/checksum/decision/promotion 증적을 GitHub Release에 업로드합니다. 업로드 대상은 `release/release-asset-manifest.json`에서 읽어오므로 workflow의 수동 파일 목록과 실제 Release asset이 어긋나지 않습니다.
`release/secret-hygiene-report.json`, `release/release-env-contract-report.json`, `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.strict.json`, `release/status-refresh-report.json`, `release/status-refresh-report-verification.strict.json`, `release/github-release-assets-report.strict.json`, `release/github-release-publish-plan.json`, `release/github-release-publish-plan-report.json`, `release/github-release-publish-plan-report.strict.json`, `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`, `release/github-release-remediation-plan-report.json`, `release/github-release-remediation-plan-report.strict.json`, `release/preflight-report.strict.json`, `release/github-release-setup-report.json`, `release/production-release-runbook-report.json`, `release/production-release-runbook-report-verification.strict.json`, `release/production-readiness-summary.json`, `release/PRODUCTION_READINESS_SUMMARY.md`, `release/production-readiness-summary-verification.strict.json`, `release/release-setup-plan.json`, `release/RELEASE_SETUP_PLAN.md`, `release/release-setup-plan-report.json`, `release/release-setup-plan-report.strict.json`, `release/release-unblock-plan.json`, `release/RELEASE_UNBLOCK_PLAN.md`, `release/release-unblock-plan-report.json`, `release/release-unblock-plan-report.strict.json`, `release/release-credential-handoff.json`, `release/RELEASE_CREDENTIAL_HANDOFF.md`, `release/release-credential-handoff-report.json`, `release/release-credential-handoff-report.strict.json`, `release/release-publication-seal.json`, `release/RELEASE_PUBLICATION_SEAL.md`, `release/baseline-freshness-report.json`, `release/BASELINE_FRESHNESS.md`, `release/baseline-export-report.json`, `release/baseline-export-report-verification.strict.json`, `release/BASELINE_EXPORT.md`, `release/release-env-report.process.json`, launch smoke log는 CI 전용 diagnostic artifact로 보존하고 GitHub Release 사용자 자산으로는 올리지 않습니다.
업로드 후 `verify:github-release-assets:strict`가 원격 Release asset 이름/크기를 `release/release-asset-manifest.json`과 대조하고, 원격 파일을 내려받아 SHA-256/SHA-512까지 확인한 뒤 `release/github-release-assets-report.strict.json`을 CI artifact로 남깁니다.
`release-env-contract-report.json`, `release-env-bootstrap.json`, `RELEASE_ENV_BOOTSTRAP.md`, `release-env.local.template`, `release-env-bootstrap-report.strict.json`, `status-refresh-report.json`, `status-refresh-report-verification.strict.json`, `github-release-assets-report.strict.json`, `github-release-publish-plan.json`, `github-release-publish-plan-report.json`, `github-release-publish-plan-report.strict.json`, `github-release-remediation-plan.json`, `GITHUB_RELEASE_REMEDIATION_PLAN.md`, `github-release-remediation-plan-report.json`, `github-release-remediation-plan-report.strict.json`, `release-env-report.process.json`, `preflight-report.strict.json`, `github-release-setup-report.json`, `production-release-runbook-report.json`, `production-release-runbook-report-verification.strict.json`, `production-readiness-summary.json`, `PRODUCTION_READINESS_SUMMARY.md`, `production-readiness-summary-verification.strict.json`, `release-setup-plan.json`, `RELEASE_SETUP_PLAN.md`, `release-setup-plan-report.json`, `release-setup-plan-report.strict.json`, `release-credential-handoff.json`, `RELEASE_CREDENTIAL_HANDOFF.md`, `release-credential-handoff-report.json`, `release-credential-handoff-report.strict.json`, `release-unblock-plan.json`, `RELEASE_UNBLOCK_PLAN.md`, `release-unblock-plan-report.json`, `release-unblock-plan-report.strict.json`, `release-publication-seal.json`, `RELEASE_PUBLICATION_SEAL.md`, `baseline-freshness-report.json`, `BASELINE_FRESHNESS.md`, `baseline-export-report.json`, `baseline-export-report-verification.strict.json`, `BASELINE_EXPORT.md`는 release env check와 strict preflight가 실패해도 별도 `always()` artifact로 업로드되어 CI 실패 원인을 추적할 수 있습니다.

CI에서 `verify:app` 또는 `build:parity`를 실행하려면 기준 앱 또는 기준 ZIP을 CI runner가 접근할 수 있어야 합니다. 기준 파일 없이 CI에서 임의로 빌드하면 0.4.8 설치 앱과 99% 이상 유사하다는 검증을 할 수 없습니다. 설치 앱 parity는 기본적으로 파일 SHA-256을 대조하되, main-process의 외부 URL/workspace path 보안 강화와 승인된 메일 의존성 보안 업데이트로 인한 `out/main.js`와 `out/main.js.map` 차이는 `release/installed-app-parity-report.json`에 승인된 delta로 기록될 때만 허용합니다. 릴리스 DMG의 `app.asar`는 `release/release-manifest.json`의 `release.appAsarPolicy`에서 같은 delta로 승인되어야 합니다.

## 릴리스 증적

```bash
cd desktop
npm run release:manifest
```

`release/preflight-report.json` 또는 CI의 `release/preflight-report.strict.json`에는 macOS 도구, npm script, baseline, workflow, signing/notarization 입력, 기존 release artifact 상태가 기록됩니다. `release/release-manifest.json`에는 버전, git 상태, 기준 앱 해시, DMG/blockmap/update manifest 해시, production audit, app/DMG codesign, Gatekeeper, stapler 결과와 `release.appAsarPolicy` 승인 결과가 기록됩니다. 이 정책에는 main-process 보안 하드닝 marker와 승인된 메일 의존성 보안 업데이트의 실제 packaged ASAR 버전이 포함됩니다. `release/security-audit-report.json`에는 production dependency tree와 전체 설치 dependency tree의 `npm audit` 결과가 기록되며 GitHub Release에 checksum-pinned 보안 증적으로 첨부됩니다. `release/release-tag-report.json`에는 package version, GitHub tag ref, 실제 배포 tag, DMG artifact naming이 같은 버전을 가리키는지 기록됩니다. `release/installed-app-parity-report.json`에는 설치 앱 기준 파일 parity와 승인된 main-process 보안 delta 및 메일 의존성 보안 오버레이가 기록됩니다. `release/ui-parity-report.json`에는 기준 앱과 로컬 앱의 DOM/layout signature, 주요 클릭 동작, preload method count, surgery modal card 및 full-page 스크린샷 99% 이상 similarity 결과가 기록됩니다. `release/performance-parity-report.json`에는 같은 기준 앱 대비 renderer load time, DOM/resource footprint, 주요 클릭 latency, renderer heap budget이 기록됩니다. `release/macos-security-contract.json`에는 hardened runtime, entitlement allowlist, privacy usage string, broad ATS arbitrary loads 비활성화와 local-only ATS 예외 범위가 계약대로 유지되는지 기록됩니다. `release/ipc-security-report.json`에는 실제 Electron 런타임에서 workspace 밖 파일 IPC 접근, terminal cwd 탈출, artifact open 탈출, javascript/file external URL 차단, 안전한 https URL 허용이 기록됩니다. `release/release-env-contract-report.json`에는 `.env.release.example`, env verifier, GitHub setup, workflow, 운영 문서가 같은 release env 변수 계약을 공유하는지 기록되며 strict release evidence에서 필수 증빙으로 검증됩니다. `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.strict.json`에는 baseline SHA가 채워진 secret-free `.env.release.local` bootstrap pack과 검증 결과가 기록됩니다. `release/release-env-report.json` 또는 CI의 `release/release-env-report.process.json`에는 release env template, ignored local secret 파일, placeholder, 인증서/노타라이즈/GitHub token 입력 그룹 상태가 값 없이 기록됩니다.
`release/secret-hygiene-report.json`에는 release용 env 파일, P12/P8 인증서 파일 ignore 규칙, release text artifact 내 민감 env 값/GitHub token/private key marker 노출 여부가 값 없이 기록되며 CI-only diagnostic으로 보존됩니다.
`release/status-refresh-report.json`에는 stale `connect-ai-*` temp cleanup, UI/동작 패리티, renderer 성능 패리티, decision, promotion, remote asset drift, strict remote asset drift, GitHub Release remediation plan, remediation apply dry-run, remediation apply verification, publish plan, publish plan verification, readiness summary, unblock plan, publication seal, setup plan verification, production runbook report, credential handoff report, commercial cutover, commercial release readiness, final asset manifest 검증을 고정 순서로 수렴시킨 실행 단계와 최종 요약이 기록됩니다. 첫 단계의 temp cleanup 결과는 `release/temp-cleanup-report.json`에 CI-only diagnostic으로 남습니다. `release/status-refresh-report-verification.strict.json`에는 이 수렴 리포트의 단계 순서, source report freshness, UI/성능 패리티 fingerprint, downstream verifier clean 상태, commercial release readiness freshness, secret material 비노출 검증 결과가 기록됩니다. `npm run release:commercial-cutover:final`은 status refresh 검증을 먼저 통과시킨 뒤 `release/commercial-cutover-plan.json`과 `release/COMMERCIAL_CUTOVER_PLAN.md`를 다시 써서 상용 전환 문서가 최신 수렴 검증 결과를 source report로 직접 잡도록 합니다. `npm run verify:commercial-release:strict:report`는 status refresh, commercial cutover, production readiness, publication seal, GitHub publish/remediation, signing, UI/성능 parity, release manifest, operator readiness를 한 리포트로 집계해 `release/commercial-release-readiness-report.strict.json`에 상용 완료/production-ready/published-ready 상태와 남은 blocker를 기록합니다. No-exit 진단 runbook은 아직 수렴 중인 자기 자신의 `release/production-release-runbook-report.json`를 commercial readiness source로 다시 읽지 않도록 `commercial-finalization`을 `deferred until release:status-refresh converges` 상태로 스킵하고, `release/production-release-runbook-report-verification.strict.json`이 이 deferral 계약을 검증합니다. `npm run release:commercial-finalize`는 status refresh 검증, commercial cutover 검증, commercial release readiness, asset manifest를 마지막 순서로 다시 실행하고 `release/commercial-finalization-report.json`, `release/COMMERCIAL_FINALIZATION.md`, `release/commercial-finalization-report-verification.strict.json`에 최종 수렴 상태와 검증 결과를 기록합니다. `release/github-release-assets-report.strict.json`에는 원격 GitHub Release asset의 bytes와 SHA-256/SHA-512 대조 결과가 기록됩니다. `release/github-release-publish-plan.json`에는 업로드 직전 production gate, baseline export verification, manifest asset bytes/SHA, readiness/publication freshness 확인 결과가 기록됩니다. `release/github-release-publish-plan-report*.json`에는 publish plan schema, gate projection, manifest asset checksum, baseline export verification source report, secret material 비노출 검증 결과가 기록됩니다. `release/github-release-remediation-plan.json`과 `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`에는 현재 원격 Release asset mismatch/missing 항목을 `gh release upload --clobber` required command로, manifest에 없는 원격 asset을 advisory review로 정리합니다. `release/github-release-remediation-plan-report*.json`에는 해당 plan이 `release/release-asset-manifest.json`의 allowlist를 빠짐없이 덮고 secret material을 포함하지 않는지 기록됩니다. `release/github-release-remediation-apply-plan.json`에는 실제 업로드 없이 같은 required action을 로컬 manifest bytes/SHA와 다시 대조한 결과가 기록됩니다. `release/github-release-remediation-apply-plan-report.strict.json`에는 apply dry-run action의 local path, bytes, SHA-256/SHA-512, baseline URL guard, source freshness, secret material 비노출 검증 결과가 기록됩니다.
`npm run verify:commercial-finalization:strict:report`는 `release/commercial-finalization-report.json`, `release/COMMERCIAL_FINALIZATION.md`, `release/commercial-finalization-report-verification.strict.json`이 최신 status refresh, commercial cutover, commercial readiness, asset manifest를 그대로 반영하는지 확인합니다.
`release/dmg-install-experience.json`에는 DMG 이미지 형식, checksum verify, Applications shortcut, drag-install copy simulation, mounted/copied app 구조 검증, mounted/copied app의 broad ATS arbitrary loads 비활성화와 local-only ATS 예외 범위가 기록됩니다. `release/release-launch-smoke.json`에는 `release/mac-arm64/Connect AI.app` 실행 파일이 조기 종료 없이 뜨는지 확인한 결과가 기록됩니다. `release/release-dmg-launch-smoke.json`에는 DMG를 실제로 마운트한 뒤 내부 `Connect AI.app`가 조기 종료 없이 뜨는지 확인한 결과가 기록됩니다. `release/update-channel-report.json`에는 packaged app과 DMG 내부 app의 `app-update.yml`, `latest-mac.yml`, DMG/blockmap, GitHub updater owner/repo/provider가 서로 일치하는지 기록됩니다. `release/signing-readiness.json`에는 Developer ID identity, 인증서 import 입력, notarization credential 그룹 상태가 기록됩니다. `release/production-release-runbook-report.json`에는 선택한 `.env.release.local` 기준으로 GitHub 설정, 서명 준비, preflight, publish plan, 원격 asset drift/remediation dry-run, manifest 검증 단계, runbook `status`, production/local/published readiness snapshot, no-exit deferral 상태, blocker detail이 secret 값 없이 기록됩니다. `release/production-release-runbook-report-verification.strict.json`에는 runbook report schema, status/gate projection, summary/blocker detail 일치 여부, 필수 stage ID, no-exit commercial finalization deferral, remote remediation stage 순서, secret material 비노출 검증 결과가 기록됩니다. `release/production-readiness-summary.json`과 `release/PRODUCTION_READINESS_SUMMARY.md`에는 로컬 후보, production-ready, published-release-ready 게이트별 통과 여부와 다음 운영 조치가 secret 값 없이 요약됩니다. `release/production-readiness-summary-verification.strict.json`에는 readiness summary schema, status/gate projection, source report 존재/parse, next action 일치, secret material 비노출 검증 결과가 기록됩니다. `release/release-setup-plan.json`과 `release/RELEASE_SETUP_PLAN.md`에는 외부 운영자가 채워야 하는 로컬/GitHub/검증/release 실행 순서와 source report 상태가 secret 값 없이 정리됩니다. `release/release-setup-plan-report*.json`에는 setup plan schema, production/local status projection, source report freshness, 필수 command, Markdown coverage, secret material 비노출 검증 결과가 기록됩니다. `release/release-credential-handoff.json`과 `release/RELEASE_CREDENTIAL_HANDOFF.md`에는 외부 운영자가 채워야 하는 baseline, GitHub audit token, Developer ID, notarization 입력과 원격 asset remediation 명령이 secret 값 없이 정리됩니다. `release/release-credential-handoff-report*.json`에는 credential handoff의 schema, 필수 그룹, source report, 운영 sequence, secret material 비노출, CI-only asset 정책 검증 결과가 기록됩니다. `release/release-unblock-plan.json`과 `release/RELEASE_UNBLOCK_PLAN.md`에는 남은 외부 차단 요소가 baseline, GitHub token, Developer ID, notarization, CI secret, signed build, publication 검증 그룹으로 정리됩니다. `release/release-unblock-plan-report*.json`에는 unblock plan의 schema, 필수 그룹, source report, readiness freshness, CI-only asset 정책 검증 결과가 기록됩니다. `release/release-publication-seal.json`과 `release/RELEASE_PUBLICATION_SEAL.md`에는 strict decision, promotion plan, readiness summary, release manifest signing/notarization security, release notes status, publish plan, remote asset verification이 최종 배포 가능한 조합인지 기록됩니다. `release/release-publication-seal-verification.strict.json`에는 publication seal schema, status/gate projection, source report 존재/parse, next action 일치, secret material 비노출 검증 결과가 기록됩니다. `release/release-decision.json` 또는 strict 실행 시 `release/release-decision.strict.json`에는 로컬 후보 통과 여부, 상용 배포 가능 여부, 남은 운영 조치가 요약됩니다. `release/release-promotion-plan.json`과 `release/RELEASE_PROMOTION_PLAN.md`에는 현재 evidence에서 production-ready까지 필요한 입력, 로컬/CI 실행 순서, GitHub Release에 올릴 asset 목록, CI-only diagnostic 목록, 배포 금지 조건이 기록됩니다. `release/release-asset-manifest.json`에는 GitHub Release에 첨부할 파일 목록, bytes, SHA-256, SHA-512와 CI-only diagnostic 목록이 기록되고 `release/asset-manifest-report*.json`에서 실제 파일 및 CI 업로드 목록과 대조됩니다.
`release/secret-hygiene-report.json`, `release/release-env-contract-report.json`, `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.json`, `release/release-env-bootstrap-report.strict.json`, `release/temp-cleanup-report.json`, `release/status-refresh-report.json`, `release/status-refresh-report-verification.strict.json`, `release/github-release-assets-report.strict.json`, `release/github-release-publish-plan.json`, `release/github-release-publish-plan-report.json`, `release/github-release-publish-plan-report.strict.json`, `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`, `release/github-release-remediation-plan-report.json`, `release/github-release-remediation-plan-report.strict.json`, `release/github-release-remediation-apply-plan.json`, `release/github-release-remediation-apply-plan-report.json`, `release/github-release-remediation-apply-plan-report.strict.json`, `release/preflight-report.strict.json`, `release/github-release-setup-report.json`, `release/production-release-runbook-report.json`, `release/production-release-runbook-report-verification.strict.json`, `release/production-readiness-summary.json`, `release/PRODUCTION_READINESS_SUMMARY.md`, `release/production-readiness-summary-verification.strict.json`, `release/engineering-readiness-report.json`, `release/ENGINEERING_READINESS.md`, `release/commercial-cutover-plan.json`, `release/COMMERCIAL_CUTOVER_PLAN.md`, `release/commercial-cutover-plan-report.json`, `release/commercial-cutover-plan-report.strict.json`, `release/commercial-release-readiness-report.strict.json`, `release/commercial-finalization-report.json`, `release/COMMERCIAL_FINALIZATION.md`, `release/commercial-finalization-report-verification.strict.json`, `release/release-setup-plan.json`, `release/RELEASE_SETUP_PLAN.md`, `release/release-setup-plan-report.json`, `release/release-setup-plan-report.strict.json`, `release/release-unblock-plan.json`, `release/RELEASE_UNBLOCK_PLAN.md`, `release/release-unblock-plan-report.json`, `release/release-unblock-plan-report.strict.json`, `release/release-credential-handoff.json`, `release/RELEASE_CREDENTIAL_HANDOFF.md`, `release/release-credential-handoff-report.json`, `release/release-credential-handoff-report.strict.json`, `release/release-publication-seal.json`, `release/RELEASE_PUBLICATION_SEAL.md`, `release/release-publication-seal-verification.strict.json`, `release/baseline-freshness-report.json`, `release/BASELINE_FRESHNESS.md`, `release/baseline-export-report.json`, `release/baseline-export-report-verification.json`, `release/baseline-export-report-verification.strict.json`, `release/BASELINE_EXPORT.md`, `release-*-launch-smoke.log`, `release/release-env-report.process.json`은 CI-only diagnostic이므로 존재와 workflow 업로드 경로만 검증하고 checksum 고정 대상에서는 제외합니다. CI는 strict release 검증 후 배포용 파일은 Release asset으로, 진단 파일은 CI artifact로 업로드합니다. `verify:release:local`은 DMG를 실제로 마운트해서 DMG 내부의 `Connect AI.app` bundle ID, 버전, Electron runtime, `app.asar` 승인 정책, `app.asar.unpacked`, codesign 상태, ATS 예외 범위도 확인합니다.
CI workflow는 release env check 실패 시 `connect-ai-desktop-release-env`, strict preflight 실패 시 `connect-ai-desktop-preflight` artifact를 `always()`로 업로드하며, `release/release-env-contract-report.json`, `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.strict.json`, `release/status-refresh-report.json`, `release/status-refresh-report-verification.strict.json`, `release/github-release-publish-plan.json`, `release/github-release-publish-plan-report.strict.json`, `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`, `release/github-release-remediation-plan-report.json`, `release/github-release-setup-report.json`, `release/production-release-runbook-report.json`, `release/production-release-runbook-report-verification.strict.json`, `release/production-readiness-summary.json`, `release/PRODUCTION_READINESS_SUMMARY.md`, `release/production-readiness-summary-verification.strict.json`, `release/engineering-readiness-report.json`, `release/ENGINEERING_READINESS.md`, `release/commercial-cutover-plan.json`, `release/COMMERCIAL_CUTOVER_PLAN.md`, `release/commercial-cutover-plan-report.json`, `release/commercial-cutover-plan-report.strict.json`, `release/commercial-release-readiness-report.strict.json`, `release/commercial-finalization-report.json`, `release/COMMERCIAL_FINALIZATION.md`, `release/commercial-finalization-report-verification.strict.json`, `release/release-setup-plan.json`, `release/RELEASE_SETUP_PLAN.md`, `release/release-setup-plan-report.strict.json`, `release/release-credential-handoff.json`, `release/RELEASE_CREDENTIAL_HANDOFF.md`, `release/release-credential-handoff-report.json`, `release/release-unblock-plan.json`, `release/RELEASE_UNBLOCK_PLAN.md`, `release/release-unblock-plan-report.json`, `release/release-publication-seal.json`, `release/RELEASE_PUBLICATION_SEAL.md`, `release/baseline-freshness-report.json`, `release/BASELINE_FRESHNESS.md`, `release/baseline-export-report.json`, `release/baseline-export-report-verification.strict.json`, `release/BASELINE_EXPORT.md`도 preflight diagnostic으로 보존합니다.
`release:evidence`는 `verify:release-env-contract`로 release env 변수 계약 증빙을 먼저 갱신하고, 이어서 `release:security-audit`로 보안 감사 리포트를 만듭니다. provenance에 secret hygiene 요약을 넣기 위해 `release:provenance` 전에 secret hygiene을 한 번 실행합니다. `RELEASE_NOTES.md`와 `SHA256SUMS.txt`/`SHA512SUMS.txt`까지 스캔하기 위해 `release:notes` 뒤에 한 번 더 `verify:release:secret-hygiene`를 실행합니다. 이 secret hygiene report는 release text artifact의 secret literal뿐 아니라 실제 repository candidate 파일 집합도 검사해 `desktop/node_modules`, `desktop/release`, `desktop/out`, local env, certificate, notary key 파일이 commit 후보로 들어오지 않는지 기록합니다.

## 보안 릴리스 상태

[SECURITY_RELEASE.md](SECURITY_RELEASE.md)에 현재 보안 상태와 runtime/toolchain uplift 조건을 기록합니다.

```bash
cd desktop
npm run verify:security:prod
npm run verify:security:all
```

현재 릴리스는 Connect AI 0.4.8 앱 콘텐츠 패리티를 유지하면서 Electron runtime `42.4.1`, electron-builder `26.15.3`을 사용합니다. Electron 42 기준 UI similarity는 surgery card와 full-page 모두 99% 이상이어야 release evidence가 통과합니다. 기준 앱과 다른 main-process bundle hash는 외부 URL/workspace path 보안 강화와 승인된 메일 의존성 보안 업데이트가 `release/installed-app-parity-report.json` 및 `release/release-manifest.json`의 `release.appAsarPolicy`에서 승인된 경우에만 허용됩니다.

## 운영 체크리스트

[RELEASE_OPERATOR_CHECKLIST.md](RELEASE_OPERATOR_CHECKLIST.md)는 Developer ID 인증서, Apple notarization credential, GitHub Actions variables/secrets, 태그 릴리스 순서를 한 번에 점검하는 운영 문서입니다.

```bash
cd desktop
npm run release:operator-runbook
npm run release:operator-checklist
npm run release:operator-checklist:strict
```

정식 릴리스 입력이 준비된 뒤에는 `npm run release:operator-runbook:apply`가 `.env.release.local`을 기준으로 GitHub 설정 dry-run/apply, 서명 import, strict preflight, signed DMG build, strict verify, publish dry-run, production readiness, release setup plan, setup plan verification, credential handoff, credential handoff verification, publication seal을 한 번에 최신화합니다. 외부 입력 없이 현재 report graph만 최신 순서로 다시 수렴시키려면 `npm run release:status-refresh`를 사용합니다. 이 refresh는 process env readiness, local operator readiness, signing readiness, GitHub repository setup, GitHub operator readiness, UI/동작 패리티, renderer 성능 패리티, evidence bundle, baseline export verification, strict evidence, 원격 asset remediation, publish plan, publish plan verification, readiness/readiness verification/seal, setup plan verification, publication seal verification, production runbook report, runbook report verification, credential handoff, strict preflight diagnostic report, commercial release readiness, asset manifest 정책을 한 번 더 고정 순서로 갱신합니다. CI는 commercial cutover 뒤 `npm run verify:commercial-release:strict:report`와 `npm run release:commercial-finalize`를 실행해 상용 완료 여부와 최종 수렴 상태를 diagnostic으로 남기고, `release:status-refresh`도 같은 리포트를 생성한 뒤 manifest를 다시 써서 CI-only artifact 목록을 닫습니다. GitHub Actions나 CI 환경 변수만 있는 실행 환경에서는 `npm run release:operator-runbook:process:strict:report`로 현재 process env 상태를 진단하고, 같은 방식으로 전체 실행이 필요할 때는 `npm run release:operator-runbook:process:apply`를 사용합니다. 실제 GitHub Release 업로드는 시작 시점의 오래된 리포트로 미리 스킵하지 않고, 업로드 직전에 `verify:publication-seal:production`을 실행해 `release-decision.strict.json`, `release-promotion-plan.json`, `release/production-readiness-summary.json`, `release/release-publication-seal.json`이 모두 `productionReady: true`이고 `release/baseline-freshness-report.json`이 `ok: true`, `release/baseline-export-report-verification.strict.json`이 blocker/warning 0인지 확인한 뒤 `npm run release:operator-runbook:publish` 또는 `npm run release:operator-runbook:process:publish`로 진행합니다. 그 다음 `release:publish-assets`가 같은 production gate, baseline export verification freshness, manifest checksum을 다시 확인하고 업로드합니다. 업로드 후에는 `verify:github-release-assets:strict` 결과를 기준으로 production readiness와 readiness summary verification, publication seal을 다시 쓰고, `verify:publication-seal:published`와 `release:commercial-finalize:commercial`이 published/commercial 상태를 최종 확인합니다.

GitHub CLI가 인증되어 있으면 repository variable/secret 이름 존재 여부도 확인할 수 있습니다.

```bash
npm run release:operator-checklist:github
npm run release:operator-checklist:github:strict
```

GitHub 점검 결과는 `release/operator-readiness.github.json`에 별도로 기록되며, 일반 릴리스 evidence인 `release/operator-readiness.json`을 덮어쓰지 않습니다. 상용 배포 전에는 `release:operator-checklist:github:strict`를 사용해 GitHub Actions variable/secret 접근 권한 또는 누락을 실패 코드로 처리합니다. 이 보고서가 이미 생성되어 있으면 release decision, promotion plan, publish plan은 `github=true`, `strict=true`, blocker/warning 0개일 때만 GitHub 자동화 준비를 통과로 판단합니다. 로컬에서 보고서 생성을 필수로 강제하려면 `CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS=1`을 설정합니다. GitHub Actions에서는 이 env가 항상 켜져 있으므로 `operator-readiness.github.json`이 없거나 dirty이면 publish가 차단됩니다.

`npm run verify:release`는 strict 검증 후 `release/release-manifest.json`, `release/release-tag-report.json`, `release/installed-app-parity-report.json`, `release/ui-parity-report.json`, `release/performance-parity-report.json`, `release/macos-security-contract.json`, `release/ipc-security-report.json`, `release/security-audit-report.json`, `release/release-env-report.process.json`, `release/secret-hygiene-report.json`, `release/dmg-install-experience.json`, `release/release-launch-smoke.json`, `release/release-dmg-launch-smoke.json`, `release/update-channel-report.json`, `release/provenance.json`, `release/RELEASE_NOTES.md`, `release/SHA256SUMS.txt`, `release/SHA512SUMS.txt`, `release/sbom.cdx.json`, `release/sbom.spdx.json`, `release/evidence-report.strict.json`, `release/operator-readiness.json`, `release/signing-readiness.json`, `release/release-decision.strict.json`, `release/production-readiness-summary.json`, `release/PRODUCTION_READINESS_SUMMARY.md`, `release/production-readiness-summary-verification.strict.json`, `release/release-setup-plan.json`, `release/RELEASE_SETUP_PLAN.md`, `release/release-setup-plan-report.strict.json`, `release/release-credential-handoff.json`, `release/RELEASE_CREDENTIAL_HANDOFF.md`, `release/release-credential-handoff-report.strict.json`, `release/release-unblock-plan.json`, `release/RELEASE_UNBLOCK_PLAN.md`, `release/release-unblock-plan-report.strict.json`, `release/release-publication-seal.json`, `release/RELEASE_PUBLICATION_SEAL.md`, `release/release-publication-seal-verification.strict.json`, `release/release-promotion-plan.json`, `release/RELEASE_PROMOTION_PLAN.md`, `release/release-asset-manifest.json`, `release/asset-manifest-report.strict.json`, `release/github-release-publish-plan.json`, `release/github-release-publish-plan-report.strict.json`, `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`, `release/github-release-remediation-plan-report.strict.json`, `release/commercial-finalization-report.json`, `release/COMMERCIAL_FINALIZATION.md`, `release/commercial-finalization-report-verification.strict.json`를 생성합니다.
CI workflow의 strict preflight 단계는 먼저 `npm run release:preflight:strict:report`로 `release/preflight-report.strict.json`을 최신 진단 artifact로 쓰고, 이어서 `npm run release:preflight:strict`를 blocking gate로 실행합니다. `RELEASE_NOTES.md`의 `Status`가 `signed-and-notarized`가 아니거나 `release-decision*.json`, `release-promotion-plan.json`, `production-readiness-summary.json`, `release-publication-seal.json`의 `productionReady`가 `true`가 아니거나, 생성된 `operator-readiness.github.json`이 clean 상태가 아니면 배포용 DMG가 아닙니다.

GitHub Release에 업로드된 asset을 배포 후 검증하려면:

```bash
npm run release:publish-assets:plan
npm run release:publish-assets:plan:env
npm run verify:github-release-assets:strict:report
npm run verify:github-release-assets:strict:report:env
npm run verify:github-release-assets:strict
npm run verify:github-release-assets:strict:env
npm run release:github-release-remediation-plan
npm run release:asset-manifest
npm run verify:github-release-remediation-plan:strict:report
npm run release:github-release-remediation-apply:plan
npm run verify:github-release-remediation-apply-plan:strict:report
npm run release:asset-manifest
```

`release:publish-assets:plan`은 `release/release-asset-manifest.json` 기준의 업로드 계획을 만들고 production-ready가 아니면 실제 업로드를 막습니다. 업로드 전에는 manifest에 적힌 각 로컬 asset의 bytes, SHA-256, SHA-512를 다시 계산하고, 현재 `release-decision.strict.json`, `release-promotion-plan.json`, `release/production-readiness-summary.json`, `release/release-publication-seal.json`의 production-ready 상태, `release/baseline-freshness-report.json`의 fresh/ok 상태, `release/baseline-export-report-verification.strict.json`의 strict clean 상태, decision/promotion/readiness/baseline freshness/baseline export verification freshness를 확인합니다. Release tag는 반드시 `package.json` 버전과 같은 `desktop-v{version}`이어야 합니다. strict 검증 명령은 원격 asset을 내려받아 bytes와 SHA-256/SHA-512를 검증하고 `release/github-release-assets-report.strict.json`을 생성합니다. `npm run verify:github-release-assets:strict:report`는 같은 strict 리포트를 쓰지만 원격 drift가 있어도 진단 루프를 중단하지 않습니다. 로컬에서 현재 원격 상태만 확인할 경우에는 `npm run verify:github-release-assets` 또는 `.env.release.local` 기반의 `npm run verify:github-release-assets:env`로 warning report를 남길 수 있습니다. 이 report의 `remediation.actions`에는 누락/크기 불일치 asset을 `gh release upload --clobber`로 복구하는 required command가 들어갑니다. 다른 플랫폼용 공식 asset이 함께 올라와도 추가 asset은 자동 삭제 대상이 아니라 advisory review로만 기록합니다. `release:github-release-remediation-plan`은 이 원격 검증 report를 별도 JSON/Markdown 운영 계획으로 고정하고, production gate와 manifest 검증을 upload 전에 강제하는 guarded publish workflow도 함께 기록합니다. `verify:github-release-remediation-plan:strict:report`는 required command가 manifest allowlist의 모든 missing/mismatch asset을 덮는지, guarded workflow 순서가 publication seal production gate -> asset manifest -> publish -> strict remote verify -> published seal 검증을 포함하는지 확인합니다. `release:github-release-remediation-apply:plan`은 실제 업로드 없이 같은 required action을 로컬 manifest bytes/SHA와 다시 대조해 `release/github-release-remediation-apply-plan.json`에 기록합니다. `verify:github-release-remediation-apply-plan:strict:report`는 apply dry-run action의 local path, bytes, SHA-256/SHA-512, baseline URL guard, source freshness, secret material 비노출을 `release/github-release-remediation-apply-plan-report.strict.json`으로 검증합니다. 원격 overwrite가 필요할 때만 production gate 통과 후 `npm run release:github-release-remediation-apply` 또는 `.env.release.local` 기반의 `npm run release:github-release-remediation-apply:env`를 사용합니다.

최종 판정만 다시 쓰려면:

```bash
npm run release:decision
npm run release:decision:strict
```

릴리스 증빙만 별도로 재검증하려면 다음을 실행합니다.

```bash
npm run release:evidence:local
npm run verify:evidence
npm run release:evidence:strict
npm run verify:evidence:strict
npm run release:decision
```

strict 증빙 검증은 release notes 상태가 `signed-and-notarized`일 때만 통과합니다.
