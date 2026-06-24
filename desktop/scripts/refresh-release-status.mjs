import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const reportPath = path.join(releaseDir, 'status-refresh-report.json');
const startedAt = new Date().toISOString();
const steps = [];

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

function tail(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return text.slice(text.length - maxLength);
}

function summaryOf(report) {
  if (!report || report.parseError) return null;
  return {
    generatedAt: report.generatedAt || null,
    status: report.status || null,
    strict: report.strict ?? null,
    noExit: report.noExit ?? null,
    productionReady: report.productionReady ?? null,
    localCandidateReady: report.localCandidateReady ?? null,
    publishedReleaseReady: report.publishedReleaseReady ?? null,
    commercialReady: report.commercialReady ?? null,
    approvedForBaselineUrl: report.approvedForBaselineUrl ?? null,
    safeForDirectUse: report.safeForDirectUse ?? null,
    summary: report.summary || null,
    gateSummary: report.gateSummary || null,
  };
}

function currentReports() {
  return {
    tempCleanup: summaryOf(readJson('release/temp-cleanup-report.json')),
    releaseEnvProcess: summaryOf(readJson('release/release-env-report.process.json')),
    operatorReadiness: summaryOf(readJson('release/operator-readiness.json')),
    signingReadiness: summaryOf(readJson('release/signing-readiness.json')),
    githubSetup: summaryOf(readJson('release/github-release-setup-report.json')),
    githubOperatorReadiness: summaryOf(readJson('release/operator-readiness.github.json')),
    baselineExportVerification: summaryOf(readJson('release/baseline-export-report-verification.strict.json')),
    uiParity: summaryOf(readJson('release/ui-parity-report.json')),
    performanceParity: summaryOf(readJson('release/performance-parity-report.json')),
    installedBundleDelta: summaryOf(readJson('release/installed-bundle-delta-report.json')),
    provenance: summaryOf(readJson('release/provenance.json')),
    strictEvidence: summaryOf(readJson('release/evidence-report.strict.json')),
    decision: summaryOf(readJson('release/release-decision.strict.json')),
    promotion: summaryOf(readJson('release/release-promotion-plan.json')),
    publishPlan: summaryOf(readJson('release/github-release-publish-plan.json')),
    remoteAssets: summaryOf(readJson('release/github-release-assets-report.json')),
    remoteRemediationPlan: summaryOf(readJson('release/github-release-remediation-plan.json')),
    remoteRemediationPlanReport: summaryOf(readJson('release/github-release-remediation-plan-report.json')),
    remoteRemediationPlanStrictReport: summaryOf(readJson('release/github-release-remediation-plan-report.strict.json')),
    remoteRemediationApplyPlan: summaryOf(readJson('release/github-release-remediation-apply-plan.json')),
    remoteRemediationApplyPlanVerification: summaryOf(readJson('release/github-release-remediation-apply-plan-report.strict.json')),
    remoteBaselineCandidate: summaryOf(readJson('release/remote-baseline-candidate-report.strict.json')),
    remoteBaselineCandidateVerification: summaryOf(readJson('release/remote-baseline-candidate-report-verification.strict.json')),
    remoteBaselineApproval: summaryOf(readJson('release/remote-baseline-approval-report.strict.json')),
    publishPlanVerification: summaryOf(readJson('release/github-release-publish-plan-report.strict.json')),
    readiness: summaryOf(readJson('release/production-readiness-summary.json')),
    readinessVerification: summaryOf(readJson('release/production-readiness-summary-verification.strict.json')),
    unblockPlan: summaryOf(readJson('release/release-unblock-plan-report.strict.json')),
    publicationSeal: summaryOf(readJson('release/release-publication-seal.json')),
    publicationSealVerification: summaryOf(readJson('release/release-publication-seal-verification.strict.json')),
    productionRunbook: summaryOf(readJson('release/production-release-runbook-report.json')),
    productionRunbookVerification: summaryOf(readJson('release/production-release-runbook-report-verification.strict.json')),
    engineeringReadiness: summaryOf(readJson('release/engineering-readiness-report.json')),
    commercialCutover: summaryOf(readJson('release/commercial-cutover-plan-report.strict.json')),
    commercialReleaseReadiness: summaryOf(readJson('release/commercial-release-readiness-report.strict.json')),
    setupPlanVerification: summaryOf(readJson('release/release-setup-plan-report.strict.json')),
    credentialHandoff: summaryOf(readJson('release/release-credential-handoff-report.strict.json')),
    envBootstrap: summaryOf(readJson('release/release-env-bootstrap.json')),
    envBootstrapVerification: summaryOf(readJson('release/release-env-bootstrap-report.strict.json')),
    preflightStrict: summaryOf(readJson('release/preflight-report.strict.json')),
    assetManifest: summaryOf(readJson('release/asset-manifest-report.json')),
  };
}

