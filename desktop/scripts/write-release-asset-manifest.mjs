import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const outPath = path.join(releaseDir, 'release-asset-manifest.json');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(desktopDir, relativePath), 'utf8'));
}

function sha(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
}

function fileInfo(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) {
    return {
      path: relativePath,
      exists: false,
    };
  }
  return {
    path: relativePath,
    exists: true,
    bytes: fs.statSync(file).size,
    sha256: sha(file, 'sha256'),
    sha512: sha(file, 'sha512'),
  };
}

function diagnosticFileInfo(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) {
    return {
      path: relativePath,
      exists: false,
      volatile: true,
    };
  }
  return {
    path: relativePath,
    exists: true,
    volatile: true,
    observedBytes: fs.statSync(file).size,
  };
}

function main() {
  const pkg = readJson('package.json');
  const decision = fs.existsSync(path.join(releaseDir, 'release-decision.json'))
    ? readJson('release/release-decision.json')
    : null;
  const strictDecision = fs.existsSync(path.join(releaseDir, 'release-decision.strict.json'))
    ? readJson('release/release-decision.strict.json')
    : null;
  const promotion = fs.existsSync(path.join(releaseDir, 'release-promotion-plan.json'))
    ? readJson('release/release-promotion-plan.json')
    : null;

  const githubReleaseAssets = [
    `release/Connect-AI-${pkg.version}-mac-arm64.dmg`,
    `release/Connect-AI-${pkg.version}-mac-arm64.dmg.blockmap`,
    'release/latest-mac.yml',
    'release/release-manifest.json',
    'release/release-tag-report.json',
    'release/installed-app-parity-report.json',
    'release/ui-parity-report.json',
    'release/performance-parity-report.json',
    'release/macos-security-contract.json',
    'release/ipc-security-report.json',
    'release/security-audit-report.json',
    'release/dmg-install-experience.json',
    'release/release-launch-smoke.json',
    'release/release-dmg-launch-smoke.json',
    'release/update-channel-report.json',
    'release/provenance.json',
    'release/RELEASE_NOTES.md',
    'release/SHA256SUMS.txt',
    'release/SHA512SUMS.txt',
    'release/sbom.cdx.json',
    'release/sbom.spdx.json',
    'release/evidence-report.strict.json',
    'release/operator-readiness.json',
    fs.existsSync(path.join(releaseDir, 'operator-readiness.github.json')) ||
    process.env.CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS === '1'
      ? 'release/operator-readiness.github.json'
      : null,
    'release/signing-readiness.json',
    'release/release-decision.strict.json',
    'release/release-promotion-plan.json',
    'release/RELEASE_PROMOTION_PLAN.md',
  ].filter(Boolean);
  const ciOnlyArtifacts = [
    'release/secret-hygiene-report.json',
    fs.existsSync(path.join(releaseDir, 'release-env-contract-report.json'))
      ? 'release/release-env-contract-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-env-bootstrap.json'))
      ? 'release/release-env-bootstrap.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'RELEASE_ENV_BOOTSTRAP.md'))
      ? 'release/RELEASE_ENV_BOOTSTRAP.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-env.local.template'))
      ? 'release/release-env.local.template'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-env-bootstrap-report.json'))
      ? 'release/release-env-bootstrap-report.json'
      : null,
	    fs.existsSync(path.join(releaseDir, 'release-env-bootstrap-report.strict.json'))
	      ? 'release/release-env-bootstrap-report.strict.json'
	      : null,
	    fs.existsSync(path.join(releaseDir, 'temp-cleanup-report.json'))
	      ? 'release/temp-cleanup-report.json'
	      : null,
	    fs.existsSync(path.join(releaseDir, 'status-refresh-report.json'))
	      ? 'release/status-refresh-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'status-refresh-report-verification.strict.json'))
      ? 'release/status-refresh-report-verification.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-assets-report.strict.json'))
      ? 'release/github-release-assets-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-remediation-plan.json'))
      ? 'release/github-release-remediation-plan.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'GITHUB_RELEASE_REMEDIATION_PLAN.md'))
      ? 'release/GITHUB_RELEASE_REMEDIATION_PLAN.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-remediation-plan-report.json'))
      ? 'release/github-release-remediation-plan-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-remediation-plan-report.strict.json'))
      ? 'release/github-release-remediation-plan-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-remediation-apply-plan.json'))
      ? 'release/github-release-remediation-apply-plan.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-remediation-apply-plan-report.json'))
      ? 'release/github-release-remediation-apply-plan-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-remediation-apply-plan-report.strict.json'))
      ? 'release/github-release-remediation-apply-plan-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'remote-baseline-candidate-report.strict.json'))
      ? 'release/remote-baseline-candidate-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'remote-baseline-candidate-report-verification.strict.json'))
      ? 'release/remote-baseline-candidate-report-verification.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'REMOTE_BASELINE_CANDIDATE.md'))
      ? 'release/REMOTE_BASELINE_CANDIDATE.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'remote-baseline-approval-report.strict.json'))
      ? 'release/remote-baseline-approval-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'REMOTE_BASELINE_APPROVAL.md'))
      ? 'release/REMOTE_BASELINE_APPROVAL.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'preflight-report.strict.json'))
      ? 'release/preflight-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-setup-plan.json'))
      ? 'release/release-setup-plan.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'RELEASE_SETUP_PLAN.md'))
      ? 'release/RELEASE_SETUP_PLAN.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-setup-plan-report.json'))
      ? 'release/release-setup-plan-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-setup-plan-report.strict.json'))
      ? 'release/release-setup-plan-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-unblock-plan.json'))
      ? 'release/release-unblock-plan.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'RELEASE_UNBLOCK_PLAN.md'))
      ? 'release/RELEASE_UNBLOCK_PLAN.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-unblock-plan-report.json'))
      ? 'release/release-unblock-plan-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-unblock-plan-report.strict.json'))
      ? 'release/release-unblock-plan-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-credential-handoff.json'))
      ? 'release/release-credential-handoff.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'RELEASE_CREDENTIAL_HANDOFF.md'))
      ? 'release/RELEASE_CREDENTIAL_HANDOFF.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-credential-handoff-report.json'))
      ? 'release/release-credential-handoff-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-credential-handoff-report.strict.json'))
      ? 'release/release-credential-handoff-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-publication-seal.json'))
      ? 'release/release-publication-seal.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'RELEASE_PUBLICATION_SEAL.md'))
      ? 'release/RELEASE_PUBLICATION_SEAL.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'release-publication-seal-verification.strict.json'))
      ? 'release/release-publication-seal-verification.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'baseline-freshness-report.json'))
      ? 'release/baseline-freshness-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'BASELINE_FRESHNESS.md'))
      ? 'release/BASELINE_FRESHNESS.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'baseline-export-report.json'))
      ? 'release/baseline-export-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'BASELINE_EXPORT.md'))
      ? 'release/BASELINE_EXPORT.md'
      : null,
    'release/release-launch-smoke.log',
    'release/release-dmg-launch-smoke.log',
    fs.existsSync(path.join(releaseDir, 'release-env-report.process.json'))
      ? 'release/release-env-report.process.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-setup-report.json'))
      ? 'release/github-release-setup-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'production-release-runbook-report.json'))
      ? 'release/production-release-runbook-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'production-release-runbook-report-verification.strict.json'))
      ? 'release/production-release-runbook-report-verification.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'production-readiness-summary.json'))
      ? 'release/production-readiness-summary.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'PRODUCTION_READINESS_SUMMARY.md'))
      ? 'release/PRODUCTION_READINESS_SUMMARY.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'production-readiness-summary-verification.strict.json'))
      ? 'release/production-readiness-summary-verification.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'engineering-readiness-report.json'))
      ? 'release/engineering-readiness-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'ENGINEERING_READINESS.md'))
      ? 'release/ENGINEERING_READINESS.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'commercial-cutover-plan.json'))
      ? 'release/commercial-cutover-plan.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'COMMERCIAL_CUTOVER_PLAN.md'))
      ? 'release/COMMERCIAL_CUTOVER_PLAN.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'commercial-cutover-plan-report.json'))
      ? 'release/commercial-cutover-plan-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'commercial-cutover-plan-report.strict.json'))
      ? 'release/commercial-cutover-plan-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'commercial-release-readiness-report.strict.json'))
      ? 'release/commercial-release-readiness-report.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'commercial-finalization-report.json'))
      ? 'release/commercial-finalization-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'COMMERCIAL_FINALIZATION.md'))
      ? 'release/COMMERCIAL_FINALIZATION.md'
      : null,
    fs.existsSync(path.join(releaseDir, 'commercial-finalization-report-verification.strict.json'))
      ? 'release/commercial-finalization-report-verification.strict.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-publish-plan.json'))
      ? 'release/github-release-publish-plan.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-publish-plan-report.json'))
      ? 'release/github-release-publish-plan-report.json'
      : null,
    fs.existsSync(path.join(releaseDir, 'github-release-publish-plan-report.strict.json'))
      ? 'release/github-release-publish-plan-report.strict.json'
      : null,
  ].filter(Boolean);

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
    },
    status: {
      localDecision: decision
        ? {
            status: decision.status,
            productionReady: Boolean(decision.productionReady),
            localCandidateReady: Boolean(decision.localCandidateReady),
          }
        : null,
      strictDecision: strictDecision
        ? {
            status: strictDecision.status,
            productionReady: Boolean(strictDecision.productionReady),
            localCandidateReady: Boolean(strictDecision.localCandidateReady),
          }
        : null,
      promotion: promotion
        ? {
            status: promotion.status,
            productionReady: Boolean(promotion.productionReady),
            localCandidateReady: Boolean(promotion.localCandidateReady),
          }
        : null,
    },
    manifestFile: 'release/release-asset-manifest.json',
    selfHashExcluded: true,
    githubReleaseAssets: githubReleaseAssets.map(fileInfo),
    ciOnlyArtifacts: ciOnlyArtifacts.map(diagnosticFileInfo),
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${path.relative(desktopDir, outPath)}`);
}

main();
