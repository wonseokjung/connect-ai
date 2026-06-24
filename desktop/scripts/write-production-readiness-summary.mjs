import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const jsonPath = path.join(releaseDir, 'production-readiness-summary.json');
const markdownPath = path.join(releaseDir, 'PRODUCTION_READINESS_SUMMARY.md');

function readJson(relativePath, required = false) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`missing ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

function readPackage() {
  return readJson('package.json', true);
}

function summary(report) {
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
}

function failedChecks(report) {
  return (report?.checks || []).filter((check) => check.ok !== true);
}

function listRemainingActions(report) {
  return (report?.remainingActions || []).map((action) => ({
    id: action.id,
    owner: action.owner || 'operator',
    blocking: Boolean(action.blocking),
    detail: action.detail,
  }));
}

function reportState(label, relativePath, options = {}) {
  const report = readJson(relativePath);
  const required = options.required !== false;
  const state = {
    label,
    path: relativePath,
    present: Boolean(report),
    required,
    generatedAt: report?.generatedAt || null,
    strict: report?.strict ?? null,
    github: report?.github ?? null,
    status: report?.status || null,
    productionReady: report?.productionReady ?? null,
    localCandidateReady: report?.localCandidateReady ?? null,
    publishedReleaseReady: report?.publishedReleaseReady ?? null,
    commercialReady: report?.commercialReady ?? null,
    summary: report && !report.parseError ? summary(report) : null,
    parseError: report?.parseError || null,
  };
  if (report?.mode) state.mode = report.mode;
  return state;
}

function addGate(gates, id, label, ok, detail, options = {}) {
  gates.push({
    id,
    label,
    ok: Boolean(ok),
    owner: options.owner || 'engineering',
    phase: options.phase || 'local',
    blocking: options.blocking !== false,
    detail,
  });
}

function hasCleanSummary(report) {
  const value = summary(report);
  return value.blockers === 0 && value.warnings === 0;
}

function hasNoBlockers(report) {
  return summary(report).blockers === 0;
}

function reportMissingOrParseError(report) {
  return !report || Boolean(report.parseError);
}

function gateDetailFromChecks(report, fallback) {
  if (!report) return fallback;
  if (report.parseError) return report.parseError;
  const checks = failedChecks(report);
  if (!checks.length) return fallback;
  return checks.slice(0, 12).map((check) => `${check.name}: ${check.detail}`);
}

function gateDetailFromActions(report, fallback) {
  const actions = listRemainingActions(report).filter((action) => action.blocking);
  if (!actions.length) return fallback;
  return actions.slice(0, 12).flatMap((action) => {
    const details = Array.isArray(action.detail) ? action.detail : [action.detail];
    return details.filter(Boolean).map((detail) => `${action.id}: ${detail}`);
  });
}

function renderDetail(detail) {
  const items = Array.isArray(detail) ? detail.filter(Boolean) : [detail].filter(Boolean);
  return items.length ? items.join('; ') : 'no detail';
}

function summaryText(report, fallback = 'report missing') {
  if (!report) return fallback;
  if (report.parseError) return report.parseError;
  const value = summary(report);
  return `${value.blockers} blocker(s), ${value.warnings} warning(s)`;
}

function generatedAtMs(report) {
  const value = Date.parse(report?.generatedAt || '');
  return Number.isFinite(value) ? value : null;
}

function sha(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
}

function strictRemoteReportIsCurrent(strictReport, localReport) {
  if (!strictReport || strictReport.parseError) return false;
  if (!localReport || localReport.parseError) return true;
  const strictTime = generatedAtMs(strictReport);
  const localTime = generatedAtMs(localReport);
  if (strictTime == null || localTime == null) return true;
  return strictTime >= localTime;
}

function currentStrictRemoteReport(strictReport, localReport) {
  return strictRemoteReportIsCurrent(strictReport, localReport) ? strictReport : null;
}

function localRemoteDetail(localReport) {
  if (!localReport) return 'local remote report missing';
  const value = summary(localReport);
  const remediation = localReport.remediation?.summary;
  if (!remediation) return `local remote report has ${value.blockers} blocker(s), ${value.warnings} warning(s)`;
  return `local remote report has ${value.blockers} blocker(s), ${value.warnings} warning(s); remediation=${localReport.remediation.status}, required=${remediation.required}, advisory=${remediation.advisory}`;
}

function remoteAssetDetail(strictReport, localReport) {
  if (strictReport && !strictRemoteReportIsCurrent(strictReport, localReport)) {
    return `strict report stale (${strictReport.generatedAt || 'missing'} older than local ${localReport?.generatedAt || 'missing'}); ${localRemoteDetail(localReport)}`;
  }
  const remediationText = (report, label) => {
    const remediation = report?.remediation?.summary;
    if (!remediation) return null;
    return `${label} remediation=${report.remediation.status}, required=${remediation.required}, advisory=${remediation.advisory}`;
  };
  if (strictReport) {
    const detail = gateDetailFromChecks(strictReport, 'strict GitHub Release asset verification is clean');
    const items = Array.isArray(detail) ? detail : [detail];
    return [
      ...items,
      remediationText(strictReport, 'strict remote asset'),
      localReport && localReport !== strictReport ? remediationText(localReport, 'latest local remote asset') : null,
    ].filter(Boolean);
  }
  if (!localReport) return 'run verify:github-release-assets:strict after publication';
  const value = summary(localReport);
  const remediation = localReport.remediation?.summary;
  if (!remediation) {
    return `strict report missing; local remote report has ${value.blockers} blocker(s), ${value.warnings} warning(s)`;
  }
  return `strict report missing; local remote report has ${value.blockers} blocker(s), ${value.warnings} warning(s); remediation=${localReport.remediation.status}, required=${remediation.required}, advisory=${remediation.advisory}`;
}

function remediationPlanDetail(plan, report) {
  if (!plan) return 'run release:github-release-remediation-plan after remote asset verification';
  if (plan.parseError) return plan.parseError;
  if (!report) return `${plan.status || 'unknown'}; verifier report missing`;
  if (report.parseError) return report.parseError;
  const value = summary(report);
  return `${plan.status || 'unknown'}; required=${plan.summary?.requiredActions ?? 'unknown'}, advisory=${plan.summary?.advisoryReviews ?? 'unknown'}, verifier=${value.blockers} blocker(s), ${value.warnings} warning(s)`;
}

function remediationApplyPlanDetail(applyPlan, remediationPlan, verificationReport) {
  if (!applyPlan) return 'run release:github-release-remediation-apply:plan after remediation plan verification';
  if (applyPlan.parseError) return applyPlan.parseError;
  const value = summary(applyPlan);
  const verification = verificationReport ? summary(verificationReport) : null;
  return `${applyPlan.status || 'unknown'}; actions=${applyPlan.summary?.actions ?? 'unknown'}, expected=${remediationPlan?.summary?.requiredActions ?? 'unknown'}, verifier=${value.blockers} blocker(s), ${value.warnings} warning(s), applyVerifier=${verification ? `${verification.blockers} blocker(s), ${verification.warnings} warning(s)` : 'missing'}`;
}

function commandText(commands) {
  return (Array.isArray(commands) ? commands : [])
    .map((item) => `${item.step || ''}\n${item.command || ''}`)
    .join('\n');
}

function cleanStrictReport(report) {
  return Boolean(report && !report.parseError && hasCleanSummary(report));
}

function remoteBaselineGuardEvidence(setupPlan, credentialHandoff, setupVerification, credentialVerification) {
  const setupCandidate = setupPlan?.remoteBaselineCandidate || null;
  const handoffCandidate = credentialHandoff?.remoteBaselineCandidate || null;
  const candidate = setupCandidate || handoffCandidate || {};
  const status = candidate.status || 'missing';
  const packageVersion = setupPlan?.product?.version || credentialHandoff?.product?.version || '0.4.8';
  const expectedBaselineZipPath = `release/Connect-AI-${packageVersion}-baseline-arm64-mac.zip`;
  const allowedStatus = ['missing', 'not-approved-baseline-url', 'size-match-sha-unverified'].includes(status);
  const candidateAligned = Boolean(
    setupCandidate &&
      handoffCandidate &&
      setupCandidate.status === handoffCandidate.status &&
      setupCandidate.asset === handoffCandidate.asset
  );
  const expectedSha = candidate.expectedBaselineSha256 || '';
  const byteGuard = status !== 'not-approved-baseline-url' ||
    (candidate.remoteBytes !== candidate.expectedBaselineBytes && /^[a-f0-9]{64}$/i.test(expectedSha));
  const validation = `${commandText(setupCandidate?.validationCommands)}\n${commandText(handoffCandidate?.validationCommands)}`;
  const validationDocumented = validation.includes('gh release download') && validation.includes('shasum -a 256');
  const safetyRules = (setupPlan?.safetyRules || []).join('\n');
  const safetyRuleDocumented = safetyRules.includes('same-name Connect AI zip') &&
    safetyRules.includes(`SHA-256 matches ${expectedBaselineZipPath}`);
  const setupVerified = Boolean(setupVerification && !setupVerification.parseError && hasNoBlockers(setupVerification));
  const handoffVerified = Boolean(credentialVerification && !credentialVerification.parseError && hasNoBlockers(credentialVerification));
  const ok = Boolean(
    setupCandidate &&
      handoffCandidate &&
      allowedStatus &&
      candidateAligned &&
      byteGuard &&
      validationDocumented &&
      safetyRuleDocumented &&
      setupVerified &&
      handoffVerified
  );
  return {
    ok,
    detail: [
      `status=${status}`,
      `asset=${candidate.asset || 'missing'}`,
      `remoteBytes=${candidate.remoteBytes ?? 'missing'}`,
      `expectedBaselineBytes=${candidate.expectedBaselineBytes ?? 'missing'}`,
      `expectedBaselineSha256=${expectedSha || 'missing'}`,
      `setupVerified=${setupVerified}`,
      `credentialHandoffVerified=${handoffVerified}`,
      `validationDocumented=${validationDocumented}`,
      `safetyRuleDocumented=${safetyRuleDocumented}`,
    ],
  };
}

function remediationBaselineUrlGuardEvidence(remediationPlan, remediationVerification, remediationApplyPlan) {
  const guard = remediationPlan?.baselineUrlGuard || null;
  const localMirror = guard?.localBaselineMirror || {};
  const remoteCandidate = guard?.remoteBaselineCandidate || {};
  const packageVersion = remediationPlan?.product?.version || '0.4.8';
  const expectedBaselineZipPath = `release/Connect-AI-${packageVersion}-baseline-arm64-mac.zip`;
  const approvedUploadFile = localMirror.approvedUploadSource ? path.join(desktopDir, localMirror.approvedUploadSource) : null;
  const approvedUploadSourceVerified = Boolean(
    approvedUploadFile &&
      fs.existsSync(approvedUploadFile) &&
      fs.statSync(approvedUploadFile).size === Number(localMirror.expectedBaselineBytes || 0) &&
      sha(approvedUploadFile, 'sha256') === localMirror.expectedBaselineSha256
  );
  const localMirrorOrApprovedSourceVerified =
    (localMirror.status === 'verified-match' && localMirror.matchesExport === true) ||
    approvedUploadSourceVerified;
  const verificationClean = cleanStrictReport(remediationVerification);
  const applyPlanClean = Boolean(
    remediationApplyPlan &&
      !remediationApplyPlan.parseError &&
      remediationApplyPlan.apply === false &&
      remediationApplyPlan.status === 'dry-run-ready' &&
      hasCleanSummary(remediationApplyPlan)
  );
  const ok = Boolean(
      guard &&
      guard.ok === true &&
      guard.status === 'approved-source-verified-remote-baseline-rejected' &&
      localMirrorOrApprovedSourceVerified &&
      localMirror.approvedUploadSource === expectedBaselineZipPath &&
      remoteCandidate.status === 'not-approved-baseline-url' &&
      remoteCandidate.remoteBytes !== remoteCandidate.expectedBaselineBytes &&
      /^[a-f0-9]{64}$/i.test(String(remoteCandidate.expectedBaselineSha256 || '')) &&
      verificationClean &&
      applyPlanClean
  );
  return {
    ok,
    detail: [
      `status=${guard?.status || 'missing'}`,
      `approvedUploadSource=${localMirror.approvedUploadSource || 'missing'}`,
      `localDownloadsMirrorStatus=${localMirror.status || 'missing'}`,
      `approvedUploadSourceVerified=${approvedUploadSourceVerified}`,
      `remoteStatus=${remoteCandidate.status || 'missing'}`,
      `remoteBytes=${remoteCandidate.remoteBytes ?? 'missing'}`,
      `expectedBaselineBytes=${remoteCandidate.expectedBaselineBytes ?? 'missing'}`,
      `verificationClean=${verificationClean}`,
      `applyPlanClean=${applyPlanClean}`,
    ],
  };
}

function renderMarkdown(summaryReport) {
  const gateLines = summaryReport.gates.map((gate) => {
    const mark = gate.ok ? 'PASS' : gate.blocking ? 'BLOCKER' : 'WARN';
    return `- ${mark}: ${gate.label} (${gate.owner}, ${gate.phase}) - ${renderDetail(gate.detail)}`;
  }).join('\n');

  const actionLines = summaryReport.nextActions.length
    ? summaryReport.nextActions.map((action, index) => {
        const details = Array.isArray(action.detail) ? action.detail : [action.detail];
        return `${index + 1}. ${action.id} (${action.owner})\n\n   ${details.filter(Boolean).map((item) => `- ${item}`).join('\n   ')}`;
      }).join('\n\n')
    : '- none';

  const reportLines = summaryReport.sourceReports.map((report) => {
    const state = report.present ? 'present' : report.required ? 'missing' : 'missing optional';
    const count = report.summary ? `${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)` : 'no summary';
    const status = report.status ? `, status=${report.status}` : '';
    return `- ${report.path}: ${state}; ${count}${status}`;
  }).join('\n');

  return `# Connect AI Production Readiness Summary

