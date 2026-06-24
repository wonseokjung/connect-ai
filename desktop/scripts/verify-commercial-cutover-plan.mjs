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
const checks = [];

const planPath = 'release/commercial-cutover-plan.json';
const markdownPath = 'release/COMMERCIAL_CUTOVER_PLAN.md';
const reportPath = strict
  ? 'release/commercial-cutover-plan-report.strict.json'
  : 'release/commercial-cutover-plan-report.json';

const requiredPhaseIds = [
  'engineering-candidate-freeze',
  'external-credential-handoff',
  'signed-notarized-production-build',
  'remote-release-asset-remediation',
  'published-release-seal',
];
const requiredSourcePaths = [
  'release/engineering-readiness-report.json',
  'release/production-readiness-summary.json',
  'release/release-publication-seal.json',
  'release/release-credential-handoff.json',
  'release/release-credential-handoff-report.strict.json',
  'release/release-setup-plan.json',
  'release/release-setup-plan-report.strict.json',
  'release/remote-baseline-approval-report.strict.json',
  'release/release-env-bootstrap.json',
  'release/release-env-bootstrap-report.strict.json',
  'release/release-unblock-plan.json',
  'release/github-release-remediation-plan.json',
  'release/github-release-remediation-apply-plan.json',
  'release/github-release-remediation-apply-plan-report.strict.json',
  'release/github-release-assets-report.strict.json',
  'release/github-release-publish-plan.json',
  'release/release-asset-manifest.json',
  'release/status-refresh-report.json',
  'release/status-refresh-report-verification.strict.json',
  'release/preflight-report.json',
  'release/preflight-report.strict.json',
  'release/baseline-export-report-verification.strict.json',
];
const requiredCommands = [
  'release:status-refresh',
  'release:engineering-readiness',
  'release:env-bootstrap',
  'verify:env-bootstrap:strict:report',
  'verify:credential-handoff:strict:report',
  'verify:setup-plan:strict:report',
  'release:operator-checklist:github:strict:report:env',
  'release:operator-runbook:process:apply',
  'verify:release:env',
  'verify:publication-seal:production',
  'verify:github-release-assets:strict:env',
  'release:github-release-remediation-plan',
  'verify:github-release-remediation-plan:published',
  'release:github-release-remediation-apply:plan',
  'release:github-release-remediation-apply:env',
  'release:operator-runbook:process:publish',
  'verify:publication-seal:published',
  'verify:status-refresh-report:strict:report',
];
const volatileSourcePaths = new Set([
  'release/status-refresh-report.json',
  'release/preflight-report.json',
  'release/preflight-report.strict.json',
  'release/release-asset-manifest.json',
  'release/asset-manifest-report.json',
]);

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

function sourcePathSet(sources) {
  return new Set((sources || []).map((source) => source.path).filter(Boolean));
}

function allCommandText(plan) {
  return (plan?.cutoverPhases || [])
    .flatMap((phase) => [...(phase.commands || []), ...(phase.validation || [])])
    .map((item) => `${item.step || ''}\n${item.command || ''}\n${item.note || ''}`)
    .join('\n');
}

function commandTextFrom(commands) {
  return (Array.isArray(commands) ? commands : [])
    .map((item) => `${item.step || ''}\n${item.command || ''}`)
    .join('\n');
}

function cleanStrictReport(report) {
  const value = summary(report);
  return Boolean(report && !report.parseError && value.blockers === 0 && value.warnings === 0);
}

