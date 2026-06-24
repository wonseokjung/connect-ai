# Connect AI Release Operator Checklist

이 문서는 상용 배포 담당자가 서명/노타라이즈 입력을 준비하고, 동일한 릴리스 게이트를 로컬과 GitHub Actions에서 재현하기 위한 절차입니다.

## 1. 로컬 준비 상태 확인

릴리스 도구chain은 Node.js `22.12.0` 이상, `26` 미만을 요구합니다. CI는 Node `22.12.0`으로 고정되어 있고, preflight는 `package.json`, `package-lock.json`, `.node-version`, GitHub Actions workflow가 같은 engine 계약을 쓰는지 확인합니다.

```bash
cd desktop
node --version
npm --version
npm run release:operator-checklist
```

GitHub repository variable/secret 이름까지 확인하려면 GitHub CLI 인증 후 실행합니다. secret 값은 읽거나 출력하지 않고 이름 존재 여부만 확인합니다.

```bash
gh auth status
cd desktop
npm run release:operator-checklist:github
npm run release:operator-checklist:github:strict
```

strict 모드는 상용 릴리스에 필요한 입력이 빠져 있으면 실패 코드로 종료합니다.

```bash
cd desktop
npm run release:operator-runbook
npm run release:operator-checklist:strict
```

로컬/strict 결과 JSON은 `release/operator-readiness.json`에 기록됩니다. GitHub repository variable/secret 이름 점검 결과는 `release/operator-readiness.github.json`에 별도로 기록되어 릴리스 evidence 파일을 덮어쓰지 않습니다. 상용 배포 직전에는 `release:operator-checklist:github:strict`를 사용해 GitHub Actions variable/secret 접근 권한 또는 누락을 실패 코드로 처리합니다. 이 보고서가 이미 생성되어 있으면 release decision, promotion plan, publish plan은 `github=true`, `strict=true`, blocker/warning 0개일 때만 GitHub 자동화 준비를 통과로 판단합니다. 로컬에서 보고서 생성을 필수로 강제하려면 `CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS=1`을 설정합니다.

Developer ID와 notarization 입력 자체를 더 자세히 확인하려면:

```bash
cd desktop
npm run signing:doctor
npm run signing:check
```

`.env.release.local`을 사용할 경우 `npm run signing:doctor:env` 또는 `npm run signing:check:env`를 실행합니다. 실패 코드 없이 최신 strict signing 리포트만 남겨야 할 때는 `npm run signing:check:report` 또는 `npm run signing:check:report:env`를 사용합니다. 결과 JSON은 `release/signing-readiness.json`에 기록되며 secret 값은 출력하지 않습니다. `CONNECT_AI_RELEASE_AUDIT_TOKEN`을 `.env.release.local`에 넣으면 `scripts/run-with-release-env.mjs`가 값을 출력하지 않고 `GH_TOKEN`으로 전달하므로 GitHub CLI 기반 점검도 같은 파일로 재현할 수 있습니다.

현재 증빙에서 상용 배포까지 남은 조치와 실행 순서를 다시 쓰려면 다음 명령을 실행합니다.

```bash
cd desktop
npm run release:promotion-plan
```

결과는 `release/release-promotion-plan.json`과 `release/RELEASE_PROMOTION_PLAN.md`에 기록됩니다.

## 2. 인증서와 노타라이즈 입력 만들기

필요한 환경 변수 이름은 [.env.release.example](.env.release.example)에 정리되어 있습니다. 실제 값은 `.env.release.local`처럼 ignore되는 파일에 복사해서 채우고 commit하지 않습니다.
`.env.release.local`을 만들기 전에는 `npm run release:env-bootstrap && npm run verify:env-bootstrap:strict:report`로 현재 baseline SHA와 필요한 key를 반영한 secret-free bootstrap pack을 먼저 생성합니다. 결과는 `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.strict.json`에 기록됩니다. 이후 `release/release-env.local.template`을 `.env.release.local`로 복사해 값을 채우고, `*:env` 스크립트를 실행하면 값은 출력하지 않고 하위 명령에만 전달합니다. 파일을 만들기 전후에는 `npm run verify:release-env-contract`로 `.env.release.example`, env verifier, GitHub setup, CI workflow, 운영 문서가 같은 변수 계약을 공유하는지 먼저 점검합니다. 결과는 `release/release-env-contract-report.json`에 기록됩니다. 그 다음 `npm run release:env-check`로 ignored 파일 여부, 파일 권한, placeholder 잔존 여부, baseline URL/SHA 형식, base64 디코딩 가능 여부, 인증서/노타라이즈/GitHub token 입력 그룹을 점검합니다. `npm run verify:release-env-validation`은 임시 env 파일로 정상/오류 케이스를 실행해 이 검증 로직과 GitHub setup dry-run이 계속 작동하는지 확인하고 기존 release report를 복원합니다. 실제 릴리스 직전에는 `npm run release:env-check:strict`를 사용하고, CI처럼 파일 없이 secret 환경 변수만 있는 경우 `npm run release:env-check:process:strict`를 사용합니다. 실패 코드 없이 report artifact만 최신화하려면 `npm run release:env-check:strict:report` 또는 `npm run release:env-check:process:strict:report`를 사용합니다.

