import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const secretHygienePath = 'release/secret-hygiene-report.json';
const securityAuditPath = 'release/security-audit-report.json';
const installedAppParityPath = 'release/installed-app-parity-report.json';
const releaseEnvContractPath = 'release/release-env-contract-report.json';
const releaseEnvBootstrapPaths = [
  'release/release-env-bootstrap.json',
  'release/RELEASE_ENV_BOOTSTRAP.md',
  'release/release-env.local.template',
  'release/release-env-bootstrap-report.json',
  'release/release-env-bootstrap-report.strict.json',
];
const tempCleanupPath = 'release/temp-cleanup-report.json';
const statusRefreshReportPath = 'release/status-refresh-report.json';
const statusRefreshVerificationPath = 'release/status-refresh-report-verification.strict.json';
const githubReleaseAssetsReportStrictPath = 'release/github-release-assets-report.strict.json';
const githubReleaseRemediationPaths = [
  'release/github-release-remediation-plan.json',
  'release/GITHUB_RELEASE_REMEDIATION_PLAN.md',
  'release/github-release-remediation-plan-report.json',
  'release/github-release-remediation-plan-report.strict.json',
  'release/github-release-remediation-apply-plan.json',
  'release/github-release-remediation-apply-plan-report.json',
  'release/github-release-remediation-apply-plan-report.strict.json',
];
const githubReleasePublishPlanPaths = [
  'release/github-release-publish-plan.json',
  'release/github-release-publish-plan-report.json',
  'release/github-release-publish-plan-report.strict.json',
];
const remoteBaselineDiagnosticPaths = [
  'release/remote-baseline-candidate-report.strict.json',
  'release/remote-baseline-candidate-report-verification.strict.json',
  'release/REMOTE_BASELINE_CANDIDATE.md',
  'release/remote-baseline-approval-report.strict.json',
  'release/REMOTE_BASELINE_APPROVAL.md',
];
const preflightStrictPath = 'release/preflight-report.strict.json';
const releaseEnvProcessPath = 'release/release-env-report.process.json';
const githubSetupReportPath = 'release/github-release-setup-report.json';
const productionRunbookPath = 'release/production-release-runbook-report.json';
const productionRunbookVerificationPath = 'release/production-release-runbook-report-verification.strict.json';
const productionReadinessPaths = [
  'release/production-readiness-summary.json',
  'release/PRODUCTION_READINESS_SUMMARY.md',
  'release/production-readiness-summary-verification.strict.json',
];
const engineeringReadinessPaths = [
  'release/engineering-readiness-report.json',
  'release/ENGINEERING_READINESS.md',
];
const commercialCutoverPaths = [
  'release/commercial-cutover-plan.json',
  'release/COMMERCIAL_CUTOVER_PLAN.md',
  'release/commercial-cutover-plan-report.json',
  'release/commercial-cutover-plan-report.strict.json',
];
const commercialReleaseReadinessPath = 'release/commercial-release-readiness-report.strict.json';
const commercialFinalizationPaths = [
  'release/commercial-finalization-report.json',
  'release/COMMERCIAL_FINALIZATION.md',
  'release/commercial-finalization-report-verification.strict.json',
];
const setupPlanPaths = [
  'release/release-setup-plan.json',
  'release/RELEASE_SETUP_PLAN.md',
  'release/release-setup-plan-report.json',
  'release/release-setup-plan-report.strict.json',
];
const unblockPlanPaths = [
  'release/release-unblock-plan.json',
  'release/RELEASE_UNBLOCK_PLAN.md',
  'release/release-unblock-plan-report.json',
  'release/release-unblock-plan-report.strict.json',
];
const credentialHandoffPaths = [
  'release/release-credential-handoff.json',
  'release/RELEASE_CREDENTIAL_HANDOFF.md',
  'release/release-credential-handoff-report.json',
  'release/release-credential-handoff-report.strict.json',
];
const publicationSealPaths = [
  'release/release-publication-seal.json',
  'release/RELEASE_PUBLICATION_SEAL.md',
  'release/release-publication-seal-verification.strict.json',
];
const baselineFreshnessPaths = [
  'release/baseline-freshness-report.json',
  'release/BASELINE_FRESHNESS.md',
];
const baselineExportPaths = [
  'release/baseline-export-report.json',
  'release/baseline-export-report-verification.json',
  'release/baseline-export-report-verification.strict.json',
  'release/BASELINE_EXPORT.md',
];
const launchLogPaths = ['release/release-launch-smoke.log', 'release/release-dmg-launch-smoke.log'];
const ciOnlyPaths = [secretHygienePath, releaseEnvContractPath, ...releaseEnvBootstrapPaths, tempCleanupPath, statusRefreshReportPath, statusRefreshVerificationPath, githubReleaseAssetsReportStrictPath, ...githubReleasePublishPlanPaths, ...githubReleaseRemediationPaths, ...remoteBaselineDiagnosticPaths, preflightStrictPath, githubSetupReportPath, productionRunbookPath, productionRunbookVerificationPath, ...productionReadinessPaths, ...engineeringReadinessPaths, ...commercialCutoverPaths, commercialReleaseReadinessPath, ...commercialFinalizationPaths, ...setupPlanPaths, ...unblockPlanPaths, ...credentialHandoffPaths, ...publicationSealPaths, ...baselineFreshnessPaths, ...baselineExportPaths, ...launchLogPaths, releaseEnvProcessPath];

