import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const reportPath = path.join(releaseDir, 'commercial-finalization-report.json');
const markdownPath = path.join(releaseDir, 'COMMERCIAL_FINALIZATION.md');
const includeStatusRefresh = process.argv.includes('--refresh');
const requireProduction = process.argv.includes('--require-production');
const requirePublished = process.argv.includes('--require-published');
const requireCommercial = process.argv.includes('--require-commercial');
const steps = [];
const checks = [];

function run(script, detail) {
  const timeout = script === 'release:status-refresh'
    ? Number(process.env.CONNECT_AI_STATUS_REFRESH_TIMEOUT_MS || 900000)
    : Number(process.env.CONNECT_AI_FINALIZATION_STEP_TIMEOUT_MS || 300000);
  const result = spawnSync('npm', ['run', script], {
    cwd: desktopDir,
    encoding: 'utf8',
    env: process.env,
    timeout,
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
  if (!step.ok) {
    console.error(step.stderrTail || step.stdoutTail || `${script} failed`);
    writeReport('failed');
    process.exit(step.status || 1);
  }
}

function tail(value, maxLength = 1600) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return text.slice(text.length - maxLength);
}

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
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

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
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

function commercialSource(commercial, relativePath) {
  return (commercial?.sources || []).find((source) => source.path === relativePath) || null;
}

function uniqueActions(actions) {
  const seen = new Set();
  return actions.filter((action) => {
    if (!action?.id || seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}

function nextExternalActionsFor(reports) {
  const commercial = reports.commercialReadiness || {};
  const commercialSummary = commercial.summary || {};
  const bundleDeltaSummary = reports.installedBundleDelta?.summary || {};
  const actions = [];

  if (commercial.productionReady !== true || bundleDeltaSummary.candidateCommercialSignature === false) {
    actions.push({
      id: 'sign-and-notarize-production-build',
      owner: 'release-operator',
      blocking: true,
      detail: 'Provide Developer ID certificate and Apple notarization credentials, then rebuild and verify signed/notarized app and DMG.',
      source: 'release/release-manifest.json',
    });
  }
  if (Number(commercialSummary.blockedCredentialGroups || 0) > 0) {
    actions.push({
      id: 'complete-credential-handoff',
      owner: 'release-operator',
      blocking: true,
      detail: `Complete ${Number(commercialSummary.blockedCredentialGroups || 0)} blocked credential group(s) in release/RELEASE_CREDENTIAL_HANDOFF.md.`,
      source: 'release/release-credential-handoff.json',
    });
  }
  if (commercialSummary.remoteUploadPermissionReady !== true) {
    actions.push({
      id: 'grant-github-release-upload-permission',
      owner: 'repository-admin',
      blocking: true,
      detail: 'Grant GitHub Release upload permission so remediation dry-run can become an authenticated upload.',
      source: 'release/github-release-remediation-apply-plan.json',
    });
  }
  if (Number(commercialSummary.remoteApplyActions || 0) > 0 || Number(commercialSummary.remoteRequiredActions || 0) > 0) {
    actions.push({
      id: 'apply-github-release-asset-remediation',
      owner: 'release-operator',
      blocking: true,
      detail: `Apply and verify ${Number(commercialSummary.remoteApplyActions || commercialSummary.remoteRequiredActions || 0)} GitHub Release asset remediation action(s).`,
      source: 'release/github-release-remediation-apply-plan.json',
    });
  }
  if (commercial.publishedReleaseReady !== true) {
    actions.push({
      id: 'publish-and-verify-github-release',
      owner: 'release-operator',
      blocking: true,
      detail: 'After production gates pass, publish/verify GitHub Release assets and rerun commercial finalization.',
      source: 'release/github-release-publish-plan.json',
    });
  }
  if (!actions.length) {
    actions.push({
      id: 'require-commercial-finalization',
      owner: 'release-operator',
      blocking: false,
      detail: 'No external action remains; rerun release:commercial-finalize:commercial to require commercialReady=true.',
      source: 'release/commercial-finalization-report.json',
    });
  }
  return uniqueActions(actions);
}

function failedCommercialBlockers(commercialReadiness) {
  return (commercialReadiness?.checks || [])
    .filter((check) => check?.ok !== true && (check.level || 'blocker') === 'blocker')
    .map((check) => ({
      name: check.name || 'unnamed commercial blocker',
      detail: check.detail || '',
    }));
}

function classifyCommercialBlocker(blocker) {
  const name = `${blocker.name} ${blocker.detail}`;
  const coverage = {
    nextExternalActions: [],
    unblockGroups: [],
    credentialGroups: [],
    requiresRemoteApplyActions: false,
    reason: '',
  };

  if (/remote baseline URL approval gate/i.test(name)) {
    coverage.nextExternalActions.push('apply-github-release-asset-remediation');
    coverage.unblockGroups.push('baseline-artifact', 'remote-baseline-url-guard');
    coverage.credentialGroups.push('baseline-artifact');
    coverage.requiresRemoteApplyActions = true;
    coverage.reason = 'remote baseline asset must match the approved local baseline artifact before the release URL can be trusted';
    return coverage;
  }

  if (/remote remediation upload permission/i.test(name)) {
    coverage.nextExternalActions.push('grant-github-release-upload-permission', 'apply-github-release-asset-remediation');
    coverage.unblockGroups.push('github-release-upload-permission');
    coverage.requiresRemoteApplyActions = true;
    coverage.reason = 'GitHub release upload permission is required before remote drift remediation can be applied';
    return coverage;
  }

  if (/remote assets verified clean|remote remediation required actions zero|remote remediation apply actions zero|publish plan clean/i.test(name)) {
    coverage.nextExternalActions.push('apply-github-release-asset-remediation', 'publish-and-verify-github-release');
    coverage.unblockGroups.push('publish-and-remote-asset-verification');
    coverage.requiresRemoteApplyActions = true;
    coverage.reason = 'remote release assets still differ from the local release manifest';
    return coverage;
  }

  if (/publishedReleaseReady|publication gate readiness|publication gate publication seal/i.test(name)) {
    coverage.nextExternalActions.push('publish-and-verify-github-release', 'apply-github-release-asset-remediation');
    coverage.unblockGroups.push('publish-and-remote-asset-verification');
    coverage.requiresRemoteApplyActions = true;
    coverage.reason = 'published-release readiness depends on verified GitHub release assets';
    return coverage;
  }

  if (/GitHub operator readiness clean/i.test(name)) {
    coverage.nextExternalActions.push('complete-credential-handoff', 'grant-github-release-upload-permission');
    coverage.unblockGroups.push('github-audit-token-permissions', 'github-actions-release-inputs');
    coverage.credentialGroups.push('github-readiness-audit-token');
    coverage.reason = 'GitHub readiness checks need repository audit/read and release upload permissions';
    return coverage;
  }

  if (/signing readiness clean|signedNotarized|signed-and-notarized|signed and notarized|release manifest signed|productionReady|promotion productionReady|readiness productionReady|publication seal productionReady/i.test(name)) {
    coverage.nextExternalActions.push('sign-and-notarize-production-build', 'complete-credential-handoff');
    coverage.unblockGroups.push('developer-id-certificate', 'notarization-credentials', 'github-actions-release-inputs');
    coverage.credentialGroups.push('developer-id-certificate', 'apple-notarization');
    coverage.reason = 'production readiness requires Developer ID signing and Apple notarization inputs';
    return coverage;
  }

  coverage.reason = 'unclassified commercial readiness blocker';
  return coverage;
}

function commercialBlockerCoverageFor(reports, nextExternalActions) {
  const actionIds = new Set(nextExternalActions.map((action) => action.id));
  const unblockGroupIds = new Set((reports.unblockPlan?.unblockGroups || []).map((group) => group.id));
  const credentialGroupIds = new Set((reports.credentialHandoff?.credentialGroups || []).map((group) => group.id));
  const remoteApplyActions = reports.remoteRemediationApply?.actions || [];
  const blockers = failedCommercialBlockers(reports.commercialReadiness);

  const items = blockers.map((blocker) => {
    const expected = classifyCommercialBlocker(blocker);
    const missingNextExternalActions = expected.nextExternalActions.filter((id) => !actionIds.has(id));
    const missingUnblockGroups = expected.unblockGroups.filter((id) => !unblockGroupIds.has(id));
    const missingCredentialGroups = expected.credentialGroups.filter((id) => !credentialGroupIds.has(id));
    const remoteApplyActionsCovered = !expected.requiresRemoteApplyActions || remoteApplyActions.length > 0;
    const classified = expected.reason !== 'unclassified commercial readiness blocker';
    const covered = classified &&
      missingNextExternalActions.length === 0 &&
      missingUnblockGroups.length === 0 &&
      missingCredentialGroups.length === 0 &&
      remoteApplyActionsCovered;
    return {
      blocker,
      classified,
      covered,
      reason: expected.reason,
      expected,
      missingNextExternalActions,
      missingUnblockGroups,
      missingCredentialGroups,
      remoteApplyActionsCovered,
    };
  });

  return {
    total: items.length,
    covered: items.filter((item) => item.covered).length,
    uncovered: items.filter((item) => !item.covered).length,
    items,
  };
}

function statusReasonFor(report) {
  if (report.summary.blockers > 0) return `${report.summary.blockers} commercial finalization blocker(s) remain`;
  if (report.commercialReady) return 'commercial-ready';
  if (report.publishedReleaseReady) return 'published release is ready but commercialReady is false';
  if (report.productionReady) return 'production build is ready and awaiting publication verification';
  if (report.localCandidateReady) {
    return `local candidate finalized; ${report.summary.commercialReadinessBlockers} commercial readiness blocker(s) remain`;
  }
  return 'local candidate is not ready';
}

function buildChecks(reports) {
  const {
    statusRefresh,
    statusRefreshVerification,
    commercialCutover,
    commercialCutoverVerification,
    commercialReadiness,
    installedBundleDelta,
    assetManifest,
    unblockPlan,
    credentialHandoff,
    remoteRemediationApply,
  } = reports;
  const statusRefreshSummary = summary(statusRefresh);
  const statusRefreshVerificationSummary = summary(statusRefreshVerification);
  const cutoverSummary = summary(commercialCutoverVerification);
  const assetSummary = summary(assetManifest);
  const commercialSummary = summary(commercialReadiness);
  const commercialStatusRefreshSource = commercialSource(commercialReadiness, 'release/status-refresh-report-verification.strict.json');
  const commercialCutoverSource = commercialSource(commercialReadiness, 'release/commercial-cutover-plan-report.strict.json');
  const commercialInstalledBundleDeltaSource = commercialSource(commercialReadiness, 'release/installed-bundle-delta-report.json');
  const installedBundleDeltaSummary = summary(installedBundleDelta);

  add('status refresh report exists', Boolean(statusRefresh && !statusRefresh.parseError), statusRefresh?.parseError || 'release/status-refresh-report.json');
  add('status refresh verification clean', statusRefreshVerification?.strict === true && statusRefreshVerificationSummary.blockers === 0 && statusRefreshVerificationSummary.warnings === 0, `${statusRefreshVerificationSummary.blockers} blocker(s), ${statusRefreshVerificationSummary.warnings} warning(s)`);
  add('commercial cutover verification clean', commercialCutoverVerification?.strict === true && cutoverSummary.blockers === 0 && cutoverSummary.warnings === 0, `${cutoverSummary.blockers} blocker(s), ${cutoverSummary.warnings} warning(s)`);
  add('asset manifest final verification clean', assetSummary.blockers === 0 && assetSummary.warnings === 0, `${assetSummary.blockers} blocker(s), ${assetSummary.warnings} warning(s)`);
  add('installed bundle delta report exists', Boolean(installedBundleDelta && !installedBundleDelta.parseError), installedBundleDelta?.parseError || 'release/installed-bundle-delta-report.json');
  add('installed bundle delta evidence clean', installedBundleDeltaSummary.blockers === 0 && installedBundleDeltaSummary.warnings === 0, `${installedBundleDeltaSummary.blockers} blocker(s), ${installedBundleDeltaSummary.warnings} warning(s)`);
  add('installed bundle macOS metadata policy retained', installedBundleDelta?.summary?.macosMetadataApprovedByPolicy === true, `macosMetadataApprovedByPolicy=${installedBundleDelta?.summary?.macosMetadataApprovedByPolicy}`);
  add('release unblock plan report exists', Boolean(unblockPlan && !unblockPlan.parseError), unblockPlan?.parseError || 'release/release-unblock-plan.json');
  add('release credential handoff report exists', Boolean(credentialHandoff && !credentialHandoff.parseError), credentialHandoff?.parseError || 'release/release-credential-handoff.json');
  add('remote remediation apply plan exists', Boolean(remoteRemediationApply && !remoteRemediationApply.parseError), remoteRemediationApply?.parseError || 'release/github-release-remediation-apply-plan.json');
  add('commercial readiness report exists', Boolean(commercialReadiness && !commercialReadiness.parseError), commercialReadiness?.parseError || 'release/commercial-release-readiness-report.strict.json');
  add('commercial readiness local candidate retained', commercialReadiness?.localCandidateReady === true, `localCandidateReady=${commercialReadiness?.localCandidateReady}`);
  add('commercial readiness source coverage', Number(commercialReadiness?.summary?.sources || 0) >= 30, `${commercialReadiness?.summary?.sources ?? 'missing'} source(s)`);
  add('commercial readiness uses latest status refresh verification', commercialStatusRefreshSource?.generatedAt === statusRefreshVerification?.generatedAt, `commercial=${commercialStatusRefreshSource?.generatedAt || 'missing'} current=${statusRefreshVerification?.generatedAt || 'missing'}`);
  add('commercial readiness uses latest commercial cutover verification', commercialCutoverSource?.generatedAt === commercialCutoverVerification?.generatedAt, `commercial=${commercialCutoverSource?.generatedAt || 'missing'} current=${commercialCutoverVerification?.generatedAt || 'missing'}`);
  add('commercial readiness uses latest installed bundle delta evidence', commercialInstalledBundleDeltaSource?.generatedAt === installedBundleDelta?.generatedAt, `commercial=${commercialInstalledBundleDeltaSource?.generatedAt || 'missing'} current=${installedBundleDelta?.generatedAt || 'missing'}`);
  add('commercial readiness generated after status verification', generatedAtMs(commercialReadiness?.generatedAt) >= generatedAtMs(statusRefreshVerification?.generatedAt), `commercial=${commercialReadiness?.generatedAt || 'missing'} verification=${statusRefreshVerification?.generatedAt || 'missing'}`);
  add('commercial readiness generated after cutover plan', generatedAtMs(commercialReadiness?.generatedAt) >= generatedAtMs(commercialCutover?.generatedAt), `commercial=${commercialReadiness?.generatedAt || 'missing'} cutover=${commercialCutover?.generatedAt || 'missing'}`);
  add('commercial readiness blocker accounting', commercialSummary.blockers === Number(commercialReadiness?.summary?.blockers || 0), `${commercialSummary.blockers} blocker(s)`);
  add('commercial readiness remote upload permission retained', typeof commercialReadiness?.summary?.remoteUploadPermissionReady === 'boolean', `remoteUploadPermissionReady=${commercialReadiness?.summary?.remoteUploadPermissionReady}`);
  add(
    'commercial readiness unblock group accounting retained',
    Number(commercialReadiness?.summary?.totalUnblockGroups || 0) >= Number(commercialReadiness?.summary?.blockedUnblockGroups || 0) &&
      Number(commercialReadiness?.summary?.blockedUnblockGroups || 0) === Number(commercialCutover?.summary?.blockedUnblockGroups ?? commercialCutover?.summary?.unblockGroups ?? 0),
    `total=${commercialReadiness?.summary?.totalUnblockGroups ?? 'missing'}, blocked=${commercialReadiness?.summary?.blockedUnblockGroups ?? 'missing'}`,
  );
  add('commercial readiness external gate retained', commercialReadiness?.commercialReady === false || commercialReadiness?.commercialReady === true, `commercialReady=${commercialReadiness?.commercialReady}`);
  add('status refresh itself clean', statusRefreshSummary.blockers === 0 && statusRefreshSummary.warnings === 0, `${statusRefreshSummary.blockers} blocker(s), ${statusRefreshSummary.warnings} warning(s)`);

  if (requireProduction) {
    add('require production-ready commercial finalization', commercialReadiness?.productionReady === true, `productionReady=${commercialReadiness?.productionReady}`);
  }
  if (requirePublished) {
    add('require published-release-ready commercial finalization', commercialReadiness?.publishedReleaseReady === true, `publishedReleaseReady=${commercialReadiness?.publishedReleaseReady}`);
  }
  if (requireCommercial) {
    add('require commercial-ready finalization', commercialReadiness?.commercialReady === true, `commercialReady=${commercialReadiness?.commercialReady}`);
  }

  const coverage = commercialBlockerCoverageFor(reports, nextExternalActionsFor(reports));
  add(
    'commercial readiness blocker coverage',
    coverage.total === Number(commercialReadiness?.summary?.blockers || 0) && coverage.uncovered === 0,
    `${coverage.covered}/${coverage.total} commercial blocker(s) mapped to unblock groups, credential groups, next external actions, and remote remediation actions`,
  );
  add('commercial finalization secret material scan', !hasSecretMaterial(JSON.stringify({ reports, checks, coverage })), 'no private key, certificate body, GitHub token, or API key literal patterns');
}

function reportStatus(reports, blockers) {
  if (blockers > 0) return 'commercial-finalization-blocked';
  if (reports.commercialReadiness?.commercialReady === true) return 'commercial-ready';
  if (reports.commercialReadiness?.publishedReleaseReady === true) return 'published-release-ready';
  if (reports.commercialReadiness?.productionReady === true) return 'production-ready-awaiting-publication';
  if (reports.commercialReadiness?.localCandidateReady === true) return 'local-candidate-finalized-awaiting-external-setup';
  return 'not-ready';
}

function renderMarkdown(report) {
  const checkLines = report.checks.map((check) => {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    return `- ${label}: ${check.name} - ${check.detail}`;
  }).join('\n');
  const stepLines = report.steps.map((step) => `- ${step.ok ? 'PASS' : 'FAIL'}: ${step.script} - ${step.detail}`).join('\n');
  const nextActionLines = report.nextExternalActions
    .map((action) => `- ${action.blocking ? 'BLOCKING' : 'INFO'}: ${action.id} - ${action.detail} (${action.source})`)
    .join('\n');
  return `# Connect AI Commercial Finalization

Generated: ${report.generatedAt}
Status: ${report.status}
Status reason: ${report.statusReason}
Commercial ready: ${report.commercialReady}
Production ready: ${report.productionReady}
Published release ready: ${report.publishedReleaseReady}
Local candidate ready: ${report.localCandidateReady}

## Summary

- Blockers: ${report.summary.blockers}
- Warnings: ${report.summary.warnings}
- Commercial readiness blockers: ${report.summary.commercialReadinessBlockers}
- Blocked credential groups: ${report.summary.blockedCredentialGroups}
- Blocked unblock groups: ${report.summary.blockedUnblockGroups} / ${report.summary.totalUnblockGroups}
- Remote upload permission ready: ${report.summary.remoteUploadPermissionReady}
- Remote required actions: ${report.summary.remoteRequiredActions}
- Remote apply actions: ${report.summary.remoteApplyActions}
- Installed bundle commercial blocking deltas: ${report.summary.installedBundleCommercialBlockingDeltas}
- Installed bundle candidate commercial signature: ${report.summary.installedBundleCandidateCommercialSignature}
- Installed bundle app.asar approved by policy: ${report.summary.installedBundleAppAsarApprovedByPolicy}
- Installed bundle macOS metadata exact match: ${report.summary.installedBundleMacosMetadataExactMatch}
- Installed bundle macOS metadata approved by policy: ${report.summary.installedBundleMacosMetadataApprovedByPolicy}
- Installed bundle Electron runtime match: ${report.summary.installedBundleElectronRuntimeMatch}
- Commercial readiness blocker coverage: ${report.summary.commercialReadinessBlockersCovered} / ${report.summary.commercialReadinessBlockersTotal}

## Next External Actions

${nextActionLines}

## Steps

${stepLines}

## Checks

${checkLines}
`;
}

function writeReport(statusOverride = null) {
  const reports = {
    statusRefresh: readJson('release/status-refresh-report.json'),
    statusRefreshVerification: readJson('release/status-refresh-report-verification.strict.json'),
    commercialCutover: readJson('release/commercial-cutover-plan.json'),
    commercialCutoverVerification: readJson('release/commercial-cutover-plan-report.strict.json'),
    commercialReadiness: readJson('release/commercial-release-readiness-report.strict.json'),
    installedBundleDelta: readJson('release/installed-bundle-delta-report.json'),
    assetManifest: readJson('release/asset-manifest-report.json'),
    unblockPlan: readJson('release/release-unblock-plan.json'),
    credentialHandoff: readJson('release/release-credential-handoff.json'),
    remoteRemediationApply: readJson('release/github-release-remediation-apply-plan.json'),
  };
  checks.length = 0;
  buildChecks(reports);
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const commercialSummary = summary(reports.commercialReadiness);
  const commercialCutoverSummary = reports.commercialCutover?.summary || {};
  const installedBundleDeltaSummary = reports.installedBundleDelta?.summary || {};
  const nextExternalActions = nextExternalActionsFor(reports);
  const commercialBlockerCoverage = commercialBlockerCoverageFor(reports, nextExternalActions);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    includeStatusRefresh,
    requireProduction,
    requirePublished,
    requireCommercial,
    status: statusOverride || reportStatus(reports, blockers),
    localCandidateReady: Boolean(reports.commercialReadiness?.localCandidateReady),
    productionReady: Boolean(reports.commercialReadiness?.productionReady),
    publishedReleaseReady: Boolean(reports.commercialReadiness?.publishedReleaseReady),
    commercialReady: Boolean(reports.commercialReadiness?.commercialReady),
    summary: {
      blockers,
      warnings,
      steps: steps.length,
      commercialReadinessBlockers: commercialSummary.blockers,
      commercialReadinessWarnings: commercialSummary.warnings,
      remoteRequiredActions: Number(reports.commercialReadiness?.summary?.remoteRequiredActions || 0),
      remoteApplyActions: Number(reports.commercialReadiness?.summary?.remoteApplyActions || 0),
      remoteUploadPermissionReady: Boolean(reports.commercialReadiness?.summary?.remoteUploadPermissionReady),
      blockedCredentialGroups: Number(reports.commercialReadiness?.summary?.blockedCredentialGroups || 0),
      totalUnblockGroups: Number(reports.commercialReadiness?.summary?.totalUnblockGroups ?? commercialCutoverSummary.totalUnblockGroups ?? 0),
      blockedUnblockGroups: Number(reports.commercialReadiness?.summary?.blockedUnblockGroups ?? commercialCutoverSummary.blockedUnblockGroups ?? commercialCutoverSummary.unblockGroups ?? 0),
      externalBlockers: Number(reports.commercialReadiness?.summary?.externalBlockers || 0),
      installedBundleCommercialBlockingDeltas: Number(installedBundleDeltaSummary.commercialBlockingDeltas || 0),
      installedBundleAppAsarApprovedByPolicy: Boolean(installedBundleDeltaSummary.appAsarApprovedByPolicy),
      installedBundleMacosMetadataExactMatch: Boolean(installedBundleDeltaSummary.macosMetadataExactMatch),
      installedBundleMacosMetadataApprovedByPolicy: Boolean(installedBundleDeltaSummary.macosMetadataApprovedByPolicy),
      installedBundleElectronRuntimeMatch: Boolean(installedBundleDeltaSummary.electronRuntimeMatch),
      installedBundleCandidateCommercialSignature: Boolean(installedBundleDeltaSummary.candidateCommercialSignature),
      commercialReadinessBlockersTotal: commercialBlockerCoverage.total,
      commercialReadinessBlockersCovered: commercialBlockerCoverage.covered,
      commercialReadinessBlockersUncovered: commercialBlockerCoverage.uncovered,
      nextExternalActions: nextExternalActions.length,
    },
    sourceReports: {
      statusRefresh: sourceSummary(reports.statusRefresh),
      statusRefreshVerification: sourceSummary(reports.statusRefreshVerification),
      commercialCutover: sourceSummary(reports.commercialCutover),
      commercialCutoverVerification: sourceSummary(reports.commercialCutoverVerification),
      commercialReadiness: sourceSummary(reports.commercialReadiness),
      installedBundleDelta: sourceSummary(reports.installedBundleDelta),
      assetManifest: sourceSummary(reports.assetManifest),
      unblockPlan: sourceSummary(reports.unblockPlan),
      credentialHandoff: sourceSummary(reports.credentialHandoff),
      remoteRemediationApply: sourceSummary(reports.remoteRemediationApply),
    },
    commercialBlockerCoverage,
    nextExternalActions,
    steps,
    checks,
  };
  report.statusReason = statusReasonFor(report);
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  return report;
}

function sourceSummary(report) {
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

if (includeStatusRefresh) {
  run('release:status-refresh', 'refresh the full release status graph before commercial finalization');
}
run('verify:status-refresh-report:strict:report', 'verify the latest status refresh graph before commercial readiness is finalized');
run('release:commercial-cutover', 'refresh commercial cutover plan from the verified status graph');
run('verify:commercial-cutover:strict:report', 'verify commercial cutover plan after status graph verification');
run('verify:commercial-release:strict:report', 'refresh commercial readiness from latest status verification and cutover reports');
run('release:asset-manifest', 'refresh release/CI-only asset manifest after commercial readiness finalization');
run('verify:asset-manifest', 'verify final release/CI-only asset policy after commercial readiness finalization');

const report = writeReport();
console.log(`Summary: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)`);
console.log(`Status: ${report.status}`);
console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
if (report.summary.blockers > 0) process.exit(1);