`npm run verify:release:secret-hygiene`는 release text artifact의 secret literal뿐 아니라 실제 repository candidate 파일 집합도 검사합니다. `desktop/node_modules`, `desktop/release`, `desktop/out`, local env, certificate, notary key 파일이 commit 후보에 들어오면 blocker로 기록합니다.

Developer ID Application 인증서를 `.p12`로 내보낸 뒤 base64로 저장합니다.

```bash
base64 -i /absolute/path/DeveloperIDApplication.p12 | pbcopy
```

App Store Connect API key `.p8`을 사용할 경우:

```bash
base64 -i /absolute/path/AuthKey_XXXX.p8 | pbcopy
```

로컬에서 직접 가져오려면:

```bash
export BUILD_CERTIFICATE_PATH="/absolute/path/DeveloperIDApplication.p12"
export P12_PASSWORD="p12-password"
export KEYCHAIN_PASSWORD="temporary-keychain-password"
export APPLE_API_KEY_BASE64="$(base64 -i /absolute/path/AuthKey_XXXX.p8)"
export APPLE_API_KEY_ID="KEYID"
export APPLE_API_ISSUER="ISSUER-UUID"
npm run signing:import
```

`.env.release.local`을 사용할 경우:

```bash
npm run release:operator-runbook
npm run release:env-check:strict
npm run release:operator-checklist:github:strict:env
npm run release:preflight:strict:report:env
npm run release:preflight:strict:env
npm run release:operator-checklist:strict:env
npm run signing:doctor:env
npm run signing:import:env
npm run verify:release:env
npm run release:publish-assets:plan:env
```

Apple ID 방식의 notarytool profile을 저장하려면:

```bash
export APPLE_ID="apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="2PX39M2HZ9"
export APPLE_KEYCHAIN_PROFILE="connect-ai-notary"
npm run signing:notary-profile
# 실패 코드 없이 readiness artifact만 남기려면:
npm run signing:notary-profile:report
```

## 3. GitHub Actions 입력

Repository variables:

- `CONNECT_AI_BASELINE_URL`: `Connect-AI-0.4.8-arm64-mac.zip` 다운로드용 `https` `.zip` URL. 현재 package version 문자열을 포함해야 합니다.
- `CONNECT_AI_BASELINE_SHA256`: 기준 ZIP SHA-256. 64자리 hex 값이어야 하며 `CONNECT_AI_ZIP_SHA256`도 함께 쓸 경우 두 값이 같아야 합니다.
- `CONNECT_AI_ZIP_SHA256`: CI workflow 입력에서 쓰는 기준 ZIP SHA-256 alias. `CONNECT_AI_BASELINE_SHA256`과 함께 설정하면 두 값이 같아야 합니다.

기준 ZIP이 아직 준비되지 않았다면 `npm run release:baseline-export && npm run verify:baseline-export:strict:report`를 실행해 `release/Connect-AI-0.4.8-baseline-arm64-mac.zip`, `release/baseline-export-report.json`, `release/baseline-export-report-verification.strict.json`, `release/BASELINE_EXPORT.md`를 생성/검증합니다. 생성된 ZIP을 CI가 접근 가능한 HTTPS 위치에 업로드하고, `release/baseline-export-report.json`의 `export.sha256` 값을 `CONNECT_AI_BASELINE_SHA256`과 `CONNECT_AI_ZIP_SHA256`에 동일하게 설정합니다.

Repository secrets:

