import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const requireClean = process.argv.includes('--require-clean');
const planPath = 'release/github-release-publish-plan.json';
const reportPath = strict
  ? 'release/github-release-publish-plan-report.strict.json'
  : 'release/github-release-publish-plan-report.json';
const checks = [];

const requiredCheckNames = [
  'release asset manifest',
  'release tag',
  'release tag matches package version',
  'manifest product version',
  'manifest-driven publish asset set',
  'strict release decision production-ready',
  'release promotion production-ready',
  'release notes signed status',
  'current strict release decision production-ready',
  'current release promotion production-ready',
  'manifest strict decision freshness',
  'manifest promotion freshness',
  'current production readiness summary production-ready',
  'current release publication seal production-ready',
  'current release manifest signed and notarized',
  'current baseline freshness clean',
  'current baseline export verification clean',
  'production readiness strict decision freshness',
  'production readiness promotion freshness',
  'production readiness baseline freshness',
  'production readiness baseline export verification',
  'publication seal strict decision freshness',
  'publication seal promotion freshness',
  'publication seal readiness freshness',
  'publication seal release manifest freshness',
  'publication seal baseline freshness',
  'publication seal baseline export verification',
  'GitHub operator readiness report clean',
];

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(desktopDir, relativePath));
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

function summary(report) {
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
}

function expectedReleaseTag(pkg) {
  return `desktop-v${pkg?.version || 'missing'}`;
}

function releaseNotesStatus() {
  const file = path.join(releaseDir, 'RELEASE_NOTES.md');
  if (!fs.existsSync(file)) return 'missing';
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^Status:\s*(.+)$/m);
  return match ? match[1].trim() : 'missing';
}

function expectedAssets(manifest) {
  return [
    ...(manifest?.githubReleaseAssets || []),
    manifest?.manifestFile ? { path: manifest.manifestFile, manifestFile: true } : null,
  ].filter(Boolean);
}

function byName(plan) {
  const map = new Map();
  for (const check of plan?.checks || []) {
    if (!check?.name) continue;
    if (!map.has(check.name)) map.set(check.name, []);
    map.get(check.name).push(check);
  }
  return map;
}

function firstCheck(checkMap, name) {
  return (checkMap.get(name) || [])[0] || null;
}

function checkOk(checkMap, name, expectedOk, detail) {
  const check = firstCheck(checkMap, name);
  add(`publish plan projection ${name}`, Boolean(check) && check.ok === expectedOk, check ? `${check.ok} expected ${expectedOk}; ${detail}` : `missing; ${detail}`);
}

function checkPresent(checkMap, name) {
  const matches = checkMap.get(name) || [];
  add(`publish plan required check ${name}`, matches.length === 1, `${matches.length} matching check(s)`);
}

function hasSecretMaterial(text) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
    /-----BEGIN CERTIFICATE-----/,
    /\bghp_[A-Za-z0-9_]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bAIza[0-9A-Za-z_-]{20,}\b/,
    /\bsk-[A-Za-z0-9]{24,}\b/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function gateClean(report) {
  const value = summary(report);
  return value.blockers === 0 && value.warnings === 0;
}

function sourceState(report, relativePath) {
  return (report?.sourceReports || []).find((item) => item.path === relativePath) || null;
}

function manifestSecurityClean(report) {
  const fields = ['codesignVerify', 'gatekeeper', 'stapler', 'dmgGatekeeper', 'dmgStapler'];
  return Boolean(report) &&
    !report.parseError &&
    report.security?.codeSignature?.developerId === true &&
    fields.every((field) => report.security?.[field]?.ok === true);
}

function validateSourceReport(relativePath, required = true) {
  const report = readJson(relativePath);
  add(`publish plan source exists ${relativePath}`, Boolean(report && !report.parseError), report?.parseError || relativePath, required ? 'blocker' : 'warn');
  if (report && !report.parseError && report.summary) {
    add(
      `publish plan source summary ${relativePath}`,
      Number.isFinite(Number(report.summary.blockers)) && Number.isFinite(Number(report.summary.warnings)),
      `${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)`,
      required ? 'blocker' : 'warn',
    );
  }
  return report;
}

