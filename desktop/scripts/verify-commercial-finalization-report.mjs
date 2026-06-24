import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const requireProduction = process.argv.includes('--require-production');
const requirePublished = process.argv.includes('--require-published');
const requireCommercial = process.argv.includes('--require-commercial');
const sourcePath = 'release/commercial-finalization-report.json';
const markdownPath = 'release/COMMERCIAL_FINALIZATION.md';
const reportPath = strict
  ? 'release/commercial-finalization-report-verification.strict.json'
  : 'release/commercial-finalization-report-verification.json';
const checks = [];

const sourceReportPaths = {
  statusRefresh: 'release/status-refresh-report.json',
  statusRefreshVerification: 'release/status-refresh-report-verification.strict.json',
  commercialCutover: 'release/commercial-cutover-plan.json',
  commercialCutoverVerification: 'release/commercial-cutover-plan-report.strict.json',
  commercialReadiness: 'release/commercial-release-readiness-report.strict.json',
  installedBundleDelta: 'release/installed-bundle-delta-report.json',
  assetManifest: 'release/asset-manifest-report.json',
  unblockPlan: 'release/release-unblock-plan.json',
  credentialHandoff: 'release/release-credential-handoff.json',
  remoteRemediationApply: 'release/github-release-remediation-apply-plan.json',
};
const volatileSourceNames = new Set([
  'statusRefreshVerification',
]);

const requiredStepScripts = [
  'verify:status-refresh-report:strict:report',
  'release:commercial-cutover',
  'verify:commercial-cutover:strict:report',
  'verify:commercial-release:strict:report',
  'release:asset-manifest',
  'verify:asset-manifest',
];

const requiredCheckNames = [
  'status refresh report exists',
  'status refresh verification clean',
  'commercial cutover verification clean',
  'asset manifest final verification clean',
  'installed bundle delta report exists',
  'installed bundle delta evidence clean',
  'installed bundle macOS metadata policy retained',
  'commercial readiness report exists',
  'commercial readiness local candidate retained',
  'commercial readiness source coverage',
  'commercial readiness uses latest status refresh verification',
  'commercial readiness uses latest commercial cutover verification',
  'commercial readiness uses latest installed bundle delta evidence',
  'commercial readiness blocker accounting',
  'commercial readiness remote upload permission retained',
  'commercial readiness unblock group accounting retained',
  'commercial readiness external gate retained',
  'status refresh itself clean',
  'commercial readiness blocker coverage',
  'commercial finalization secret material scan',
];