- `CONNECT_AI_RELEASE_AUDIT_TOKEN`: GitHub Actions variable/secret 이름 목록을 점검하는 fine-grained token. repository `Variables: read`, `Secrets: read`, `Metadata: read` 권한이 필요합니다. process env에서는 같은 계약의 fallback으로 `GH_TOKEN`도 허용됩니다.
- `BUILD_CERTIFICATE_BASE64`: Developer ID Application `.p12` base64 단일 라인 값. 검증 스크립트가 디코딩 가능 여부만 확인하고 값은 출력하지 않습니다.
- `CONNECT_AI_CERTIFICATE_PATH` 또는 `CONNECT_AI_CERTIFICATE_BASE64`: `BUILD_CERTIFICATE_PATH`/`BUILD_CERTIFICATE_BASE64`의 Connect AI 전용 alias
- `P12_PASSWORD`: `.p12` 비밀번호
- `CONNECT_AI_CERTIFICATE_PASSWORD`: `P12_PASSWORD`의 Connect AI 전용 alias
- `KEYCHAIN_PASSWORD`: CI 임시 keychain 비밀번호
- `CONNECT_AI_KEYCHAIN_PASSWORD`: `KEYCHAIN_PASSWORD`의 Connect AI 전용 alias
- `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`: App Store Connect API key 방식. base64 값은 단일 라인이고 디코딩 가능해야 합니다.
- 또는 `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: Apple ID 방식
- 또는 `APPLE_KEYCHAIN_PROFILE`: runner에 미리 저장된 notarytool profile
- `CONNECT_AI_BASELINE_TOKEN`: 기준 ZIP URL이 private일 때만 필요

GitHub CLI로 설정할 때:

```bash
gh variable set CONNECT_AI_BASELINE_URL --body "https://example.com/Connect-AI-0.4.8-arm64-mac.zip"
gh variable set CONNECT_AI_BASELINE_SHA256 --body "zip-sha256"
gh secret set CONNECT_AI_RELEASE_AUDIT_TOKEN
gh secret set BUILD_CERTIFICATE_BASE64
gh secret set P12_PASSWORD
gh secret set KEYCHAIN_PASSWORD
gh secret set APPLE_API_KEY_BASE64
gh secret set APPLE_API_KEY_ID
gh secret set APPLE_API_ISSUER
```

## 4. 상용 릴리스 실행

로컬:

```bash
cd desktop
npm run release:operator-runbook
npm run release:operator-checklist:strict
npm run release:preflight:strict:report
npm run release:preflight:strict
npm run dist
npm run verify:release
```

상용 릴리스 입력이 모두 채워진 뒤에는 아래 명령으로 GitHub 설정 적용, Developer ID 인증서 import, signed/notarized DMG build, strict 검증, publish dry-run, 원격 asset drift/remediation dry-run, production readiness, release setup plan, setup plan verification, credential handoff, credential handoff verification, publication seal을 한 번에 최신화합니다. 외부 입력을 바꾸지 않고 현재 report graph만 최신 순서로 다시 수렴시키려면 `npm run release:status-refresh`를 사용하고, 결과는 `release/status-refresh-report.json`에 기록합니다. 이 refresh는 stale `connect-ai-*` temp cleanup, process env readiness, local operator readiness, signing readiness, GitHub repository setup, GitHub operator readiness, UI/동작 패리티, renderer 성능 패리티, evidence bundle, strict evidence, warning-mode 원격 asset 확인과 strict diagnostic 원격 asset 확인을 함께 실행해 `release/temp-cleanup-report.json`, `release/operator-readiness.json`, `release/signing-readiness.json`, `release/github-release-setup-report.json`, `release/ui-parity-report.json`, `release/performance-parity-report.json`, `release/provenance.json`, `release/RELEASE_NOTES.md`, `release/SHA256SUMS.txt`, `release/SHA512SUMS.txt`, `release/evidence-report.strict.json`, `release/github-release-assets-report.json`, `release/github-release-assets-report.strict.json`을 갱신하고, `release:github-release-remediation-plan`, `verify:github-release-remediation-plan`, `release:github-release-remediation-apply:plan`, `verify:github-release-remediation-apply-plan:strict:report`로 `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`, `release/github-release-remediation-apply-plan.json`, `release/github-release-remediation-apply-plan-report.strict.json`을 갱신한 뒤, `release/github-release-publish-plan.json`, `verify:github-release-publish-plan:strict:report`, `release/production-readiness-summary.json`, `verify:readiness-summary-report:strict:report`, `release/release-publication-seal.json`, `verify:setup-plan:strict:report`, `verify:publication-seal-report:strict:report`, `release/production-release-runbook-report.json`, `verify:operator-runbook-report:strict:report`, credential handoff, strict preflight diagnostic report, commercial release readiness, asset manifest 정책까지 다시 갱신합니다. `npm run verify:status-refresh-report:strict:report`는 이 수렴 리포트의 단계 순서, source report freshness, UI/성능 패리티 fingerprint, commercial release readiness freshness, downstream verifier clean 상태를 별도 `release/status-refresh-report-verification.strict.json`으로 검증합니다. `npm run release:commercial-cutover:final`은 이 검증을 먼저 수행한 뒤 상용 전환 계획과 검증 리포트를 다시 생성해 `release/COMMERCIAL_CUTOVER_PLAN.md`가 최신 수렴 검증 결과를 직접 source report로 포함하게 합니다. `npm run verify:commercial-release:strict:report`는 이 결과와 production/published gate, signing, GitHub 원격 asset, UI/성능 parity를 `release/commercial-release-readiness-report.strict.json` 하나로 집계해 상용 완료 여부와 남은 blocker를 운영자가 바로 확인하게 합니다. `release:operator-runbook:*:report` 같은 no-exit 진단 runbook은 아직 수렴 중인 자기 자신의 runbook report를 다시 source로 읽지 않도록 `commercial-finalization` 단계를 `deferred until release:status-refresh converges`로 스킵합니다. `npm run release:commercial-finalize`는 status refresh 검증, commercial cutover 검증, commercial release readiness, asset manifest를 마지막 순서로 다시 실행해 `release/commercial-finalization-report.json`, `release/COMMERCIAL_FINALIZATION.md`, `release/commercial-finalization-report-verification.strict.json`에 최종 수렴 상태와 검증 결과를 남깁니다.
`npm run verify:commercial-finalization:strict:report`는 finalization JSON/Markdown이 최신 status refresh, commercial cutover, commercial readiness, asset manifest를 그대로 반영하는지 검증합니다.

```bash
cd desktop
npm run release:operator-runbook:apply
```

GitHub Actions 또는 CI처럼 `.env.release.local` 없이 process env에 secret이 주입되는 환경에서는 아래 명령이 같은 진단을 현재 환경 변수 기준으로 수행합니다.

```bash
cd desktop
npm run release:operator-runbook:process:strict:report
```

실제 GitHub Release 업로드는 runbook 시작 시점의 오래된 리포트로 미리 스킵하지 않고, 업로드 직전에 `verify:publication-seal:production`을 실행해 `release-decision.strict.json`, `release-promotion-plan.json`, `release/production-readiness-summary.json`, `release/release-publication-seal.json`이 모두 `productionReady: true`이고 `release/baseline-freshness-report.json`이 `ok: true`, `release/baseline-export-report-verification.strict.json`이 blocker/warning 0인지 확인한 뒤에만 진행합니다. 그 다음 `release:publish-assets`가 같은 production gate, baseline export verification freshness, manifest checksum을 다시 확인하고 업로드합니다. 업로드 후에는 `verify:github-release-assets:strict` 결과를 기준으로 production readiness와 publication seal을 다시 쓰고, `verify:publication-seal:published`와 `release:commercial-finalize:commercial`이 `publishedReleaseReady: true` 및 `commercialReady: true`까지 최종 확인합니다.

```bash
cd desktop
npm run release:operator-runbook:publish
# CI/process env 환경에서는:
npm run release:operator-runbook:process:publish
```

GitHub Actions:

```bash
git tag desktop-v0.4.8
git push origin desktop-v0.4.8
```

또는 `Build Connect AI Desktop` workflow를 수동 실행하고 `publish_release=true`를 선택합니다.

GitHub Release 업로드 후 원격 asset 목록을 직접 확인하려면:

```bash
cd desktop
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