const args = new Set(process.argv.slice(2));
const normalizePromotion = args.has('--promotion') || (!args.has('--manifest') && !args.has('--verify'));
const normalizeManifest = args.has('--manifest') || (!args.has('--promotion') && !args.has('--verify'));
const verifyMode = args.has('--verify');
const strict = args.has('--strict');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(desktopDir, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(desktopDir, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function sha(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
}

function fileInfo(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return { path: relativePath, exists: false };
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
  if (!fs.existsSync(file)) return { path: relativePath, exists: false, volatile: true };
  return {
    path: relativePath,
    exists: true,
    volatile: true,
    observedBytes: fs.statSync(file).size,
  };
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function normalizeMarkdownListSection(markdown, heading, transform) {
  const pattern = new RegExp(`(## ${heading}\\n\\n)([\\s\\S]*?)(\\n\\n## )`);
  return markdown.replace(pattern, (match, prefix, body, suffix) => {
    const lines = body.split('\n').filter((line) => line.trim().length > 0);
    return `${prefix}${transform(lines).join('\n')}${suffix}`;
  });
}

function normalizePromotionPlan() {
  const jsonPath = 'release/release-promotion-plan.json';
  const markdownPath = 'release/RELEASE_PROMOTION_PLAN.md';
  const fullJsonPath = path.join(desktopDir, jsonPath);
  if (!fs.existsSync(fullJsonPath)) return false;

  const plan = readJson(jsonPath);
  plan.artifactsToPromote = (plan.artifactsToPromote || []).filter((entry) => entry !== secretHygienePath);
  plan.ciOnlyDiagnostics = unique([...ciOnlyPaths, ...(plan.ciOnlyDiagnostics || [])]);
  writeJson(jsonPath, plan);

  const fullMarkdownPath = path.join(desktopDir, markdownPath);
  if (fs.existsSync(fullMarkdownPath)) {
    let markdown = fs.readFileSync(fullMarkdownPath, 'utf8');
    markdown = markdown.replace(
      /- secret hygiene: PASS - 0 blocker\(s\), 0 warning\(s\); GitHub Release asset, checksum-pinned/g,
      '- secret hygiene: PASS - 0 blocker(s), 0 warning(s); CI-only diagnostic, not a GitHub Release asset',
    );
    markdown = normalizeMarkdownListSection(markdown, 'GitHub Release Assets', (lines) =>
      lines.filter((line) => !ciOnlyPaths.some((relativePath) => line === `- \`${relativePath}\``)),
    );
    markdown = normalizeMarkdownListSection(markdown, 'CI-Only Diagnostics', (lines) =>
      unique([...ciOnlyPaths.map((relativePath) => `- \`${relativePath}\``), ...lines]),
    );
    fs.writeFileSync(fullMarkdownPath, markdown);
  }
  return true;
}

function normalizeAssetManifest() {
  const manifestPath = 'release/release-asset-manifest.json';
  const fullManifestPath = path.join(desktopDir, manifestPath);
  if (!fs.existsSync(fullManifestPath)) return false;

  const manifest = readJson(manifestPath);
  const releaseAssetPaths = (manifest.githubReleaseAssets || []).map((asset) => asset.path);
  const normalizedReleasePaths = releaseAssetPaths.filter((entry) => !ciOnlyPaths.includes(entry));
  manifest.githubReleaseAssets = normalizedReleasePaths.map(fileInfo);
  manifest.ciOnlyArtifacts = ciOnlyPaths
    .filter((relativePath) => fs.existsSync(path.join(desktopDir, relativePath)) || launchLogPaths.includes(relativePath))
    .map(diagnosticFileInfo);
  writeJson(manifestPath, manifest);
  return true;
}

function replaceInFile(relativePath, replacements) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return false;
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  for (const [from, to] of replacements) {
    text = text.replace(from, to);
  }
  if (text === before) return false;
  fs.writeFileSync(file, text);
  return true;
}

function normalizeOperatorDocs() {
  const staleSecretReleaseAssetLine = [
    '`release/secret-hygiene-report.json`도 bytes, SHA-256, SHA-512가 고정된 ',
    ['GitHub Release', 'asset으로'].join(' '),
    ' 업로드합니다.',
  ].join('');
  const staleSecretEvidenceLine = [
    '`release/secret-hygiene-report.json`에는 release용 env 파일, P12/P8 인증서 파일 ignore 규칙, release text artifact 내 민감 env 값/GitHub token/private key marker 노출 여부가 값 없이 기록되며 ',
    ['GitHub Release', 'asset으로'].join(' '),
    ' bytes, SHA-256, SHA-512가 고정됩니다.',
  ].join('');
  const staleOperatorSecretLine = [
    '`release/secret-hygiene-report.json`은 ',
    ['Release asset manifest', '에서 bytes'].join(''),
    ', SHA-256, SHA-512를 고정하는 배포 증적입니다.\n',
  ].join('');
  const currentSecretEvidenceLine =
    '`release/secret-hygiene-report.json`에는 release용 env 파일, P12/P8 인증서 파일 ignore 규칙, release text artifact 내 민감 env 값/GitHub token/private key marker 노출 여부가 값 없이 기록되며 CI-only diagnostic으로 보존됩니다.';
  const currentCiOnlyLine =
    '`release/secret-hygiene-report.json`, `release/release-env-contract-report.json`, `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.json`, `release/release-env-bootstrap-report.strict.json`, `release/temp-cleanup-report.json`, `release/status-refresh-report.json`, `release/status-refresh-report-verification.strict.json`, `release/github-release-assets-report.strict.json`, `release/github-release-publish-plan.json`, `release/github-release-publish-plan-report.json`, `release/github-release-publish-plan-report.strict.json`, `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`, `release/github-release-remediation-plan-report.json`, `release/github-release-remediation-plan-report.strict.json`, `release/github-release-remediation-apply-plan.json`, `release/github-release-remediation-apply-plan-report.json`, `release/github-release-remediation-apply-plan-report.strict.json`, `release/preflight-report.strict.json`, `release/github-release-setup-report.json`, `release/production-release-runbook-report.json`, `release/production-release-runbook-report-verification.strict.json`, `release/production-readiness-summary.json`, `release/PRODUCTION_READINESS_SUMMARY.md`, `release/production-readiness-summary-verification.strict.json`, `release/engineering-readiness-report.json`, `release/ENGINEERING_READINESS.md`, `release/commercial-cutover-plan.json`, `release/COMMERCIAL_CUTOVER_PLAN.md`, `release/commercial-cutover-plan-report.json`, `release/commercial-cutover-plan-report.strict.json`, `release/commercial-release-readiness-report.strict.json`, `release/commercial-finalization-report.json`, `release/COMMERCIAL_FINALIZATION.md`, `release/commercial-finalization-report-verification.strict.json`, `release/release-setup-plan.json`, `release/RELEASE_SETUP_PLAN.md`, `release/release-setup-plan-report.json`, `release/release-setup-plan-report.strict.json`, `release/release-unblock-plan.json`, `release/RELEASE_UNBLOCK_PLAN.md`, `release/release-unblock-plan-report.json`, `release/release-unblock-plan-report.strict.json`, `release/release-credential-handoff.json`, `release/RELEASE_CREDENTIAL_HANDOFF.md`, `release/release-credential-handoff-report.json`, `release/release-credential-handoff-report.strict.json`, `release/release-publication-seal.json`, `release/RELEASE_PUBLICATION_SEAL.md`, `release/release-publication-seal-verification.strict.json`, `release/baseline-freshness-report.json`, `release/BASELINE_FRESHNESS.md`, `release/baseline-export-report.json`, `release/baseline-export-report-verification.json`, `release/baseline-export-report-verification.strict.json`, `release/BASELINE_EXPORT.md`, `release-*-launch-smoke.log`, `release/release-env-report.process.json`은 CI-only diagnostic이므로 존재와 workflow 업로드 경로만 검증하고 checksum 고정 대상에서는 제외합니다.';
  const currentOperatorCiOnlyLine =
    '`release/secret-hygiene-report.json`, `release/release-env-contract-report.json`, `release/release-env-bootstrap.json`, `release/RELEASE_ENV_BOOTSTRAP.md`, `release/release-env.local.template`, `release/release-env-bootstrap-report.json`, `release/release-env-bootstrap-report.strict.json`, `release/temp-cleanup-report.json`, `release/status-refresh-report.json`, `release/status-refresh-report-verification.strict.json`, `release/github-release-assets-report.strict.json`, `release/github-release-publish-plan.json`, `release/github-release-publish-plan-report.json`, `release/github-release-publish-plan-report.strict.json`, `release/github-release-remediation-plan.json`, `release/GITHUB_RELEASE_REMEDIATION_PLAN.md`, `release/github-release-remediation-plan-report.json`, `release/github-release-remediation-plan-report.strict.json`, `release/github-release-remediation-apply-plan.json`, `release/github-release-remediation-apply-plan-report.json`, `release/github-release-remediation-apply-plan-report.strict.json`, `release/preflight-report.strict.json`, `release/github-release-setup-report.json`, `release/production-release-runbook-report.json`, `release/production-release-runbook-report-verification.strict.json`, `release/production-readiness-summary.json`, `release/PRODUCTION_READINESS_SUMMARY.md`, `release/production-readiness-summary-verification.strict.json`, `release/engineering-readiness-report.json`, `release/ENGINEERING_READINESS.md`, `release/commercial-cutover-plan.json`, `release/COMMERCIAL_CUTOVER_PLAN.md`, `release/commercial-cutover-plan-report.json`, `release/commercial-cutover-plan-report.strict.json`, `release/commercial-release-readiness-report.strict.json`, `release/commercial-finalization-report.json`, `release/COMMERCIAL_FINALIZATION.md`, `release/commercial-finalization-report-verification.strict.json`, `release/release-setup-plan.json`, `release/RELEASE_SETUP_PLAN.md`, `release/release-setup-plan-report.json`, `release/release-setup-plan-report.strict.json`, `release/release-unblock-plan.json`, `release/RELEASE_UNBLOCK_PLAN.md`, `release/release-unblock-plan-report.json`, `release/release-unblock-plan-report.strict.json`, `release/release-credential-handoff.json`, `release/RELEASE_CREDENTIAL_HANDOFF.md`, `release/release-credential-handoff-report.json`, `release/release-credential-handoff-report.strict.json`, `release/release-publication-seal.json`, `release/RELEASE_PUBLICATION_SEAL.md`, `release/release-publication-seal-verification.strict.json`, `release/baseline-freshness-report.json`, `release/BASELINE_FRESHNESS.md`, `release/baseline-export-report.json`, `release/baseline-export-report-verification.json`, `release/baseline-export-report-verification.strict.json`, `release/BASELINE_EXPORT.md`, `release-*-launch-smoke.log`, `release/release-env-report.process.json`는 CI-only diagnostic이므로 GitHub Release 사용자 자산으로 올리지 않고 업로드 경로와 파일 존재 여부만 검증합니다.';
  const previousCiOnlyLineWithoutTempCleanup = currentCiOnlyLine.replace('`release/temp-cleanup-report.json`, ', '');
  const previousOperatorCiOnlyLineWithoutTempCleanup = currentOperatorCiOnlyLine.replace('`release/temp-cleanup-report.json`, ', '');
  let changed = false;
  changed =
    replaceInFile('DISTRIBUTION.md', [
      [/macOS security\/secret hygiene\/DMG install/g, 'macOS security/DMG install'],
      [new RegExp(`${staleSecretReleaseAssetLine}\\n`, 'g'), ''],
      [staleSecretEvidenceLine, currentSecretEvidenceLine],
      [previousCiOnlyLineWithoutTempCleanup, currentCiOnlyLine],
      [
        /^`release\/preflight-report\.strict\.json`, `release-\*-launch-smoke\.log`, `release\/release-env-report\.process\.json`은 CI-only diagnostic이므로 존재와 workflow 업로드 경로만 검증하고 checksum 고정 대상에서는 제외합니다\./gm,
        currentCiOnlyLine,
      ],
      [
        /^(?:`release\/secret-hygiene-report\.json`,\s*)+`release\/preflight-report\.strict\.json`, (?:`release\/github-release-setup-report\.json`, )?(?:`release\/production-release-runbook-report\.json`, )?(?:`release\/production-release-runbook-report-verification\.strict\.json`, )?(?:`release\/production-readiness-summary\.json`, `release\/PRODUCTION_READINESS_SUMMARY\.md`, )?(?:`release\/production-readiness-summary-verification\.strict\.json`, )?(?:`release\/release-setup-plan\.json`, `release\/RELEASE_SETUP_PLAN\.md`, (?:`release\/release-setup-plan-report\.json`, `release\/release-setup-plan-report\.strict\.json`, )?)?(?:`release\/release-unblock-plan\.json`, `release\/RELEASE_UNBLOCK_PLAN\.md`, )?(?:`release\/release-unblock-plan-report\.json`, `release\/release-unblock-plan-report\.strict\.json`, )?(?:`release\/release-credential-handoff\.json`, `release\/RELEASE_CREDENTIAL_HANDOFF\.md`, )?(?:`release\/release-publication-seal\.json`, `release\/RELEASE_PUBLICATION_SEAL\.md`, )?(?:`release\/release-publication-seal-verification\.strict\.json`, )?(?:`release\/baseline-freshness-report\.json`, `release\/BASELINE_FRESHNESS\.md`, )?(?:`release\/baseline-export-report\.json`, `release\/BASELINE_EXPORT\.md`, )?`release-\*-launch-smoke\.log`, `release\/release-env-report\.process\.json`은 CI-only diagnostic이므로 존재와 workflow 업로드 경로만 검증하고 checksum 고정 대상에서는 제외합니다\./gm,
        currentCiOnlyLine,
      ],
    ]) || changed;
  changed =
    replaceInFile('RELEASE_OPERATOR_CHECKLIST.md', [
      [staleOperatorSecretLine, ''],
      [previousOperatorCiOnlyLineWithoutTempCleanup, currentOperatorCiOnlyLine],
      [
        /^`release\/preflight-report\.strict\.json`, `release-\*-launch-smoke\.log`, `release\/release-env-report\.process\.json`는 CI-only diagnostic이므로 GitHub Release 사용자 자산으로 올리지 않고 업로드 경로와 파일 존재 여부만 검증합니다\.$/gm,
        currentOperatorCiOnlyLine,
      ],
      [
        /^(?:`release\/secret-hygiene-report\.json`,\s*)+`release\/preflight-report\.strict\.json`, (?:`release\/github-release-setup-report\.json`, )?(?:`release\/production-release-runbook-report\.json`, )?(?:`release\/production-release-runbook-report-verification\.strict\.json`, )?(?:`release\/production-readiness-summary\.json`, `release\/PRODUCTION_READINESS_SUMMARY\.md`, )?(?:`release\/production-readiness-summary-verification\.strict\.json`, )?(?:`release\/release-setup-plan\.json`, `release\/RELEASE_SETUP_PLAN\.md`, (?:`release\/release-setup-plan-report\.json`, `release\/release-setup-plan-report\.strict\.json`, )?)?(?:`release\/release-unblock-plan\.json`, `release\/RELEASE_UNBLOCK_PLAN\.md`, )?(?:`release\/release-unblock-plan-report\.json`, `release\/release-unblock-plan-report\.strict\.json`, )?(?:`release\/release-credential-handoff\.json`, `release\/RELEASE_CREDENTIAL_HANDOFF\.md`, )?(?:`release\/release-publication-seal\.json`, `release\/RELEASE_PUBLICATION_SEAL\.md`, )?(?:`release\/release-publication-seal-verification\.strict\.json`, )?(?:`release\/baseline-freshness-report\.json`, `release\/BASELINE_FRESHNESS\.md`, )?(?:`release\/baseline-export-report\.json`, `release\/BASELINE_EXPORT\.md`, )?`release-\*-launch-smoke\.log`, `release\/release-env-report\.process\.json`는 CI-only diagnostic이므로 GitHub Release 사용자 자산으로 올리지 않고 업로드 경로와 파일 존재 여부만 검증합니다\.$/gm,
        currentOperatorCiOnlyLine,
      ],
    ]) || changed;
  if (changed) console.log('Normalized release operator documentation policy');
}

function add(checks, name, ok, detail, level = 'blocker') {
  checks.push({ name, ok: Boolean(ok), detail, level: ok ? 'pass' : level });
}

function verifyAsset(asset, checks, label) {
  const file = path.join(desktopDir, asset.path);
  add(checks, `${label} ${asset.path}`, fs.existsSync(file), fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'missing');
  if (!fs.existsSync(file)) return;
  if (asset.volatile) {
    add(checks, `${label} ${asset.path} volatile diagnostic`, asset.sha256 == null && asset.sha512 == null, `observed ${asset.observedBytes} bytes`);
    return;
  }
  add(checks, `${label} ${asset.path} bytes`, fs.statSync(file).size === asset.bytes, `${fs.statSync(file).size} expected ${asset.bytes}`);
  add(checks, `${label} ${asset.path} sha256`, sha(file, 'sha256') === asset.sha256, asset.sha256 || 'missing');
  add(checks, `${label} ${asset.path} sha512`, sha(file, 'sha512') === asset.sha512, asset.sha512 || 'missing');
}

function verifyAssetPolicy() {
  const checks = [];
  const manifestPath = path.join(releaseDir, 'release-asset-manifest.json');
  add(checks, 'release asset manifest', fs.existsSync(manifestPath), 'release/release-asset-manifest.json');
  if (!fs.existsSync(manifestPath)) return checks;

  const manifest = readJson('release/release-asset-manifest.json');
  const releaseAssetPaths = new Set((manifest.githubReleaseAssets || []).map((asset) => asset.path));
  const ciOnlyArtifactPaths = new Set((manifest.ciOnlyArtifacts || []).map((asset) => asset.path));
  add(checks, 'asset manifest schema version', manifest.schemaVersion === 1, String(manifest.schemaVersion));
  add(checks, 'GitHub release asset list', Array.isArray(manifest.githubReleaseAssets) && manifest.githubReleaseAssets.length >= 20, `${manifest.githubReleaseAssets?.length || 0} assets`);
  add(checks, 'CI-only artifact list', Array.isArray(manifest.ciOnlyArtifacts), `${manifest.ciOnlyArtifacts?.length || 0} artifacts`);
  add(
    checks,
    'secret hygiene CI-only diagnostic',
    !releaseAssetPaths.has(secretHygienePath) && ciOnlyArtifactPaths.has(secretHygienePath),
    'secret hygiene report is CI-only diagnostic, never a GitHub Release asset',
  );
  add(
    checks,
    'security audit release asset',
    releaseAssetPaths.has(securityAuditPath) && !ciOnlyArtifactPaths.has(securityAuditPath),
    'security audit report is checksum-pinned GitHub Release evidence',
  );
  add(
    checks,
    'installed app parity release asset',
    releaseAssetPaths.has(installedAppParityPath) && !ciOnlyArtifactPaths.has(installedAppParityPath),
    'installed app parity report is checksum-pinned GitHub Release evidence',
  );
  add(
    checks,
    'release env contract CI-only diagnostic',
    !releaseAssetPaths.has(releaseEnvContractPath) &&
      (!fs.existsSync(path.join(desktopDir, releaseEnvContractPath)) || ciOnlyArtifactPaths.has(releaseEnvContractPath)),
    'release env contract report is never a GitHub Release asset',
  );
  for (const releaseEnvBootstrapPath of releaseEnvBootstrapPaths) {
    add(
      checks,
      `${releaseEnvBootstrapPath} CI-only diagnostic`,
      !releaseAssetPaths.has(releaseEnvBootstrapPath) &&
        (!fs.existsSync(path.join(desktopDir, releaseEnvBootstrapPath)) || ciOnlyArtifactPaths.has(releaseEnvBootstrapPath)),
      'release env bootstrap is never a GitHub Release asset',
    );
  }
  add(
    checks,
    'temp cleanup CI-only diagnostic',
    !releaseAssetPaths.has(tempCleanupPath) &&
      (!fs.existsSync(path.join(desktopDir, tempCleanupPath)) || ciOnlyArtifactPaths.has(tempCleanupPath)),
    'temp cleanup report is never a GitHub Release asset',
  );
  add(
    checks,
    'release env process CI-only diagnostic',
    !releaseAssetPaths.has(releaseEnvProcessPath) &&
      (!fs.existsSync(path.join(desktopDir, releaseEnvProcessPath)) || ciOnlyArtifactPaths.has(releaseEnvProcessPath)),
    'process env report is never a GitHub Release asset',
  );
  add(
    checks,
    'GitHub Release strict asset report CI-only diagnostic',
    !releaseAssetPaths.has(githubReleaseAssetsReportStrictPath) &&
      (!fs.existsSync(path.join(desktopDir, githubReleaseAssetsReportStrictPath)) || ciOnlyArtifactPaths.has(githubReleaseAssetsReportStrictPath)),
    'strict GitHub Release asset report is never a GitHub Release asset',
  );
  add(
    checks,
    'preflight strict CI-only diagnostic',
    !releaseAssetPaths.has(preflightStrictPath) &&
      (!fs.existsSync(path.join(desktopDir, preflightStrictPath)) || ciOnlyArtifactPaths.has(preflightStrictPath)),
    'strict preflight report is never a GitHub Release asset',
  );
  for (const githubReleasePublishPlanPath of githubReleasePublishPlanPaths) {
    add(
      checks,
      `${githubReleasePublishPlanPath} CI-only diagnostic`,
      !releaseAssetPaths.has(githubReleasePublishPlanPath) &&
        (!fs.existsSync(path.join(desktopDir, githubReleasePublishPlanPath)) || ciOnlyArtifactPaths.has(githubReleasePublishPlanPath)),
      'GitHub Release publish plan is never a GitHub Release asset',
    );
  }
  add(
    checks,
    'GitHub setup report CI-only diagnostic',
    !releaseAssetPaths.has(githubSetupReportPath) &&
      (!fs.existsSync(path.join(desktopDir, githubSetupReportPath)) || ciOnlyArtifactPaths.has(githubSetupReportPath)),
    'GitHub setup report is never a GitHub Release asset',
  );
  add(
    checks,
    'production release runbook report CI-only diagnostic',
    !releaseAssetPaths.has(productionRunbookPath) &&
      (!fs.existsSync(path.join(desktopDir, productionRunbookPath)) || ciOnlyArtifactPaths.has(productionRunbookPath)),
    'production release runbook report is never a GitHub Release asset',
  );
  add(
    checks,
    'production release runbook verification report CI-only diagnostic',
    !releaseAssetPaths.has(productionRunbookVerificationPath) &&
      (!fs.existsSync(path.join(desktopDir, productionRunbookVerificationPath)) || ciOnlyArtifactPaths.has(productionRunbookVerificationPath)),
    'production release runbook verification report is never a GitHub Release asset',
  );
  for (const productionReadinessPath of productionReadinessPaths) {
    add(
      checks,
      `${productionReadinessPath} CI-only diagnostic`,
      !releaseAssetPaths.has(productionReadinessPath) &&
        (!fs.existsSync(path.join(desktopDir, productionReadinessPath)) || ciOnlyArtifactPaths.has(productionReadinessPath)),
      'production readiness summary is never a GitHub Release asset',
    );
  }
  for (const engineeringReadinessPath of engineeringReadinessPaths) {
    add(
      checks,
      `${engineeringReadinessPath} CI-only diagnostic`,
      !releaseAssetPaths.has(engineeringReadinessPath) &&
        (!fs.existsSync(path.join(desktopDir, engineeringReadinessPath)) || ciOnlyArtifactPaths.has(engineeringReadinessPath)),
      'engineering readiness report is never a GitHub Release asset',
    );
  }
  for (const commercialCutoverPath of commercialCutoverPaths) {
    add(
      checks,
      `${commercialCutoverPath} CI-only diagnostic`,
      !releaseAssetPaths.has(commercialCutoverPath) &&
        (!fs.existsSync(path.join(desktopDir, commercialCutoverPath)) || ciOnlyArtifactPaths.has(commercialCutoverPath)),
      'commercial cutover plan is never a GitHub Release asset',
    );
  }
  add(
    checks,
    `${commercialReleaseReadinessPath} CI-only diagnostic`,
    !releaseAssetPaths.has(commercialReleaseReadinessPath) &&
      (!fs.existsSync(path.join(desktopDir, commercialReleaseReadinessPath)) || ciOnlyArtifactPaths.has(commercialReleaseReadinessPath)),
    'commercial release readiness report is never a GitHub Release asset',
  );
  for (const setupPlanPath of setupPlanPaths) {
    add(
      checks,
      `${setupPlanPath} CI-only diagnostic`,
      !releaseAssetPaths.has(setupPlanPath) &&
        (!fs.existsSync(path.join(desktopDir, setupPlanPath)) || ciOnlyArtifactPaths.has(setupPlanPath)),
      'release setup plan is never a GitHub Release asset',
    );
  }
  for (const unblockPlanPath of unblockPlanPaths) {
    add(
      checks,
      `${unblockPlanPath} CI-only diagnostic`,
      !releaseAssetPaths.has(unblockPlanPath) &&
        (!fs.existsSync(path.join(desktopDir, unblockPlanPath)) || ciOnlyArtifactPaths.has(unblockPlanPath)),
      'release unblock plan is never a GitHub Release asset',
    );
  }
  for (const credentialHandoffPath of credentialHandoffPaths) {
    add(
      checks,
      `${credentialHandoffPath} CI-only diagnostic`,
      !releaseAssetPaths.has(credentialHandoffPath) &&
        (!fs.existsSync(path.join(desktopDir, credentialHandoffPath)) || ciOnlyArtifactPaths.has(credentialHandoffPath)),
      'release credential handoff is never a GitHub Release asset',
    );
  }
  for (const publicationSealPath of publicationSealPaths) {
    add(
      checks,
      `${publicationSealPath} CI-only diagnostic`,
      !releaseAssetPaths.has(publicationSealPath) &&
        (!fs.existsSync(path.join(desktopDir, publicationSealPath)) || ciOnlyArtifactPaths.has(publicationSealPath)),
      'release publication seal is never a GitHub Release asset',
    );
  }
  for (const baselineFreshnessPath of baselineFreshnessPaths) {
    add(
      checks,
      `${baselineFreshnessPath} CI-only diagnostic`,
      !releaseAssetPaths.has(baselineFreshnessPath) &&
        (!fs.existsSync(path.join(desktopDir, baselineFreshnessPath)) || ciOnlyArtifactPaths.has(baselineFreshnessPath)),
      'baseline freshness report is never a GitHub Release asset',
    );
  }
  for (const baselineExportPath of baselineExportPaths) {
    add(
      checks,
      `${baselineExportPath} CI-only diagnostic`,
      !releaseAssetPaths.has(baselineExportPath) &&
        (!fs.existsSync(path.join(desktopDir, baselineExportPath)) || ciOnlyArtifactPaths.has(baselineExportPath)),
      'baseline export report is never a GitHub Release asset',
    );
  }
  for (const asset of manifest.githubReleaseAssets || []) verifyAsset(asset, checks, 'release asset');
  for (const asset of manifest.ciOnlyArtifacts || []) verifyAsset(asset, checks, 'CI artifact');
  if (strict) {
    add(checks, 'strict asset manifest production status', manifest.status?.strictDecision?.productionReady === true, manifest.status?.strictDecision?.status || 'missing');
    add(checks, 'strict promotion production status', manifest.status?.promotion?.productionReady === true, manifest.status?.promotion?.status || 'missing');
  }
  return checks;
}

function printReport(checks) {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level === 'warn' ? 'WARN' : 'BLOCKER';
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    checks,
    summary: { blockers, warnings },
  };
  const reportPath = path.join(releaseDir, strict ? 'asset-manifest-report.strict.json' : 'asset-manifest-report.json');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (blockers > 0) process.exit(1);
}

if (normalizePromotion) {
  if (normalizePromotionPlan()) console.log('Normalized release promotion asset policy');
}
if (normalizeManifest) {
  if (normalizeAssetManifest()) console.log('Normalized release asset manifest policy');
}
if (normalizePromotion || normalizeManifest) {
  normalizeOperatorDocs();
}
if (verifyMode) {
  printReport(verifyAssetPolicy());
}