function readText(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function readJson(relativePath) {
  const text = readText(relativePath);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { parseError: error.message };
  }
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

function expectedStatus(report) {
  if (Number(report?.summary?.blockers || 0) > 0) return 'commercial-finalization-blocked';
  if (report?.commercialReady === true) return 'commercial-ready';
  if (report?.publishedReleaseReady === true) return 'published-release-ready';
  if (report?.productionReady === true) return 'production-ready-awaiting-publication';
  if (report?.localCandidateReady === true) return 'local-candidate-finalized-awaiting-external-setup';
  return 'not-ready';
}

function expectedStatusReason(report) {
  if (Number(report?.summary?.blockers || 0) > 0) return `${Number(report.summary.blockers)} commercial finalization blocker(s) remain`;
  if (report?.commercialReady === true) return 'commercial-ready';
  if (report?.publishedReleaseReady === true) return 'published release is ready but commercialReady is false';
  if (report?.productionReady === true) return 'production build is ready and awaiting publication verification';
  if (report?.localCandidateReady === true) {
    return `local candidate finalized; ${Number(report?.summary?.commercialReadinessBlockers || 0)} commercial readiness blocker(s) remain`;
  }
  return 'local candidate is not ready';
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

function comparableSummary(report) {
  if (!report || report.parseError) return null;
  return {
    generatedAt: report.generatedAt || null,
    status: report.status || null,
    strict: report.strict ?? null,
    localCandidateReady: report.localCandidateReady ?? null,
    productionReady: report.productionReady ?? null,
    publishedReleaseReady: report.publishedReleaseReady ?? null,
    commercialReady: report.commercialReady ?? null,
    summary: report.summary || null,
  };
}

function sourceMatches(name, finalization, current) {
  const reported = finalization?.sourceReports?.[name] || null;
  const expected = comparableSummary(current);
  add(
    `commercial finalization source ${name}`,
    Boolean(reported && expected),
    reported && expected ? 'present' : 'missing',
  );
  if (!reported || !expected) return;
  const reportedSummary = reported.summary || {};
  const expectedSummary = expected.summary || {};
  const volatileCleanRefresh =
    volatileSourceNames.has(name) &&
    generatedAtMs(expected.generatedAt) >= generatedAtMs(reported.generatedAt) &&
    Number(reportedSummary.blockers || 0) === 0 &&
    Number(reportedSummary.warnings || 0) === 0 &&
    Number(expectedSummary.blockers || 0) === 0 &&
    Number(expectedSummary.warnings || 0) === 0;
  add(
    `commercial finalization source ${name} generatedAt`,
    reported.generatedAt === expected.generatedAt || volatileCleanRefresh,
    `reported=${reported.generatedAt || 'missing'} current=${expected.generatedAt || 'missing'}`,
  );
  add(
    `commercial finalization source ${name} status`,
    JSON.stringify(reported.status ?? null) === JSON.stringify(expected.status ?? null),
    `reported=${reported.status || 'missing'} current=${expected.status || 'missing'}`,
  );
  add(
    `commercial finalization source ${name} summary`,
    JSON.stringify(reported.summary || null) === JSON.stringify(expected.summary || null),
    reported.summary ? `${reported.summary.blockers || 0} blocker(s), ${reported.summary.warnings || 0} warning(s)` : 'no summary',
  );
}

function main() {
  const finalization = readJson(sourcePath);
  const markdown = readText(markdownPath) || '';
  const sources = Object.fromEntries(
    Object.entries(sourceReportPaths).map(([name, relativePath]) => [name, readJson(relativePath)]),
  );

  add('commercial finalization report exists', Boolean(finalization && !finalization.parseError), finalization?.parseError || sourcePath);
  add('commercial finalization markdown exists', Boolean(markdown), markdownPath);
  if (!finalization || finalization.parseError) {
    writeReport();
    return;
  }

  const finalSummary = summary(finalization);
  const failedFinalChecks = (finalization.checks || []).filter((check) => check.ok !== true);
  const failedFinalWarnings = failedFinalChecks.filter((check) => check.level === 'warn').length;
  const failedFinalBlockers = failedFinalChecks.filter((check) => (check.level || 'blocker') === 'blocker').length;
  const stepScripts = (finalization.steps || []).map((step) => step.script);
  const checkNames = (finalization.checks || []).map((check) => check.name);
  const commercial = sources.commercialReadiness;
  const installedBundleDelta = sources.installedBundleDelta;
  const commercialSummary = summary(commercial);
  const installedBundleDeltaSummary = installedBundleDelta?.summary || {};

  add('commercial finalization schema version', finalization.schemaVersion === 1, String(finalization.schemaVersion));
  add('commercial finalization generatedAt', generatedAtMs(finalization.generatedAt) > 0, finalization.generatedAt || 'missing');
  add('commercial finalization status', finalization.status === expectedStatus(finalization), `${finalization.status || 'missing'} expected ${expectedStatus(finalization)}`);
  add('commercial finalization status reason', finalization.statusReason === expectedStatusReason(finalization), `${finalization.statusReason || 'missing'} expected ${expectedStatusReason(finalization)}`);
  add('commercial finalization summary blocker accounting', finalSummary.blockers === failedFinalBlockers, `${finalSummary.blockers} expected ${failedFinalBlockers}`);
  add('commercial finalization summary warning accounting', finalSummary.warnings === failedFinalWarnings, `${finalSummary.warnings} expected ${failedFinalWarnings}`);
  add('commercial finalization step count', Number(finalization.summary?.steps || 0) === (finalization.steps || []).length, `${finalization.summary?.steps ?? 'missing'} expected ${(finalization.steps || []).length}`);
  add('commercial finalization required steps', requiredStepScripts.every((script) => stepScripts.includes(script)), `required=${requiredStepScripts.join(', ')}`);
  add('commercial finalization all steps passed', (finalization.steps || []).every((step) => step.ok === true), `${(finalization.steps || []).filter((step) => step.ok !== true).length} failed step(s)`);
  add('commercial finalization required checks', requiredCheckNames.every((name) => checkNames.includes(name)), `required=${requiredCheckNames.length} check(s)`);

  for (const [name, report] of Object.entries(sources)) {
    sourceMatches(name, finalization, report);
  }

  add('commercial finalization mirrors local candidate readiness', finalization.localCandidateReady === Boolean(commercial?.localCandidateReady), `final=${finalization.localCandidateReady}, commercial=${commercial?.localCandidateReady}`);
  add('commercial finalization mirrors production readiness', finalization.productionReady === Boolean(commercial?.productionReady), `final=${finalization.productionReady}, commercial=${commercial?.productionReady}`);
  add('commercial finalization mirrors published readiness', finalization.publishedReleaseReady === Boolean(commercial?.publishedReleaseReady), `final=${finalization.publishedReleaseReady}, commercial=${commercial?.publishedReleaseReady}`);
  add('commercial finalization mirrors commercial readiness', finalization.commercialReady === Boolean(commercial?.commercialReady), `final=${finalization.commercialReady}, commercial=${commercial?.commercialReady}`);
  add('commercial finalization commercial blocker summary', Number(finalization.summary?.commercialReadinessBlockers || 0) === commercialSummary.blockers, `${finalization.summary?.commercialReadinessBlockers ?? 'missing'} expected ${commercialSummary.blockers}`);
  add('commercial finalization commercial warning summary', Number(finalization.summary?.commercialReadinessWarnings || 0) === commercialSummary.warnings, `${finalization.summary?.commercialReadinessWarnings ?? 'missing'} expected ${commercialSummary.warnings}`);
  add('commercial finalization remote required action summary', Number(finalization.summary?.remoteRequiredActions || 0) === Number(commercial?.summary?.remoteRequiredActions || 0), `${finalization.summary?.remoteRequiredActions ?? 'missing'} expected ${commercial?.summary?.remoteRequiredActions ?? 'missing'}`);
  add('commercial finalization remote apply action summary', Number(finalization.summary?.remoteApplyActions || 0) === Number(commercial?.summary?.remoteApplyActions || 0), `${finalization.summary?.remoteApplyActions ?? 'missing'} expected ${commercial?.summary?.remoteApplyActions ?? 'missing'}`);
  add('commercial finalization remote upload permission summary', finalization.summary?.remoteUploadPermissionReady === commercial?.summary?.remoteUploadPermissionReady, `${finalization.summary?.remoteUploadPermissionReady ?? 'missing'} expected ${commercial?.summary?.remoteUploadPermissionReady ?? 'missing'}`);
  add('commercial finalization blocked credential group summary', Number(finalization.summary?.blockedCredentialGroups || 0) === Number(commercial?.summary?.blockedCredentialGroups || 0), `${finalization.summary?.blockedCredentialGroups ?? 'missing'} expected ${commercial?.summary?.blockedCredentialGroups ?? 'missing'}`);
  add('commercial finalization total unblock group summary', Number(finalization.summary?.totalUnblockGroups || 0) === Number(commercial?.summary?.totalUnblockGroups || 0), `${finalization.summary?.totalUnblockGroups ?? 'missing'} expected ${commercial?.summary?.totalUnblockGroups ?? 'missing'}`);
  add('commercial finalization blocked unblock group summary', Number(finalization.summary?.blockedUnblockGroups || 0) === Number(commercial?.summary?.blockedUnblockGroups || 0), `${finalization.summary?.blockedUnblockGroups ?? 'missing'} expected ${commercial?.summary?.blockedUnblockGroups ?? 'missing'}`);
  add('commercial finalization external blocker summary', Number(finalization.summary?.externalBlockers || 0) === Number(commercial?.summary?.externalBlockers || 0), `${finalization.summary?.externalBlockers ?? 'missing'} expected ${commercial?.summary?.externalBlockers ?? 'missing'}`);
  add('commercial finalization installed bundle commercial delta summary', Number(finalization.summary?.installedBundleCommercialBlockingDeltas || 0) === Number(installedBundleDeltaSummary.commercialBlockingDeltas || 0), `${finalization.summary?.installedBundleCommercialBlockingDeltas ?? 'missing'} expected ${installedBundleDeltaSummary.commercialBlockingDeltas ?? 'missing'}`);
  add('commercial finalization installed bundle ASAR policy summary', finalization.summary?.installedBundleAppAsarApprovedByPolicy === installedBundleDeltaSummary.appAsarApprovedByPolicy, `${finalization.summary?.installedBundleAppAsarApprovedByPolicy ?? 'missing'} expected ${installedBundleDeltaSummary.appAsarApprovedByPolicy ?? 'missing'}`);
  add('commercial finalization installed bundle macOS metadata exact summary', finalization.summary?.installedBundleMacosMetadataExactMatch === installedBundleDeltaSummary.macosMetadataExactMatch, `${finalization.summary?.installedBundleMacosMetadataExactMatch ?? 'missing'} expected ${installedBundleDeltaSummary.macosMetadataExactMatch ?? 'missing'}`);
  add('commercial finalization installed bundle macOS metadata policy summary', finalization.summary?.installedBundleMacosMetadataApprovedByPolicy === installedBundleDeltaSummary.macosMetadataApprovedByPolicy, `${finalization.summary?.installedBundleMacosMetadataApprovedByPolicy ?? 'missing'} expected ${installedBundleDeltaSummary.macosMetadataApprovedByPolicy ?? 'missing'}`);
  add('commercial finalization installed bundle Electron runtime summary', finalization.summary?.installedBundleElectronRuntimeMatch === installedBundleDeltaSummary.electronRuntimeMatch, `${finalization.summary?.installedBundleElectronRuntimeMatch ?? 'missing'} expected ${installedBundleDeltaSummary.electronRuntimeMatch ?? 'missing'}`);
  add('commercial finalization installed bundle signature summary', finalization.summary?.installedBundleCandidateCommercialSignature === installedBundleDeltaSummary.candidateCommercialSignature, `${finalization.summary?.installedBundleCandidateCommercialSignature ?? 'missing'} expected ${installedBundleDeltaSummary.candidateCommercialSignature ?? 'missing'}`);

  const failedCommercialBlockers = (commercial?.checks || []).filter((check) => check.ok !== true && (check.level || 'blocker') === 'blocker');
  const coverage = finalization.commercialBlockerCoverage || {};
  const coverageItems = Array.isArray(coverage.items) ? coverage.items : [];
  add('commercial finalization blocker coverage object', Boolean(finalization.commercialBlockerCoverage), finalization.commercialBlockerCoverage ? 'present' : 'missing');
  add('commercial finalization blocker coverage total summary', Number(finalization.summary?.commercialReadinessBlockersTotal || 0) === failedCommercialBlockers.length && Number(coverage.total || 0) === failedCommercialBlockers.length, `summary=${finalization.summary?.commercialReadinessBlockersTotal ?? 'missing'} coverage=${coverage.total ?? 'missing'} expected=${failedCommercialBlockers.length}`);
  add('commercial finalization blocker coverage covered summary', Number(finalization.summary?.commercialReadinessBlockersCovered || 0) === Number(coverage.covered || 0), `${finalization.summary?.commercialReadinessBlockersCovered ?? 'missing'} expected ${coverage.covered ?? 'missing'}`);
  add('commercial finalization blocker coverage uncovered summary', Number(finalization.summary?.commercialReadinessBlockersUncovered || 0) === Number(coverage.uncovered || 0) && Number(coverage.uncovered || 0) === 0, `${finalization.summary?.commercialReadinessBlockersUncovered ?? 'missing'} expected 0`);
  add('commercial finalization blocker coverage item count', coverageItems.length === failedCommercialBlockers.length, `${coverageItems.length} expected ${failedCommercialBlockers.length}`);
  add('commercial finalization blocker coverage all classified', coverageItems.every((item) => item.classified === true), `${coverageItems.filter((item) => item.classified !== true).length} unclassified item(s)`);
  add('commercial finalization blocker coverage all covered', coverageItems.every((item) => item.covered === true), `${coverageItems.filter((item) => item.covered !== true).length} uncovered item(s)`);
  add(
    'commercial finalization blocker coverage evidence links',
    coverageItems.every((item) =>
      Array.isArray(item.expected?.nextExternalActions) &&
      Array.isArray(item.expected?.unblockGroups) &&
      Array.isArray(item.expected?.credentialGroups) &&
      typeof item.reason === 'string' &&
      item.reason.length > 0
    ),
    `${coverageItems.length} coverage item(s) include expected action/group evidence`,
  );

  const nextExternalActions = Array.isArray(finalization.nextExternalActions) ? finalization.nextExternalActions : [];
  const nextActionIds = new Set(nextExternalActions.map((action) => action.id));
  const requiredActionIds = [];
  if (finalization.productionReady !== true || installedBundleDeltaSummary.candidateCommercialSignature === false) requiredActionIds.push('sign-and-notarize-production-build');
  if (Number(commercial?.summary?.blockedCredentialGroups || 0) > 0) requiredActionIds.push('complete-credential-handoff');
  if (commercial?.summary?.remoteUploadPermissionReady !== true) requiredActionIds.push('grant-github-release-upload-permission');
  if (Number(commercial?.summary?.remoteApplyActions || 0) > 0 || Number(commercial?.summary?.remoteRequiredActions || 0) > 0) requiredActionIds.push('apply-github-release-asset-remediation');
  if (finalization.publishedReleaseReady !== true) requiredActionIds.push('publish-and-verify-github-release');
  add('commercial finalization next external actions present', nextExternalActions.length === Number(finalization.summary?.nextExternalActions || 0) && nextExternalActions.length > 0, `${nextExternalActions.length} action(s), summary=${finalization.summary?.nextExternalActions ?? 'missing'}`);
  add('commercial finalization next external actions cover blockers', requiredActionIds.every((id) => nextActionIds.has(id)), `required=${requiredActionIds.join(', ') || 'none'}`);

  if (requireProduction) {
    add('commercial finalization require production', finalization.productionReady === true, `productionReady=${finalization.productionReady}`);
  }
  if (requirePublished) {
    add('commercial finalization require published', finalization.publishedReleaseReady === true, `publishedReleaseReady=${finalization.publishedReleaseReady}`);
  }
  if (requireCommercial) {
    add('commercial finalization require commercial', finalization.commercialReady === true, `commercialReady=${finalization.commercialReady}`);
  }

  add(
    'commercial finalization markdown status',
    markdown.includes(`Status: ${finalization.status}`) &&
      markdown.includes(`Status reason: ${finalization.statusReason}`) &&
      markdown.includes(`Commercial ready: ${finalization.commercialReady}`) &&
      markdown.includes(`Production ready: ${finalization.productionReady}`) &&
      markdown.includes(`Published release ready: ${finalization.publishedReleaseReady}`) &&
      markdown.includes(`Local candidate ready: ${finalization.localCandidateReady}`),
    'markdown mirrors final status and readiness booleans',
  );
  add(
    'commercial finalization markdown summary',
    markdown.includes(`Commercial readiness blockers: ${finalization.summary?.commercialReadinessBlockers}`) &&
      markdown.includes(`Blocked credential groups: ${finalization.summary?.blockedCredentialGroups}`) &&
      markdown.includes(`Blocked unblock groups: ${finalization.summary?.blockedUnblockGroups} / ${finalization.summary?.totalUnblockGroups}`) &&
      markdown.includes(`Remote upload permission ready: ${finalization.summary?.remoteUploadPermissionReady}`) &&
      markdown.includes(`Remote required actions: ${finalization.summary?.remoteRequiredActions}`) &&
      markdown.includes(`Remote apply actions: ${finalization.summary?.remoteApplyActions}`) &&
      markdown.includes(`Installed bundle commercial blocking deltas: ${finalization.summary?.installedBundleCommercialBlockingDeltas}`) &&
      markdown.includes(`Installed bundle candidate commercial signature: ${finalization.summary?.installedBundleCandidateCommercialSignature}`) &&
      markdown.includes(`Installed bundle app.asar approved by policy: ${finalization.summary?.installedBundleAppAsarApprovedByPolicy}`) &&
      markdown.includes(`Installed bundle macOS metadata exact match: ${finalization.summary?.installedBundleMacosMetadataExactMatch}`) &&
      markdown.includes(`Installed bundle macOS metadata approved by policy: ${finalization.summary?.installedBundleMacosMetadataApprovedByPolicy}`) &&
      markdown.includes(`Installed bundle Electron runtime match: ${finalization.summary?.installedBundleElectronRuntimeMatch}`) &&
      markdown.includes(`Commercial readiness blocker coverage: ${finalization.summary?.commercialReadinessBlockersCovered} / ${finalization.summary?.commercialReadinessBlockersTotal}`),
    'markdown mirrors commercial blocker, unblock, remote upload, remote apply, and installed bundle summaries',
  );
  add(
    'commercial finalization markdown next external actions',
    markdown.includes('## Next External Actions') && nextExternalActions.every((action) => markdown.includes(action.id) && markdown.includes(action.source)),
    'markdown lists next external action ids and sources',
  );
  add('commercial finalization secret material scan', !hasSecretMaterial(`${JSON.stringify(finalization)}\n${markdown}`), 'no private key, certificate body, GitHub token, or API key literal patterns');

  writeReport();
}

function writeReport() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireProduction,
    requirePublished,
    requireCommercial,
    source: sourcePath,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI commercial finalization verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${reportPath}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

main();