Strict 검증은 원격 asset의 bytes와 SHA-256/SHA-512를 `release/release-asset-manifest.json`과 대조합니다. `verify:github-release-assets:strict:report`는 같은 `release/github-release-assets-report.strict.json`을 쓰되 원격 drift가 있어도 진단 루프를 중단하지 않습니다. 로컬에서 현재 원격 상태만 보고서로 남기려면 `npm run verify:github-release-assets` 또는 `.env.release.local` 기반의 `npm run verify:github-release-assets:env`를 사용합니다. 이 로컬 명령은 mismatch를 warning으로 기록하고 `release/github-release-assets-report.json`을 생성합니다. 보고서의 `remediation.actions`에는 누락/크기 불일치 asset을 `gh release upload --clobber`로 맞추는 required command가 들어가며, 현재 manifest에 없는 다른 플랫폼 asset은 의도된 멀티 플랫폼 릴리스인지 확인해야 하는 advisory review로만 기록합니다. `release:github-release-remediation-plan`은 required command, advisory review, guarded publish workflow를 `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`로 고정합니다. 기본 복구 경로는 raw `gh` command가 아니라 `verify:publication-seal:production`, `verify:asset-manifest`, `release:publish-assets`, strict remote asset verification, `verify:publication-seal:published` 순서가 포함된 guarded workflow입니다. `verify:github-release-remediation-plan:strict:report`는 plan의 command coverage, guarded workflow order, manifest allowlist, secret material 비노출을 검증합니다. `release:github-release-remediation-apply:plan`은 실제 업로드 없이 같은 required action을 로컬 manifest bytes/SHA와 다시 대조해 `release/github-release-remediation-apply-plan.json`에 기록합니다. `verify:github-release-remediation-apply-plan:strict:report`는 apply dry-run action의 local path, bytes, SHA-256/SHA-512, baseline URL guard, source freshness, secret material 비노출을 `release/github-release-remediation-apply-plan-report.strict.json`으로 검증합니다. 원격 overwrite가 필요할 때만 production gate 통과 후 `npm run release:github-release-remediation-apply` 또는 `.env.release.local` 기반의 `npm run release:github-release-remediation-apply:env`를 사용합니다.

