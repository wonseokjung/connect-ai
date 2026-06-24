import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoDir = path.resolve(desktopDir, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const checks = [];
const releaseEnvContractPath = 'release/release-env-contract-report.json';
const setupPlanPaths = ['release/release-setup-plan.json', 'release/RELEASE_SETUP_PLAN.md'];
const productionReadinessPaths = ['release/production-readiness-summary.json', 'release/PRODUCTION_READINESS_SUMMARY.md'];
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
const publicationSealPaths = ['release/release-publication-seal.json', 'release/RELEASE_PUBLICATION_SEAL.md'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function workflowText() {
  const file = path.join(repoDir, '.github', 'workflows', 'build-desktop.yml');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

function verifyAsset(asset, group) {
  const file = path.join(desktopDir, asset.path);
  add(`${group} ${asset.path}`, fs.existsSync(file), fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'missing');
  if (!fs.existsSync(file)) return;
  if (asset.volatile === true) {
    add(
      `${group} ${asset.path} volatile diagnostic`,
      true,
      `hash not pinned; observed ${fs.statSync(file).size} bytes`,
    );
    return;
  }
  add(`${group} ${asset.path} bytes`, asset.bytes === fs.statSync(file).size, `${asset.bytes} expected`);
  add(`${group} ${asset.path} sha256`, asset.sha256 === sha(file, 'sha256'), asset.sha256 || 'missing');
  add(`${group} ${asset.path} sha512`, asset.sha512 === sha(file, 'sha512'), asset.sha512 || 'missing');
}

function verifyWorkflow(manifest) {
  const text = workflowText();
  add('GitHub Actions workflow', text.length > 0, '.github/workflows/build-desktop.yml');
  if (!text) return;

  const requiredUploads = [
    ...manifest.githubReleaseAssets.map((asset) => asset.path),
    ...manifest.ciOnlyArtifacts.map((asset) => asset.path),
    manifest.manifestFile,
  ];
  for (const relativePath of requiredUploads) {
    const workflowPath = `desktop/${relativePath}`;
    add(`workflow artifact upload ${relativePath}`, text.includes(workflowPath), workflowPath);
  }

  const releaseAssets = [
    ...manifest.githubReleaseAssets.map((asset) => asset.path),
    manifest.manifestFile,
  ];
  const publishScript = path.join(desktopDir, 'scripts', 'publish-github-release-assets.mjs');
  const publishText = fs.existsSync(publishScript) ? fs.readFileSync(publishScript, 'utf8') : '';
  const manifestDrivenPublish = text.includes('npm run release:publish-assets') &&
    publishText.includes('release-asset-manifest.json') &&
    publishText.includes('manifest.githubReleaseAssets') &&
    publishText.includes('manifest.manifestFile');
  add('workflow manifest-driven release publish', manifestDrivenPublish, 'npm run release:publish-assets reads release-asset-manifest.json');
  add(
    'workflow publish asset hash verification',
    publishText.includes('publish asset ${asset.path} sha256') &&
      publishText.includes('publish asset ${asset.path} sha512'),
    'release publish validates bytes, SHA-256, and SHA-512 before upload',
  );
  add(
    'workflow publish production readiness summary gate',
    publishText.includes('productionReadinessStatus') &&
      publishText.includes('publicationSealStatus') &&
      publishText.includes('releaseManifestSecurityStatus') &&
      publishText.includes('current production readiness summary production-ready') &&
      publishText.includes('current release publication seal production-ready') &&
      publishText.includes('current release manifest signed and notarized') &&
      publishText.includes('production readiness strict decision freshness') &&
      publishText.includes('production readiness promotion freshness'),
    'release publish validates production-readiness-summary.json, release-publication-seal.json, and release-manifest.json before upload',
  );
  for (const relativePath of releaseAssets) {
    add(`workflow release publish manifest asset ${relativePath}`, manifestDrivenPublish, 'covered by release-asset-manifest.json');
  }
}

function verifyDecisionFreshness(manifest) {
  const evidenceFile = path.join(releaseDir, 'evidence-report.json');
  const strictEvidenceFile = path.join(releaseDir, 'evidence-report.strict.json');
  const decisionFile = path.join(releaseDir, 'release-decision.json');
  const strictDecisionFile = path.join(releaseDir, 'release-decision.strict.json');

  if (fs.existsSync(evidenceFile) && fs.existsSync(decisionFile)) {
    const evidence = readJson(evidenceFile);
    const decision = readJson(decisionFile);
    add(
      'local decision evidence summary freshness',
      decision.summaries?.evidence?.blockers === evidence.summary?.blockers &&
        decision.summaries?.evidence?.warnings === evidence.summary?.warnings,
      `decision=${JSON.stringify(decision.summaries?.evidence || {})}, evidence=${JSON.stringify(evidence.summary || {})}`
    );
    add(
      'asset manifest local decision status freshness',
      manifest.status?.localDecision?.status === decision.status &&
        manifest.status?.localDecision?.productionReady === Boolean(decision.productionReady),
      `manifest=${JSON.stringify(manifest.status?.localDecision || {})}, decision=${decision.status}`
    );
  }

  if (fs.existsSync(strictEvidenceFile) && fs.existsSync(strictDecisionFile)) {
    const strictEvidence = readJson(strictEvidenceFile);
    const strictDecision = readJson(strictDecisionFile);
    add(
      'strict decision evidence summary freshness',
      strictDecision.summaries?.strictEvidence?.blockers === strictEvidence.summary?.blockers &&
        strictDecision.summaries?.strictEvidence?.warnings === strictEvidence.summary?.warnings,
      `decision=${JSON.stringify(strictDecision.summaries?.strictEvidence || {})}, strictEvidence=${JSON.stringify(strictEvidence.summary || {})}`
    );
    add(
      'asset manifest strict decision status freshness',
      manifest.status?.strictDecision?.status === strictDecision.status &&
        manifest.status?.strictDecision?.productionReady === Boolean(strictDecision.productionReady),
      `manifest=${JSON.stringify(manifest.status?.strictDecision || {})}, decision=${strictDecision.status}`
    );
  }
}

function main() {
  const manifestPath = path.join(releaseDir, 'release-asset-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    add('release asset manifest', false, 'missing release/release-asset-manifest.json');
    printAndExit();
    return;
  }

  const manifest = readJson(manifestPath);
  add('asset manifest schema version', manifest.schemaVersion === 1, String(manifest.schemaVersion));
  add('asset manifest self excluded', manifest.selfHashExcluded === true, String(manifest.selfHashExcluded));
  add('asset manifest file path', manifest.manifestFile === 'release/release-asset-manifest.json', manifest.manifestFile || 'missing');
  add('GitHub release asset list', Array.isArray(manifest.githubReleaseAssets) && manifest.githubReleaseAssets.length >= 20, `${manifest.githubReleaseAssets?.length || 0} assets`);
  add('CI-only artifact list', Array.isArray(manifest.ciOnlyArtifacts), `${manifest.ciOnlyArtifacts?.length || 0} artifacts`);
  const releaseAssetPaths = new Set((manifest.githubReleaseAssets || []).map((asset) => asset.path));
  const ciOnlyArtifactPaths = new Set((manifest.ciOnlyArtifacts || []).map((asset) => asset.path));
  add(
    'secret hygiene CI-only diagnostic',
    !releaseAssetPaths.has('release/secret-hygiene-report.json') &&
      ciOnlyArtifactPaths.has('release/secret-hygiene-report.json'),
    'secret hygiene report is never a GitHub Release asset',
  );
  add(
    'security audit release asset',
    releaseAssetPaths.has('release/security-audit-report.json') &&
      !ciOnlyArtifactPaths.has('release/security-audit-report.json'),
    'security audit report is checksum-pinned release evidence',
  );
  add(
    'release env contract CI-only diagnostic',
    !releaseAssetPaths.has(releaseEnvContractPath) &&
      (!fs.existsSync(path.join(desktopDir, releaseEnvContractPath)) ||
        ciOnlyArtifactPaths.has(releaseEnvContractPath)),
    'release env contract report is never a GitHub Release asset',
  );
  add(
    'release env process CI-only diagnostic',
    !releaseAssetPaths.has('release/release-env-report.process.json') &&
      (!fs.existsSync(path.join(releaseDir, 'release-env-report.process.json')) ||
        ciOnlyArtifactPaths.has('release/release-env-report.process.json')),
    'process env report is never a GitHub Release asset',
  );
  add(
    'preflight strict CI-only diagnostic',
    !releaseAssetPaths.has('release/preflight-report.strict.json') &&
      (!fs.existsSync(path.join(releaseDir, 'preflight-report.strict.json')) ||
        ciOnlyArtifactPaths.has('release/preflight-report.strict.json')),
    'strict preflight report is never a GitHub Release asset',
  );
  for (const relativePath of productionReadinessPaths) {
    add(
      `production readiness CI-only diagnostic ${relativePath}`,
      !releaseAssetPaths.has(relativePath) &&
        (!fs.existsSync(path.join(desktopDir, relativePath)) || ciOnlyArtifactPaths.has(relativePath)),
      'production readiness summary is never a GitHub Release asset',
    );
  }
  for (const relativePath of setupPlanPaths) {
    add(
      `release setup plan CI-only diagnostic ${relativePath}`,
      !releaseAssetPaths.has(relativePath) &&
        (!fs.existsSync(path.join(desktopDir, relativePath)) || ciOnlyArtifactPaths.has(relativePath)),
      'release setup plan is never a GitHub Release asset',
    );
  }
  for (const relativePath of unblockPlanPaths) {
    add(
      `release unblock plan CI-only diagnostic ${relativePath}`,
      !releaseAssetPaths.has(relativePath) &&
        (!fs.existsSync(path.join(desktopDir, relativePath)) || ciOnlyArtifactPaths.has(relativePath)),
      'release unblock plan is never a GitHub Release asset',
    );
  }
  for (const relativePath of credentialHandoffPaths) {
    add(
      `release credential handoff CI-only diagnostic ${relativePath}`,
      !releaseAssetPaths.has(relativePath) &&
        (!fs.existsSync(path.join(desktopDir, relativePath)) || ciOnlyArtifactPaths.has(relativePath)),
      'release credential handoff is never a GitHub Release asset',
    );
  }
  for (const relativePath of publicationSealPaths) {
    add(
      `release publication seal CI-only diagnostic ${relativePath}`,
      !releaseAssetPaths.has(relativePath) &&
        (!fs.existsSync(path.join(desktopDir, relativePath)) || ciOnlyArtifactPaths.has(relativePath)),
      'release publication seal is never a GitHub Release asset',
    );
  }

  for (const asset of manifest.githubReleaseAssets || []) verifyAsset(asset, 'release asset');
  for (const asset of manifest.ciOnlyArtifacts || []) verifyAsset(asset, 'CI artifact');
  verifyWorkflow(manifest);
  verifyDecisionFreshness(manifest);

  if (strict) {
    add('strict asset manifest production status', manifest.status?.strictDecision?.productionReady === true, manifest.status?.strictDecision?.status || 'missing');
    add('strict promotion production status', manifest.status?.promotion?.productionReady === true, manifest.status?.promotion?.status || 'missing');
  }

  printAndExit();
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  const reportPath = path.join(releaseDir, strict ? 'asset-manifest-report.strict.json' : 'asset-manifest-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI release asset manifest verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (blockers > 0) process.exit(1);
}

main();
