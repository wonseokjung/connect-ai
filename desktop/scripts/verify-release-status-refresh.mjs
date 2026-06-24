import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const checks = [];

const statusPath = 'release/status-refresh-report.json';
const reportPath = strict
  ? 'release/status-refresh-report-verification.strict.json'
  : 'release/status-refresh-report-verification.json';

const requiredScripts = [
  'release:cleanup-temp',
  'release:env-check:process:strict:report',
  'signing:check:report',
  'release:operator-checklist:strict:report',
  'release:github-setup:process:strict:report',
  'release:operator-checklist:github:strict:report',
  'verify:release:ui-parity',
  'verify:release:performance-parity',
  'release:installed-bundle-delta',
  'verify:release:macos-security',
  'verify:release:ipc-security',
  'verify:release:dmg-install',
  'verify:release:launch',
  'verify:release:dmg-launch',
  'verify:update-channel',
  'verify:release-tag',
  'release:evidence',
  'verify:baseline-export:strict:report',
  'verify:evidence:strict:report',
  'release:decision:strict:report',
  'release:promotion-plan',
  'release:asset-manifest',
  'verify:github-release-assets',
  'verify:github-release-assets:strict:report',
  'release:github-release-remediation-plan',
  'verify:github-release-remediation-plan',
  'verify:github-release-remediation-plan:strict:report',
  'release:github-release-remediation-apply:plan',
  'verify:github-release-remediation-apply-plan:strict:report',
  'release:publish-assets:plan',
  'verify:github-release-publish-plan:strict:report',
  'release:readiness-summary:strict:report',
  'verify:readiness-summary-report:strict:report',
  'release:unblock-plan',
  'verify:unblock-plan:strict:report',
  'release:publication-seal:strict:report',
  'release:operator-runbook:strict:report',
  'verify:publication-seal-report:strict:report',
  'verify:operator-runbook-report:strict:report',
  'release:engineering-readiness',
  'release:credential-handoff',
  'verify:credential-handoff:strict:report',
  'release:setup-plan',
  'verify:setup-plan:strict:report',
  'release:env-bootstrap',
  'verify:env-bootstrap:strict:report',
  'verify:remote-baseline-candidate:strict:report',
  'verify:remote-baseline-candidate-report:strict:report',
  'verify:remote-baseline-approved:report',
  'release:commercial-cutover',
  'verify:commercial-cutover:strict:report',
  'release:preflight:strict:report',
  'verify:commercial-release:strict:report',
  'verify:asset-manifest',
];

