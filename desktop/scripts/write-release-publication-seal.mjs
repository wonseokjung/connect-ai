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
const jsonPath = path.join(releaseDir, 'release-publication-seal.json');
const markdownPath = path.join(releaseDir, 'RELEASE_PUBLICATION_SEAL.md');

const sourcePaths = [
  ['strict release decision', 'release/release-decision.strict.json', 'json', true],
  ['release promotion plan', 'release/release-promotion-plan.json', 'json', true],
  ['production readiness summary', 'release/production-readiness-summary.json', 'json', true],
  ['release asset manifest', 'release/release-asset-manifest.json', 'json', true],
  ['release manifest', 'release/release-manifest.json', 'json', true],
  ['baseline export report', 'release/baseline-export-report.json', 'json', true],
  ['baseline export verification report', 'release/baseline-export-report-verification.strict.json', 'json', true],
  ['baseline freshness report', 'release/baseline-freshness-report.json', 'json', true],
  ['release credential handoff', 'release/release-credential-handoff.json', 'json', true],
  ['release credential handoff verification', 'release/release-credential-handoff-report.strict.json', 'json', true],
  ['release setup plan', 'release/release-setup-plan.json', 'json', true],
  ['release setup plan verification', 'release/release-setup-plan-report.strict.json', 'json', true],
  ['GitHub Release publish plan', 'release/github-release-publish-plan.json', 'json', true],
  ['strict GitHub Release assets report', 'release/github-release-assets-report.strict.json', 'json', false],
  ['local GitHub Release assets report', 'release/github-release-assets-report.json', 'json', false],
  ['GitHub Release remediation plan', 'release/github-release-remediation-plan.json', 'json', false],
  ['GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.json', 'json', false],
  ['strict GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.strict.json', 'json', false],
  ['GitHub Release remediation apply dry-run plan', 'release/github-release-remediation-apply-plan.json', 'json', true],
  ['GitHub Release remediation apply dry-run verification', 'release/github-release-remediation-apply-plan-report.strict.json', 'json', true],
  ['release tag report', 'release/release-tag-report.json', 'json', false],
  ['release notes', 'release/RELEASE_NOTES.md', 'text', true],
];

function fullPath(relativePath) {
  return path.join(desktopDir, relativePath);
}