function remoteBaselineGuardExpected(setupPlan, credentialHandoff, setupVerification, credentialVerification) {
  const setupCandidate = setupPlan?.remoteBaselineCandidate || null;
  const handoffCandidate = credentialHandoff?.remoteBaselineCandidate || null;
  const candidate = setupCandidate || handoffCandidate || {};
  const status = candidate.status || 'missing';
  const expectedSha = candidate.expectedBaselineSha256 || '';
  const validation = `${commandTextFrom(setupCandidate?.validationCommands)}\n${commandTextFrom(handoffCandidate?.validationCommands)}`;
  const safetyRules = (setupPlan?.safetyRules || []).join('\n');
  const setupVerified = cleanStrictReport(setupVerification);
  const handoffVerified = cleanStrictReport(credentialVerification);
  const validationDocumented = validation.includes('gh release download') && validation.includes('shasum -a 256');
  const safetyRuleDocumented = safetyRules.includes('same-name Connect AI zip') &&
    safetyRules.includes('SHA-256 matches release/Connect-AI-0.4.8-baseline-arm64-mac.zip');
  return Boolean(
    setupCandidate &&
      handoffCandidate &&
      ['missing', 'not-approved-baseline-url', 'size-match-sha-unverified'].includes(status) &&
      setupCandidate.status === handoffCandidate.status &&
      setupCandidate.asset === handoffCandidate.asset &&
      (status !== 'not-approved-baseline-url' ||
        (candidate.remoteBytes !== candidate.expectedBaselineBytes && /^[a-f0-9]{64}$/i.test(expectedSha))) &&
      validationDocumented &&
      safetyRuleDocumented &&
      setupVerified &&
      handoffVerified
  );
}

function statusRefreshVerificationAcceptable(report) {
  if (!report || report.parseError || report.strict !== true) return false;
  const failed = (report.checks || []).filter((check) => check.ok !== true);
  return failed.every((check) => check.name === 'status refresh report clean commercial cutover');
}