const orderConstraints = [
  ['release:cleanup-temp', 'verify:release:ui-parity'],
  ['release:operator-checklist:github:strict:report', 'verify:release:ipc-security'],
  ['verify:release:ipc-security', 'verify:release:ui-parity'],
  ['verify:release:ui-parity', 'verify:release:performance-parity'],
  ['verify:release:performance-parity', 'release:installed-bundle-delta'],
  ['release:installed-bundle-delta', 'verify:release:macos-security'],
  ['verify:release:macos-security', 'verify:release:dmg-install'],
  ['verify:release:dmg-install', 'verify:release:launch'],
  ['verify:release:launch', 'verify:release:dmg-launch'],
  ['verify:release:dmg-launch', 'verify:update-channel'],
  ['verify:update-channel', 'verify:release-tag'],
  ['verify:release-tag', 'release:evidence'],
  ['release:evidence', 'verify:evidence:strict:report'],
  ['verify:baseline-export:strict:report', 'release:credential-handoff'],
  ['release:credential-handoff', 'verify:credential-handoff:strict:report'],
  ['verify:credential-handoff:strict:report', 'release:setup-plan'],
  ['release:setup-plan', 'verify:setup-plan:strict:report'],
  ['verify:setup-plan:strict:report', 'release:env-bootstrap'],
  ['release:env-bootstrap', 'verify:env-bootstrap:strict:report'],
  ['verify:env-bootstrap:strict:report', 'verify:remote-baseline-candidate:strict:report'],
  ['verify:remote-baseline-approved:report', 'release:github-release-remediation-plan'],
  ['verify:evidence:strict:report', 'release:decision:strict:report'],
  ['release:asset-manifest', 'verify:github-release-assets'],
  ['verify:github-release-assets:strict:report', 'release:github-release-remediation-plan'],
  ['release:github-release-remediation-plan', 'verify:github-release-remediation-plan:strict:report'],
  ['release:github-release-remediation-apply:plan', 'release:publish-assets:plan'],
  ['release:github-release-remediation-apply:plan', 'verify:github-release-remediation-apply-plan:strict:report'],
  ['verify:github-release-remediation-apply-plan:strict:report', 'release:publish-assets:plan'],
  ['release:publish-assets:plan', 'verify:github-release-publish-plan:strict:report'],
  ['verify:github-release-publish-plan:strict:report', 'release:readiness-summary:strict:report'],
  ['release:readiness-summary:strict:report', 'verify:readiness-summary-report:strict:report'],
  ['verify:readiness-summary-report:strict:report', 'release:publication-seal:strict:report'],
  ['release:operator-runbook:strict:report', 'release:engineering-readiness'],
  ['release:commercial-cutover', 'verify:commercial-cutover:strict:report'],
  ['verify:env-bootstrap:strict:report', 'verify:remote-baseline-candidate:strict:report'],
  ['verify:remote-baseline-candidate:strict:report', 'verify:remote-baseline-candidate-report:strict:report'],
  ['verify:remote-baseline-candidate-report:strict:report', 'release:commercial-cutover'],
  ['verify:remote-baseline-candidate-report:strict:report', 'verify:remote-baseline-approved:report'],
  ['verify:remote-baseline-approved:report', 'release:commercial-cutover'],
  ['verify:commercial-cutover:strict:report', 'release:preflight:strict:report'],
  ['release:preflight:strict:report', 'verify:asset-manifest'],
  ['verify:asset-manifest', 'verify:commercial-release:strict:report'],
  ['verify:commercial-release:strict:report', 'verify:asset-manifest', 'first', 'last'],
];

const cleanReportKeys = [
  ['temp cleanup', 'tempCleanup'],
  ['baseline export verification', 'baselineExportVerification'],
  ['UI parity', 'uiParity'],
  ['performance parity', 'performanceParity'],
  ['installed bundle delta', 'installedBundleDelta'],
  ['publish plan verification', 'publishPlanVerification'],
  ['readiness verification', 'readinessVerification'],
  ['unblock plan', 'unblockPlan'],
  ['publication seal', 'publicationSeal'],
  ['publication seal verification', 'publicationSealVerification'],
  ['production runbook verification', 'productionRunbookVerification'],
  ['engineering readiness', 'engineeringReadiness'],
  ['commercial cutover', 'commercialCutover'],
  ['remote remediation apply verification', 'remoteRemediationApplyPlanVerification'],
  ['setup plan verification', 'setupPlanVerification'],
  ['credential handoff', 'credentialHandoff'],
  ['env bootstrap verification', 'envBootstrapVerification'],
  ['remote baseline candidate', 'remoteBaselineCandidate'],
  ['remote baseline candidate verification', 'remoteBaselineCandidateVerification'],
  ['asset manifest', 'assetManifest'],
];