function readJson(relativePath, required = false) {
  const file = fullPath(relativePath);
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

function readText(relativePath) {
  const file = fullPath(relativePath);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function summary(report) {
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
}

function cleanSummary(report, { warnings = true } = {}) {
  const value = summary(report);
  return Boolean(report && !report.parseError && value.blockers === 0 && (!warnings || value.warnings === 0));
}

function releaseNotesStatus(text) {
  const match = String(text || '').match(/^Status:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function sourceState(label, relativePath, kind, required) {
  const file = fullPath(relativePath);
  const present = fs.existsSync(file);
  let parsed = null;
  let parseError = null;
  if (kind === 'json' && present) {
    parsed = readJson(relativePath);
    parseError = parsed?.parseError || null;
  }
  const state = {
    label,
    path: relativePath,
    kind,
    required,
    present,
    bytes: present ? fs.statSync(file).size : 0,
    parseError,
    generatedAt: parsed?.generatedAt || null,
    strict: parsed?.strict ?? null,
    status: typeof parsed?.status === 'string' ? parsed.status : null,
    productionReady: parsed?.productionReady ?? null,
    localCandidateReady: parsed?.localCandidateReady ?? null,
    publishedReleaseReady: parsed?.publishedReleaseReady ?? null,
    commercialReady: parsed?.commercialReady ?? null,
    summary: parsed && !parseError ? summary(parsed) : null,
  };
  if (relativePath === 'release/release-asset-manifest.json' && parsed && !parseError) {
    state.githubReleaseAssets = Array.isArray(parsed.githubReleaseAssets) ? parsed.githubReleaseAssets.length : 0;
    state.ciOnlyArtifacts = Array.isArray(parsed.ciOnlyArtifacts) ? parsed.ciOnlyArtifacts.length : 0;
  }
  return state;
}

function addCheck(list, id, label, ok, detail, options = {}) {
  list.push({
    id,
    label,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : options.level || 'blocker',
    phase: options.phase || 'consistency',
    owner: options.owner || 'engineering',
  });
}

function versionOf(report) {
  return report?.product?.version || report?.releaseTag?.packageVersion || null;
}

function assetManifestClean(manifest) {
  const assets = Array.isArray(manifest?.githubReleaseAssets) ? manifest.githubReleaseAssets : [];
  if (!assets.length) return false;
  return assets.every((asset) =>
    asset.exists === true &&
      Number.isFinite(asset.bytes) &&
      asset.bytes > 0 &&
      typeof asset.sha256 === 'string' &&
      asset.sha256.length === 64 &&
      typeof asset.sha512 === 'string' &&
      asset.sha512.length === 128
  );
}

function failedAssetDetails(manifest) {
  const assets = Array.isArray(manifest?.githubReleaseAssets) ? manifest.githubReleaseAssets : [];
  return assets
    .filter((asset) => !asset.exists || !asset.bytes || !asset.sha256 || !asset.sha512)
    .slice(0, 8)
    .map((asset) => asset.path)
    .join(', ') || `${assets.length} checksum-pinned release asset(s)`;
}

const releaseManifestSecurityFields = [
  'codesignVerify',
  'gatekeeper',
  'stapler',
  'dmgGatekeeper',
  'dmgStapler',
];

function releaseManifestSignedAndNotarized(manifest) {
  if (!manifest || manifest.parseError) return false;
  return manifest.security?.codeSignature?.developerId === true &&
    releaseManifestSecurityFields.every((field) => manifest.security?.[field]?.ok === true);
}

function releaseManifestSecurityDetail(manifest) {
  if (!manifest) return 'missing release/release-manifest.json';
  if (manifest.parseError) return manifest.parseError;
  const failed = [
    manifest.security?.codeSignature?.developerId === true
      ? null
      : `Developer ID signature: ${manifest.security?.codeSignature?.kind || 'missing'}${manifest.security?.codeSignature?.teamIdentifier ? ` team=${manifest.security.codeSignature.teamIdentifier}` : ''}`,
    ...releaseManifestSecurityFields
    .filter((field) => manifest.security?.[field]?.ok !== true)
    .map((field) => {
      const output = String(manifest.security?.[field]?.output || 'not ok')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)[0] || 'not ok';
      return `${field}: ${output}`;
    }),
  ].filter(Boolean);
  return failed.length ? failed : 'Developer ID codesign, Gatekeeper, stapler, DMG Gatekeeper, and DMG stapler pass';
}

function renderDetail(detail) {
  const values = Array.isArray(detail) ? detail : [detail];
  return values.filter(Boolean).join('; ') || 'no detail';
}

function remoteAssetDetail(strictReport, localReport) {
  if (strictReport && !strictRemoteReportIsCurrent(strictReport, localReport)) {
    return `strict report stale (${strictReport.generatedAt || 'missing'} older than local ${localReport?.generatedAt || 'missing'}); ${localRemoteDetail(localReport)}`;
  }
  if (strictReport) {
    const value = summary(strictReport);
    const remediation = strictReport.remediation?.summary;
    const remediationText = remediation ? `; remediation=${strictReport.remediation.status}, required=${remediation.required}, advisory=${remediation.advisory}` : '';
    const localRemediation = localReport?.remediation?.summary;
    const localText = localRemediation && localReport !== strictReport
      ? `; latest local remediation=${localReport.remediation.status}, required=${localRemediation.required}, advisory=${localRemediation.advisory}`
      : '';
    return `${value.blockers} blocker(s), ${value.warnings} warning(s)${remediationText}${localText}`;
  }
  if (!localReport) return 'run verify:github-release-assets:strict after publication';
  const value = summary(localReport);
  const remediation = localReport.remediation?.summary;
  if (!remediation) {
    return `strict report missing; local report has ${value.blockers} blocker(s), ${value.warnings} warning(s)`;
  }
  return `strict report missing; local report has ${value.blockers} blocker(s), ${value.warnings} warning(s); remediation=${localReport.remediation.status}, required=${remediation.required}, advisory=${remediation.advisory}`;
}

function generatedAtMs(report) {
  const value = Date.parse(report?.generatedAt || '');
  return Number.isFinite(value) ? value : null;
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
  if (!remediation) return `local report has ${value.blockers} blocker(s), ${value.warnings} warning(s)`;
  return `local report has ${value.blockers} blocker(s), ${value.warnings} warning(s); remediation=${localReport.remediation.status}, required=${remediation.required}, advisory=${remediation.advisory}`;
}

function remediationPlanDetail(plan, strictReport, localReport) {
  if (!plan) return 'run release:github-release-remediation-plan after remote asset verification';
  if (plan.parseError) return plan.parseError;
  const report = strictReport || localReport;
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
  return cleanSummary(report, { warnings: true });
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
  const setupVerified = cleanSummary(setupVerification, { warnings: false });
  const handoffVerified = cleanSummary(credentialVerification, { warnings: false });
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

function renderMarkdown(report) {
  const consistencyLines = report.consistencyChecks.map((check) => {
    const mark = check.ok ? 'PASS' : check.level.toUpperCase();
    return `- ${mark}: ${check.label} - ${renderDetail(check.detail)}`;
  }).join('\n');
  const gateLines = report.gates.map((gate) => {
    const mark = gate.ok ? 'PASS' : gate.phase === 'publication' ? 'WAITING' : 'BLOCKER';
    return `- ${mark}: ${gate.label} (${gate.phase}) - ${renderDetail(gate.detail)}`;
  }).join('\n');
  const sourceLines = report.sourceReports.map((source) => {
    const state = source.present ? 'present' : source.required ? 'missing' : 'missing optional';
    const summaryText = source.summary ? `${source.summary.blockers} blocker(s), ${source.summary.warnings} warning(s)` : 'no summary';
    const status = source.status ? `, status=${source.status}` : '';
    return `- ${source.path}: ${state}; ${summaryText}${status}`;
  }).join('\n');
  const nextLines = report.nextActions.length
    ? report.nextActions.map((action, index) => `${index + 1}. ${action.id}: ${renderDetail(action.detail)}`).join('\n')
    : '- none';

  return `# Connect AI Release Publication Seal

Generated: ${report.generatedAt}
Product: ${report.product.name} ${report.product.version}
Status: ${report.status}
Local candidate ready: ${report.localCandidateReady}
Production ready: ${report.productionReady}
Published release ready: ${report.publishedReleaseReady}
Commercial ready: ${report.commercialReady}
Release notes status: ${report.releaseNotes.status || 'missing'}

## Consistency Checks

${consistencyLines}

## Publication Gates

${gateLines}

## Next Actions

${nextLines}

## Source Reports

${sourceLines}
`;
}

function main() {
  const pkg = readJson('package.json', true);
  const reports = {
    strictDecision: readJson('release/release-decision.strict.json'),
    promotion: readJson('release/release-promotion-plan.json'),
    readiness: readJson('release/production-readiness-summary.json'),
    manifest: readJson('release/release-asset-manifest.json'),
    releaseManifest: readJson('release/release-manifest.json'),
    baselineExport: readJson('release/baseline-export-report.json'),
    baselineExportVerification: readJson('release/baseline-export-report-verification.strict.json'),
    baselineFreshness: readJson('release/baseline-freshness-report.json'),
    credentialHandoff: readJson('release/release-credential-handoff.json'),
    credentialHandoffVerification: readJson('release/release-credential-handoff-report.strict.json'),
    releaseSetup: readJson('release/release-setup-plan.json'),
    releaseSetupVerification: readJson('release/release-setup-plan-report.strict.json'),
    publishPlan: readJson('release/github-release-publish-plan.json'),
    remoteAssetsStrict: readJson('release/github-release-assets-report.strict.json'),
    remoteAssetsLocal: readJson('release/github-release-assets-report.json'),
    remoteRemediationPlan: readJson('release/github-release-remediation-plan.json'),
    remoteRemediationReport: readJson('release/github-release-remediation-plan-report.json'),
    remoteRemediationStrictReport: readJson('release/github-release-remediation-plan-report.strict.json'),
    remoteRemediationApplyPlan: readJson('release/github-release-remediation-apply-plan.json'),
    remoteRemediationApplyVerification: readJson('release/github-release-remediation-apply-plan-report.strict.json'),
    releaseTag: readJson('release/release-tag-report.json'),
  };
  const notesText = readText('release/RELEASE_NOTES.md');
  const notesStatus = releaseNotesStatus(notesText);
  const sourceReports = sourcePaths.map(([label, relativePath, kind, required]) => sourceState(label, relativePath, kind, required));

  const consistencyChecks = [];
  for (const source of sourceReports) {
    addCheck(
      consistencyChecks,
      `source-${source.path}`,
      `${source.label} source report`,
      source.present || !source.required,
      source.present ? `${source.bytes} bytes` : `${source.path} is missing`,
    );
    if (source.present && source.kind === 'json') {
      addCheck(
        consistencyChecks,
        `source-parse-${source.path}`,
        `${source.label} parses as JSON`,
        !source.parseError,
        source.parseError || 'valid JSON',
      );
    }
  }

  const expectedVersion = pkg.version;
  for (const [label, report] of [
    ['strict decision', reports.strictDecision],
    ['promotion plan', reports.promotion],
    ['readiness summary', reports.readiness],
    ['asset manifest', reports.manifest],
    ['release manifest', reports.releaseManifest],
    ['baseline export', reports.baselineExport],
    ['baseline export verification', reports.baselineExportVerification],
    ['baseline freshness', reports.baselineFreshness],
  ]) {
    addCheck(
      consistencyChecks,
      `version-${label.replace(/\s+/g, '-')}`,
      `${label} version matches package`,
      !report || report.parseError || versionOf(report) === expectedVersion,
      `${versionOf(report) || 'missing'} expected ${expectedVersion}`,
    );
  }

  const manifestClean = assetManifestClean(reports.manifest);
  const baselineFreshnessClean = Boolean(
    reports.baselineFreshness &&
      !reports.baselineFreshness.parseError &&
      reports.baselineFreshness.ok === true &&
      summary(reports.baselineFreshness).blockers === 0
  );
  const baselineExportClean = Boolean(
    reports.baselineExport &&
      !reports.baselineExport.parseError &&
      reports.baselineExport.ok === true &&
      summary(reports.baselineExport).blockers === 0
  );
  const baselineExportVerificationClean = Boolean(
    reports.baselineExportVerification &&
      !reports.baselineExportVerification.parseError &&
      reports.baselineExportVerification.strict === true &&
      summary(reports.baselineExportVerification).blockers === 0 &&
      summary(reports.baselineExportVerification).warnings === 0
  );
  const remoteBaselineGuard = remoteBaselineGuardEvidence(
    reports.releaseSetup,
    reports.credentialHandoff,
    reports.releaseSetupVerification,
    reports.credentialHandoffVerification,
  );
  addCheck(
    consistencyChecks,
    'asset-manifest-checksum-pinned',
    'Release asset manifest has checksum-pinned local assets',
    manifestClean,
    reports.manifest?.parseError || failedAssetDetails(reports.manifest),
  );
  addCheck(
    consistencyChecks,
    'asset-manifest-ci-only-separation',
    'Release asset manifest separates GitHub Release assets and CI-only diagnostics',
    Array.isArray(reports.manifest?.githubReleaseAssets) && Array.isArray(reports.manifest?.ciOnlyArtifacts),
    `${reports.manifest?.githubReleaseAssets?.length || 0} release asset(s), ${reports.manifest?.ciOnlyArtifacts?.length || 0} CI-only diagnostic(s)`,
  );
  addCheck(
    consistencyChecks,
    'remote-baseline-guard-source-coherence',
    'Remote same-name baseline URL guard is sourced and verified',
    remoteBaselineGuard.ok,
    remoteBaselineGuard.detail,
  );

  const localCandidateReady = Boolean(
    reports.strictDecision?.localCandidateReady &&
      reports.promotion?.localCandidateReady &&
      reports.readiness?.localCandidateReady &&
      baselineExportClean &&
      baselineExportVerificationClean &&
      baselineFreshnessClean &&
      remoteBaselineGuard.ok
  );
  const releaseNotesSigned = notesStatus === 'signed-and-notarized';
  const releaseManifestSecurityReady = releaseManifestSignedAndNotarized(reports.releaseManifest);
  const sourceProductionReady = Boolean(
    reports.strictDecision?.productionReady &&
      reports.promotion?.productionReady &&
      reports.readiness?.productionReady &&
      releaseManifestSecurityReady &&
      releaseNotesSigned
  );
  const publishPlanClean = cleanSummary(reports.publishPlan, { warnings: true });
  const currentRemoteAssetsStrict = currentStrictRemoteReport(reports.remoteAssetsStrict, reports.remoteAssetsLocal);
  const remoteAssetsClean = cleanSummary(currentRemoteAssetsStrict, { warnings: true });
  const remoteRemediationPlanVerified = cleanSummary(reports.remoteRemediationReport, { warnings: true }) &&
    cleanSummary(reports.remoteRemediationStrictReport, { warnings: true });
  const remoteRemediationApplyPlanReady = Boolean(
    reports.remoteRemediationApplyPlan &&
      !reports.remoteRemediationApplyPlan.parseError &&
      reports.remoteRemediationApplyPlan.apply === false &&
      reports.remoteRemediationApplyPlan.status === 'dry-run-ready' &&
      cleanSummary(reports.remoteRemediationApplyPlan, { warnings: true }) &&
      cleanSummary(reports.remoteRemediationApplyVerification, { warnings: true }) &&
      Number(reports.remoteRemediationApplyPlan.summary?.actions || 0) === Number(reports.remoteRemediationPlan?.summary?.requiredActions || 0)
  );
  const readinessPublishedExpected = Boolean(reports.readiness?.productionReady && manifestClean && publishPlanClean && remoteAssetsClean && remoteRemediationPlanVerified && remoteRemediationApplyPlanReady);
  const publishedReleaseReady = Boolean(sourceProductionReady && manifestClean && publishPlanClean && remoteAssetsClean && remoteRemediationPlanVerified && remoteRemediationApplyPlanReady && reports.readiness?.publishedReleaseReady);

  addCheck(
    consistencyChecks,
    'production-ready-source-coherence',
    'Production-ready source reports are coherent',
    Boolean(reports.readiness) && !reports.readiness.parseError && reports.readiness.productionReady === sourceProductionReady,
    `strictDecision=${Boolean(reports.strictDecision?.productionReady)}, promotion=${Boolean(reports.promotion?.productionReady)}, readiness=${Boolean(reports.readiness?.productionReady)}, releaseManifestSecurity=${releaseManifestSecurityReady}, releaseNotes=${notesStatus || 'missing'}`,
  );
  addCheck(
    consistencyChecks,
    'published-ready-source-coherence',
    'Published-release readiness matches publication evidence',
    Boolean(reports.readiness) && !reports.readiness.parseError && Boolean(reports.readiness.publishedReleaseReady) === readinessPublishedExpected,
    `readiness=${Boolean(reports.readiness?.publishedReleaseReady)}, expected=${readinessPublishedExpected}, assetManifestClean=${manifestClean}, publishPlanClean=${publishPlanClean}, remoteAssetsClean=${remoteAssetsClean}, remediationPlanVerified=${remoteRemediationPlanVerified}, remediationApplyPlanReady=${remoteRemediationApplyPlanReady}`,
  );

  const gates = [];
  addCheck(
    gates,
    'local-candidate-ready',
    'Local candidate gate is ready',
    localCandidateReady,
    localCandidateReady ? 'strict decision, promotion plan, readiness summary, baseline export, baseline verification, baseline freshness, and remote baseline guard are ready' : 'local candidate reports are not all ready',
    { phase: 'local' },
  );
  addCheck(
    gates,
    'baseline-export-ready',
    'Baseline export report is clean',
    baselineExportClean,
    reports.baselineExport ? `${summary(reports.baselineExport).blockers} blocker(s), ${summary(reports.baselineExport).warnings} warning(s)` : 'missing baseline export report',
    { phase: 'local' },
  );
  addCheck(
    gates,
    'baseline-export-verified-ready',
    'Baseline export ZIP and source hash are verified',
    baselineExportVerificationClean,
    reports.baselineExportVerification ? `${summary(reports.baselineExportVerification).blockers} blocker(s), ${summary(reports.baselineExportVerification).warnings} warning(s)` : 'missing baseline export verification report',
    { phase: 'local' },
  );
  addCheck(
    gates,
    'baseline-freshness-ready',
    'Baseline freshness report is clean',
    baselineFreshnessClean,
    reports.baselineFreshness ? `${summary(reports.baselineFreshness).blockers} blocker(s), ${summary(reports.baselineFreshness).warnings} warning(s)` : 'missing baseline freshness report',
    { phase: 'local' },
  );
  addCheck(
    gates,
    'remote-baseline-guard-ready',
    'Remote same-name baseline URL guard is verified',
    remoteBaselineGuard.ok,
    remoteBaselineGuard.detail,
    { phase: 'local' },
  );
  addCheck(
    gates,
    'strict-decision-production-ready',
    'Strict release decision is production-ready',
    reports.strictDecision?.productionReady === true,
    reports.strictDecision?.productionReady === true ? reports.strictDecision.status || 'production-ready' : reports.strictDecision?.status || 'not production-ready',
    { phase: 'production', owner: 'operator' },
  );
  addCheck(
    gates,
    'promotion-production-ready',
    'Release promotion plan is production-ready',
    reports.promotion?.productionReady === true,
    reports.promotion?.productionReady === true ? reports.promotion.status || 'production-ready' : reports.promotion?.status || 'not production-ready',
    { phase: 'production', owner: 'operator' },
  );
  addCheck(
    gates,
    'readiness-production-ready',
    'Production readiness summary is production-ready',
    reports.readiness?.productionReady === true,
    reports.readiness?.productionReady === true ? reports.readiness.status || 'production-ready' : reports.readiness?.status || 'not production-ready',
    { phase: 'production', owner: 'operator' },
  );
  addCheck(
    gates,
    'release-notes-signed',
    'Release notes are marked signed and notarized',
    releaseNotesSigned,
    notesStatus ? `Status: ${notesStatus}` : 'missing Status line',
    { phase: 'production', owner: 'operator' },
  );
  addCheck(
    gates,
    'release-manifest-signed-notarized',
    'Release manifest proves signed and notarized app and DMG',
    releaseManifestSecurityReady,
    releaseManifestSecurityDetail(reports.releaseManifest),
    { phase: 'production', owner: 'operator' },
  );
  addCheck(
    gates,
    'asset-manifest-ready',
    'Release asset manifest is complete',
    manifestClean,
    failedAssetDetails(reports.manifest),
    { phase: 'publication' },
  );
  addCheck(
    gates,
    'publish-plan-clean',
    'GitHub Release publish plan is clean',
    publishPlanClean,
    reports.publishPlan ? `${summary(reports.publishPlan).blockers} blocker(s), ${summary(reports.publishPlan).warnings} warning(s)` : 'missing publish plan',
    { phase: 'publication', owner: 'operator' },
  );
  addCheck(
    gates,
    'remote-assets-verified',
    'Published GitHub Release assets are strictly verified',
    remoteAssetsClean,
    remoteAssetDetail(reports.remoteAssetsStrict, reports.remoteAssetsLocal),
    { phase: 'publication', owner: 'operator' },
  );
  addCheck(
    gates,
    'remote-remediation-plan-verified',
    'GitHub Release remediation plan is actionable and verified',
    remoteRemediationPlanVerified,
    remediationPlanDetail(
      reports.remoteRemediationPlan,
      reports.remoteRemediationStrictReport,
      reports.remoteRemediationReport,
    ),
    { phase: 'publication', owner: 'operator' },
  );
  addCheck(
    gates,
    'remote-remediation-apply-plan-ready',
    'GitHub Release remediation apply dry-run matches local manifest',
    remoteRemediationApplyPlanReady,
    remediationApplyPlanDetail(reports.remoteRemediationApplyPlan, reports.remoteRemediationPlan, reports.remoteRemediationApplyVerification),
    { phase: 'publication', owner: 'operator' },
  );
  const remoteApplyActions = Number(reports.remoteRemediationApplyPlan?.summary?.actions || 0);
  const uploadPermissionReady = remoteApplyActions === 0 ||
    reports.remoteRemediationApplyPlan?.github?.canUploadReleaseAssets === true;
  addCheck(
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
    { phase: 'publication', owner: 'operator' },
  );
  addCheck(
    gates,
    'readiness-published-ready',
    'Production readiness summary marks the published release ready',
    reports.readiness?.publishedReleaseReady === true,
    `publishedReleaseReady=${Boolean(reports.readiness?.publishedReleaseReady)}`,
    { phase: 'publication', owner: 'operator' },
  );

  const productionGateIds = new Set([
    'local-candidate-ready',
    'baseline-export-ready',
    'baseline-export-verified-ready',
    'baseline-freshness-ready',
    'remote-baseline-guard-ready',
    'strict-decision-production-ready',
    'promotion-production-ready',
    'readiness-production-ready',
    'release-notes-signed',
    'release-manifest-signed-notarized',
  ]);
  const productionReady = gates.filter((gate) => productionGateIds.has(gate.id)).every((gate) => gate.ok);
  const publicationReady = productionReady && gates.filter((gate) => gate.phase === 'publication').every((gate) => gate.ok);
  const commercialReady = publicationReady;
  const status = publicationReady
    ? 'published-release-ready'
    : productionReady
      ? 'production-ready-awaiting-publication'
      : localCandidateReady
        ? 'local-candidate-awaiting-external-setup'
        : 'not-ready';

  const consistencyBlockers = consistencyChecks.filter((check) => !check.ok && check.level === 'blocker').length;
  const consistencyWarnings = consistencyChecks.filter((check) => !check.ok && check.level === 'warn').length;
  const productionBlockers = gates.filter((gate) => !gate.ok && (gate.phase === 'local' || gate.phase === 'production')).length;
  const publicationBlockers = gates.filter((gate) => !gate.ok && gate.phase === 'publication').length;
  const nextActions = gates
    .filter((gate) => !gate.ok)
    .map((gate) => ({
      id: gate.id,
      phase: gate.phase,
      owner: gate.owner,
      detail: gate.detail,
    }));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireProduction,
    requirePublished,
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
      releaseTag: `desktop-v${pkg.version}`,
    },
    status,
    localCandidateReady,
    productionReady,
    publishedReleaseReady: publicationReady,
    commercialReady,
    releaseNotes: {
      path: 'release/RELEASE_NOTES.md',
      status: notesStatus,
      signedAndNotarized: releaseNotesSigned,
    },
    summary: {
      blockers: consistencyBlockers,
      warnings: consistencyWarnings,
    },
    gateSummary: {
      productionBlockers,
      publicationBlockers,
      gates: gates.length,
    },
    consistencyChecks,
    gates,
    nextActions,
    sourceReports,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));

  console.log(`Connect AI release publication seal (${strict ? 'strict' : 'local'})`);
  for (const check of consistencyChecks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.label} - ${renderDetail(check.detail)}`);
  }
  for (const gate of gates) {
    const label = gate.ok ? 'PASS' : gate.phase === 'publication' ? 'WAITING' : 'BLOCKER';
    console.log(`${label.padEnd(7)} ${gate.label} - ${renderDetail(gate.detail)}`);
  }
  console.log(`Status: ${status}`);
  console.log(`Consistency: ${consistencyBlockers} blocker(s), ${consistencyWarnings} warning(s)`);
  console.log(`Gates: ${productionBlockers} production blocker(s), ${publicationBlockers} publication blocker(s)`);
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);

  const forcedFailure =
    (requireProduction && !productionReady) ||
    (requirePublished && !publicationReady);
  if (!noExit && (consistencyBlockers > 0 || forcedFailure)) process.exit(1);
}

main();
