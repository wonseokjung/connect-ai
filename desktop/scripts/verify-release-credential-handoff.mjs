import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const requireClean = process.argv.includes('--require-clean');
const checks = [];

const reportPath = strict
  ? 'release/release-credential-handoff-report.strict.json'
  : 'release/release-credential-handoff-report.json';
const handoffPath = 'release/release-credential-handoff.json';
const handoffMarkdownPath = 'release/RELEASE_CREDENTIAL_HANDOFF.md';
const requiredGroupIds = [
  'baseline-artifact',
  'github-readiness-audit-token',
  'developer-id-certificate',
  'apple-notarization',
];
const requiredSourcePaths = [
  'release/release-env-contract-report.json',
  'release/baseline-export-report.json',
  'release/baseline-export-report-verification.strict.json',
  'release/release-env-report.process.json',
  'release/release-env-report.json',
  'release/signing-readiness.json',
  'release/github-release-setup-report.json',
  'release/operator-readiness.github.json',
  'release/production-readiness-summary.json',
  'release/release-unblock-plan.json',
  'release/commercial-release-readiness-report.strict.json',
  'release/commercial-finalization-report.json',
  'release/commercial-finalization-report-verification.strict.json',
  'release/github-release-remediation-plan.json',
  'release/github-release-remediation-plan-report.json',
  'release/github-release-remediation-plan-report.strict.json',
  'release/github-release-remediation-apply-plan.json',
  'release/github-release-remediation-apply-plan-report.strict.json',
];
const requiredOperatorCommands = [
  'release:baseline-export',
  'verify:baseline-export:strict:report',
  'release:env-bootstrap',
  'verify:env-bootstrap:strict:report',
  'verify:release-env-contract',
  'release:env-check:strict:report',
  'verify:release-env-validation',
  'signing:check:report:env',
  'release:github-setup',
  'release:github-setup:apply',
  'release:operator-checklist:github:strict:report:env',
  'verify:credential-handoff:strict:report',
  'release:operator-runbook:process:apply',
  'verify:github-release-assets:strict:env',
  'release:github-release-remediation-plan',
  'verify:github-release-remediation-plan:strict:report',
  'release:github-release-remediation-apply:plan',
  'verify:github-release-remediation-apply-plan:strict:report',
  'release:github-release-remediation-apply:env',
  'release:publication-seal:strict:report',
  'release:commercial-finalize',
  'release:commercial-finalize:commercial',
  'verify:commercial-finalization:commercial',
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

function fileExists(relativePath) {
  return fs.existsSync(path.join(desktopDir, relativePath));
}

function actualSourceReport(relativePath) {
  return readJson(relativePath);
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

function generatedAtMs(report) {
  const value = Date.parse(report?.generatedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function remoteAssetSourceEntries(handoff) {
  return (handoff.sourceReports || [])
    .filter((source) => [
      'release/github-release-assets-report.strict.json',
      'release/github-release-assets-report.json',
    ].includes(source.path));
}

function expectedSelectedRemoteAssetSource(handoff) {
  const entries = remoteAssetSourceEntries(handoff)
    .filter((source) => source.present && !source.parseError)
    .map((source) => ({
      ...source,
      timestamp: generatedAtMs(source),
    }));
  return entries.sort((left, right) => {
    if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
    return Number(right.strict === true) - Number(left.strict === true);
  })[0] || null;
}

function expectedStatus(readiness) {
  return readiness?.productionReady === true ? 'production-ready' : 'external-credentials-required';
}

function asCommandText(items) {
  return (items || []).map((item) => `${item.step || ''}\n${item.command || ''}\n${item.note || ''}`).join('\n');
}

function baselineUrlLooksValid(value, version) {
  const text = String(value || '').trim();
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.pathname.endsWith('.zip') && text.includes(version);
  } catch {
    return false;
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sourcePathSet(sources) {
  return new Set((sources || []).map((item) => item.path).filter(Boolean));
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

function looksLikeReleaseUploadCommand(value) {
  const text = String(value || '');
  return /\bgh\s+release\s+upload\b/.test(text) || /'gh'\s+'release'\s+'upload'/.test(text);
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireClean,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI release credential handoff verification (${strict ? 'strict' : 'local'})`);
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
  const handoff = readJson(handoffPath);
  const readiness = readJson('release/production-readiness-summary.json');
  const manifest = readJson('release/release-asset-manifest.json');
  const baselineExport = readJson('release/baseline-export-report.json');
  const baselineExportVerification = readJson('release/baseline-export-report-verification.strict.json');
  const remediationPlan = readJson('release/github-release-remediation-plan.json');
  const remediationReport = readJson('release/github-release-remediation-plan-report.json');
  const remediationStrictReport = readJson('release/github-release-remediation-plan-report.strict.json');
  const remediationApplyPlan = readJson('release/github-release-remediation-apply-plan.json');
  const remediationApplyVerification = readJson('release/github-release-remediation-apply-plan-report.strict.json');

  add('release credential handoff exists', Boolean(handoff && !handoff.parseError), handoff?.parseError || handoffPath);
  add('release credential handoff notes exist', fileExists(handoffMarkdownPath), handoffMarkdownPath);
  if (!handoff || handoff.parseError) {
    printAndExit();
    return;
  }

  const groups = Array.isArray(handoff.credentialGroups) ? handoff.credentialGroups : [];
  const groupIds = groups.map((group) => group.id);
  const duplicateGroupIds = groupIds.filter((id, index) => groupIds.indexOf(id) !== index);
  const groupIdSet = new Set(groupIds);
  const sourceReports = Array.isArray(handoff.sourceReports) ? handoff.sourceReports : [];
  const sourcePaths = sourcePathSet(sourceReports);
  const missingSources = sourceReports.filter((source) => !source.present).length;
  const blockedGroups = groups.filter((group) => group.status !== 'ready').length;
  const remote = handoff.remoteAssetRemediation || {};
  const requiredRemoteCommands = Array.isArray(remote.requiredCommands) ? remote.requiredCommands : [];
  const advisoryRemoteReviews = Array.isArray(remote.advisoryReviews) ? remote.advisoryReviews : [];
  const remoteBaselineCandidate = handoff.remoteBaselineCandidate || {};
  const localBaselineMirror = handoff.localBaselineMirror || {};
  const githubApiPermissions = handoff.githubApiPermissions || {};
  const githubReleaseUploadPermission = handoff.githubReleaseUploadPermission || {};

  add('release credential handoff schema version', handoff.schemaVersion === 1, String(handoff.schemaVersion));
  add('release credential handoff product version', handoff.product?.version === pkg?.version, `${handoff.product?.version || 'missing'} expected ${pkg?.version || 'missing'}`);
  add('release credential handoff product appId', handoff.product?.appId === pkg?.build?.appId, `${handoff.product?.appId || 'missing'} expected ${pkg?.build?.appId || 'missing'}`);
  add('release credential handoff status freshness', handoff.status === expectedStatus(readiness), `${handoff.status} expected ${expectedStatus(readiness)}`);
  add('release credential handoff group array', groups.length > 0, `${groups.length} group(s)`);
  add('release credential handoff required groups', requiredGroupIds.every((id) => groupIdSet.has(id)), `required=${requiredGroupIds.join(', ')}`);
  add('release credential handoff duplicate groups', duplicateGroupIds.length === 0, duplicateGroupIds.length ? duplicateGroupIds.join(', ') : 'none');
  add('release credential handoff group summary', handoff.summary?.credentialGroups === groups.length, `${handoff.summary?.credentialGroups} expected ${groups.length}`);
  add('release credential handoff blocked group summary', handoff.summary?.blockedCredentialGroups === blockedGroups, `${handoff.summary?.blockedCredentialGroups} expected ${blockedGroups}`);
  add('release credential handoff missing source summary', handoff.summary?.missingSourceReports === missingSources, `${handoff.summary?.missingSourceReports} expected ${missingSources}`);
  add('release credential handoff remote required summary', handoff.summary?.remoteRequiredActions === Number(remote.requiredActions || 0), `${handoff.summary?.remoteRequiredActions} expected ${Number(remote.requiredActions || 0)}`);
  add('release credential handoff remote advisory summary', handoff.summary?.remoteAdvisoryActions === Number(remote.advisoryActions || 0), `${handoff.summary?.remoteAdvisoryActions} expected ${Number(remote.advisoryActions || 0)}`);
  const remoteUploadActions = Number(remediationApplyPlan?.summary?.actions || 0);
  const remoteUploadReady = remoteUploadActions === 0 || remediationApplyPlan?.github?.canUploadReleaseAssets === true;
  add(
    'release credential handoff remote upload permission summary',
    handoff.summary?.remoteUploadPermissionReady === remoteUploadReady,
    `${handoff.summary?.remoteUploadPermissionReady} expected ${remoteUploadReady}`,
  );
  add('release credential handoff source report array', sourceReports.length >= requiredSourcePaths.length, `${sourceReports.length} source report(s)`);

  for (const sourcePath of requiredSourcePaths) {
    const source = sourceReports.find((item) => item.path === sourcePath);
    add(`release credential source report ${sourcePath}`, Boolean(source), source ? 'listed' : 'missing');
    if (source) {
      add(`release credential source report present ${sourcePath}`, source.present === fileExists(sourcePath), `reported=${source.present} actual=${fileExists(sourcePath)}`);
      add(`release credential source report parse ${sourcePath}`, !source.parseError, source.parseError || 'valid or absent');
    }
  }
  const staleSources = [];
  for (const source of sourceReports) {
    if (!source.present || !source.path) continue;
    const actual = actualSourceReport(source.path);
    const actualGeneratedAt = actual?.generatedAt || null;
    if (actualGeneratedAt && source.generatedAt !== actualGeneratedAt) {
      staleSources.push(`${source.path}: handoff=${source.generatedAt || 'missing'} actual=${actualGeneratedAt}`);
    }
  }
  add(
    'release credential source report freshness',
    staleSources.length === 0,
    staleSources.length ? staleSources.join('; ') : `${sourceReports.length} source report(s) current`,
  );
  add(
    'release credential remote asset source report',
    sourceReports.some((item) => item.path === 'release/github-release-assets-report.strict.json' || item.path === 'release/github-release-assets-report.json'),
    'strict or local remote asset report listed',
  );
  const remoteAssetSources = remoteAssetSourceEntries(handoff);
  const selectedRemoteAssetSource = expectedSelectedRemoteAssetSource(handoff);
  const selectedRemoteAssetSources = remoteAssetSources.filter((source) => source.selected === true);
  add('release credential remote asset source report selection coverage', remoteAssetSources.length >= 1, `${remoteAssetSources.length} remote asset source report(s)`);
  add(
    'release credential selected remote asset source report',
    Boolean(selectedRemoteAssetSource) &&
      selectedRemoteAssetSources.length === 1 &&
      selectedRemoteAssetSources[0].path === selectedRemoteAssetSource.path &&
      remote.upstreamAssetReport === selectedRemoteAssetSource.path,
    selectedRemoteAssetSource ? `${selectedRemoteAssetSource.path} selected=${selectedRemoteAssetSources.map((source) => source.path).join(', ') || 'none'} upstream=${remote.upstreamAssetReport || 'missing'}` : 'missing selected source',
  );
  for (const source of remoteAssetSources.filter((item) => item.present && !item.parseError)) {
    const isSelected = selectedRemoteAssetSource?.path === source.path;
    const expectedFreshness = isSelected ? 'selected-current' : selectedRemoteAssetSource && generatedAtMs(source) < generatedAtMs(selectedRemoteAssetSource) ? `stale-superseded-by-${selectedRemoteAssetSource.strict === true ? 'strict' : 'local'}` : 'available-not-selected';
    const expectedSupersededBy = expectedFreshness.startsWith('stale-superseded-by-') ? selectedRemoteAssetSource?.path : null;
    add(
      `release credential remote asset source freshness ${source.path}`,
      source.selected === isSelected &&
        source.freshness === expectedFreshness &&
        (source.supersededBy || null) === expectedSupersededBy,
      `selected=${source.selected}, freshness=${source.freshness || 'missing'}, supersededBy=${source.supersededBy || 'none'}`,
    );
  }
  add(
    'release credential remediation source reports',
    sourceReports.some((item) => item.path === 'release/github-release-remediation-plan.json') &&
      sourceReports.some((item) => item.path === 'release/github-release-remediation-plan-report.json') &&
      sourceReports.some((item) => item.path === 'release/github-release-remediation-plan-report.strict.json') &&
      sourceReports.some((item) => item.path === 'release/github-release-remediation-apply-plan.json') &&
      sourceReports.some((item) => item.path === 'release/github-release-remediation-apply-plan-report.strict.json'),
    'remediation plan, both verifier reports, apply dry-run report, and apply dry-run verifier listed',
  );
  const baselineArtifact = handoff.baselineArtifact || {};
  const baselineSha = String(baselineArtifact.sha256 || '');
  add('release credential baseline artifact snapshot', Boolean(handoff.baselineArtifact), handoff.baselineArtifact ? 'present' : 'missing');
  add('release credential baseline artifact source report', baselineArtifact.sourceReport === 'release/baseline-export-report.json', baselineArtifact.sourceReport || 'missing');
  add('release credential baseline artifact verification report', baselineArtifact.verificationReport === 'release/baseline-export-report-verification.strict.json', baselineArtifact.verificationReport || 'missing');
  add(
    'release credential baseline artifact freshness',
    Boolean(baselineExport) &&
      !baselineExport.parseError &&
      baselineArtifact.generatedAt === baselineExport.generatedAt &&
      baselineArtifact.ok === (baselineExport.ok === true && summary(baselineExport).blockers === 0),
    `handoff=${baselineArtifact.generatedAt || 'missing'}, baseline=${baselineExport?.generatedAt || 'missing'}`,
  );
  add(
    'release credential baseline artifact verification freshness',
    Boolean(baselineExportVerification) &&
      !baselineExportVerification.parseError &&
      baselineArtifact.verificationGeneratedAt === baselineExportVerification.generatedAt &&
      baselineArtifact.verified === (baselineExportVerification.strict === true && summary(baselineExportVerification).blockers === 0 && summary(baselineExportVerification).warnings === 0) &&
      baselineArtifact.verificationSummary?.blockers === summary(baselineExportVerification).blockers &&
      baselineArtifact.verificationSummary?.warnings === summary(baselineExportVerification).warnings,
    `handoff=${baselineArtifact.verificationGeneratedAt || 'missing'}, verification=${baselineExportVerification?.generatedAt || 'missing'}`,
  );
  add('release credential baseline artifact path', baselineArtifact.path === baselineExport?.export?.path, baselineArtifact.path || 'missing');
  add('release credential baseline artifact bytes', baselineArtifact.bytes === baselineExport?.export?.bytes, `${baselineArtifact.bytes ?? 'missing'} expected ${baselineExport?.export?.bytes ?? 'missing'}`);
  add('release credential baseline artifact sha256', /^[a-f0-9]{64}$/.test(baselineSha) && baselineSha === baselineExport?.export?.sha256, baselineSha || 'missing');
	  add(
	    'release credential baseline artifact variable aliases',
	    baselineArtifact.suggestedVariables?.CONNECT_AI_BASELINE_SHA256 === baselineSha &&
	      baselineArtifact.suggestedVariables?.CONNECT_AI_ZIP_SHA256 === baselineSha,
	    'CONNECT_AI_BASELINE_SHA256 and CONNECT_AI_ZIP_SHA256 mirror baseline artifact sha256',
	  );
	  add(
	    'release credential baseline URL candidate shape',
	    baselineUrlLooksValid(baselineArtifact.suggestedVariables?.CONNECT_AI_BASELINE_URL, pkg?.version || ''),
	    baselineArtifact.suggestedVariables?.CONNECT_AI_BASELINE_URL || 'missing',
	  );
  const localMirrorValidationText = asCommandText(localBaselineMirror.validationCommands);
  const localMirrorPath = localBaselineMirror.resolvedPath || null;
  const localMirrorPresent = Boolean(localMirrorPath && fs.existsSync(localMirrorPath));
  const localMirrorStat = localMirrorPresent ? fs.statSync(localMirrorPath) : null;
  const localMirrorSha = localMirrorPresent ? sha256File(localMirrorPath) : null;
  add('release credential local baseline mirror snapshot', Boolean(handoff.localBaselineMirror), handoff.localBaselineMirror ? 'present' : 'missing');
  add('release credential local baseline mirror status', ['missing', 'verified-match', 'mismatch'].includes(localBaselineMirror.status), localBaselineMirror.status || 'missing');
  add('release credential local baseline mirror approved source', localBaselineMirror.approvedUploadSource === baselineArtifact.path || localBaselineMirror.status === 'missing', `${localBaselineMirror.approvedUploadSource || 'missing'} expected ${baselineArtifact.path || 'missing'}`);
  add('release credential local baseline mirror expected sha', localBaselineMirror.expectedBaselineSha256 === baselineSha || localBaselineMirror.status === 'missing', localBaselineMirror.expectedBaselineSha256 || 'missing');
  add(
    'release credential local baseline mirror validation commands',
    localMirrorValidationText.includes('shasum -a 256') &&
      localMirrorValidationText.includes('Connect-AI-0.4.8-arm64-mac.zip') &&
      localMirrorValidationText.includes('Connect-AI-0.4.8-baseline-arm64-mac.zip'),
    'local mirror and exported baseline SHA comparison documented',
  );
  if (localBaselineMirror.status !== 'missing') {
    add('release credential local baseline mirror file presence', localMirrorPresent, localMirrorPath || 'missing resolved path');
    add('release credential local baseline mirror bytes', localMirrorStat?.size === localBaselineMirror.bytes && localBaselineMirror.bytes === baselineArtifact.bytes, `${localMirrorStat?.size ?? 'missing'} reported=${localBaselineMirror.bytes ?? 'missing'} baseline=${baselineArtifact.bytes ?? 'missing'}`);
    add('release credential local baseline mirror sha256', localMirrorSha === localBaselineMirror.sha256 && localBaselineMirror.sha256 === baselineSha, `${localMirrorSha || 'missing'} reported=${localBaselineMirror.sha256 || 'missing'} baseline=${baselineSha || 'missing'}`);
    add('release credential local baseline mirror match projection', localBaselineMirror.matchesExport === (localMirrorStat?.size === baselineArtifact.bytes && localMirrorSha === baselineSha), `matchesExport=${localBaselineMirror.matchesExport}`);
  }
  const remoteBaselineValidationText = asCommandText(remoteBaselineCandidate.validationCommands);
  add('release credential remote baseline candidate snapshot', Boolean(handoff.remoteBaselineCandidate), handoff.remoteBaselineCandidate ? 'present' : 'missing');
  add('release credential remote baseline candidate source', remoteBaselineCandidate.sourceReport === 'release/github-release-assets-report.strict.json', remoteBaselineCandidate.sourceReport || 'missing');
  add('release credential remote baseline candidate asset', remoteBaselineCandidate.asset === `Connect-AI-${pkg?.version || '0.4.8'}-arm64-mac.zip`, remoteBaselineCandidate.asset || 'missing');
  add(
    'release credential remote baseline candidate status',
    ['missing', 'not-approved-baseline-url', 'size-match-sha-unverified'].includes(remoteBaselineCandidate.status),
    remoteBaselineCandidate.status || 'missing',
  );
  add(
    'release credential remote baseline candidate byte comparison',
    remoteBaselineCandidate.status !== 'not-approved-baseline-url' ||
      (remoteBaselineCandidate.remoteBytes !== remoteBaselineCandidate.expectedBaselineBytes &&
        remoteBaselineCandidate.expectedBaselineSha256 === baselineSha),
    `remote=${remoteBaselineCandidate.remoteBytes ?? 'missing'}, expected=${remoteBaselineCandidate.expectedBaselineBytes ?? 'missing'}, sha=${remoteBaselineCandidate.expectedBaselineSha256 || 'missing'}`,
  );
  add(
    'release credential remote baseline candidate validation commands',
    remoteBaselineValidationText.includes('gh release download desktop-v0.4.8') &&
      remoteBaselineValidationText.includes('shasum -a 256') &&
      remoteBaselineValidationText.includes('release/Connect-AI-0.4.8-baseline-arm64-mac.zip'),
    'download and SHA comparison commands documented',
  );
  const githubApiValidationText = `${asCommandText(githubApiPermissions.validationCommands)}\n${asCommandText(githubApiPermissions.remediationCommands)}`;
  const githubApiRequiredPermissions = Array.isArray(githubApiPermissions.requiredPermissions) ? githubApiPermissions.requiredPermissions.join('\n') : '';
  add('release credential GitHub API permission snapshot', Boolean(handoff.githubApiPermissions), handoff.githubApiPermissions ? 'present' : 'missing');
  add('release credential GitHub API permission source report', githubApiPermissions.sourceReport === 'release/operator-readiness.github.json', githubApiPermissions.sourceReport || 'missing');
  add('release credential GitHub API permission status', ['ready', 'missing-or-unverified'].includes(githubApiPermissions.status), githubApiPermissions.status || 'missing');
  add(
    'release credential GitHub API required permissions',
    /Actions variables: read/.test(githubApiRequiredPermissions) &&
      /Actions secrets: read/.test(githubApiRequiredPermissions) &&
      /Repository metadata: read/.test(githubApiRequiredPermissions),
    githubApiRequiredPermissions || 'missing',
  );
  add(
    'release credential GitHub API evidence',
    Array.isArray(githubApiPermissions.currentEvidence) && githubApiPermissions.currentEvidence.length > 0,
    `${githubApiPermissions.currentEvidence?.length || 0} evidence item(s)`,
  );
  add(
    'release credential GitHub API validation commands',
    githubApiValidationText.includes("repos/wonseokjung/connect-ai/actions/variables?per_page=1") &&
      githubApiValidationText.includes("repos/wonseokjung/connect-ai/actions/secrets?per_page=1") &&
      githubApiValidationText.includes('release:operator-checklist:github:strict:report:env') &&
      githubApiValidationText.includes('gh secret set CONNECT_AI_RELEASE_AUDIT_TOKEN'),
    'variables/secrets API probes and token handoff command documented',
  );
  const uploadValidationText = `${asCommandText(githubReleaseUploadPermission.validationCommands)}\n${asCommandText(githubReleaseUploadPermission.remediationCommands)}`;
  const uploadRequiredPermissions = Array.isArray(githubReleaseUploadPermission.requiredPermissions)
    ? githubReleaseUploadPermission.requiredPermissions.join('\n')
    : '';
  const uploadEvidence = Array.isArray(githubReleaseUploadPermission.currentEvidence)
    ? githubReleaseUploadPermission.currentEvidence.join('\n')
    : '';
  add('release credential GitHub Release upload permission snapshot', Boolean(handoff.githubReleaseUploadPermission), handoff.githubReleaseUploadPermission ? 'present' : 'missing');
  add('release credential GitHub Release upload permission source report', githubReleaseUploadPermission.sourceReport === 'release/github-release-remediation-apply-plan.json', githubReleaseUploadPermission.sourceReport || 'missing');
  add('release credential GitHub Release upload permission verifier report', githubReleaseUploadPermission.verifierReport === 'release/github-release-remediation-apply-plan-report.strict.json', githubReleaseUploadPermission.verifierReport || 'missing');
  add(
    'release credential GitHub Release upload permission status',
    ['ready', 'missing-or-unverified'].includes(githubReleaseUploadPermission.status) &&
      (remoteUploadReady ? githubReleaseUploadPermission.status === 'ready' : githubReleaseUploadPermission.status === 'missing-or-unverified'),
    `${githubReleaseUploadPermission.status || 'missing'} expected ${remoteUploadReady ? 'ready' : 'missing-or-unverified'}`,
  );
  add(
    'release credential GitHub Release upload permission evidence',
    uploadEvidence.includes(`repo=${remediationApplyPlan?.github?.repo || 'missing'}`) &&
      uploadEvidence.includes(`viewerPermission=${remediationApplyPlan?.github?.viewerPermission || 'missing'}`) &&
      uploadEvidence.includes(`canUploadReleaseAssets=${remediationApplyPlan?.github?.canUploadReleaseAssets ?? 'missing'}`) &&
      uploadEvidence.includes(`actions=${remoteUploadActions}`),
    uploadEvidence || 'missing',
  );
  add(
    'release credential GitHub Release upload required permissions',
    /write, maintain, or admin/i.test(uploadRequiredPermissions) &&
      /upload\/delete GitHub Release assets/i.test(uploadRequiredPermissions) &&
      /canUploadReleaseAssets true when actions > 0/i.test(uploadRequiredPermissions),
    uploadRequiredPermissions || 'missing',
  );
  add(
    'release credential GitHub Release upload validation commands',
    uploadValidationText.includes('gh repo view wonseokjung/connect-ai --json viewerPermission,url') &&
      uploadValidationText.includes('release:github-release-remediation-apply:plan') &&
      uploadValidationText.includes('verify:github-release-remediation-apply-plan:strict:report') &&
      uploadValidationText.includes('gh auth login --hostname github.com --scopes repo,workflow'),
    'repo permission probe, dry-run diagnostics, verifier, and re-auth command documented',
  );
  add('release credential missing source reports accounted', handoff.summary?.missingSourceReports === missingSources, `${missingSources} missing source report(s)`);

  for (const id of requiredGroupIds) {
    const group = groups.find((item) => item.id === id);
    add(`release credential group ${id}`, Boolean(group), group ? group.title : 'missing');
    if (!group) continue;
    add(`release credential group ${id} status`, ['ready', 'missing-or-unverified'].includes(group.status), group.status || 'missing');
    add(`release credential group ${id} local inputs`, Array.isArray(group.localInputs) && group.localInputs.length > 0, `${group.localInputs?.length || 0} input(s)`);
    add(`release credential group ${id} current evidence`, Array.isArray(group.currentEvidence) && group.currentEvidence.length > 0, `${group.currentEvidence?.length || 0} evidence item(s)`);
    add(`release credential group ${id} commands`, Array.isArray(group.commands) && group.commands.length > 0 && group.commands.every((item) => item.step && item.command), `${group.commands?.length || 0} command(s)`);
    add(`release credential group ${id} validation`, Array.isArray(group.validation) && group.validation.length > 0 && group.validation.every((item) => item.step && item.command), `${group.validation?.length || 0} validation command(s)`);
	    const commandText = `${asCommandText(group.commands)}\n${asCommandText(group.validation)}`;
	    add(`release credential group ${id} command safety`, !hasSecretMaterial(commandText), 'commands contain key names and shell snippets only');
	    if (id === 'baseline-artifact') {
	      add(
	        'release credential baseline group uses candidate URL and SHA',
	        commandText.includes(baselineArtifact.suggestedVariables?.CONNECT_AI_BASELINE_URL || 'missing') &&
	          commandText.includes(baselineSha),
	        'baseline URL candidate and exported SHA are projected into operator commands',
	      );
	      add(
	        'release credential baseline group guards GitHub variable command',
	        commandText.includes('verify:remote-baseline-approved:refresh') &&
	          commandText.includes('gh variable set CONNECT_AI_BASELINE_URL'),
	        'GitHub baseline variable command is guarded by the remote baseline approval gate',
	      );
	    }
	  }

  const notarizationGroup = groups.find((item) => item.id === 'apple-notarization');
  const notarizationCommandText = `${asCommandText(notarizationGroup?.commands)}\n${asCommandText(notarizationGroup?.validation)}`;
  add(
    'release credential notarization profile command',
    notarizationCommandText.includes('signing:notary-profile:report:env'),
    'Apple ID notarytool profile report command is documented for local profile mode',
  );

  const operatorSequence = Array.isArray(handoff.operatorSequence) ? handoff.operatorSequence : [];
  const operatorText = asCommandText(operatorSequence);
  add('release credential operator sequence', operatorSequence.length >= requiredOperatorCommands.length, `${operatorSequence.length} step(s)`);
  for (const commandText of requiredOperatorCommands) {
    add(`release credential operator command ${commandText}`, operatorText.includes(commandText), commandText);
  }

  const safetyRules = Array.isArray(handoff.safetyRules) ? handoff.safetyRules : [];
  const safetyText = safetyRules.join('\n');
  add('release credential safety rules', safetyRules.length >= 4, `${safetyRules.length} rule(s)`);
  add('release credential safety no commit rule', /Never commit/i.test(safetyText) && /\.env\.release\.local/.test(safetyText), '.env.release.local and secrets must not be committed');
  add('release credential safety no secret value rule', /must never contain actual secret values/i.test(safetyText), 'handoff must not contain secret values');
  add('release credential safety production gate rule', /productionReady=true/.test(safetyText), 'productionReady gate documented');
  add('release credential safety asset allowlist rule', /release\/release-asset-manifest\.json/.test(safetyText), 'asset manifest allowlist documented');
  add('release credential safety baseline upload source rule', /approved upload source/i.test(safetyText) && /matching bytes and SHA-256/i.test(safetyText), 'baseline upload source and mirror SHA rule documented');
  add('release credential safety upload permission rule', /canUploadReleaseAssets=true/.test(safetyText), 'GitHub Release upload permission gate documented');

  const serialized = `${JSON.stringify(handoff, null, 2)}\n${fileExists(handoffMarkdownPath) ? fs.readFileSync(path.join(desktopDir, handoffMarkdownPath), 'utf8') : ''}`;
  add('release credential handoff secret material scan', !hasSecretMaterial(serialized), 'no private key, certificate body, GitHub token, or API key literal patterns');

  add('release credential remote remediation source', typeof remote.status === 'string' && remote.status.length > 0, remote.status || 'missing');
  add('release credential remote remediation source report', remote.sourceReport === 'release/github-release-remediation-plan.json', remote.sourceReport || 'missing');
  add(
    'release credential remote remediation verifier reports',
    Array.isArray(remote.verifierReports) &&
      remote.verifierReports.includes('release/github-release-remediation-plan-report.json') &&
      remote.verifierReports.includes('release/github-release-remediation-plan-report.strict.json'),
    (remote.verifierReports || []).join(', ') || 'missing',
  );
  add(
    'release credential remote remediation apply plan report',
    remote.applyPlanReport === 'release/github-release-remediation-apply-plan.json' &&
      remote.applyPlanVerifierReport === 'release/github-release-remediation-apply-plan-report.strict.json' &&
      remote.applyPlanStatus === remediationApplyPlan?.status &&
      Number(remote.applyPlanActions || 0) === Number(remediationApplyPlan?.summary?.actions || 0) &&
      Number(remote.applyPlanVerifierSummary?.blockers || 0) === Number(remediationApplyVerification?.summary?.blockers || 0) &&
      Number(remote.applyPlanVerifierSummary?.warnings || 0) === Number(remediationApplyVerification?.summary?.warnings || 0),
    `report=${remote.applyPlanReport || 'missing'}, verifier=${remote.applyPlanVerifierReport || 'missing'}, status=${remote.applyPlanStatus || 'missing'}, actions=${remote.applyPlanActions ?? 'missing'}`,
  );
  add('release credential remote required commands summary', requiredRemoteCommands.length === Number(remote.requiredActions || 0), `${requiredRemoteCommands.length} expected ${Number(remote.requiredActions || 0)}`);
  add('release credential remote advisory summary', advisoryRemoteReviews.length === Number(remote.advisoryActions || 0), `${advisoryRemoteReviews.length} expected ${Number(remote.advisoryActions || 0)}`);
  const remediationPlanFresh =
    Boolean(remediationPlan) &&
    Boolean(remediationReport) &&
    Boolean(remediationStrictReport) &&
    Number(remote.requiredActions || 0) === Number(remediationPlan.summary?.requiredActions || 0) &&
    Number(remote.advisoryActions || 0) === Number(remediationPlan.summary?.advisoryReviews || 0) &&
    summary(remediationReport).blockers === 0 &&
    summary(remediationStrictReport).blockers === 0 &&
    Boolean(remediationApplyPlan) &&
    !remediationApplyPlan.parseError &&
    remediationApplyPlan.apply === false &&
    summary(remediationApplyPlan).warnings === 0 &&
    Number(remediationApplyPlan.summary?.actions || 0) === Number(remediationPlan.summary?.requiredActions || 0);
  const remediationApplyClean =
    remediationApplyPlan?.status === 'dry-run-ready' &&
    summary(remediationApplyPlan).blockers === 0 &&
    summary(remediationApplyVerification).blockers === 0 &&
    summary(remediationApplyVerification).warnings === 0;
  const remediationApplyExpectedExternalBlock =
    remediationApplyPlan?.status === 'plan-invalid' &&
    remediationApplyPlan?.github?.canUploadReleaseAssets === false &&
    Number(remediationApplyPlan?.summary?.actions || 0) > 0 &&
    summary(remediationApplyPlan).blockers > 0 &&
    summary(remediationApplyVerification).blockers > 0 &&
    summary(remediationApplyVerification).warnings === 0;
  add(
    'release credential remote remediation plan summary freshness',
    remediationPlanFresh && (remediationApplyClean || remediationApplyExpectedExternalBlock),
    `remote=${remote.requiredActions}/${remote.advisoryActions}, plan=${remediationPlan?.summary?.requiredActions ?? 'missing'}/${remediationPlan?.summary?.advisoryReviews ?? 'missing'}, apply=${remediationApplyPlan?.summary?.actions ?? 'missing'}, applyStatus=${remediationApplyPlan?.status || 'missing'}, upload=${remediationApplyPlan?.github?.canUploadReleaseAssets}`,
  );
  for (const item of requiredRemoteCommands.slice(0, 12)) {
    add(`release credential remote command ${item.asset || 'unknown'}`, looksLikeReleaseUploadCommand(item.command), item.command || 'missing command');
  }

  if (fileExists(handoffMarkdownPath)) {
    const markdown = fs.readFileSync(path.join(desktopDir, handoffMarkdownPath), 'utf8');
    add('release credential notes status freshness', markdown.includes(`Status: ${handoff.status}`), `Status: ${handoff.status}`);
    add('release credential notes blocked summary', markdown.includes(`Blocked credential groups: ${handoff.summary?.blockedCredentialGroups}`), `Blocked credential groups: ${handoff.summary?.blockedCredentialGroups}`);
    add('release credential notes local baseline mirror', markdown.includes('Local Baseline Mirror') && markdown.includes(localBaselineMirror.status || 'missing'), 'local baseline mirror section documented');
    add(
      'release credential notes GitHub Release upload permission',
      markdown.includes('GitHub Release Upload Permission Diagnostic') &&
        markdown.includes('canUploadReleaseAssets=false') &&
        markdown.includes(`Pending upload/remediation actions: ${remoteUploadActions}`),
      'GitHub Release upload permission section documented',
    );
    for (const group of groups) {
      add(`release credential notes include ${group.id}`, markdown.includes(group.title), group.title);
    }
  }

  const releaseAssetPaths = new Set((manifest?.githubReleaseAssets || []).map((asset) => asset.path));
  const ciOnlyPaths = new Set((manifest?.ciOnlyArtifacts || []).map((asset) => asset.path));
  add('release asset manifest available to check credential handoff policy', Boolean(manifest && !manifest.parseError), 'release/release-asset-manifest.json');
  if (manifest && !manifest.parseError) {
    for (const relativePath of [handoffPath, handoffMarkdownPath]) {
      add(
        `${relativePath} CI-only diagnostic`,
        !releaseAssetPaths.has(relativePath) && (!fileExists(relativePath) || ciOnlyPaths.has(relativePath)),
        'release credential handoff diagnostics are never GitHub Release assets',
      );
    }
  }

  add(
    'release credential handoff references unblock plan',
    sourcePaths.has('release/release-unblock-plan.json') && Number(handoff.summary?.unblockGroups || 0) > 0,
    `${handoff.summary?.unblockGroups || 0} unblock group(s)`,
  );
  if (requireClean) {
    add('release credential handoff clean', blockedGroups === 0 && Number(remote.requiredActions || 0) === 0, `${blockedGroups} blocked credential group(s), ${Number(remote.requiredActions || 0)} remote required action(s)`);
  }

  printAndExit();
}

main();