Generated: ${summaryReport.generatedAt}
Product: ${summaryReport.product.name} ${summaryReport.product.version}
Status: ${summaryReport.status}
Production ready: ${summaryReport.productionReady}
Local candidate ready: ${summaryReport.localCandidateReady}
Published release ready: ${summaryReport.publishedReleaseReady}
Commercial ready: ${summaryReport.commercialReady}

## Gates

${gateLines}

## Next Actions

${actionLines}

## Source Reports

${reportLines}
`;
}

function main() {
  const pkg = readPackage();
  const reports = {
    localDecision: readJson('release/release-decision.json'),
    strictDecision: readJson('release/release-decision.strict.json'),
    localEvidence: readJson('release/evidence-report.json'),
    strictEvidence: readJson('release/evidence-report.strict.json'),
    baselineExport: readJson('release/baseline-export-report.json'),
    baselineExportVerification: readJson('release/baseline-export-report-verification.strict.json'),
    baselineFreshness: readJson('release/baseline-freshness-report.json'),
    promotion: readJson('release/release-promotion-plan.json'),
    envLocal: readJson('release/release-env-report.json'),
    envProcess: readJson('release/release-env-report.process.json'),
    signing: readJson('release/signing-readiness.json'),
    operator: readJson('release/operator-readiness.json'),
    githubOperator: readJson('release/operator-readiness.github.json'),
    githubSetup: readJson('release/github-release-setup-report.json'),
    publishPlan: readJson('release/github-release-publish-plan.json'),
    publishPlanVerification: readJson('release/github-release-publish-plan-report.strict.json'),
    remoteAssetsLocal: readJson('release/github-release-assets-report.json'),
    remoteAssetsStrict: readJson('release/github-release-assets-report.strict.json'),
    remoteRemediationPlan: readJson('release/github-release-remediation-plan.json'),
    remoteRemediationReport: readJson('release/github-release-remediation-plan-report.json'),
    remoteRemediationStrictReport: readJson('release/github-release-remediation-plan-report.strict.json'),
    remoteRemediationApplyPlan: readJson('release/github-release-remediation-apply-plan.json'),
    remoteRemediationApplyVerification: readJson('release/github-release-remediation-apply-plan-report.strict.json'),
    credentialHandoff: readJson('release/release-credential-handoff.json'),
    credentialHandoffVerification: readJson('release/release-credential-handoff-report.strict.json'),
    releaseSetup: readJson('release/release-setup-plan.json'),
    releaseSetupVerification: readJson('release/release-setup-plan-report.strict.json'),
    preflight: readJson('release/preflight-report.json'),
    preflightStrict: readJson('release/preflight-report.strict.json'),
    assetManifest: readJson('release/release-asset-manifest.json'),
  };

  const sourceReports = [
    reportState('local decision', 'release/release-decision.json'),
    reportState('strict decision', 'release/release-decision.strict.json'),
    reportState('local evidence', 'release/evidence-report.json'),
    reportState('strict evidence', 'release/evidence-report.strict.json'),
    reportState('baseline export', 'release/baseline-export-report.json'),
    reportState('baseline export verification', 'release/baseline-export-report-verification.strict.json'),
    reportState('baseline freshness', 'release/baseline-freshness-report.json'),
    reportState('release promotion', 'release/release-promotion-plan.json'),
    reportState('release env', 'release/release-env-report.json'),
    reportState('release process env', 'release/release-env-report.process.json'),
    reportState('signing readiness', 'release/signing-readiness.json'),
    reportState('operator readiness', 'release/operator-readiness.json'),
    reportState('GitHub operator readiness', 'release/operator-readiness.github.json'),
    reportState('GitHub setup', 'release/github-release-setup-report.json'),
    reportState('GitHub Release publish plan', 'release/github-release-publish-plan.json'),
    reportState('GitHub Release publish plan verification', 'release/github-release-publish-plan-report.strict.json', { required: false }),
    reportState('GitHub Release assets', 'release/github-release-assets-report.json', { required: false }),
    reportState('strict GitHub Release assets', 'release/github-release-assets-report.strict.json', { required: false }),
    reportState('GitHub Release remediation plan', 'release/github-release-remediation-plan.json', { required: false }),
    reportState('GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.json', { required: false }),
    reportState('strict GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.strict.json', { required: false }),
    reportState('GitHub Release remediation apply dry-run plan', 'release/github-release-remediation-apply-plan.json'),
    reportState('GitHub Release remediation apply dry-run verification', 'release/github-release-remediation-apply-plan-report.strict.json'),
    reportState('release credential handoff', 'release/release-credential-handoff.json'),
    reportState('release credential handoff verification', 'release/release-credential-handoff-report.strict.json'),
    reportState('release setup plan', 'release/release-setup-plan.json'),
    reportState('release setup plan verification', 'release/release-setup-plan-report.strict.json'),
    reportState('release preflight', 'release/preflight-report.json'),
    reportState('strict release preflight', 'release/preflight-report.strict.json', { required: false }),
    reportState('release asset manifest', 'release/release-asset-manifest.json'),
  ];
  const remoteBaselineGuard = remoteBaselineGuardEvidence(
    reports.releaseSetup,
    reports.credentialHandoff,
    reports.releaseSetupVerification,
    reports.credentialHandoffVerification,
  );
  const remediationBaselineGuard = remediationBaselineUrlGuardEvidence(
    reports.remoteRemediationPlan,
    reports.remoteRemediationStrictReport || reports.remoteRemediationReport,
    reports.remoteRemediationApplyPlan,
  );

  const gates = [];
  addGate(
    gates,
    'local-decision-ready',
    'Local release decision is ready',
    reports.localDecision?.localCandidateReady === true,
    reports.localDecision?.localCandidateReady === true
      ? `localCandidateReady=true, productionReady=${Boolean(reports.localDecision?.productionReady)}`
      : gateDetailFromActions(reports.localDecision, 'release/release-decision.json must have localCandidateReady=true'),
  );
  addGate(
    gates,
    'local-evidence-clean',
    'Local release evidence has no blockers or warnings',
    reports.localEvidence && hasCleanSummary(reports.localEvidence),
    reports.localEvidence && hasCleanSummary(reports.localEvidence)
      ? summaryText(reports.localEvidence)
      : gateDetailFromChecks(reports.localEvidence, 'release/evidence-report.json must be clean'),
  );
  addGate(
    gates,
    'baseline-export-clean',
    'Baseline export report is clean',
    reports.baselineExport?.ok === true && hasNoBlockers(reports.baselineExport),
    reports.baselineExport?.ok === true && hasNoBlockers(reports.baselineExport)
      ? summaryText(reports.baselineExport)
      : gateDetailFromChecks(reports.baselineExport, 'release/baseline-export-report.json must be generated by release:baseline-export and clean'),
  );
  addGate(
    gates,
    'baseline-export-verified',
    'Baseline export ZIP and source hash are verified',
    reports.baselineExportVerification &&
      reports.baselineExportVerification.strict === true &&
      hasCleanSummary(reports.baselineExportVerification),
    reports.baselineExportVerification &&
      reports.baselineExportVerification.strict === true &&
      hasCleanSummary(reports.baselineExportVerification)
      ? summaryText(reports.baselineExportVerification)
      : gateDetailFromChecks(reports.baselineExportVerification, 'run verify:baseline-export:strict:report after release:baseline-export and release:evidence'),
  );
  addGate(
    gates,
    'baseline-freshness-clean',
    'Baseline freshness report is clean',
    reports.baselineFreshness?.ok === true && hasNoBlockers(reports.baselineFreshness),
    reports.baselineFreshness?.ok === true && hasNoBlockers(reports.baselineFreshness)
      ? summaryText(reports.baselineFreshness)
      : gateDetailFromChecks(reports.baselineFreshness, 'release/baseline-freshness-report.json must be clean'),
  );
  addGate(
    gates,
    'remote-baseline-guard-ready',
    'Remote same-name baseline URL guard is verified',
    remoteBaselineGuard.ok,
    remoteBaselineGuard.detail,
  );
  addGate(
    gates,
    'strict-evidence-clean',
    'Strict release evidence has no blockers',
    reports.strictEvidence && hasNoBlockers(reports.strictEvidence),
    reports.strictEvidence && hasNoBlockers(reports.strictEvidence)
      ? summaryText(reports.strictEvidence)
      : gateDetailFromChecks(reports.strictEvidence, 'release/evidence-report.strict.json must have 0 blockers'),
    { owner: 'operator', phase: 'production' },
  );
  addGate(
    gates,
    'release-env-ready',
    'Strict process release env is ready',
    reports.envProcess && reports.envProcess.strict === true && reports.envProcess.processEnv === true && hasNoBlockers(reports.envProcess),
    reports.envProcess && reports.envProcess.strict === true && reports.envProcess.processEnv === true && hasNoBlockers(reports.envProcess)
      ? summaryText(reports.envProcess)
      : gateDetailFromChecks(reports.envProcess, 'run release:env-check:process:strict:report with complete release env'),
    { owner: 'operator', phase: 'production' },
  );
  addGate(
    gates,
    'signing-ready',
    'Developer ID signing and notarization inputs are ready',
    reports.signing && hasNoBlockers(reports.signing),
    reports.signing && hasNoBlockers(reports.signing)
      ? summaryText(reports.signing)
      : gateDetailFromChecks(reports.signing, 'run signing:check:report with Developer ID and notarization inputs'),
    { owner: 'operator', phase: 'production' },
  );
  addGate(
    gates,
    'github-setup-ready',
    'GitHub repository variables and secrets are configured',
    reports.githubSetup && hasNoBlockers(reports.githubSetup),
    reports.githubSetup && hasNoBlockers(reports.githubSetup)
      ? summaryText(reports.githubSetup)
      : gateDetailFromChecks(reports.githubSetup, 'run release:github-setup:apply after filling release env'),
    { owner: 'operator', phase: 'production' },
  );
  addGate(
    gates,
    'github-operator-ready',
    'GitHub operator readiness is clean',
    reports.githubOperator &&
      reports.githubOperator.github === true &&
      reports.githubOperator.strict === true &&
      hasCleanSummary(reports.githubOperator),
    reports.githubOperator &&
      reports.githubOperator.github === true &&
      reports.githubOperator.strict === true &&
      hasCleanSummary(reports.githubOperator)
      ? summaryText(reports.githubOperator)
      : gateDetailFromChecks(reports.githubOperator, 'run release:operator-checklist:github:strict with required GitHub permissions'),
    { owner: 'operator', phase: 'production' },
  );
  addGate(
    gates,
    'promotion-ready',
    'Release promotion plan is production-ready',
    reports.promotion?.productionReady === true,
    reports.promotion?.productionReady === true
      ? `status=${reports.promotion.status || 'ready'}`
      : gateDetailFromActions(reports.promotion, 'release/release-promotion-plan.json must have productionReady=true'),
    { owner: 'operator', phase: 'production' },
  );
  addGate(
    gates,
    'strict-decision-ready',
    'Strict release decision is production-ready',
    reports.strictDecision?.productionReady === true,
    reports.strictDecision?.productionReady === true
      ? `status=${reports.strictDecision.status || 'production-ready'}`
      : gateDetailFromActions(reports.strictDecision, 'release/release-decision.strict.json must have productionReady=true'),
    { owner: 'operator', phase: 'production' },
  );
  addGate(
    gates,
    'publish-plan-ready',
    'GitHub Release publish plan is ready',
    reports.publishPlan && hasNoBlockers(reports.publishPlan),
    reports.publishPlan && hasNoBlockers(reports.publishPlan)
      ? summaryText(reports.publishPlan)
      : gateDetailFromChecks(reports.publishPlan, 'run release:publish-assets:plan after productionReady=true'),
    { owner: 'operator', phase: 'publication' },
  );
  addGate(
    gates,
    'asset-manifest-ready',
    'Release asset manifest is present and generated',
    reports.assetManifest?.schemaVersion === 1 && Array.isArray(reports.assetManifest.githubReleaseAssets),
    reportMissingOrParseError(reports.assetManifest)
      ? 'release/release-asset-manifest.json is missing or invalid'
      : `${reports.assetManifest.githubReleaseAssets.length} GitHub Release asset(s)`,
    { phase: 'publication' },
  );
  addGate(
    gates,
    'remote-assets-verified',
    'Published GitHub Release assets are verified',
    currentStrictRemoteReport(reports.remoteAssetsStrict, reports.remoteAssetsLocal)
      ? hasCleanSummary(currentStrictRemoteReport(reports.remoteAssetsStrict, reports.remoteAssetsLocal))
      : false,
    remoteAssetDetail(reports.remoteAssetsStrict, reports.remoteAssetsLocal),
    { owner: 'operator', phase: 'publication', blocking: false },
  );
  addGate(
    gates,
    'remote-remediation-plan-verified',
    'GitHub Release remediation plan is actionable and verified',
    reports.remoteRemediationPlan &&
      hasCleanSummary(reports.remoteRemediationReport) &&
      hasCleanSummary(reports.remoteRemediationStrictReport),
    remediationPlanDetail(
      reports.remoteRemediationPlan,
      reports.remoteRemediationStrictReport || reports.remoteRemediationReport,
    ),
    { owner: 'operator', phase: 'publication', blocking: false },
  );
  addGate(
    gates,
    'remote-remediation-baseline-url-guard-ready',
    'GitHub Release remediation baseline URL guard is verified',
    remediationBaselineGuard.ok,
    remediationBaselineGuard.detail,
    { owner: 'operator', phase: 'publication', blocking: false },
  );
  addGate(
    gates,
    'remote-remediation-apply-plan-ready',
    'GitHub Release remediation apply dry-run matches local manifest',
    reports.remoteRemediationApplyPlan &&
      reports.remoteRemediationApplyPlan.apply === false &&
      reports.remoteRemediationApplyPlan.status === 'dry-run-ready' &&
      hasCleanSummary(reports.remoteRemediationApplyPlan) &&
      hasCleanSummary(reports.remoteRemediationApplyVerification) &&
      Number(reports.remoteRemediationApplyPlan.summary?.actions || 0) === Number(reports.remoteRemediationPlan?.summary?.requiredActions || 0),
    remediationApplyPlanDetail(reports.remoteRemediationApplyPlan, reports.remoteRemediationPlan, reports.remoteRemediationApplyVerification),
    { owner: 'operator', phase: 'publication', blocking: false },
  );
  const remoteApplyActions = Number(reports.remoteRemediationApplyPlan?.summary?.actions || 0);
  const uploadPermissionReady = remoteApplyActions === 0 ||
    reports.remoteRemediationApplyPlan?.github?.canUploadReleaseAssets === true;
  addGate(
    gates,
    'remote-remediation-upload-permission-ready',
    'GitHub Release remediation upload permission is available when remote drift exists',
    uploadPermissionReady,
    [
      `repo=${reports.remoteRemediationApplyPlan?.github?.repo || 'missing'}`,
      `viewerPermission=${reports.remoteRemediationApplyPlan?.github?.viewerPermission || 'missing'}`,
      `canUploadReleaseAssets=${reports.remoteRemediationApplyPlan?.github?.canUploadReleaseAssets ?? 'missing'}`,
      `actions=${remoteApplyActions}`,
    ],
    { owner: 'operator', phase: 'publication', blocking: false },
  );

  const blockingGates = gates.filter((gate) => gate.blocking);
  const productionGates = blockingGates.filter((gate) => gate.phase !== 'publication');
  const publicationGates = gates.filter((gate) => gate.phase === 'publication');
  const localCandidateReady = gates.find((gate) => gate.id === 'local-decision-ready')?.ok === true &&
    gates.find((gate) => gate.id === 'local-evidence-clean')?.ok === true &&
    gates.find((gate) => gate.id === 'baseline-export-clean')?.ok === true &&
    gates.find((gate) => gate.id === 'baseline-export-verified')?.ok === true &&
    gates.find((gate) => gate.id === 'baseline-freshness-clean')?.ok === true &&
    gates.find((gate) => gate.id === 'remote-baseline-guard-ready')?.ok === true;
  const productionReady = productionGates.every((gate) => gate.ok);
  const publishedReleaseReady = productionReady && publicationGates.every((gate) => gate.ok);
  const commercialReady = publishedReleaseReady;
  const status = publishedReleaseReady
    ? 'published-release-ready'
    : productionReady
      ? 'production-ready-awaiting-publication'
      : localCandidateReady
        ? 'local-candidate-awaiting-external-setup'
        : 'not-ready';

  const nextActions = gates
    .filter((gate) => !gate.ok)
    .map((gate) => ({
      id: gate.id,
      owner: gate.owner,
      phase: gate.phase,
      blocking: gate.blocking,
      detail: gate.detail,
    }));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
      repository: pkg.repository?.url || null,
    },
    status,
    productionReady,
    localCandidateReady,
    publishedReleaseReady,
    commercialReady,
    summary: {
      blockers: blockingGates.filter((gate) => !gate.ok).length,
      warnings: gates.filter((gate) => !gate.ok && !gate.blocking).length,
    },
    gates,
    nextActions,
    sourceReports,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));

  console.log('Connect AI production readiness summary');
  for (const gate of gates) {
    const label = gate.ok ? 'PASS' : gate.blocking ? 'BLOCKER' : 'WARN';
    console.log(`${label.padEnd(7)} ${gate.label} - ${renderDetail(gate.detail)}`);
  }
  console.log(`Status: ${status}`);
  console.log(`Summary: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);

  if (strict && report.summary.blockers > 0 && !noExit) process.exit(1);
}

main();
