import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const requireProduction = process.argv.includes('--require-production');
const requirePublished = process.argv.includes('--require-published');
const reportPath = strict
  ? 'release/commercial-release-readiness-report.strict.json'
  : 'release/commercial-release-readiness-report.json';
const checks = [];

const sourceDefinitions = [
  ['status refresh verification', 'release/status-refresh-report-verification.strict.json', 'json'],
  ['commercial cutover plan', 'release/commercial-cutover-plan.json', 'json'],
  ['commercial cutover verification', 'release/commercial-cutover-plan-report.strict.json', 'json'],
  ['production readiness summary', 'release/production-readiness-summary.json', 'json'],
  ['production readiness verification', 'release/production-readiness-summary-verification.strict.json', 'json'],
  ['publication seal', 'release/release-publication-seal.json', 'json'],
  ['publication seal verification', 'release/release-publication-seal-verification.strict.json', 'json'],
  ['release decision', 'release/release-decision.strict.json', 'json'],
  ['release promotion plan', 'release/release-promotion-plan.json', 'json'],
  ['release manifest', 'release/release-manifest.json', 'json'],
  ['release notes', 'release/RELEASE_NOTES.md', 'text'],
  ['GitHub release publish plan', 'release/github-release-publish-plan.json', 'json'],
  ['GitHub release publish plan verification', 'release/github-release-publish-plan-report.strict.json', 'json'],
  ['GitHub release assets strict report', 'release/github-release-assets-report.strict.json', 'json'],
  ['GitHub release remediation plan', 'release/github-release-remediation-plan.json', 'json'],
  ['GitHub release remediation verification', 'release/github-release-remediation-plan-report.strict.json', 'json'],
  ['GitHub release remediation apply plan', 'release/github-release-remediation-apply-plan.json', 'json'],
  ['GitHub release remediation apply verification', 'release/github-release-remediation-apply-plan-report.strict.json', 'json'],
  ['remote baseline candidate', 'release/remote-baseline-candidate-report.strict.json', 'json'],
  ['remote baseline candidate verification', 'release/remote-baseline-candidate-report-verification.strict.json', 'json'],
  ['remote baseline approval', 'release/remote-baseline-approval-report.strict.json', 'json'],
  ['asset manifest verification', 'release/asset-manifest-report.json', 'json'],
  ['baseline export verification', 'release/baseline-export-report-verification.strict.json', 'json'],
  ['baseline freshness', 'release/baseline-freshness-report.json', 'json'],
  ['installed app parity', 'release/installed-app-parity-report.json', 'json'],
  ['installed bundle delta', 'release/installed-bundle-delta-report.json', 'json'],
  ['UI parity', 'release/ui-parity-report.json', 'json'],
  ['performance parity', 'release/performance-parity-report.json', 'json'],
  ['macOS security contract', 'release/macos-security-contract.json', 'json'],
  ['IPC security', 'release/ipc-security-report.json', 'json'],
  ['security audit', 'release/security-audit-report.json', 'json'],
  ['secret hygiene', 'release/secret-hygiene-report.json', 'json'],
  ['DMG install experience', 'release/dmg-install-experience.json', 'json'],
  ['release launch smoke', 'release/release-launch-smoke.json', 'json'],
  ['DMG launch smoke', 'release/release-dmg-launch-smoke.json', 'json'],
  ['update channel', 'release/update-channel-report.json', 'json'],
  ['signing readiness', 'release/signing-readiness.json', 'json'],
  ['GitHub operator readiness', 'release/operator-readiness.github.json', 'json'],
];

function filePath(relativePath) {
  return path.join(desktopDir, relativePath);
}

function sha(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
}