실제 업로드는 `release/release-asset-manifest.json`을 기준으로 수행합니다. 업로드 전 계획과 production gate를 확인하려면:

```bash
cd desktop
npm run release:publish-assets:plan
npm run release:publish-assets:plan:env
```

Release tag는 `package.json`의 버전과 같은 `desktop-v{version}`이어야 하며, 다른 tag로 실행하면 publish plan 단계에서 차단됩니다. Publish plan은 업로드 전 각 로컬 asset의 bytes, SHA-256, SHA-512를 manifest와 다시 대조하고, 현재 `release-decision.strict.json`, `release-promotion-plan.json`, `release/production-readiness-summary.json`, `release/release-publication-seal.json`의 production-ready 상태, `release/baseline-freshness-report.json`의 fresh/ok 상태, `release/baseline-export-report-verification.strict.json`의 strict clean 상태, decision/promotion/readiness/baseline freshness/baseline export verification freshness를 확인합니다. GitHub Actions에서는 `CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS=1`이 항상 켜져 있으므로 `release/operator-readiness.github.json`이 없거나 dirty이면 publish도 차단됩니다.

## 5. 릴리스 증빙

`npm run verify:release`는 strict 검증 후 아래 파일을 생성하고 최종 operator readiness를 다시 기록합니다.

릴리스 DMG의 `app.asar`는 기준 앱과 byte-for-byte로 같거나, `release/release-manifest.json`의 `release.appAsarPolicy`에서 승인된 main-process 보안 하드닝 및 메일 의존성 보안 업데이트 delta여야 합니다. 현재 배포 구조는 빌드된 `app.asar`를 보존해 외부 URL/workspace path 하드닝과 `imapflow@1.4.1`, `mailparser@3.9.10`, `nodemailer@9.0.1` 보안 오버레이를 포함하고, 기준 앱의 `app.asar.unpacked` native/unpacked 리소스와 top-level `Resources/llamacpp` 실행 리소스를 복원해 설치 앱 수준의 UI/동작 패리티를 유지합니다. `release/baseline-freshness-report.json`, `release/dmg-install-experience.json`, `release/provenance.json`, `release/evidence-report*.json`은 같은 `release.appAsarPolicy`를 기준으로 판정합니다.

