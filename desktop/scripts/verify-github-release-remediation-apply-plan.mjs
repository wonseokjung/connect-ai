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
const sourcePath = 'release/github-release-remediation-apply-plan.json';
const reportPath = strict
  ? 'release/github-release-remediation-apply-plan-report.strict.json'
  : 'release/github-release-remediation-apply-plan-report.json';
const checks = [];

function fullPath(relativePath) {
  return path.join(desktopDir, relativePath);
}

function readJson(relativePath) {
  const file = fullPath(relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
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

function generatedAtMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
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

function manifestAssetMap(manifest) {
  const assets = [
    ...(manifest?.githubReleaseAssets || []),
    manifest?.manifestFile ? {
      path: manifest.manifestFile,
      bytes: fs.existsSync(fullPath(manifest.manifestFile)) ? fs.statSync(fullPath(manifest.manifestFile)).size : null,
      sha256: fs.existsSync(fullPath(manifest.manifestFile)) ? sha(fullPath(manifest.manifestFile), 'sha256') : null,
      sha512: fs.existsSync(fullPath(manifest.manifestFile)) ? sha(fullPath(manifest.manifestFile), 'sha512') : null,
    } : null,
  ].filter(Boolean);
  return new Map(assets.map((asset) => [path.basename(asset.path), asset]));
}

function actionMap(actions) {
  const map = new Map();
  for (const action of actions || []) {
    if (!action?.asset) continue;
    if (!map.has(action.asset)) map.set(action.asset, []);
    map.get(action.asset).push(action);
  }
  return map;
}

function sourceReportMap(applyPlan) {
  return new Map((applyPlan?.sourceReports || [])
    .filter((source) => source?.path)
    .map((source) => [source.path, source]));
}

function reportStatusMatches(source, current) {
  if (!current || current.parseError) return false;
  if ((source.generatedAt || null) !== (current.generatedAt || null)) return false;
  if (JSON.stringify(source.status ?? null) !== JSON.stringify(current.status ?? null)) return false;
  const sourceSummary = source.summary || {};
  const currentSummary = summary(current);
  return Number(sourceSummary.blockers || 0) === currentSummary.blockers &&
    Number(sourceSummary.warnings || 0) === currentSummary.warnings;
}

function looksLikeUploadCommand(value, tag, localPath) {
  const text = String(value || '');
  return text === `gh release upload ${tag} ${localPath} --clobber`;
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireClean,
    source: sourcePath,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(fullPath(reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI GitHub Release remediation apply plan verification (${strict ? 'strict' : 'local'})`);
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
  const applyPlan = readJson(sourcePath);
  const remediationPlan = readJson('release/github-release-remediation-plan.json');
  const remediationVerification = readJson('release/github-release-remediation-plan-report.strict.json');
  const manifest = readJson('release/release-asset-manifest.json');

  add('GitHub Release remediation apply plan exists', Boolean(applyPlan && !applyPlan.parseError), applyPlan?.parseError || sourcePath);
  add('GitHub Release remediation plan exists', Boolean(remediationPlan && !remediationPlan.parseError), remediationPlan?.parseError || 'release/github-release-remediation-plan.json');
  add(
    'GitHub Release remediation plan verification clean',
    Boolean(remediationVerification && !remediationVerification.parseError) &&
      summary(remediationVerification).blockers === 0 &&
      summary(remediationVerification).warnings === 0,
    remediationVerification?.parseError || JSON.stringify(summary(remediationVerification)),
  );
  add('release asset manifest exists', Boolean(manifest && !manifest.parseError), manifest?.parseError || 'release/release-asset-manifest.json');
  if (!applyPlan || applyPlan.parseError || !remediationPlan || remediationPlan.parseError || !manifest || manifest.parseError) {
    printAndExit();
    return;
  }

  const manifestAssets = manifestAssetMap(manifest);
  const requiredActions = Array.isArray(remediationPlan.requiredActions) ? remediationPlan.requiredActions : [];
  const applyActions = Array.isArray(applyPlan.actions) ? applyPlan.actions : [];
  const requiredByAsset = actionMap(requiredActions);
  const applyByAsset = actionMap(applyActions);
  const expectedTag = `desktop-v${pkg?.version || 'unknown'}`;
  const sourceReports = sourceReportMap(applyPlan);
  const failedEmbeddedChecks = (applyPlan.checks || []).filter((check) => check.ok !== true && check.level === 'blocker');
  const failedEmbeddedWarnings = (applyPlan.checks || []).filter((check) => check.ok !== true && check.level === 'warn');

  add('GitHub Release remediation apply plan schema version', applyPlan.schemaVersion === 1, String(applyPlan.schemaVersion));
  add('GitHub Release remediation apply plan dry-run mode', applyPlan.apply === false && applyPlan.confirm === false, `apply=${applyPlan.apply}, confirm=${applyPlan.confirm}`);
  add('GitHub Release remediation apply plan status', applyPlan.status === 'dry-run-ready', applyPlan.status || 'missing');
  add('GitHub Release remediation apply plan summary clean', Number(applyPlan.summary?.blockers || 0) === 0 && Number(applyPlan.summary?.warnings || 0) === 0, JSON.stringify(applyPlan.summary || {}));
  add('GitHub Release remediation apply plan action count', Number(applyPlan.summary?.actions || 0) === applyActions.length && applyActions.length === requiredActions.length, `${applyPlan.summary?.actions} summary, ${applyActions.length} listed, ${requiredActions.length} required`);
  add('GitHub Release remediation apply plan release tag', applyPlan.release?.tag === expectedTag && applyPlan.release?.expectedTag === expectedTag, `${applyPlan.release?.tag || 'missing'} expected ${expectedTag}`);
  add(
    'GitHub Release remediation apply permission diagnostics',
    applyPlan.github &&
      typeof applyPlan.github.canUploadReleaseAssets === 'boolean' &&
      typeof applyPlan.github.canReadRelease === 'boolean' &&
      applyPlan.github.releaseTag === expectedTag &&
      typeof applyPlan.github.repo === 'string' &&
      applyPlan.github.repo.includes('/'),
    `repo=${applyPlan.github?.repo || 'missing'}, permission=${applyPlan.github?.viewerPermission || 'missing'}, canUpload=${applyPlan.github?.canUploadReleaseAssets}, canReadRelease=${applyPlan.github?.canReadRelease}`,
  );
  add('GitHub Release remediation apply embedded blocker checks', failedEmbeddedChecks.length === 0, `${failedEmbeddedChecks.length} blocker check(s)`);
  add('GitHub Release remediation apply embedded warning checks', failedEmbeddedWarnings.length === 0, `${failedEmbeddedWarnings.length} warning check(s)`, strict ? 'blocker' : 'warn');

  const requiredSourcePaths = [
    'release/release-asset-manifest.json',
    'release/github-release-remediation-plan.json',
    'release/github-release-remediation-plan-report.strict.json',
    'release/production-readiness-summary.json',
    'release/release-publication-seal.json',
    'release/baseline-freshness-report.json',
    'release/baseline-export-report-verification.strict.json',
    remediationPlan.sourceReport,
  ].filter(Boolean);
  for (const sourcePath of requiredSourcePaths) {
    add(`GitHub Release remediation apply source ${sourcePath}`, sourceReports.has(sourcePath), sourcePath);
  }
  for (const sourcePath of requiredSourcePaths.filter((item) => sourceReports.has(item))) {
    const current = readJson(sourcePath);
    const source = sourceReports.get(sourcePath);
    add(
      `GitHub Release remediation apply source freshness ${sourcePath}`,
      reportStatusMatches(source, current),
      `reported=${source.generatedAt || 'missing'} current=${current?.generatedAt || 'missing'}`,
    );
  }

  for (const required of requiredActions) {
    const matches = applyByAsset.get(required.asset) || [];
    const action = matches[0];
    const manifestAsset = manifestAssets.get(required.asset);
    const expectedLocalPath = required.localPath || required.expectedManifestPath || manifestAsset?.path;
    add(`GitHub Release remediation apply action coverage ${required.asset}`, matches.length === 1, `${matches.length} matching action(s)`);
    if (!action) continue;
    add(`GitHub Release remediation apply local path ${required.asset}`, action.localPath === expectedLocalPath && action.localPath === manifestAsset?.path, `${action.localPath || 'missing'} expected ${expectedLocalPath || 'missing'}`);
    add(`GitHub Release remediation apply command ${required.asset}`, looksLikeUploadCommand(action.command, applyPlan.release?.tag, action.localPath), action.command || 'missing');
    add(`GitHub Release remediation apply detail ${required.asset}`, String(action.detail || '').includes('would upload') && String(action.detail || '').includes(action.asset), action.detail || 'missing');
    add(`GitHub Release remediation apply reasons ${required.asset}`, Array.isArray(action.reasons) && action.reasons.length > 0, `${action.reasons?.length || 0} reason(s)`);
    const file = action.localPath ? fullPath(action.localPath) : null;
    add(`GitHub Release remediation apply file exists ${required.asset}`, Boolean(file && fs.existsSync(file)), action.localPath || 'missing');
    if (file && fs.existsSync(file) && manifestAsset) {
      add(`GitHub Release remediation apply bytes ${required.asset}`, fs.statSync(file).size === manifestAsset.bytes && action.expectedBytes === manifestAsset.bytes, `${fs.statSync(file).size}/${action.expectedBytes} expected ${manifestAsset.bytes}`);
      add(`GitHub Release remediation apply sha256 ${required.asset}`, sha(file, 'sha256') === manifestAsset.sha256, manifestAsset.sha256 || 'missing');
      add(`GitHub Release remediation apply sha512 ${required.asset}`, sha(file, 'sha512') === manifestAsset.sha512, manifestAsset.sha512 || 'missing');
    }
  }
  for (const action of applyActions) {
    add(`GitHub Release remediation apply action required ${action.asset}`, (requiredByAsset.get(action.asset) || []).length === 1, `${(requiredByAsset.get(action.asset) || []).length} required action(s)`);
  }

  const embeddedCheck = (name) => (applyPlan.checks || []).find((check) => check.name === name);
  add(
    'GitHub Release remediation apply baseline URL guard',
    embeddedCheck('remediation baseline URL guard present')?.ok === true &&
      embeddedCheck('remediation approved baseline upload source verified')?.ok === true &&
      embeddedCheck('remediation remote same-name baseline URL rejected')?.ok === true,
    `present=${Boolean(embeddedCheck('remediation baseline URL guard present')?.ok)}, approved=${Boolean(embeddedCheck('remediation approved baseline upload source verified')?.ok)}, rejected=${Boolean(embeddedCheck('remediation remote same-name baseline URL rejected')?.ok)}`,
  );
  add(
    'GitHub Release remediation apply production gate snapshot',
    typeof applyPlan.productionGate?.ready === 'boolean' &&
      applyPlan.productionGate.readiness?.summary &&
      applyPlan.productionGate.publicationSeal?.summary &&
      applyPlan.productionGate.baselineFreshness?.summary,
    applyPlan.productionGate?.detail || 'missing production gate snapshot',
  );
  add(
    'GitHub Release remediation apply safety rules',
      /Dry-run mode must never upload/.test((applyPlan.safetyRules || []).join('\n')) &&
      /--confirm-remote-remediation/.test((applyPlan.safetyRules || []).join('\n')) &&
      /GitHub token with write\/maintain\/admin/.test((applyPlan.safetyRules || []).join('\n')) &&
      /Dry-run mode records GitHub release upload permission diagnostics/.test((applyPlan.safetyRules || []).join('\n')) &&
      /release\/release-asset-manifest\.json/.test((applyPlan.safetyRules || []).join('\n')) &&
      /CONNECT_AI_BASELINE_URL/.test((applyPlan.safetyRules || []).join('\n')),
    `${applyPlan.safetyRules?.length || 0} rule(s)`,
  );
  add('GitHub Release remediation apply generatedAt', generatedAtMs(applyPlan.generatedAt) > 0, applyPlan.generatedAt || 'missing');
  add('GitHub Release remediation apply secret material scan', !hasSecretMaterial(JSON.stringify(applyPlan, null, 2)), 'no private key, certificate body, GitHub token, or API key literal patterns');

  if (requireClean) {
    add('GitHub Release remediation apply clean', applyActions.length === 0, `${applyActions.length} action(s)`);
  }

  printAndExit();
}

main();