function validateAssets(plan, manifest, checkMap) {
  const assets = expectedAssets(manifest);
  const ciOnlyPaths = new Set((manifest?.ciOnlyArtifacts || []).map((asset) => asset.path));
  const names = new Set();
  add('publish plan expected asset count', assets.length >= 20, `${assets.length} assets`);

  for (const asset of assets) {
    const file = path.join(desktopDir, asset.path);
    const name = path.basename(asset.path);
    add(`publish plan asset not CI-only ${asset.path}`, !ciOnlyPaths.has(asset.path), ciOnlyPaths.has(asset.path) ? 'listed as CI-only' : 'release asset');
    add(`publish plan asset file ${asset.path}`, fs.existsSync(file), fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'missing');
    add(`publish plan asset name unique ${name}`, !names.has(name), names.has(name) ? 'duplicate basename' : name);
    names.add(name);

    const publishAssetCheck = firstCheck(checkMap, `publish asset ${asset.path}`);
    const assetNameCheck = firstCheck(checkMap, `publish asset name ${name}`);
    add(`publish plan check covers asset ${asset.path}`, Boolean(publishAssetCheck), publishAssetCheck?.detail || 'missing');
    add(`publish plan check covers asset name ${name}`, Boolean(assetNameCheck), assetNameCheck?.detail || 'missing');
    if (!fs.existsSync(file)) continue;

    if (Number.isFinite(asset.bytes)) {
      const actualBytes = fs.statSync(file).size;
      add(`publish plan asset bytes ${asset.path}`, actualBytes === asset.bytes, `${actualBytes} expected ${asset.bytes}`);
      const bytesCheck = firstCheck(checkMap, `publish asset ${asset.path} bytes`);
      add(`publish plan bytes check projection ${asset.path}`, Boolean(bytesCheck) && bytesCheck.ok === (actualBytes === asset.bytes), bytesCheck ? `${bytesCheck.ok} expected ${actualBytes === asset.bytes}` : 'missing');
    }
    if (asset.sha256) {
      const actual = sha(file, 'sha256');
      add(`publish plan asset sha256 ${asset.path}`, actual === asset.sha256, `${actual} expected ${asset.sha256}`);
      const shaCheck = firstCheck(checkMap, `publish asset ${asset.path} sha256`);
      add(`publish plan sha256 check projection ${asset.path}`, Boolean(shaCheck) && shaCheck.ok === (actual === asset.sha256), shaCheck ? `${shaCheck.ok} expected ${actual === asset.sha256}` : 'missing');
    }
    if (asset.sha512) {
      const actual = sha(file, 'sha512');
      add(`publish plan asset sha512 ${asset.path}`, actual === asset.sha512, `${actual} expected ${asset.sha512}`);
      const shaCheck = firstCheck(checkMap, `publish asset ${asset.path} sha512`);
      add(`publish plan sha512 check projection ${asset.path}`, Boolean(shaCheck) && shaCheck.ok === (actual === asset.sha512), shaCheck ? `${shaCheck.ok} expected ${actual === asset.sha512}` : 'missing');
    }
  }

  const assetSetCheck = firstCheck(checkMap, 'manifest-driven publish asset set');
  add(
    'publish plan asset count projection',
    Boolean(assetSetCheck) && assetSetCheck.ok === (assets.length >= 20) && String(assetSetCheck.detail || '').includes(`${assets.length} assets`),
    assetSetCheck ? `${assetSetCheck.detail || 'missing'} expected ${assets.length} assets` : 'missing',
  );

  const planAssetChecks = (plan.checks || [])
    .filter((check) => String(check.name || '').startsWith('publish asset '))
    .map((check) => String(check.name || '').replace(/^publish asset /, '').replace(/ (?:bytes|sha256|sha512)$/, ''))
    .filter((value) => value.startsWith('release/'));
  const expectedPaths = new Set(assets.map((asset) => asset.path));
  const unexpected = [...new Set(planAssetChecks)].filter((assetPath) => !expectedPaths.has(assetPath));
  add('publish plan unexpected asset checks', unexpected.length === 0, unexpected.length ? unexpected.join(', ') : 'none');
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireClean,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI GitHub Release publish plan verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${reportPath}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const pkg = readJson('package.json');
  const plan = readJson(planPath);
  const manifest = readJson('release/release-asset-manifest.json');
  const strictDecision = validateSourceReport('release/release-decision.strict.json');
  const promotion = validateSourceReport('release/release-promotion-plan.json');
  const readiness = validateSourceReport('release/production-readiness-summary.json');
  const publicationSeal = validateSourceReport('release/release-publication-seal.json');
  const releaseManifest = validateSourceReport('release/release-manifest.json');
  const baselineFreshness = validateSourceReport('release/baseline-freshness-report.json');
  const baselineExportVerification = validateSourceReport('release/baseline-export-report-verification.strict.json');
  const githubOperator = validateSourceReport('release/operator-readiness.github.json');

  add('GitHub Release publish plan exists', Boolean(plan && !plan.parseError), plan?.parseError || planPath);
  add('release asset manifest available', Boolean(manifest && !manifest.parseError), manifest?.parseError || 'release/release-asset-manifest.json');
  if (!plan || plan.parseError) {
    printAndExit();
    return;
  }

  const checkMap = byName(plan);
  const failedBlockers = (plan.checks || []).filter((check) => check.ok !== true && check.level === 'blocker');
  const failedWarnings = (plan.checks || []).filter((check) => check.ok !== true && check.level === 'warn');
  const duplicateCheckNames = [...checkMap.entries()].filter(([, matches]) => matches.length > 1).map(([name]) => name);
  const serialized = JSON.stringify(plan);
  const manifestAssets = expectedAssets(manifest);
  const expectedTag = expectedReleaseTag(pkg);
  const readinessBaselineExportVerification = sourceState(readiness, 'release/baseline-export-report-verification.strict.json');
  const sealBaselineExportVerification = sourceState(publicationSeal, 'release/baseline-export-report-verification.strict.json');

  add('GitHub Release publish plan schema version', plan.schemaVersion === 1, String(plan.schemaVersion));
  add('GitHub Release publish plan generatedAt', Number.isFinite(Date.parse(plan.generatedAt || '')), plan.generatedAt || 'missing');
  add('GitHub Release publish plan dryRun metadata', typeof plan.dryRun === 'boolean', `dryRun=${plan.dryRun}`);
  add('GitHub Release publish plan check array', Array.isArray(plan.checks) && plan.checks.length >= requiredCheckNames.length, `${plan.checks?.length || 0} check(s)`);
  add('GitHub Release publish plan actions array', Array.isArray(plan.actions), `${plan.actions?.length || 0} action(s)`);
  add('GitHub Release publish plan summary blockers', Number(plan.summary?.blockers) === failedBlockers.length, `${plan.summary?.blockers ?? 'missing'} expected ${failedBlockers.length}`);
  add('GitHub Release publish plan summary warnings', Number(plan.summary?.warnings) === failedWarnings.length, `${plan.summary?.warnings ?? 'missing'} expected ${failedWarnings.length}`);
  add('GitHub Release publish plan duplicate check names', duplicateCheckNames.length === 0, duplicateCheckNames.length ? duplicateCheckNames.join(', ') : 'none');

  for (const name of requiredCheckNames) checkPresent(checkMap, name);

  if (pkg && !pkg.parseError) {
    checkOk(checkMap, 'release tag matches package version', true, expectedTag);
    checkOk(checkMap, 'manifest product version', manifest?.product?.version === pkg.version, `${manifest?.product?.version || 'missing'} expected ${pkg.version}`);
  }
  if (manifest && !manifest.parseError) {
    checkOk(checkMap, 'strict release decision production-ready', manifest.status?.strictDecision?.productionReady === true, manifest.status?.strictDecision?.status || 'missing');
    checkOk(checkMap, 'release promotion production-ready', manifest.status?.promotion?.productionReady === true, manifest.status?.promotion?.status || 'missing');
    validateAssets(plan, manifest, checkMap);
  }

  checkOk(checkMap, 'release notes signed status', releaseNotesStatus() === 'signed-and-notarized', releaseNotesStatus());
  checkOk(checkMap, 'current strict release decision production-ready', strictDecision?.productionReady === true, strictDecision?.status || 'missing');
  checkOk(checkMap, 'current release promotion production-ready', promotion?.productionReady === true, promotion?.status || 'missing');
  checkOk(
    checkMap,
    'current production readiness summary production-ready',
    readiness?.productionReady === true && readiness?.localCandidateReady === true,
    `status=${readiness?.status || 'missing'}, productionReady=${Boolean(readiness?.productionReady)}, localCandidateReady=${Boolean(readiness?.localCandidateReady)}`,
  );
  checkOk(
    checkMap,
    'current release publication seal production-ready',
    publicationSeal?.productionReady === true && publicationSeal?.localCandidateReady === true && summary(publicationSeal).blockers === 0,
    `status=${publicationSeal?.status || 'missing'}, productionReady=${Boolean(publicationSeal?.productionReady)}, localCandidateReady=${Boolean(publicationSeal?.localCandidateReady)}`,
  );
  checkOk(checkMap, 'current release manifest signed and notarized', manifestSecurityClean(releaseManifest), 'Developer ID codesign/Gatekeeper/stapler app and DMG checks');
  checkOk(checkMap, 'current baseline freshness clean', baselineFreshness?.ok === true && baselineFreshness?.status === 'fresh' && summary(baselineFreshness).blockers === 0, baselineFreshness?.status || 'missing');
  checkOk(
    checkMap,
    'current baseline export verification clean',
    baselineExportVerification?.strict === true && gateClean(baselineExportVerification),
    `strict=${Boolean(baselineExportVerification?.strict)} ${summary(baselineExportVerification).blockers} blocker(s), ${summary(baselineExportVerification).warnings} warning(s)`,
  );
  checkOk(
    checkMap,
    'production readiness baseline export verification',
    Boolean(readiness && baselineExportVerification && readinessBaselineExportVerification) &&
      readinessBaselineExportVerification.generatedAt === baselineExportVerification.generatedAt &&
      readinessBaselineExportVerification.strict === true &&
      readinessBaselineExportVerification.summary?.blockers === summary(baselineExportVerification).blockers &&
      readinessBaselineExportVerification.summary?.warnings === summary(baselineExportVerification).warnings,
    `readiness=${JSON.stringify(readinessBaselineExportVerification || {})}, current=${baselineExportVerification?.generatedAt || 'missing'}`,
  );
  checkOk(
    checkMap,
    'publication seal baseline export verification',
    Boolean(publicationSeal && baselineExportVerification && sealBaselineExportVerification) &&
      sealBaselineExportVerification.generatedAt === baselineExportVerification.generatedAt &&
      sealBaselineExportVerification.strict === true &&
      sealBaselineExportVerification.summary?.blockers === summary(baselineExportVerification).blockers &&
      sealBaselineExportVerification.summary?.warnings === summary(baselineExportVerification).warnings,
    `seal=${JSON.stringify(sealBaselineExportVerification || {})}, current=${baselineExportVerification?.generatedAt || 'missing'}`,
  );
  checkOk(checkMap, 'GitHub operator readiness report clean', githubOperator?.github === true && githubOperator?.strict === true && gateClean(githubOperator), `github=${Boolean(githubOperator?.github)} strict=${Boolean(githubOperator?.strict)} ${summary(githubOperator).blockers} blocker(s), ${summary(githubOperator).warnings} warning(s)`);

  const actions = (plan.actions || []).map((action) => String(action));
  add(
    'GitHub Release publish plan blocked action projection',
    failedBlockers.length > 0 ? actions.some((action) => /publish skipped because release gates are not satisfied/.test(action)) : true,
    failedBlockers.length > 0 ? actions.join('; ') || 'missing skipped action' : 'no blockers',
  );
  add(
    'GitHub Release publish plan dry-run action projection',
    failedBlockers.length === 0 && plan.dryRun === true
      ? actions.some((action) => action.includes(`GitHub Release ${expectedTag}`)) && actions.some((action) => action.includes(`${manifestAssets.length} manifest-listed assets`))
      : true,
    actions.join('; ') || 'no dry-run actions required',
  );
  add('GitHub Release publish plan secret material scan', !hasSecretMaterial(serialized), 'no private key, certificate body, GitHub token, or API key literal patterns');

  if (requireClean) {
    add('GitHub Release publish plan require clean blockers', Number(plan.summary?.blockers || 0) === 0, `${plan.summary?.blockers ?? 'missing'} blocker(s)`);
    add('GitHub Release publish plan require clean warnings', Number(plan.summary?.warnings || 0) === 0, `${plan.summary?.warnings ?? 'missing'} warning(s)`);
  }

  printAndExit();
}

main();