function writeReport(status) {
  const failed = steps.filter((step) => !step.ok);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    status,
    cwd: path.relative(process.cwd(), desktopDir) || '.',
    summary: {
      blockers: failed.length,
      warnings: 0,
      steps: steps.length,
    },
    steps,
    reports: currentReports(),
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function runScript(script, detail) {
  const result = spawnSync('npm', ['run', script], {
    cwd: desktopDir,
    encoding: 'utf8',
    env: process.env,
    timeout: 300000,
  });
  const step = {
    script,
    detail,
    ok: result.status === 0,
    status: result.status ?? 1,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    error: result.error ? result.error.message : null,
  };
  steps.push(step);
  const label = step.ok ? 'PASS' : 'FAIL';
  console.log(`${label.padEnd(7)} ${script} - ${detail}`);
  writeReport('running');
  if (!step.ok) {
    console.error(step.stderrTail || step.stdoutTail || `${script} failed`);
    process.exit(step.status || 1);
  }
}

function runSequence(sequence) {
  for (const [script, detail] of sequence) runScript(script, detail);
}

writeReport('running');

runSequence([
  ['release:cleanup-temp', 'remove stale Connect AI temp extraction artifacts before parity and release graph refresh'],
  ['release:env-check:process:strict:report', 'refresh strict process environment diagnostic report without exiting on missing external inputs'],
  ['signing:check:report', 'refresh signing and notarization readiness diagnostic report without exiting on missing external inputs'],
  ['release:operator-checklist:strict:report', 'refresh local operator readiness diagnostic report without exiting on missing external inputs'],
  ['release:github-setup:process:strict:report', 'refresh GitHub repository setup diagnostic report without exiting on missing external inputs'],
  ['release:operator-checklist:github:strict:report', 'refresh GitHub operator readiness diagnostic report without exiting on missing repository permissions or secrets'],
	  ['verify:release:ipc-security', 'refresh IPC security runtime report before evidence hashing'],
	  ['verify:release:ui-parity', 'refresh UI and behavior parity against the current baseline before evidence hashing'],
	  ['verify:release:performance-parity', 'refresh renderer performance parity against the current baseline before evidence hashing'],
	  ['release:installed-bundle-delta', 'refresh installed/baseline app versus release candidate bundle delta evidence before evidence hashing'],
	  ['verify:release:macos-security', 'refresh macOS security contract against the current release bundle before evidence hashing'],
	  ['verify:release:dmg-install', 'refresh DMG install experience against the current DMG before evidence hashing'],
	  ['verify:release:launch', 'refresh packaged app launch smoke before evidence hashing'],
	  ['verify:release:dmg-launch', 'refresh DMG app launch smoke before evidence hashing'],
	  ['verify:update-channel', 'refresh update channel metadata before evidence hashing'],
	  ['verify:release-tag', 'refresh release tag and artifact naming gate before evidence hashing'],
	  ['release:evidence', 'refresh evidence bundle, provenance, release notes, checksums, and secret hygiene after current diagnostics'],
  ['verify:baseline-export:strict:report', 'verify current baseline export ZIP bytes, SHA-256, source app.asar, and freshness cross-check without repackaging'],
  ['verify:evidence:strict:report', 'refresh strict evidence after current evidence bundle without blocking status refresh'],
  ['release:decision:strict:report', 'refresh strict release decision without exiting on expected external blockers'],
  ['release:promotion-plan', 'refresh promotion plan and CI-only asset policy'],
  ['release:asset-manifest', 'refresh manifest before publish/readiness checks'],
  ['verify:github-release-assets', 'refresh local GitHub Release asset drift report without blocking on remote drift'],
  ['verify:github-release-assets:strict:report', 'refresh strict GitHub Release asset drift report without blocking diagnostic refresh'],
  ['release:credential-handoff', 'refresh baseline-dependent credential handoff before remote remediation planning'],
  ['verify:credential-handoff:strict:report', 'verify baseline-dependent credential handoff before remote remediation planning'],
  ['release:setup-plan', 'refresh baseline-dependent setup plan before remote remediation planning'],
  ['verify:setup-plan:strict:report', 'verify baseline-dependent setup plan before remote remediation planning'],
  ['release:env-bootstrap', 'refresh baseline-dependent env bootstrap before remote remediation planning'],
  ['verify:env-bootstrap:strict:report', 'verify baseline-dependent env bootstrap before remote remediation planning'],
  ['verify:remote-baseline-candidate:strict:report', 'refresh remote baseline candidate guard before remote remediation planning'],
  ['verify:remote-baseline-candidate-report:strict:report', 'verify remote baseline candidate guard before remote remediation planning'],
  ['verify:remote-baseline-approved:report', 'write remote baseline approval gate before remote remediation planning'],
  ['release:github-release-remediation-plan', 'write actionable remote asset remediation plan from the latest drift report'],
  ['release:asset-manifest', 'refresh manifest after remote remediation diagnostics are written'],
  ['verify:github-release-remediation-plan', 'verify remediation plan action coverage and secret redaction policy'],
  ['verify:github-release-remediation-plan:strict:report', 'write strict remediation plan verification report without blocking diagnostic refresh'],
  ['release:asset-manifest', 'refresh manifest after remediation verification reports are written'],
  ['release:github-release-remediation-apply:plan', 'refresh dry-run remote remediation apply plan before publish/readiness checks'],
  ['verify:github-release-remediation-apply-plan:strict:report', 'verify dry-run remote remediation apply plan before publish/readiness checks'],
  ['release:publish-assets:plan', 'refresh GitHub Release publish dry-run gate report'],
  ['verify:github-release-publish-plan:strict:report', 'verify GitHub Release publish plan schema, gate projections, manifest assets, and secret hygiene'],
  ['release:readiness-summary:strict:report', 'refresh production readiness from current publish plan'],
  ['verify:readiness-summary-report:strict:report', 'verify production readiness summary schema, status, gates, source reports, and secret hygiene'],
  ['release:unblock-plan', 'refresh external unblock action groups'],
  ['verify:unblock-plan:strict:report', 'verify unblock plan schema and source report coverage'],
  ['release:publication-seal:strict:report', 'refresh publication seal from current readiness summary'],
  ['release:setup-plan', 'refresh setup plan from current blockers'],
  ['verify:setup-plan:strict:report', 'verify release setup plan schema, source reports, commands, and secret hygiene'],
  ['release:credential-handoff', 'refresh credential handoff from current blockers'],
  ['verify:credential-handoff:strict:report', 'verify credential handoff schema and secret redaction policy'],
  ['release:env-bootstrap', 'write copyable release env bootstrap from current baseline and credential blockers'],
  ['verify:env-bootstrap:strict:report', 'verify release env bootstrap schema, key coverage, baseline SHA, commands, and secret hygiene'],
  ['verify:remote-baseline-candidate:strict:report', 'verify the remote same-name baseline ZIP candidate without approving it before SHA match'],
  ['verify:remote-baseline-candidate-report:strict:report', 'verify remote baseline candidate guard semantics and SHA approval rules'],
  ['verify:remote-baseline-approved:report', 'write remote baseline approval gate report without blocking diagnostic refresh'],
]);

for (let pass = 1; pass <= 2; pass += 1) {
  runSequence([
    ['release:asset-manifest', `convergence pass ${pass}: refresh manifest after diagnostic reports`],
    ['verify:github-release-assets', `convergence pass ${pass}: refresh remote asset drift report`],
    ['verify:github-release-assets:strict:report', `convergence pass ${pass}: refresh strict remote asset drift report`],
    ['release:github-release-remediation-plan', `convergence pass ${pass}: refresh remote asset remediation plan`],
    ['release:asset-manifest', `convergence pass ${pass}: refresh manifest after remediation plan`],
    ['verify:github-release-remediation-plan', `convergence pass ${pass}: verify remediation plan`],
    ['verify:github-release-remediation-plan:strict:report', `convergence pass ${pass}: write strict remediation plan report`],
    ['release:asset-manifest', `convergence pass ${pass}: refresh manifest after remediation verification reports`],
    ['release:github-release-remediation-apply:plan', `convergence pass ${pass}: refresh dry-run remote remediation apply plan before publish/readiness checks`],
    ['verify:github-release-remediation-apply-plan:strict:report', `convergence pass ${pass}: verify dry-run remote remediation apply plan before publish/readiness checks`],
    ['release:publish-assets:plan', `convergence pass ${pass}: refresh publish plan against current manifest/readiness/seal`],
    ['verify:github-release-publish-plan:strict:report', `convergence pass ${pass}: verify publish plan`],
    ['release:readiness-summary:strict:report', `convergence pass ${pass}: refresh readiness against current publish plan`],
    ['verify:readiness-summary-report:strict:report', `convergence pass ${pass}: verify readiness summary`],
    ['release:unblock-plan', `convergence pass ${pass}: refresh unblock plan against current readiness`],
    ['verify:unblock-plan:strict:report', `convergence pass ${pass}: verify unblock plan`],
    ['release:publication-seal:strict:report', `convergence pass ${pass}: refresh seal against current readiness`],
  ]);
}

runSequence([
  ['release:asset-manifest', 'refresh manifest before final remote remediation apply dry-run and cutover reports'],
  ['release:github-release-remediation-apply:plan', 'refresh dry-run remote remediation apply plan without uploading'],
  ['verify:github-release-remediation-apply-plan:strict:report', 'verify dry-run remote remediation apply plan without uploading'],
  ['release:credential-handoff', 'refresh final credential handoff from converged report graph'],
  ['verify:credential-handoff:strict:report', 'verify final credential handoff freshness against converged report graph'],
  ['release:setup-plan', 'refresh final setup plan from converged report graph'],
  ['verify:setup-plan:strict:report', 'verify final setup plan freshness against converged report graph'],
  ['release:env-bootstrap', 'refresh final release env bootstrap from converged report graph'],
  ['verify:env-bootstrap:strict:report', 'verify final release env bootstrap freshness against converged report graph'],
  ['verify:remote-baseline-candidate:strict:report', 'refresh final remote baseline candidate guard after env bootstrap'],
  ['verify:remote-baseline-candidate-report:strict:report', 'verify final remote baseline guard report before commercial cutover'],
  ['verify:remote-baseline-approved:report', 'write final remote baseline approval gate report before commercial cutover'],
  ['release:readiness-summary:strict:report', 'refresh final readiness after final credential/setup/baseline guard reports'],
  ['verify:readiness-summary-report:strict:report', 'verify final readiness after final credential/setup/baseline guard reports'],
  ['release:unblock-plan', 'refresh final unblock plan after final readiness'],
  ['verify:unblock-plan:strict:report', 'verify final unblock plan after final readiness'],
  ['release:publication-seal:strict:report', 'refresh final publication seal after final readiness'],
  ['verify:publication-seal-report:strict:report', 'verify final publication seal before engineering readiness'],
  ['release:operator-runbook:strict:report', 'refresh production release runbook report against final converged evidence without applying credentials or publishing'],
  ['verify:operator-runbook-report:strict:report', 'verify production release runbook report schema, status, gate snapshot, blockers, and secret hygiene'],
  ['release:engineering-readiness', 'refresh engineering readiness report after final converged production diagnostics'],
  ['release:commercial-cutover', 'refresh commercial cutover plan from converged report graph'],
  ['verify:commercial-cutover:strict:report', 'verify commercial cutover plan schema, commands, source reports, and secret hygiene'],
  ['release:preflight:strict:report', 'refresh strict preflight diagnostic report without blocking status refresh'],
  ['release:asset-manifest', 'refresh manifest after final preflight diagnostic report'],
  ['verify:asset-manifest', 'verify release/CI-only asset policy before commercial release readiness'],
  ['verify:commercial-release:strict:report', 'refresh commercial release readiness from final manifest and converged report graph'],
  ['release:asset-manifest', 'refresh manifest after commercial release readiness report'],
  ['verify:asset-manifest', 'verify final release/CI-only asset policy after commercial release readiness'],
]);

const finalReport = writeReport('refreshed');
console.log(`Summary: ${finalReport.summary.blockers} blocker(s), ${finalReport.summary.warnings} warning(s), ${finalReport.summary.steps} step(s)`);
console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