const freshReportKeys = [
  'tempCleanup',
  'releaseEnvProcess',
  'operatorReadiness',
  'signingReadiness',
  'githubSetup',
  'githubOperatorReadiness',
  'baselineExportVerification',
  'uiParity',
  'performanceParity',
  'installedBundleDelta',
  'provenance',
  'strictEvidence',
  'decision',
  'promotion',
  'publishPlan',
  'remoteAssets',
  'remoteRemediationPlan',
  'remoteRemediationPlanReport',
  'remoteRemediationPlanStrictReport',
  'remoteRemediationApplyPlan',
  'remoteRemediationApplyPlanVerification',
  'remoteBaselineCandidate',
  'remoteBaselineCandidateVerification',
  'remoteBaselineApproval',
  'publishPlanVerification',
  'readiness',
  'readinessVerification',
  'publicationSeal',
  'publicationSealVerification',
  'productionRunbook',
  'productionRunbookVerification',
  'engineeringReadiness',
  'commercialCutover',
  'commercialReleaseReadiness',
  'setupPlanVerification',
  'credentialHandoff',
  'envBootstrap',
  'envBootstrapVerification',
  'preflightStrict',
  'assetManifest',
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

function currentCommercialCutoverConverged(snapshotCounts) {
  if (snapshotCounts.blockers !== 1 || snapshotCounts.warnings !== 0) return false;
  const current = readJson('release/commercial-cutover-plan-report.strict.json');
  if (!current || current.parseError || current.strict !== true) return false;
  const currentCounts = summary(current);
  if (currentCounts.blockers === 0 && currentCounts.warnings === 0) return true;
  if (currentCounts.blockers !== 1 || currentCounts.warnings !== 0) return false;
  const failed = (current.checks || []).filter((check) => check.ok !== true);
  return failed.length === 1 && failed[0].name === 'commercial cutover status refresh verification acceptable';
}

function failedCheckNames(report) {
  return (report?.checks || []).filter((check) => check.ok !== true).map((check) => check.name || '');
}

function expectedExternalGateReport(key, counts) {
  if (counts.warnings !== 0 || counts.blockers === 0) return false;
  if (key === 'readinessVerification') {
    const current = readJson('release/production-readiness-summary-verification.strict.json');
    const names = failedCheckNames(current);
    return counts.blockers === 1 &&
      names.length === 1 &&
      names[0] === 'production readiness remediation baseline URL guard evidence';
  }
  if (key === 'unblockPlan') {
    const current = readJson('release/release-unblock-plan-report.strict.json');
    const names = failedCheckNames(current);
    return names.length > 0 &&
      names.every((name) => [
        'release unblock remediation apply plan verified',
        'release unblock commercial finalization reports verified',
      ].includes(name));
  }
  if (key === 'commercialCutover') {
    const current = readJson('release/commercial-cutover-plan-report.strict.json');
    const names = failedCheckNames(current);
    return names.length > 0 &&
      names.every((name) => [
        'commercial cutover status refresh verification acceptable',
        'commercial cutover remote apply plan summary',
      ].includes(name));
  }
  if (key === 'remoteRemediationApplyPlanVerification') {
    const current = readJson('release/github-release-remediation-apply-plan-report.strict.json');
    const names = failedCheckNames(current);
    return names.length > 0 &&
      names.every((name) => [
        'GitHub Release remediation apply plan status',
        'GitHub Release remediation apply plan summary clean',
        'GitHub Release remediation apply embedded blocker checks',
        'GitHub Release remediation apply baseline URL guard',
      ].includes(name));
  }
  return false;
}

function generatedAtMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function stepIndex(steps, script, mode = 'first') {
  if (mode === 'last') {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (steps[index].script === script) return index;
    }
    return -1;
  }
  return steps.findIndex((step) => step.script === script);
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

function checkEvidenceParityFreshness() {
  const evidence = readJson('release/evidence-report.strict.json');
  add('status refresh strict evidence exists', Boolean(evidence && !evidence.parseError), evidence?.parseError || 'release/evidence-report.strict.json');
  if (!evidence || evidence.parseError) return;

  const uiFingerprint = (evidence.checks || []).find((check) => check.name === 'UI parity tested source fingerprint');
  const uiCoverage = (evidence.checks || []).find((check) => check.name === 'UI parity tested source coverage');
  const performanceFingerprint = (evidence.checks || []).find((check) => check.name === 'performance parity tested source fingerprint');
  const performanceCoverage = (evidence.checks || []).find((check) => check.name === 'performance parity tested source coverage');
  const staleFailures = (evidence.checks || [])
    .filter((check) => check.ok === false && /tested source|UI parity|performance parity/i.test(`${check.name} ${check.detail}`));

  add('status refresh strict evidence UI fingerprint', uiFingerprint?.ok === true, uiFingerprint?.detail || 'missing UI parity tested source fingerprint');
  add('status refresh strict evidence UI coverage', uiCoverage?.ok === true, uiCoverage?.detail || 'missing UI parity tested source coverage');
  add('status refresh strict evidence performance fingerprint', performanceFingerprint?.ok === true, performanceFingerprint?.detail || 'missing performance parity tested source fingerprint');
  add('status refresh strict evidence performance coverage', performanceCoverage?.ok === true, performanceCoverage?.detail || 'missing performance parity tested source coverage');
  add(
    'status refresh strict evidence no parity freshness blocker',
    staleFailures.length === 0,
    staleFailures.length ? staleFailures.map((check) => `${check.name}: ${check.detail}`).join('; ') : 'no UI/performance tested-source failures',
  );
}

function writeReport() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    source: statusPath,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI release status refresh verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${reportPath}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const report = readJson(statusPath);
  add('status refresh report exists', Boolean(report && !report.parseError), report?.parseError || statusPath);
  if (!report || report.parseError) {
    writeReport();
    return;
  }

  const steps = Array.isArray(report.steps) ? report.steps : [];
  const failedSteps = steps.filter((step) => step.ok !== true);
  const duplicateRequiredScripts = requiredScripts.filter((script, index) => requiredScripts.indexOf(script) !== index);
  const startedAt = generatedAtMs(report.startedAt);
  const generatedAt = generatedAtMs(report.generatedAt);
  const reportText = JSON.stringify(report);

  add('status refresh schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('status refresh status', report.status === 'refreshed', report.status || 'missing');
  add('status refresh generatedAt', generatedAt > 0, report.generatedAt || 'missing');
  add('status refresh startedAt', startedAt > 0, report.startedAt || 'missing');
  add('status refresh timestamp order', startedAt > 0 && generatedAt >= startedAt, `startedAt=${report.startedAt || 'missing'} generatedAt=${report.generatedAt || 'missing'}`);
  add('status refresh step array', steps.length > 0, `${steps.length} step(s)`);
  add('status refresh step summary count', Number(report.summary?.steps || 0) === steps.length, `${report.summary?.steps ?? 'missing'} expected ${steps.length}`);
  add('status refresh blocker summary', Number(report.summary?.blockers || 0) === failedSteps.length, `${report.summary?.blockers ?? 'missing'} expected ${failedSteps.length}`);
  add('status refresh warning summary', Number(report.summary?.warnings || 0) === 0, `${report.summary?.warnings ?? 'missing'} expected 0`);
  add('status refresh all steps passed', failedSteps.length === 0, failedSteps.map((step) => `${step.script}: ${step.status}`).join('; ') || 'all steps ok');
  add('status refresh required script definition sanity', duplicateRequiredScripts.length === 0, duplicateRequiredScripts.length ? duplicateRequiredScripts.join(', ') : 'no duplicate required scripts');

  for (const script of requiredScripts) {
    const count = steps.filter((step) => step.script === script).length;
    add(`status refresh step ${script}`, count > 0, count ? `${count} occurrence(s)` : 'missing');
  }

  for (const [before, after, beforeMode = 'first', afterMode = 'first'] of orderConstraints) {
    const beforeIndex = stepIndex(steps, before, beforeMode);
    const afterIndex = stepIndex(steps, after, afterMode);
    add(
      `status refresh order ${before} before ${after}`,
      beforeIndex >= 0 && afterIndex >= 0 && beforeIndex < afterIndex,
      `before=${beforeIndex} (${beforeMode}) after=${afterIndex} (${afterMode})`,
    );
  }

  add(
    'status refresh convergence pass coverage',
    steps.some((step) => /convergence pass 1/.test(step.detail || '')) &&
      steps.some((step) => /convergence pass 2/.test(step.detail || '')),
    'requires convergence pass 1 and 2 steps',
  );
  add(
    'status refresh parity before evidence detail',
    steps.some((step) => step.script === 'verify:release:ui-parity' && /before evidence hashing/.test(step.detail || '')) &&
      steps.some((step) => step.script === 'verify:release:performance-parity' && /before evidence hashing/.test(step.detail || '')),
    'UI and performance parity steps must run before evidence hashing',
  );
  add(
    'status refresh installed bundle delta before evidence detail',
    steps.some((step) => step.script === 'release:installed-bundle-delta' && /before evidence hashing/.test(step.detail || '')),
    'installed bundle delta evidence must run before evidence hashing',
  );
  add(
    'status refresh local release evidence before hashing detail',
    [
      'verify:release:macos-security',
      'verify:release:ipc-security',
      'verify:release:dmg-install',
      'verify:release:launch',
      'verify:release:dmg-launch',
      'verify:update-channel',
      'verify:release-tag',
    ].every((script) => steps.some((step) => step.script === script && /before evidence hashing/.test(step.detail || ''))),
    'macOS, IPC, DMG install, launch, update channel, and release tag reports must run before evidence hashing',
  );

  for (const [label, key] of cleanReportKeys) {
    const item = report.reports?.[key];
    const counts = summary(item);
    const clean = Boolean(item) && counts.blockers === 0 && counts.warnings === 0;
    const commercialCutoverConverged = key === 'commercialCutover' && Boolean(item) && currentCommercialCutoverConverged(counts);
    const expectedExternalGate = Boolean(item) && expectedExternalGateReport(key, counts);
    const detail = item
      ? `${counts.blockers} blocker(s), ${counts.warnings} warning(s)${
          commercialCutoverConverged ? '; accepted bounded status-refresh self-check convergence' : ''
        }${expectedExternalGate ? '; accepted expected external gate diagnostic' : ''
        }`
      : 'missing';
    add(`status refresh report clean ${label}`, clean || commercialCutoverConverged || expectedExternalGate, detail);
  }

  for (const key of freshReportKeys) {
    const item = report.reports?.[key];
    if (!item?.generatedAt) {
      add(`status refresh report freshness ${key}`, false, 'missing generatedAt');
      continue;
    }
    const itemTime = generatedAtMs(item.generatedAt);
    add(
      `status refresh report freshness ${key}`,
      startedAt > 0 && generatedAt > 0 && itemTime >= startedAt && itemTime <= generatedAt,
      `report=${item.generatedAt} window=${report.startedAt || 'missing'}..${report.generatedAt || 'missing'}`,
    );
  }

  add('status refresh UI parity strict clean', summary(report.reports?.uiParity).blockers === 0 && summary(report.reports?.uiParity).warnings === 0, JSON.stringify(report.reports?.uiParity?.summary || null));
  add('status refresh performance parity strict clean', summary(report.reports?.performanceParity).blockers === 0 && summary(report.reports?.performanceParity).warnings === 0, JSON.stringify(report.reports?.performanceParity?.summary || null));
  const installedBundleDelta = report.reports?.installedBundleDelta;
  const installedBundleDeltaCounts = summary(installedBundleDelta);
  add('status refresh installed bundle delta report present', Boolean(installedBundleDelta), installedBundleDelta ? installedBundleDelta.status || 'present' : 'missing');
  add('status refresh installed bundle delta evidence clean', installedBundleDeltaCounts.blockers === 0 && installedBundleDeltaCounts.warnings === 0, `${installedBundleDeltaCounts.blockers} blocker(s), ${installedBundleDeltaCounts.warnings} warning(s)`);
  add('status refresh installed bundle ASAR policy retained', installedBundleDelta?.summary?.appAsarApprovedByPolicy === true, `appAsarApprovedByPolicy=${installedBundleDelta?.summary?.appAsarApprovedByPolicy}`);
  add('status refresh installed bundle macOS metadata policy retained', installedBundleDelta?.summary?.macosMetadataApprovedByPolicy === true, `macosMetadataApprovedByPolicy=${installedBundleDelta?.summary?.macosMetadataApprovedByPolicy}`);
  add('status refresh installed bundle commercial signature gate retained', installedBundleDelta?.summary?.candidateCommercialSignature === false || installedBundleDelta?.summary?.candidateCommercialSignature === true, `candidateCommercialSignature=${installedBundleDelta?.summary?.candidateCommercialSignature}`);
  const remoteBaselineApproval = report.reports?.remoteBaselineApproval;
  const remoteBaselineApprovalCounts = summary(remoteBaselineApproval);
  const remoteBaselineApproved = remoteBaselineApproval?.approvedForBaselineUrl === true;
  add(
    'status refresh remote baseline approval gate captured',
    Boolean(remoteBaselineApproval) &&
      (
        (remoteBaselineApproved && remoteBaselineApprovalCounts.blockers === 0 && remoteBaselineApprovalCounts.warnings === 0) ||
        (!remoteBaselineApproved &&
          remoteBaselineApproval.status === 'not-approved-for-baseline-url' &&
          remoteBaselineApprovalCounts.blockers > 0 &&
          remoteBaselineApprovalCounts.warnings === 0)
      ),
    remoteBaselineApproval
      ? `status=${remoteBaselineApproval.status || 'missing'}, approved=${remoteBaselineApproval.approvedForBaselineUrl}, ${remoteBaselineApprovalCounts.blockers} blocker(s), ${remoteBaselineApprovalCounts.warnings} warning(s)`
      : 'missing',
  );
  add('status refresh strict evidence report mode', report.reports?.strictEvidence?.strict === true && report.reports?.strictEvidence?.noExit === true, `strict=${report.reports?.strictEvidence?.strict}, noExit=${report.reports?.strictEvidence?.noExit}`);
  add('status refresh local candidate readiness retained', report.reports?.readiness?.localCandidateReady === true, `localCandidateReady=${report.reports?.readiness?.localCandidateReady}`);
  add('status refresh production readiness externally gated', report.reports?.readiness?.productionReady === false || report.reports?.readiness?.productionReady === true, `productionReady=${report.reports?.readiness?.productionReady}`);
  add('status refresh commercial readiness report present', Boolean(report.reports?.commercialReleaseReadiness), report.reports?.commercialReleaseReadiness ? report.reports.commercialReleaseReadiness.status || 'present' : 'missing');
  add('status refresh commercial readiness local candidate retained', report.reports?.commercialReleaseReadiness?.localCandidateReady === true, `localCandidateReady=${report.reports?.commercialReleaseReadiness?.localCandidateReady}`);
  add('status refresh commercial readiness externally gated', report.reports?.commercialReleaseReadiness?.commercialReady === false || report.reports?.commercialReleaseReadiness?.commercialReady === true, `commercialReady=${report.reports?.commercialReleaseReadiness?.commercialReady}`);
  add('status refresh commercial readiness source coverage', Number(report.reports?.commercialReleaseReadiness?.summary?.sources || 0) >= 38, `${report.reports?.commercialReleaseReadiness?.summary?.sources ?? 'missing'} source(s)`);
  const commercialReadiness = readJson('release/commercial-release-readiness-report.strict.json');
  const commercialInstalledBundleDeltaSource = (commercialReadiness?.sources || []).find((source) => source.path === 'release/installed-bundle-delta-report.json');
  add(
    'status refresh commercial readiness installed bundle delta source',
    commercialInstalledBundleDeltaSource?.generatedAt === installedBundleDelta?.generatedAt,
    `commercial=${commercialInstalledBundleDeltaSource?.generatedAt || 'missing'} statusRefresh=${installedBundleDelta?.generatedAt || 'missing'}`,
  );
  add('status refresh secret material scan', !hasSecretMaterial(reportText), 'no private key, certificate body, GitHub token, or API key literal patterns');

  checkEvidenceParityFreshness();
  writeReport();
}

main();