function expectedStatus({ engineering, readiness, seal }) {
  const engineeringReady = engineering?.engineeringReady === true && Number(engineering?.summary?.blockers || 0) === 0;
  const localCandidateReady = engineering?.localCandidateReady === true || readiness?.localCandidateReady === true;
  const productionReady = readiness?.productionReady === true && seal?.productionReady === true;
  const publishedReleaseReady = readiness?.publishedReleaseReady === true && seal?.publishedReleaseReady === true;
  if (publishedReleaseReady) return 'published-commercial-ready';
  if (productionReady) return 'production-ready-awaiting-publication';
  if (engineeringReady) return 'engineering-ready-awaiting-commercial-cutover';
  if (localCandidateReady) return 'local-candidate-awaiting-commercial-cutover';
  return 'engineering-gates-incomplete';
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

function writeReport() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireProduction,
    requirePublished,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI commercial cutover plan verification (${strict ? 'strict' : 'local'})`);
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
  const markdown = fileExists(markdownPath) ? fs.readFileSync(path.join(desktopDir, markdownPath), 'utf8') : '';
  const engineering = readJson('release/engineering-readiness-report.json');
  const readiness = readJson('release/production-readiness-summary.json');
  const seal = readJson('release/release-publication-seal.json');
  const credential = readJson('release/release-credential-handoff.json');
  const credentialVerification = readJson('release/release-credential-handoff-report.strict.json');
  const unblock = readJson('release/release-unblock-plan.json');
  const remediation = readJson('release/github-release-remediation-plan.json');
  const remediationApplyPlan = readJson('release/github-release-remediation-apply-plan.json');
  const remediationApplyVerification = readJson('release/github-release-remediation-apply-plan-report.strict.json');
  const baselineExportVerification = readJson('release/baseline-export-report-verification.strict.json');
  const statusRefreshVerification = readJson('release/status-refresh-report-verification.strict.json');
  const releaseSetup = readJson('release/release-setup-plan.json');
  const releaseSetupVerification = readJson('release/release-setup-plan-report.strict.json');
  const remoteBaselineApproval = readJson('release/remote-baseline-approval-report.strict.json');

  add('commercial cutover plan exists', Boolean(plan && !plan.parseError), plan?.parseError || planPath);
  add('commercial cutover markdown exists', fileExists(markdownPath), markdownPath);
  if (!plan || plan.parseError) {
    writeReport();
    return;
  }

  const phaseIds = (plan.cutoverPhases || []).map((phase) => phase.id);
  const duplicatePhaseIds = phaseIds.filter((id, index) => phaseIds.indexOf(id) !== index);
  const sourcePaths = sourcePathSet(plan.sourceReports);
  const blockedCredentialGroups = (credential?.credentialGroups || []).filter((group) => group.status !== 'ready').length;
  const unblockGroups = unblock?.unblockGroups || [];
  const blockedUnblockGroups = unblockGroups.filter((group) => group.ok !== true && group.blocking !== false).length;
  const uploadPermission = credential?.githubReleaseUploadPermission || {};
  const remoteUploadPermissionReady = Boolean(
    uploadPermission.status === 'ready' ||
      Number(remediationApplyPlan?.summary?.actions || 0) === 0 ||
      remediationApplyPlan?.github?.canUploadReleaseAssets === true
  );
  const remoteRequiredActions = Number(credential?.remoteAssetRemediation?.requiredActions ?? remediation?.summary?.requiredActions ?? 0);
  const remoteAdvisoryActions = Number(credential?.remoteAssetRemediation?.advisoryActions ?? remediation?.summary?.advisoryReviews ?? 0);
  const commandText = allCommandText(plan);
  const expected = expectedStatus({ engineering, readiness, seal });
  const remoteBaselineGuardExpectedValue = remoteBaselineGuardExpected(releaseSetup, credential, releaseSetupVerification, credentialVerification);
  const remoteBaselineApprovalCounts = summary(remoteBaselineApproval);
  const remoteBaselineApprovalCaptured = Boolean(
    remoteBaselineApproval &&
      !remoteBaselineApproval.parseError &&
      (
        (remoteBaselineApproval.approvedForBaselineUrl === true &&
          remoteBaselineApproval.status === 'approved-for-baseline-url' &&
          remoteBaselineApprovalCounts.blockers === 0 &&
          remoteBaselineApprovalCounts.warnings === 0) ||
        (remoteBaselineApproval.approvedForBaselineUrl !== true &&
          remoteBaselineApproval.status === 'not-approved-for-baseline-url' &&
          remoteBaselineApprovalCounts.blockers > 0 &&
          remoteBaselineApprovalCounts.warnings === 0)
      )
  );
  const remoteBaselineApprovalReady = Boolean(
    remoteBaselineApprovalCaptured &&
      remoteBaselineApproval.approvedForBaselineUrl === true &&
      remoteBaselineApproval.status === 'approved-for-baseline-url'
  );

  add('commercial cutover schema version', plan.schemaVersion === 1, String(plan.schemaVersion));
  add('commercial cutover product version', plan.product?.version === pkg?.version, `${plan.product?.version || 'missing'} expected ${pkg?.version || 'missing'}`);
  add('commercial cutover product appId', plan.product?.appId === pkg?.build?.appId, `${plan.product?.appId || 'missing'} expected ${pkg?.build?.appId || 'missing'}`);
  add('commercial cutover status freshness', plan.status === expected, `${plan.status} expected ${expected}`);
  add('commercial cutover phase coverage', requiredPhaseIds.every((id) => phaseIds.includes(id)), `required=${requiredPhaseIds.join(', ')}`);
  add('commercial cutover duplicate phases', duplicatePhaseIds.length === 0, duplicatePhaseIds.length ? duplicatePhaseIds.join(', ') : 'none');
  add('commercial cutover recommended sequence', (plan.recommendedSequence || []).length === (plan.cutoverPhases || []).length, `${(plan.recommendedSequence || []).length} expected ${(plan.cutoverPhases || []).length}`);
  add('commercial cutover source report coverage', requiredSourcePaths.every((sourcePath) => sourcePaths.has(sourcePath)), `required=${requiredSourcePaths.join(', ')}`);
  add('commercial cutover missing source summary', plan.summary?.missingSourceReports === (plan.sourceReports || []).filter((source) => !source.present).length, `${plan.summary?.missingSourceReports} missing source report(s)`);

  for (const sourcePath of requiredSourcePaths) {
    const source = (plan.sourceReports || []).find((item) => item.path === sourcePath);
    add(`commercial cutover source listed ${sourcePath}`, Boolean(source), source ? 'listed' : 'missing');
    if (source) {
      add(`commercial cutover source presence ${sourcePath}`, source.present === fileExists(sourcePath), `reported=${source.present} actual=${fileExists(sourcePath)}`);
      const actual = readJson(sourcePath);
      if (actual?.generatedAt && !volatileSourcePaths.has(sourcePath)) {
        add(`commercial cutover source freshness ${sourcePath}`, source.generatedAt === actual.generatedAt, `reported=${source.generatedAt || 'missing'} actual=${actual.generatedAt}`);
      }
    }
  }

  add('commercial cutover engineering summary', plan.summary?.engineeringReady === (engineering?.engineeringReady === true && Number(engineering?.summary?.blockers || 0) === 0), `${plan.summary?.engineeringReady}`);
  add('commercial cutover local candidate summary', plan.summary?.localCandidateReady === (engineering?.localCandidateReady === true || readiness?.localCandidateReady === true), `${plan.summary?.localCandidateReady}`);
  add('commercial cutover production summary', plan.summary?.productionReady === (readiness?.productionReady === true && seal?.productionReady === true), `${plan.summary?.productionReady}`);
  add('commercial cutover published summary', plan.summary?.publishedReleaseReady === (readiness?.publishedReleaseReady === true && seal?.publishedReleaseReady === true), `${plan.summary?.publishedReleaseReady}`);
  add(
    'commercial cutover baseline export verification summary',
    plan.summary?.baselineExportVerified === (baselineExportVerification?.strict === true && summary(baselineExportVerification).blockers === 0 && summary(baselineExportVerification).warnings === 0),
    `${plan.summary?.baselineExportVerified}`,
  );
  add(
    'commercial cutover remote baseline guard summary',
    plan.summary?.remoteBaselineGuardVerified === remoteBaselineGuardExpectedValue &&
      plan.remoteBaselineGuard?.status === (releaseSetup?.remoteBaselineCandidate?.status || credential?.remoteBaselineCandidate?.status || 'missing') &&
      plan.remoteBaselineGuard?.setupVerified === cleanStrictReport(releaseSetupVerification) &&
      plan.remoteBaselineGuard?.credentialHandoffVerified === cleanStrictReport(credentialVerification),
    `reported=${plan.summary?.remoteBaselineGuardVerified}, expected=${remoteBaselineGuardExpectedValue}, status=${plan.remoteBaselineGuard?.status || 'missing'}`,
  );
  add(
    'commercial cutover remote baseline approval summary',
    plan.summary?.remoteBaselineApprovalReady === remoteBaselineApprovalReady &&
      plan.remoteBaselineGuard?.approvalReportCaptured === remoteBaselineApprovalCaptured &&
      plan.remoteBaselineGuard?.approvalReady === remoteBaselineApprovalReady &&
      plan.remoteBaselineGuard?.approvalStatus === (remoteBaselineApproval?.status || null) &&
      plan.remoteBaselineGuard?.approvedForBaselineUrl === (remoteBaselineApproval?.approvedForBaselineUrl ?? null),
    `reported=${plan.summary?.remoteBaselineApprovalReady}, expected=${remoteBaselineApprovalReady}, status=${remoteBaselineApproval?.status || 'missing'}, approved=${remoteBaselineApproval?.approvedForBaselineUrl}`,
  );
  add(
    'commercial cutover status refresh verification summary',
    plan.summary?.statusRefreshVerified === statusRefreshVerificationAcceptable(statusRefreshVerification),
    `${plan.summary?.statusRefreshVerified}`,
  );
  add(
    'commercial cutover status refresh verification acceptable',
    statusRefreshVerificationAcceptable(statusRefreshVerification),
    `strict=${statusRefreshVerification?.strict === true}, ${summary(statusRefreshVerification).blockers} blocker(s), ${summary(statusRefreshVerification).warnings} warning(s)`,
  );
  add('commercial cutover credential blocker summary', plan.summary?.blockedCredentialGroups === blockedCredentialGroups, `${plan.summary?.blockedCredentialGroups} expected ${blockedCredentialGroups}`);
  add('commercial cutover total unblock group summary', plan.summary?.totalUnblockGroups === unblockGroups.length, `${plan.summary?.totalUnblockGroups} expected ${unblockGroups.length}`);
  add('commercial cutover blocked unblock group summary', plan.summary?.blockedUnblockGroups === blockedUnblockGroups, `${plan.summary?.blockedUnblockGroups} expected ${blockedUnblockGroups}`);
  add('commercial cutover unblock group summary', plan.summary?.unblockGroups === blockedUnblockGroups, `${plan.summary?.unblockGroups} expected ${blockedUnblockGroups}`);
  add('commercial cutover remote upload permission summary', plan.summary?.remoteUploadPermissionReady === remoteUploadPermissionReady, `${plan.summary?.remoteUploadPermissionReady} expected ${remoteUploadPermissionReady}`);
  add('commercial cutover remote required summary', plan.summary?.remoteRequiredActions === remoteRequiredActions, `${plan.summary?.remoteRequiredActions} expected ${remoteRequiredActions}`);
  add('commercial cutover remote advisory summary', plan.summary?.remoteAdvisoryActions === remoteAdvisoryActions, `${plan.summary?.remoteAdvisoryActions} expected ${remoteAdvisoryActions}`);
  add('commercial cutover remote command coverage', (plan.remoteAssetRemediation?.requiredCommands || []).length === remoteRequiredActions, `${(plan.remoteAssetRemediation?.requiredCommands || []).length} command(s) expected ${remoteRequiredActions}`);
  const applyPlanSnapshotFresh =
    plan.remoteAssetRemediation?.applyPlanReport === 'release/github-release-remediation-apply-plan.json' &&
    plan.remoteAssetRemediation?.applyPlanVerifierReport === 'release/github-release-remediation-apply-plan-report.strict.json' &&
    plan.remoteAssetRemediation?.applyPlanStatus === remediationApplyPlan?.status &&
    Number(plan.remoteAssetRemediation?.applyPlanActions || 0) === Number(remediationApplyPlan?.summary?.actions || 0) &&
    Number(plan.remoteAssetRemediation?.applyPlanVerifierSummary?.blockers || 0) === Number(remediationApplyVerification?.summary?.blockers || 0) &&
    Number(plan.remoteAssetRemediation?.applyPlanVerifierSummary?.warnings || 0) === Number(remediationApplyVerification?.summary?.warnings || 0) &&
    remediationApplyPlan?.apply === false &&
    summary(remediationApplyPlan).warnings === 0 &&
    summary(remediationApplyVerification).warnings === 0 &&
    Number(remediationApplyPlan?.summary?.actions || 0) === remoteRequiredActions;
  const applyPlanClean =
    remediationApplyPlan?.status === 'dry-run-ready' &&
    summary(remediationApplyPlan).blockers === 0 &&
    summary(remediationApplyVerification).blockers === 0;
  const applyPlanExpectedExternalBlock =
    remediationApplyPlan?.status === 'plan-invalid' &&
    remediationApplyPlan?.github?.canUploadReleaseAssets === false &&
    Number(remediationApplyPlan?.summary?.actions || 0) > 0 &&
    summary(remediationApplyPlan).blockers > 0 &&
    summary(remediationApplyVerification).blockers > 0;
  add(
    'commercial cutover remote apply plan summary',
    applyPlanSnapshotFresh && (applyPlanClean || applyPlanExpectedExternalBlock),
    `report=${plan.remoteAssetRemediation?.applyPlanReport || 'missing'}, verifier=${plan.remoteAssetRemediation?.applyPlanVerifierReport || 'missing'}, status=${plan.remoteAssetRemediation?.applyPlanStatus || 'missing'}, actions=${plan.remoteAssetRemediation?.applyPlanActions ?? 'missing'}`,
  );
  add(
    'commercial cutover remote upload permission snapshot',
    plan.remoteAssetRemediation?.uploadPermission?.sourceReport === 'release/github-release-remediation-apply-plan.json' &&
      plan.remoteAssetRemediation?.uploadPermission?.verifierReport === 'release/github-release-remediation-apply-plan-report.strict.json' &&
      plan.remoteAssetRemediation?.uploadPermission?.status === (uploadPermission.status || (remoteUploadPermissionReady ? 'ready' : 'missing-or-unverified')) &&
      plan.remoteAssetRemediation?.uploadPermission?.repo === (uploadPermission.repo || remediationApplyPlan?.github?.repo || null) &&
      plan.remoteAssetRemediation?.uploadPermission?.viewerPermission === (uploadPermission.viewerPermission || remediationApplyPlan?.github?.viewerPermission || null) &&
      plan.remoteAssetRemediation?.uploadPermission?.canUploadReleaseAssets === (uploadPermission.canUploadReleaseAssets ?? remediationApplyPlan?.github?.canUploadReleaseAssets ?? null) &&
      Number(plan.remoteAssetRemediation?.uploadPermission?.actions || 0) === Number(uploadPermission.actions ?? remediationApplyPlan?.summary?.actions ?? 0),
    `status=${plan.remoteAssetRemediation?.uploadPermission?.status || 'missing'}, repo=${plan.remoteAssetRemediation?.uploadPermission?.repo || 'missing'}, viewerPermission=${plan.remoteAssetRemediation?.uploadPermission?.viewerPermission || 'missing'}, canUploadReleaseAssets=${plan.remoteAssetRemediation?.uploadPermission?.canUploadReleaseAssets ?? 'missing'}, actions=${plan.remoteAssetRemediation?.uploadPermission?.actions ?? 'missing'}`,
  );

  for (const required of requiredCommands) {
    add(`commercial cutover command ${required}`, commandText.includes(required), required);
  }

  const textForSecretScan = `${JSON.stringify(plan)}\n${markdown}`;
  add('commercial cutover secret hygiene', !hasSecretMaterial(textForSecretScan), 'no private key, token, or certificate literal patterns');
  add('commercial cutover human-readable status fields', !textForSecretScan.includes('[object Object]'), 'no [object Object] placeholders in JSON or Markdown output');
  add('commercial cutover markdown summary', markdown.includes('Connect AI Commercial Cutover Plan') && markdown.includes('Recommended Sequence') && markdown.includes('Remote baseline URL approved') && markdown.includes('Blocked unblock groups') && markdown.includes('Remote upload permission ready'), 'title, recommended sequence, blocker counts, remote upload permission, and remote baseline approval summary present');
  add('commercial cutover markdown remote baseline guard', markdown.includes('Remote Baseline Guard') && markdown.includes(plan.remoteBaselineGuard?.status || 'missing'), 'remote baseline guard section present');
  add('commercial cutover markdown remote remediation', markdown.includes('Remote Asset Remediation Snapshot'), 'remote remediation section present');
  add('commercial cutover remote baseline safety rule', (plan.safetyRules || []).join('\n').includes('same-name Connect AI zip'), 'same-name zip baseline URL safety rule present');

  if (requireProduction) {
    add('commercial cutover require production ready', plan.summary?.productionReady === true, `productionReady=${plan.summary?.productionReady}`);
  }
  if (requirePublished) {
    add('commercial cutover require published release ready', plan.summary?.publishedReleaseReady === true, `publishedReleaseReady=${plan.summary?.publishedReleaseReady}`);
  }

  const generatedAt = generatedAtMs(plan.generatedAt);
  add('commercial cutover generatedAt valid', generatedAt > 0, plan.generatedAt || 'missing');

  writeReport();
}

main();