function readText(relativePath) {
  const file = filePath(relativePath);
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

function clean(report, warningsAllowed = false) {
  const counts = summary(report);
  return counts.blockers === 0 && (warningsAllowed || counts.warnings === 0);
}

function reportDetail(report) {
  const counts = summary(report);
  const status = report?.status ? `status=${report.status}, ` : '';
  return `${status}${counts.blockers} blocker(s), ${counts.warnings} warning(s)`;
}

function addReportClean(name, report, { warningsAsBlockers = false } = {}) {
  const counts = summary(report);
  if (counts.blockers > 0 || (warningsAsBlockers && counts.warnings > 0)) {
    add(name, false, reportDetail(report));
    return;
  }
  if (counts.warnings > 0) {
    add(name, false, reportDetail(report), 'warn');
    return;
  }
  add(name, true, reportDetail(report));
}

function releaseNotesStatus(notes) {
  const match = /^Status:\s*(.+)$/m.exec(notes || '');
  return match?.[1]?.trim() || 'missing';
}

function signedManifest(manifest) {
  const security = manifest?.security || {};
  return Boolean(
    security.codeSignature?.developerId === true &&
      security.codesignVerify?.ok &&
      security.gatekeeper?.ok &&
      security.stapler?.ok &&
      security.dmgGatekeeper?.ok &&
      security.dmgStapler?.ok
  );
}

function expectedStatus({ localCandidateReady, productionReady, publishedReleaseReady, commercialReady }) {
  if (commercialReady) return 'commercial-release-ready';
  if (publishedReleaseReady) return 'published-release-ready-with-blockers';
  if (productionReady) return 'production-ready-awaiting-publication';
  if (localCandidateReady) return 'local-candidate-awaiting-external-setup';
  return 'not-ready';
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

function sourceEntry([label, relativePath, kind]) {
  const present = fs.existsSync(filePath(relativePath));
  const entry = {
    label,
    path: relativePath,
    kind,
    present,
    generatedAt: null,
    status: null,
    summary: null,
    parseError: null,
  };
  if (!present) return entry;
  if (kind === 'json') {
    const data = readJson(relativePath);
    entry.generatedAt = data?.generatedAt || null;
    entry.status = data?.status || null;
    entry.summary = data?.summary || null;
    entry.parseError = data?.parseError || null;
  }
  return entry;
}

function main() {
  const pkg = readJson('package.json');
  const sources = sourceDefinitions.map(sourceEntry);
  const sourceMap = new Map(sourceDefinitions.map(([, relativePath]) => [relativePath, readJson(relativePath)]));
  const notesText = readText('release/RELEASE_NOTES.md') || '';

  for (const source of sources) {
    add(`commercial release source exists ${source.path}`, source.present, source.path);
    if (source.present && source.kind === 'json') {
      add(`commercial release source parses ${source.path}`, !source.parseError, source.parseError || 'valid JSON');
    }
  }

  const statusRefreshVerification = sourceMap.get('release/status-refresh-report-verification.strict.json');
  const cutover = sourceMap.get('release/commercial-cutover-plan.json');
  const cutoverVerification = sourceMap.get('release/commercial-cutover-plan-report.strict.json');
  const readiness = sourceMap.get('release/production-readiness-summary.json');
  const readinessVerification = sourceMap.get('release/production-readiness-summary-verification.strict.json');
  const seal = sourceMap.get('release/release-publication-seal.json');
  const sealVerification = sourceMap.get('release/release-publication-seal-verification.strict.json');
  const decision = sourceMap.get('release/release-decision.strict.json');
  const promotion = sourceMap.get('release/release-promotion-plan.json');
  const manifest = sourceMap.get('release/release-manifest.json');
  const publishPlan = sourceMap.get('release/github-release-publish-plan.json');
  const publishPlanVerification = sourceMap.get('release/github-release-publish-plan-report.strict.json');
  const remoteAssets = sourceMap.get('release/github-release-assets-report.strict.json');
  const remediation = sourceMap.get('release/github-release-remediation-plan.json');
  const remediationVerification = sourceMap.get('release/github-release-remediation-plan-report.strict.json');
  const remediationApply = sourceMap.get('release/github-release-remediation-apply-plan.json');
  const remediationApplyVerification = sourceMap.get('release/github-release-remediation-apply-plan-report.strict.json');
  const remoteBaselineCandidate = sourceMap.get('release/remote-baseline-candidate-report.strict.json');
  const remoteBaselineCandidateVerification = sourceMap.get('release/remote-baseline-candidate-report-verification.strict.json');
  const remoteBaselineApproval = sourceMap.get('release/remote-baseline-approval-report.strict.json');
  const assetManifestVerification = sourceMap.get('release/asset-manifest-report.json');
  const baselineExportVerification = sourceMap.get('release/baseline-export-report-verification.strict.json');
  const baselineFreshness = sourceMap.get('release/baseline-freshness-report.json');
  const signingReadiness = sourceMap.get('release/signing-readiness.json');
  const githubOperatorReadiness = sourceMap.get('release/operator-readiness.github.json');

  const localEvidenceReports = [
    ['status refresh verification', statusRefreshVerification],
    ['commercial cutover verification', cutoverVerification],
    ['production readiness verification', readinessVerification],
    ['publication seal verification', sealVerification],
    ['asset manifest verification', assetManifestVerification],
    ['baseline export verification', baselineExportVerification],
    ['baseline freshness', baselineFreshness],
    ['installed app parity', sourceMap.get('release/installed-app-parity-report.json')],
    ['installed bundle delta', sourceMap.get('release/installed-bundle-delta-report.json')],
    ['UI parity', sourceMap.get('release/ui-parity-report.json')],
    ['performance parity', sourceMap.get('release/performance-parity-report.json')],
    ['macOS security contract', sourceMap.get('release/macos-security-contract.json')],
    ['IPC security', sourceMap.get('release/ipc-security-report.json')],
    ['security audit', sourceMap.get('release/security-audit-report.json')],
    ['secret hygiene', sourceMap.get('release/secret-hygiene-report.json')],
    ['DMG install experience', sourceMap.get('release/dmg-install-experience.json')],
    ['release launch smoke', sourceMap.get('release/release-launch-smoke.json')],
    ['DMG launch smoke', sourceMap.get('release/release-dmg-launch-smoke.json')],
    ['update channel', sourceMap.get('release/update-channel-report.json')],
    ['remote baseline candidate', remoteBaselineCandidate],
    ['remote baseline candidate verification', remoteBaselineCandidateVerification],
  ];
  for (const [label, report] of localEvidenceReports) {
    addReportClean(`commercial release local evidence clean ${label}`, report);
  }

  add('commercial release product version', cutover?.product?.version === pkg?.version && readiness?.product?.version === pkg?.version && seal?.product?.version === pkg?.version, `package=${pkg?.version || 'missing'}`);
  add('commercial release app id', cutover?.product?.appId === pkg?.build?.appId && readiness?.product?.appId === pkg?.build?.appId && seal?.product?.appId === pkg?.build?.appId, `expected=${pkg?.build?.appId || 'missing'}`);
  add('commercial release cutover status refresh verified', cutover?.summary?.statusRefreshVerified === true, `statusRefreshVerified=${cutover?.summary?.statusRefreshVerified}`);
  add('commercial release cutover baseline export verified', cutover?.summary?.baselineExportVerified === true, `baselineExportVerified=${cutover?.summary?.baselineExportVerified}`);
  add(
    'commercial release remote baseline candidate guard',
    remoteBaselineCandidate?.approvedForBaselineUrl === true
      ? remoteBaselineCandidate.status === 'approved-for-baseline-url' &&
          remoteBaselineCandidate.remote?.sha256 === remoteBaselineCandidate.expected?.sha256
      : remoteBaselineCandidate?.safeForDirectUse === false &&
          ['remote-size-mismatch', 'remote-sha-mismatch', 'remote-unreachable', 'remote-download-failed'].includes(remoteBaselineCandidate?.status),
    `status=${remoteBaselineCandidate?.status || 'missing'}, approved=${remoteBaselineCandidate?.approvedForBaselineUrl}, safe=${remoteBaselineCandidate?.safeForDirectUse}`,
  );
  const remoteBaselineApprovalCounts = summary(remoteBaselineApproval);
  add(
    'commercial release remote baseline approval report captured',
    Boolean(remoteBaselineApproval && !remoteBaselineApproval.parseError) &&
      (
        (remoteBaselineApproval.approvedForBaselineUrl === true &&
          remoteBaselineApproval.status === 'approved-for-baseline-url' &&
          remoteBaselineApprovalCounts.blockers === 0 &&
          remoteBaselineApprovalCounts.warnings === 0) ||
        (remoteBaselineApproval.approvedForBaselineUrl !== true &&
          remoteBaselineApproval.status === 'not-approved-for-baseline-url' &&
          remoteBaselineApprovalCounts.blockers > 0 &&
          remoteBaselineApprovalCounts.warnings === 0)
      ),
    remoteBaselineApproval
      ? `status=${remoteBaselineApproval.status || 'missing'}, approved=${remoteBaselineApproval.approvedForBaselineUrl}, ${remoteBaselineApprovalCounts.blockers} blocker(s), ${remoteBaselineApprovalCounts.warnings} warning(s)`
      : 'missing',
  );

  const manifestSigned = signedManifest(manifest);
  const notesStatus = releaseNotesStatus(notesText);
  const productionChecks = [
    ['strict decision productionReady', decision?.productionReady === true, `status=${decision?.status || 'missing'}, productionReady=${decision?.productionReady}`],
    ['strict decision signedNotarized', decision?.signedNotarized === true, `signedNotarized=${decision?.signedNotarized}`],
    ['promotion productionReady', promotion?.productionReady === true, `status=${promotion?.status || 'missing'}, productionReady=${promotion?.productionReady}`],
    ['readiness productionReady', readiness?.productionReady === true, `status=${readiness?.status || 'missing'}, productionReady=${readiness?.productionReady}`],
    ['publication seal productionReady', seal?.productionReady === true, `status=${seal?.status || 'missing'}, productionReady=${seal?.productionReady}`],
    ['release notes signed-and-notarized', notesStatus === 'signed-and-notarized', `status=${notesStatus}`],
    ['release manifest signed and notarized', manifestSigned, `developerId=${manifest?.security?.codeSignature?.developerId}, signature=${manifest?.security?.codeSignature?.kind || 'missing'}, codesign=${manifest?.security?.codesignVerify?.ok}, gatekeeper=${manifest?.security?.gatekeeper?.ok}, stapler=${manifest?.security?.stapler?.ok}, dmgGatekeeper=${manifest?.security?.dmgGatekeeper?.ok}, dmgStapler=${manifest?.security?.dmgStapler?.ok}`],
    ['signing readiness clean', clean(signingReadiness), reportDetail(signingReadiness)],
    ['GitHub operator readiness clean', clean(githubOperatorReadiness), reportDetail(githubOperatorReadiness)],
  ];
  for (const [name, ok, detail] of productionChecks) add(`commercial release production gate ${name}`, ok, detail);

  const remoteRequiredActions = Number(remediation?.summary?.requiredActions ?? remediation?.requiredActions?.length ?? 0);
  const remoteApplyActions = Number(remediationApply?.summary?.actions || 0);
  const remoteUploadPermissionReady = remoteApplyActions === 0 ||
    remediationApply?.github?.canUploadReleaseAssets === true;
  const cutoverUploadPermission = cutover?.remoteAssetRemediation?.uploadPermission || {};
  const cutoverTotalUnblockGroups = Number(cutover?.summary?.totalUnblockGroups || 0);
  const cutoverBlockedUnblockGroups = Number(cutover?.summary?.blockedUnblockGroups ?? cutover?.summary?.unblockGroups ?? 0);
  add(
    'commercial release cutover unblock group accounting',
    cutoverTotalUnblockGroups >= cutoverBlockedUnblockGroups &&
      cutoverBlockedUnblockGroups === Number(cutover?.summary?.unblockGroups || 0),
    `total=${cutoverTotalUnblockGroups}, blocked=${cutoverBlockedUnblockGroups}, legacy=${cutover?.summary?.unblockGroups ?? 'missing'}`,
  );
  add(
    'commercial release cutover remote upload permission summary',
    cutover?.summary?.remoteUploadPermissionReady === remoteUploadPermissionReady,
    `cutover=${cutover?.summary?.remoteUploadPermissionReady}, expected=${remoteUploadPermissionReady}`,
  );
  add(
    'commercial release cutover remote upload permission snapshot',
    cutoverUploadPermission.sourceReport === 'release/github-release-remediation-apply-plan.json' &&
      cutoverUploadPermission.verifierReport === 'release/github-release-remediation-apply-plan-report.strict.json' &&
      cutoverUploadPermission.repo === (remediationApply?.github?.repo || null) &&
      cutoverUploadPermission.viewerPermission === (remediationApply?.github?.viewerPermission || null) &&
      cutoverUploadPermission.canUploadReleaseAssets === (remediationApply?.github?.canUploadReleaseAssets ?? null) &&
      Number(cutoverUploadPermission.actions || 0) === remoteApplyActions,
    `status=${cutoverUploadPermission.status || 'missing'}, repo=${cutoverUploadPermission.repo || 'missing'}, viewerPermission=${cutoverUploadPermission.viewerPermission || 'missing'}, canUploadReleaseAssets=${cutoverUploadPermission.canUploadReleaseAssets ?? 'missing'}, actions=${cutoverUploadPermission.actions ?? 'missing'}`,
  );
  const remediationGuard = remediation?.baselineUrlGuard || {};
  const remediationGuardMirror = remediationGuard.localBaselineMirror || {};
  const remediationGuardRemote = remediationGuard.remoteBaselineCandidate || {};
  const approvedBaselineSource = remediationGuardMirror.approvedUploadSource || '';
  const approvedBaselineFile = approvedBaselineSource ? filePath(approvedBaselineSource) : null;
  const approvedBaselineSourceVerified = Boolean(
    approvedBaselineFile &&
      fs.existsSync(approvedBaselineFile) &&
      fs.statSync(approvedBaselineFile).size === Number(remediationGuardMirror.expectedBaselineBytes || 0) &&
      sha(approvedBaselineFile, 'sha256') === remediationGuardMirror.expectedBaselineSha256
  );
  const localMirrorOrApprovedBaselineSourceVerified =
    (remediationGuardMirror.status === 'verified-match' && remediationGuardMirror.matchesExport === true) ||
    approvedBaselineSourceVerified;
  const publicationChecks = [
    ['readiness publishedReleaseReady', readiness?.publishedReleaseReady === true, `publishedReleaseReady=${readiness?.publishedReleaseReady}`],
    ['publication seal publishedReleaseReady', seal?.publishedReleaseReady === true, `publishedReleaseReady=${seal?.publishedReleaseReady}`],
    ['publish plan clean', clean(publishPlan), reportDetail(publishPlan)],
    ['publish plan verification clean', clean(publishPlanVerification), reportDetail(publishPlanVerification)],
    ['remote assets verified clean', clean(remoteAssets), reportDetail(remoteAssets)],
    ['remote remediation verification clean', clean(remediationVerification), reportDetail(remediationVerification)],
    ['remote remediation apply verification clean', clean(remediationApplyVerification), reportDetail(remediationApplyVerification)],
    [
      'remote remediation baseline URL guard',
      remediationGuard.ok === true &&
        remediationGuard.status === 'approved-source-verified-remote-baseline-rejected' &&
        localMirrorOrApprovedBaselineSourceVerified &&
        remediationGuardMirror.approvedUploadSource === 'release/Connect-AI-0.4.8-baseline-arm64-mac.zip' &&
        remediationGuardRemote.status === 'not-approved-baseline-url' &&
        remediationGuardRemote.remoteBytes !== remediationGuardRemote.expectedBaselineBytes,
      `status=${remediationGuard.status || 'missing'}, source=${remediationGuardMirror.approvedUploadSource || 'missing'}, sourceVerified=${approvedBaselineSourceVerified}, remote=${remediationGuardRemote.remoteBytes ?? 'missing'}, expected=${remediationGuardRemote.expectedBaselineBytes ?? 'missing'}`,
    ],
    [
      'remote remediation upload permission',
      remoteUploadPermissionReady,
      `repo=${remediationApply?.github?.repo || 'missing'}, permission=${remediationApply?.github?.viewerPermission || 'missing'}, canUpload=${remediationApply?.github?.canUploadReleaseAssets}, actions=${remoteApplyActions}`,
    ],
    [
      'remote baseline URL approval gate',
      remoteBaselineApproval?.approvedForBaselineUrl === true &&
        remoteBaselineApproval?.status === 'approved-for-baseline-url' &&
        remoteBaselineApprovalCounts.blockers === 0 &&
        remoteBaselineApprovalCounts.warnings === 0,
      `status=${remoteBaselineApproval?.status || 'missing'}, approved=${remoteBaselineApproval?.approvedForBaselineUrl}, ${remoteBaselineApprovalCounts.blockers} blocker(s), ${remoteBaselineApprovalCounts.warnings} warning(s)`,
    ],
    ['remote remediation required actions zero', remoteRequiredActions === 0, `${remoteRequiredActions} required action(s)`],
    ['remote remediation apply actions zero', remoteApplyActions === 0, `${remoteApplyActions} dry-run action(s)`],
  ];
  for (const [name, ok, detail] of publicationChecks) add(`commercial release publication gate ${name}`, ok, detail);

  if (requireProduction) {
    add('commercial release require production', readiness?.productionReady === true && seal?.productionReady === true && decision?.productionReady === true && promotion?.productionReady === true, `decision=${decision?.productionReady}, promotion=${promotion?.productionReady}, readiness=${readiness?.productionReady}, seal=${seal?.productionReady}`);
  }
  if (requirePublished) {
    add('commercial release require published', readiness?.publishedReleaseReady === true && seal?.publishedReleaseReady === true, `readiness=${readiness?.publishedReleaseReady}, seal=${seal?.publishedReleaseReady}`);
  }

  const serialized = JSON.stringify({ sources, checks, cutover, readiness, seal });
  add('commercial release secret material scan', !hasSecretMaterial(serialized), 'no private key, certificate body, GitHub token, or API key literal patterns');

  const currentBlockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const currentWarnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const localCandidateReady = Boolean(readiness?.localCandidateReady && seal?.localCandidateReady && decision?.localCandidateReady && promotion?.localCandidateReady);
  const productionReady = currentBlockers === 0 || productionChecks.every(([, ok]) => ok);
  const publishedReleaseReady = productionReady && publicationChecks.every(([, ok]) => ok);
  const commercialReady = currentBlockers === 0 && publishedReleaseReady;
  const status = expectedStatus({ localCandidateReady, productionReady, publishedReleaseReady, commercialReady });

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireProduction,
    requirePublished,
    status,
    localCandidateReady,
    productionReady,
    publishedReleaseReady,
    commercialReady,
    product: {
      name: pkg?.build?.productName || pkg?.name || 'Connect AI',
      version: pkg?.version || null,
      appId: pkg?.build?.appId || null,
      releaseTag: pkg?.version ? `desktop-v${pkg.version}` : null,
    },
    summary: {
      blockers: currentBlockers,
      warnings: currentWarnings,
      sources: sources.length,
      remoteRequiredActions,
      remoteApplyActions,
      remoteUploadPermissionReady,
      blockedCredentialGroups: Number(cutover?.summary?.blockedCredentialGroups || 0),
      totalUnblockGroups: cutoverTotalUnblockGroups,
      blockedUnblockGroups: cutoverBlockedUnblockGroups,
      externalBlockers: Number(cutover?.summary?.externalBlockers || 0),
    },
    sources,
    checks,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(filePath(reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI commercial release readiness (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${currentBlockers} blocker(s), ${currentWarnings} warning(s)`);
  console.log(`Status: ${status}`);
  console.log(`Wrote ${reportPath}`);
  if (currentBlockers > 0 && !noExit) process.exit(1);
}

main();
