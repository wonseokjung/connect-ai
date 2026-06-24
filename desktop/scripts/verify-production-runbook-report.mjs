import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const requireProduction = process.argv.includes('--require-production');
const checks = [];

const runbookPath = 'release/production-release-runbook-report.json';
const reportPath = strict
  ? 'release/production-release-runbook-report-verification.strict.json'
  : 'release/production-release-runbook-report-verification.json';

const coreStageIds = [
  'release-env-contract',
  'release-env-check',
  'github-setup-dry-run',
  'github-operator-readiness',
  'signing-readiness',
  'signing-strict-check',
  'release-preflight',
  'promotion-plan',
  'asset-manifest',
  'baseline-freshness',
  'publish-plan',
  'verify-publish-plan',
  'verify-remote-assets',
  'remote-remediation-plan',
  'verify-remote-remediation-plan',
  'remote-remediation-apply-plan',
  'verify-remote-remediation-apply-plan',
  'readiness-summary',
  'unblock-plan',
  'verify-unblock-plan',
  'publication-seal',
  'setup-plan',
  'credential-handoff',
  'verify-credential-handoff',
  'asset-manifest-final',
  'publication-seal-final',
  'verify-asset-manifest',
  'commercial-finalization',
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

function readText(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function asNumber(value) {
  return Number(value || 0);
}

function summarize(guards, stages) {
  const guardBlockers = guards.filter((check) => !check.ok && check.level === 'blocker');
  const guardWarnings = guards.filter((check) => !check.ok && check.level === 'warn');
  const failedRequired = stages.filter((item) => item.enabled && item.required && item.ok !== true);
  const failedOptional = stages.filter((item) => item.enabled && !item.required && item.ok !== true);
  const skippedRequired = stages.filter((item) => !item.enabled && item.required);
  return {
    guardBlockers,
    guardWarnings,
    failedRequired,
    failedOptional,
    skippedRequired,
    summary: {
      blockers: guardBlockers.length + failedRequired.length,
      warnings: guardWarnings.length + failedOptional.length,
      passed: stages.filter((item) => item.status === 'passed').length,
      skipped: stages.filter((item) => item.status === 'skipped').length,
      failed: stages.filter((item) => item.status === 'failed').length,
    },
  };
}

function expectedStatus(summary, gates) {
  if (asNumber(summary?.blockers) > 0) {
    return gates?.localCandidateReady ? 'local-candidate-awaiting-external-setup' : 'blocked';
  }
  if (gates?.commercialFinalization?.commercialReady === true) return 'commercial-ready';
  if (gates?.publishedReleaseReady) return 'published-release-ready';
  if (gates?.productionReady) return 'production-ready';
  if (gates?.localCandidateReady) return 'local-candidate-ready';
  return 'diagnostic-complete';
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

function stageIndex(stages, id) {
  return stages.findIndex((stage) => stage.id === id);
}

function stageCommandText(stages) {
  return stages
    .map((stage) => `${stage.id || ''}\n${stage.command || ''}\n${stage.title || ''}\n${(stage.reportPaths || []).join('\n')}`)
    .join('\n');
}

function writeReport() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireProduction,
    source: runbookPath,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI production runbook report verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${reportPath}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const runbook = readJson(runbookPath);
  add('production runbook report exists', Boolean(runbook && !runbook.parseError), runbook?.parseError || runbookPath);
  if (!runbook || runbook.parseError) {
    writeReport();
    return;
  }

  const guards = Array.isArray(runbook.guards) ? runbook.guards : [];
  const stages = Array.isArray(runbook.stages) ? runbook.stages : [];
  const stageIds = new Set(stages.map((stage) => stage.id));
  const missingCoreStages = coreStageIds.filter((id) => !stageIds.has(id));
  const duplicateStageIds = stages
    .map((stage) => stage.id)
    .filter((id, index, ids) => id && ids.indexOf(id) !== index);
  const actual = summarize(guards, stages);
  const expected = expectedStatus(runbook.summary, runbook.gateSnapshot);
  const gateSnapshot = runbook.gateSnapshot || {};
  const serialized = JSON.stringify(runbook);
  const safetyRulesText = (runbook.safetyRules || []).join('\n');
  const commandText = stageCommandText(stages);
  const runbookSourceText = readText('scripts/run-production-release.mjs');
  const commercialFinalizationStage = stages.find((stage) => stage.id === 'commercial-finalization');
  const postPublishCommercialStage = stages.find((stage) => stage.id === 'post-publish-commercial-finalization');
  const readinessNextActions = Array.isArray(gateSnapshot.readiness?.nextActions)
    ? gateSnapshot.readiness.nextActions
    : [];
  const publicationSealNextActions = Array.isArray(gateSnapshot.publicationSeal?.nextActions)
    ? gateSnapshot.publicationSeal.nextActions
    : [];
  const uploadPermissionActions = [...readinessNextActions, ...publicationSealNextActions]
    .filter((action) => action.id === 'remote-remediation-upload-permission-ready');
  const uploadPermissionDetails = JSON.stringify(uploadPermissionActions.flatMap((action) => action.detail || []));
  const uploadPermissionActionCount = asNumber(gateSnapshot.commercialReadiness?.summary?.remoteApplyActions);
  const uploadPermissionRequired = asNumber(gateSnapshot.commercialReadiness?.summary?.remoteApplyActions) > 0 &&
    gateSnapshot.commercialReadiness?.summary?.remoteUploadPermissionReady === false;
  const commercialFinalization = gateSnapshot.commercialFinalization || {};
  const commercialCoverage = commercialFinalization.commercialBlockerCoverage || {};
  const commercialCoverageItems = Array.isArray(commercialCoverage.items) ? commercialCoverage.items : [];
  const expectedCommercialBlockers = asNumber(
    gateSnapshot.commercialReadiness?.summary?.blockers ||
      commercialFinalization.summary?.commercialReadinessBlockersTotal ||
      commercialCoverage.total,
  );
  const externalCoverage = runbook.blockerDetails?.externalBlockerCoverage || {};
  const finalizationFailedNames = Array.isArray(commercialFinalization.failedChecks)
    ? commercialFinalization.failedChecks.map((check) => check.name || '')
    : [];
  const pendingFinalizationRefresh = commercialFinalization.status === 'commercial-finalization-blocked' &&
    finalizationFailedNames.length > 0 &&
    finalizationFailedNames.every((name) => [
      'status refresh verification clean',
      'commercial cutover verification clean',
      'commercial readiness blocker coverage',
    ].includes(name));

  add('production runbook schema version', runbook.schemaVersion === 1, String(runbook.schemaVersion));
  add('production runbook generatedAt', Number.isFinite(Date.parse(runbook.generatedAt || '')), runbook.generatedAt || 'missing');
  add('production runbook status', runbook.status === expected, `${runbook.status || 'missing'} expected ${expected}`);
  add('production runbook readiness booleans', typeof runbook.productionReady === 'boolean' && typeof runbook.localCandidateReady === 'boolean' && typeof runbook.publishedReleaseReady === 'boolean' && typeof runbook.commercialReady === 'boolean', `productionReady=${runbook.productionReady}, localCandidateReady=${runbook.localCandidateReady}, publishedReleaseReady=${runbook.publishedReleaseReady}, commercialReady=${runbook.commercialReady}`);
  add('production runbook gate snapshot object', Boolean(runbook.gateSnapshot && typeof runbook.gateSnapshot === 'object'), runbook.gateSnapshot ? 'present' : 'missing');
  add(
    'production runbook upload permission gate snapshot',
    !uploadPermissionRequired ||
      (uploadPermissionActions.length > 0 &&
        uploadPermissionDetails.includes('viewerPermission=READ') &&
        uploadPermissionDetails.includes('canUploadReleaseAssets=false') &&
        uploadPermissionDetails.includes(`actions=${uploadPermissionActionCount}`)),
    uploadPermissionRequired
      ? uploadPermissionDetails || 'missing remote remediation upload permission action'
      : 'remote upload permission currently ready or no remediation upload required',
  );
  add('production runbook production gate projection', runbook.productionReady === Boolean(gateSnapshot.productionReady && asNumber(runbook.summary?.blockers) === 0), `reported=${runbook.productionReady} gate=${gateSnapshot.productionReady} blockers=${runbook.summary?.blockers ?? 'missing'}`);
  add('production runbook local candidate projection', runbook.localCandidateReady === Boolean(gateSnapshot.localCandidateReady), `reported=${runbook.localCandidateReady} gate=${gateSnapshot.localCandidateReady}`);
  add('production runbook published gate projection', runbook.publishedReleaseReady === Boolean(gateSnapshot.publishedReleaseReady && asNumber(runbook.summary?.blockers) === 0), `reported=${runbook.publishedReleaseReady} gate=${gateSnapshot.publishedReleaseReady} blockers=${runbook.summary?.blockers ?? 'missing'}`);
  add('production runbook commercial gate projection', runbook.commercialReady === Boolean(gateSnapshot.commercialFinalization?.commercialReady === true && asNumber(runbook.summary?.blockers) === 0), `reported=${runbook.commercialReady} gate=${gateSnapshot.commercialFinalization?.commercialReady} blockers=${runbook.summary?.blockers ?? 'missing'}`);
  add('production runbook commercial finalization commercialReady snapshot', typeof commercialFinalization.commercialReady === 'boolean', `commercialReady=${commercialFinalization.commercialReady}`);
  add('production runbook commercial blocker coverage object', Boolean(commercialFinalization.commercialBlockerCoverage), commercialFinalization.commercialBlockerCoverage ? 'present' : 'missing');
  add(
    'production runbook commercial blocker coverage total',
    expectedCommercialBlockers === 0 ||
      (asNumber(commercialCoverage.total) === expectedCommercialBlockers &&
        asNumber(commercialFinalization.summary?.commercialReadinessBlockersTotal) === expectedCommercialBlockers),
    `coverage=${commercialCoverage.total ?? 'missing'} summary=${commercialFinalization.summary?.commercialReadinessBlockersTotal ?? 'missing'} expected=${expectedCommercialBlockers}`,
  );
  add(
    'production runbook commercial blocker coverage complete',
    expectedCommercialBlockers === 0 ||
      pendingFinalizationRefresh ||
      (asNumber(commercialCoverage.covered) === expectedCommercialBlockers &&
        asNumber(commercialCoverage.uncovered) === 0 &&
        asNumber(commercialFinalization.summary?.commercialReadinessBlockersCovered) === expectedCommercialBlockers &&
        asNumber(commercialFinalization.summary?.commercialReadinessBlockersUncovered) === 0),
    pendingFinalizationRefresh
      ? `pending finalization refresh after status graph convergence; previous coverage=${commercialCoverage.covered ?? 'missing'}/${commercialCoverage.total ?? 'missing'}`
      : `covered=${commercialCoverage.covered ?? 'missing'}/${expectedCommercialBlockers}, uncovered=${commercialCoverage.uncovered ?? 'missing'}`,
  );
  add(
    'production runbook commercial blocker coverage items',
    expectedCommercialBlockers === 0 ||
      pendingFinalizationRefresh ||
      (commercialCoverageItems.length === expectedCommercialBlockers &&
        commercialCoverageItems.every((item) => item.classified === true && item.covered === true)),
    pendingFinalizationRefresh
      ? `pending finalization refresh; failed checks=${finalizationFailedNames.join(', ')}`
      : `${commercialCoverageItems.length} item(s), ${commercialCoverageItems.filter((item) => item.covered !== true).length} uncovered`,
  );
  add(
    'production runbook external blocker coverage summary',
    pendingFinalizationRefresh ||
      (asNumber(externalCoverage.commercialReadinessBlockers) === expectedCommercialBlockers &&
        asNumber(externalCoverage.commercialReadinessBlockersCovered) === expectedCommercialBlockers &&
        asNumber(externalCoverage.commercialReadinessBlockersUncovered) === 0 &&
        asNumber(externalCoverage.remoteApplyActions) === uploadPermissionActionCount),
    pendingFinalizationRefresh
      ? `pending finalization refresh after runbook/status-refresh convergence; commercial=${externalCoverage.commercialReadinessBlockersCovered ?? 'missing'}/${externalCoverage.commercialReadinessBlockers ?? 'missing'}`
      : `commercial=${externalCoverage.commercialReadinessBlockersCovered ?? 'missing'}/${externalCoverage.commercialReadinessBlockers ?? 'missing'}, remoteApply=${externalCoverage.remoteApplyActions ?? 'missing'} expected ${uploadPermissionActionCount}`,
  );
  add('production runbook strict mode metadata', strict ? runbook.mode?.strict === true : typeof runbook.mode?.strict === 'boolean', `mode.strict=${runbook.mode?.strict}`);
  add('production runbook source metadata', typeof runbook.source === 'string' && runbook.source.length > 0, runbook.source || 'missing');
  add('production runbook envFile metadata', hasOwn(runbook, 'envFile') && (runbook.mode?.processEnv === true ? runbook.envFile === null : typeof runbook.envFile === 'string'), `envFile=${runbook.envFile}`);
  add('production runbook guard array', Array.isArray(runbook.guards), `${guards.length} guard(s)`);
  add('production runbook stage array', Array.isArray(runbook.stages) && stages.length >= coreStageIds.length, `${stages.length} stage(s)`);
  add('production runbook stage ids', missingCoreStages.length === 0, missingCoreStages.length ? `missing ${missingCoreStages.join(', ')}` : 'core stage ids present');
  add('production runbook duplicate stage ids', duplicateStageIds.length === 0, duplicateStageIds.length ? duplicateStageIds.join(', ') : 'none');
  add(
    'production runbook remote remediation stage order',
    stageIndex(stages, 'verify-publish-plan') >= 0 &&
      stageIndex(stages, 'verify-remote-assets') > stageIndex(stages, 'verify-publish-plan') &&
      stageIndex(stages, 'remote-remediation-plan') > stageIndex(stages, 'verify-remote-assets') &&
      stageIndex(stages, 'verify-remote-remediation-plan') > stageIndex(stages, 'remote-remediation-plan') &&
      stageIndex(stages, 'remote-remediation-apply-plan') > stageIndex(stages, 'verify-remote-remediation-plan') &&
      stageIndex(stages, 'verify-remote-remediation-apply-plan') > stageIndex(stages, 'remote-remediation-apply-plan') &&
      stageIndex(stages, 'readiness-summary') > stageIndex(stages, 'verify-remote-remediation-apply-plan'),
    'verify publish plan -> verify remote assets -> remediation plan -> verify remediation plan -> dry-run apply plan -> verify dry-run apply plan -> readiness summary',
  );
  add(
    'production runbook commercial finalization stage order',
    stageIndex(stages, 'commercial-finalization') > stageIndex(stages, 'verify-asset-manifest'),
    'verify asset manifest -> commercial finalization',
  );
  add(
    'production runbook remote remediation commands',
    commandText.includes('verify:github-release-assets:strict:report') &&
      commandText.includes('release:github-release-remediation-plan') &&
      commandText.includes('verify:github-release-remediation-plan:strict:report') &&
      commandText.includes('release:github-release-remediation-apply:plan') &&
      commandText.includes('verify:github-release-remediation-apply-plan:strict:report') &&
      commandText.includes('release/github-release-remediation-apply-plan.json') &&
      commandText.includes('release/github-release-remediation-apply-plan-report.strict.json'),
    'remote asset drift, remediation plan, strict verifier, dry-run apply plan, and dry-run apply verifier commands are present',
  );
  add(
    'production runbook commercial finalization commands',
    commandText.includes('release:commercial-finalize') &&
      commandText.includes('release/commercial-finalization-report.json') &&
      commandText.includes('release/COMMERCIAL_FINALIZATION.md') &&
      commandText.includes('release/commercial-finalization-report-verification.strict.json'),
    'commercial finalization command, report paths, and strict verifier report are present',
  );
  add(
    'production runbook diagnostic finalization deferral',
    runbook.mode?.noExit !== true ||
      (commercialFinalizationStage?.enabled === false &&
        commercialFinalizationStage?.status === 'skipped' &&
        (commercialFinalizationStage?.skippedReason || '').includes('status-refresh') &&
        (commercialFinalizationStage?.skippedReason || '').includes('release:commercial-finalize')),
    runbook.mode?.noExit === true
      ? `${commercialFinalizationStage?.status || 'missing'} - ${commercialFinalizationStage?.skippedReason || 'missing skipped reason'}`
      : 'not a no-exit diagnostic runbook',
  );
  add(
    'production runbook publish commercial finalization source',
    runbookSourceText.includes('post-publish-published-gate') &&
      runbookSourceText.includes('verify:publication-seal:published') &&
      runbookSourceText.includes('post-publish-commercial-finalization') &&
      runbookSourceText.includes('release:commercial-finalize:commercial') &&
      runbookSourceText.indexOf('post-publish-commercial-finalization') > runbookSourceText.indexOf('post-publish-published-gate'),
    'published gate source stage is followed by commercial-ready finalization source stage',
  );
  add(
    'production runbook publish commercial finalization stage',
    !postPublishCommercialStage ||
      (postPublishCommercialStage.command === 'npm run release:commercial-finalize:commercial' &&
        (postPublishCommercialStage.reportPaths || []).includes('release/commercial-finalization-report.json') &&
        (postPublishCommercialStage.reportPaths || []).includes('release/COMMERCIAL_FINALIZATION.md') &&
        (postPublishCommercialStage.reportPaths || []).includes('release/commercial-finalization-report-verification.strict.json')),
    postPublishCommercialStage
      ? `${postPublishCommercialStage.command || 'missing command'} with ${(postPublishCommercialStage.reportPaths || []).join(', ')}`
      : 'publish stage absent in non-publish runbook report',
  );
  add('production runbook stage status vocabulary', stages.every((stage) => ['passed', 'skipped', 'failed'].includes(stage.status)), 'expected passed/skipped/failed statuses');
  add('production runbook summary blockers', asNumber(runbook.summary?.blockers) === actual.summary.blockers, `${runbook.summary?.blockers ?? 'missing'} expected ${actual.summary.blockers}`);
  add('production runbook summary warnings', asNumber(runbook.summary?.warnings) === actual.summary.warnings, `${runbook.summary?.warnings ?? 'missing'} expected ${actual.summary.warnings}`);
  add('production runbook summary passed', asNumber(runbook.summary?.passed) === actual.summary.passed, `${runbook.summary?.passed ?? 'missing'} expected ${actual.summary.passed}`);
  add('production runbook summary skipped', asNumber(runbook.summary?.skipped) === actual.summary.skipped, `${runbook.summary?.skipped ?? 'missing'} expected ${actual.summary.skipped}`);
  add('production runbook summary failed', asNumber(runbook.summary?.failed) === actual.summary.failed, `${runbook.summary?.failed ?? 'missing'} expected ${actual.summary.failed}`);
  add('production runbook blocker details object', Boolean(runbook.blockerDetails && typeof runbook.blockerDetails === 'object'), runbook.blockerDetails ? 'present' : 'missing');
  add('production runbook guard blocker details', (runbook.blockerDetails?.guardBlockers || []).length === actual.guardBlockers.length, `${runbook.blockerDetails?.guardBlockers?.length ?? 'missing'} expected ${actual.guardBlockers.length}`);
  add('production runbook failed required stage details', (runbook.blockerDetails?.failedRequiredStages || []).length === actual.failedRequired.length, `${runbook.blockerDetails?.failedRequiredStages?.length ?? 'missing'} expected ${actual.failedRequired.length}`);
  add('production runbook skipped required stage details', (runbook.blockerDetails?.skippedRequiredStages || []).length === actual.skippedRequired.length, `${runbook.blockerDetails?.skippedRequiredStages?.length ?? 'missing'} expected ${actual.skippedRequired.length}`);
  add('production runbook safety rules', Array.isArray(runbook.safetyRules) && runbook.safetyRules.length > 0, `${runbook.safetyRules?.length || 0} rule(s)`);
  add(
    'production runbook remote remediation safety rule',
    safetyRulesText.includes('release:github-release-remediation-apply:plan') &&
      safetyRulesText.includes('verify:github-release-remediation-apply-plan:strict:report') &&
      safetyRulesText.includes('verify:github-release-assets:strict:report'),
    'runbook documents dry-run remote remediation and verifier before readiness refresh',
  );
  add(
    'production runbook commercial finalization safety rule',
    safetyRulesText.includes('release:commercial-finalize') &&
      safetyRulesText.includes('commercialReady=true'),
    'runbook documents final commercial readiness confirmation',
  );
  add(
    'production runbook commercial blocker coverage safety rule',
    safetyRulesText.includes('commercialBlockerCoverage') &&
      safetyRulesText.includes('Commercial readiness blockers'),
    'runbook documents commercial blocker coverage before external setup is treated as actionable',
  );
  add('production runbook safety rules secret scan', !hasSecretMaterial(safetyRulesText), 'no private key, certificate body, GitHub token, or API key literal patterns');
  add('production runbook secret material scan', !hasSecretMaterial(serialized), 'no private key, certificate body, GitHub token, or API key literal patterns');

  if (requireProduction) {
    add('production runbook require production', runbook.productionReady === true && asNumber(runbook.summary?.blockers) === 0, `productionReady=${runbook.productionReady}, blockers=${runbook.summary?.blockers ?? 'missing'}`);
  }

  writeReport();
}

main();