- `release/release-manifest.json`
- `release/preflight-report.strict.json` (CI preflight 후)
- `release/temp-cleanup-report.json` (status refresh 첫 단계의 stale temp cleanup 후)
- `release/status-refresh-report.json` (status refresh 후)
- `release/status-refresh-report-verification.strict.json` (status refresh 검증 후)
- `release/commercial-release-readiness-report.strict.json` (상용 release readiness 집계 후)
- `release/commercial-finalization-report.json` (상용 finalization 수렴 후)
- `release/COMMERCIAL_FINALIZATION.md`
- `release/commercial-finalization-report-verification.strict.json`
- `release/release-tag-report.json`
- `release/installed-app-parity-report.json` (설치 앱 parity, 승인된 main-process 보안 delta, 메일 의존성 보안 오버레이)
- `release/ui-parity-report.json` (surgery card 및 full-page screenshot similarity 99% 이상)
- `release/performance-parity-report.json`
- `release/macos-security-contract.json`
- `release/ipc-security-report.json` (IPC security runtime workspace/URL guard)
- `release/security-audit-report.json`
- `release/release-env-contract-report.json` (release env 변수 계약 정합성 점검)
- `release/release-env-bootstrap.json` / `release/RELEASE_ENV_BOOTSTRAP.md` / `release/release-env.local.template` / `release/release-env-bootstrap-report.strict.json` (secret-free local env bootstrap pack)
- `release/release-env-report.process.json` (CI 환경 변수 기반 strict release env 점검)
- `release/secret-hygiene-report.json`
- `release/dmg-install-experience.json`
- `release/release-launch-smoke.json`
- `release/release-dmg-launch-smoke.json`
- `release/update-channel-report.json`
- `release/provenance.json`
- `release/RELEASE_NOTES.md`
- `release/SHA256SUMS.txt`
- `release/SHA512SUMS.txt`
- `release/sbom.cdx.json`
- `release/sbom.spdx.json`
- `release/evidence-report.strict.json`
- `release/operator-readiness.json`
- `release/operator-readiness.github.json` (GitHub repository variable/secret 이름 점검 후)
- `release/signing-readiness.json`
- `release/production-release-runbook-report.json`
- `release/production-release-runbook-report-verification.strict.json`
- `release/production-readiness-summary.json`
- `release/PRODUCTION_READINESS_SUMMARY.md`
- `release/production-readiness-summary-verification.strict.json`
- `release/release-setup-plan.json`
- `release/RELEASE_SETUP_PLAN.md`
- `release/release-setup-plan-report.strict.json`
- `release/release-unblock-plan.json`
- `release/RELEASE_UNBLOCK_PLAN.md`
- `release/release-unblock-plan-report.strict.json`
- `release/release-credential-handoff.json`
- `release/RELEASE_CREDENTIAL_HANDOFF.md`
- `release/release-credential-handoff-report.strict.json`
- `release/release-publication-seal.json`
- `release/RELEASE_PUBLICATION_SEAL.md`
- `release/release-publication-seal-verification.strict.json`
- `release/release-decision.strict.json`
- `release/release-promotion-plan.json`
- `release/RELEASE_PROMOTION_PLAN.md`
- `release/release-asset-manifest.json`
- `release/asset-manifest-report.strict.json`
- `release/github-release-publish-plan.json` (GitHub Release 업로드 후)
- `release/github-release-publish-plan-report.strict.json` (GitHub Release 업로드 계획 검증)
- `release/github-release-assets-report.strict.json` (GitHub Release 업로드 후)
- `release/github-release-remediation-plan.json` (GitHub Release 검증 후)
- `release/GITHUB_RELEASE_REMEDIATION_PLAN.md` (GitHub Release 검증 후)
- `release/github-release-remediation-plan-report.strict.json` (GitHub Release 검증 후)
- `release/github-release-remediation-apply-plan.json` (GitHub Release remediation dry-run 후)
- `release/github-release-remediation-apply-plan-report.strict.json` (GitHub Release remediation dry-run 검증 후)

`RELEASE_NOTES.md`의 `Status`가 `signed-and-notarized`가 아니거나 `release-decision*.json`, `release-promotion-plan.json`, `production-readiness-summary.json`, `release-publication-seal.json`의 `productionReady`가 `true`가 아니거나, 생성된 `operator-readiness.github.json`이 clean 상태가 아니면 배포용으로 사용하지 않습니다.
`release/secret-hygiene-report.json`, `release/release-env-contract-report.json`, `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.json`, `release/release-env-bootstrap-report.strict.json`, `release/status-refresh-report.json`, `release/status-refresh-report-verification.strict.json`, `release/github-release-assets-report.strict.json`, `release/github-release-publish-plan.json`, `release/github-release-publish-plan-report.json`, `release/github-release-publish-plan-report.strict.json`, `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`, `release/github-release-remediation-plan-report.json`, `release/github-release-remediation-plan-report.strict.json`, `release/github-release-remediation-apply-plan.json`, `release/preflight-report.strict.json`, `release/github-release-setup-report.json`, `release/production-release-runbook-report.json`, `release/production-release-runbook-report-verification.strict.json`, `release/production-readiness-summary.json`, `release/PRODUCTION_READINESS_SUMMARY.md`, `release/production-readiness-summary-verification.strict.json`, `release/engineering-readiness-report.json`, `release/ENGINEERING_READINESS.md`, `release/commercial-cutover-plan.json`, `release/COMMERCIAL_CUTOVER_PLAN.md`, `release/commercial-cutover-plan-report.json`, `release/commercial-cutover-plan-report.strict.json`, `release/release-setup-plan.json`, `release/RELEASE_SETUP_PLAN.md`, `release/release-setup-plan-report.json`, `release/release-setup-plan-report.strict.json`, `release/release-unblock-plan.json`, `release/RELEASE_UNBLOCK_PLAN.md`, `release/release-unblock-plan-report.json`, `release/release-unblock-plan-report.strict.json`, `release/release-credential-handoff.json`, `release/RELEASE_CREDENTIAL_HANDOFF.md`, `release/release-credential-handoff-report.json`, `release/release-credential-handoff-report.strict.json`, `release/release-publication-seal.json`, `release/RELEASE_PUBLICATION_SEAL.md`, `release/release-publication-seal-verification.strict.json`, `release/baseline-freshness-report.json`, `release/BASELINE_FRESHNESS.md`, `release/baseline-export-report.json`, `release/baseline-export-report-verification.json`, `release/baseline-export-report-verification.strict.json`, `release/BASELINE_EXPORT.md`, `release-*-launch-smoke.log`, `release/release-env-report.process.json`는 CI-only diagnostic이므로 GitHub Release 사용자 자산으로 올리지 않고 업로드 경로와 파일 존재 여부만 검증합니다.
CI workflow는 release env check 실패 시 `connect-ai-desktop-release-env`, strict preflight 실패 시 `connect-ai-desktop-preflight` artifact를 `always()`로 업로드하며, `release/release-env-contract-report.json`, `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.strict.json`, `release/status-refresh-report.json`, `release/status-refresh-report-verification.strict.json`, `release/github-release-assets-report.strict.json`, `release/github-release-publish-plan.json`, `release/github-release-publish-plan-report.strict.json`, `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`, `release/github-release-remediation-plan-report.json`, `release/github-release-setup-report.json`, `release/production-release-runbook-report.json`, `release/production-release-runbook-report-verification.strict.json`, `release/production-readiness-summary.json`, `release/PRODUCTION_READINESS_SUMMARY.md`, `release/production-readiness-summary-verification.strict.json`, `release/engineering-readiness-report.json`, `release/ENGINEERING_READINESS.md`, `release/commercial-cutover-plan.json`, `release/COMMERCIAL_CUTOVER_PLAN.md`, `release/commercial-cutover-plan-report.json`, `release/commercial-cutover-plan-report.strict.json`, `release/release-setup-plan.json`, `release/RELEASE_SETUP_PLAN.md`, `release/release-setup-plan-report.strict.json`, `release/release-credential-handoff.json`, `release/RELEASE_CREDENTIAL_HANDOFF.md`, `release/release-credential-handoff-report.json`, `release/release-unblock-plan.json`, `release/RELEASE_UNBLOCK_PLAN.md`, `release/release-unblock-plan-report.json`, `release/release-publication-seal.json`, `release/RELEASE_PUBLICATION_SEAL.md`, `release/baseline-freshness-report.json`, `release/BASELINE_FRESHNESS.md`, `release/baseline-export-report.json`, `release/baseline-export-report-verification.strict.json`, `release/BASELINE_EXPORT.md`도 preflight diagnostic으로 보존합니다.

증빙 파일의 checksum, SBOM, release notes 상태를 다시 검증하려면:

```bash
npm run release:evidence:local
npm run verify:evidence
npm run release:evidence:strict
npm run verify:evidence:strict
npm run release:decision
```
