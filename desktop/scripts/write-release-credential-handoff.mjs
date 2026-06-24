import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const jsonPath = path.join(releaseDir, 'release-credential-handoff.json');
const markdownPath = path.join(releaseDir, 'RELEASE_CREDENTIAL_HANDOFF.md');

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

function generatedAtMs(report) {
  const value = Date.parse(report?.generatedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function reportTimestamp(relativePath, report) {
  const generated = generatedAtMs(report);
  if (generated) return generated;
  const file = path.join(desktopDir, relativePath);
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
}

function remoteAssetReportInventory() {
  const definitions = [
    { kind: 'strict', path: 'release/github-release-assets-report.strict.json' },
    { kind: 'local', path: 'release/github-release-assets-report.json' },
  ];
  const items = definitions
    .map((definition) => {
      const report = readJson(definition.path);
      return {
        ...definition,
        report,
        timestamp: report && !report.parseError ? reportTimestamp(definition.path, report) : 0,
      };
    })
    .filter((item) => item.report && !item.report.parseError);
  const sorted = [...items].sort((left, right) => {
    if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
    return Number(right.report.strict === true) - Number(left.report.strict === true);
  });
  return {
    selected: sorted[0] || null,
    items,
    byPath: new Map(items.map((item) => [item.path, item])),
  };
}

function failedChecks(report) {
  return (report?.checks || []).filter((check) => check.ok !== true);
}

function matchingFailures(report, patterns) {
  const regexes = patterns.map((pattern) => pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i'));
  return failedChecks(report).filter((check) => {
    const text = `${check.name}: ${check.detail}`;
    return regexes.some((regex) => regex.test(text));
  });
}

function namedCheck(report, name) {
  return (report?.checks || []).find((check) => check.name === name) || null;
}

function detailsFrom(failures) {
  return failures.map((check) => `${check.name}: ${check.detail}`);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function command(step, commandText, note = '') {
  return { step, command: commandText, note };
}

function guardedBaselineVariableCommand(baselineUrl, baselineSha) {
  return [
    'npm run verify:remote-baseline-approved:refresh',
    `gh variable set CONNECT_AI_BASELINE_URL --body "${baselineUrl}"`,
    `gh variable set CONNECT_AI_BASELINE_SHA256 --body "${baselineSha}"`,
  ].join('\n');
}

function reportState(label, relativePath, options = {}) {
  const report = readJson(relativePath);
  const state = {
    label,
    path: relativePath,
    present: Boolean(report),
    generatedAt: report?.generatedAt || null,
    strict: report?.strict ?? null,
    status: report?.status || null,
    productionReady: report?.productionReady ?? null,
    localCandidateReady: report?.localCandidateReady ?? null,
    summary: report && !report.parseError ? summary(report) : null,
    parseError: report?.parseError || null,
  };
  return {
    ...state,
    ...options,
  };
}

function remoteAssetReportState(label, relativePath, inventory) {
  const item = inventory.byPath.get(relativePath);
  if (!item) return reportState(label, relativePath, { selected: false, freshness: 'missing' });
  const newer = inventory.items
    .filter((candidate) => candidate.path !== item.path && candidate.timestamp > item.timestamp)
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  const selected = inventory.selected?.path === item.path;
  return reportState(label, relativePath, {
    selected,
    freshness: selected ? 'selected-current' : newer ? `stale-superseded-by-${newer.kind}` : 'available-not-selected',
    supersededBy: newer?.path || null,
  });
}

function hasCleanSummary(report) {
  return report && !report.parseError && summary(report).blockers === 0 && summary(report).warnings === 0;
}

function baselineArtifactSnapshot(report, verificationReport) {
  const exportInfo = report?.export || {};
  const sha256 = exportInfo.sha256 || null;
  const verificationSummary = verificationReport && !verificationReport.parseError ? summary(verificationReport) : null;
  const verified = verificationReport?.strict === true && hasCleanSummary(verificationReport);
  return {
    sourceReport: 'release/baseline-export-report.json',
    verificationReport: 'release/baseline-export-report-verification.strict.json',
    generatedAt: report?.generatedAt || null,
    verificationGeneratedAt: verificationReport?.generatedAt || null,
    ok: report?.ok === true && summary(report).blockers === 0,
    verified,
    verificationSummary,
    path: exportInfo.path || null,
    bytes: Number.isFinite(exportInfo.bytes) ? exportInfo.bytes : null,
    sha256,
    suggestedVariables: {
      CONNECT_AI_BASELINE_URL: '<upload this zip to an HTTPS URL and set that URL>',
      CONNECT_AI_BASELINE_SHA256: sha256 || '<64 hex baseline zip sha256>',
      CONNECT_AI_ZIP_SHA256: sha256 || '<64 hex baseline zip sha256>',
    },
    sourceAppAsarSha256: report?.source?.appAsarSha256 || null,
  };
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function localBaselineMirrorSnapshot(pkg, baselineArtifact) {
  const version = pkg?.version || '0.4.8';
  const expectedName = `Connect-AI-${version}-arm64-mac.zip`;
  const home = process.env.HOME || '';
  const downloadsPath = home ? path.join(home, 'Downloads', expectedName) : null;
  const present = Boolean(downloadsPath && fs.existsSync(downloadsPath));
  const stat = present ? fs.statSync(downloadsPath) : null;
  const sha256 = present ? sha256File(downloadsPath) : null;
  const expectedBytes = baselineArtifact?.bytes ?? null;
  const expectedSha256 = baselineArtifact?.sha256 || null;
  const matchesExport = Boolean(
    present &&
      expectedBytes != null &&
      stat?.size === expectedBytes &&
      expectedSha256 &&
      sha256 === expectedSha256
  );
  const status = !present ? 'missing' : matchesExport ? 'verified-match' : 'mismatch';
  return {
    source: 'local-downloads',
    asset: expectedName,
    status,
    path: downloadsPath ? `~/Downloads/${expectedName}` : null,
    resolvedPath: downloadsPath,
    bytes: stat?.size ?? null,
    sha256,
    expectedBaselinePath: baselineArtifact?.path || `release/Connect-AI-${version}-baseline-arm64-mac.zip`,
    expectedBaselineBytes: expectedBytes,
    expectedBaselineSha256: expectedSha256,
    approvedUploadSource: baselineArtifact?.path || null,
    matchesExport,
    currentEvidence: !present
      ? [`No local Downloads mirror was found at ~/Downloads/${expectedName}; use ${baselineArtifact?.path || 'the exported baseline zip'} as the approved upload source.`]
      : matchesExport
        ? [`~/Downloads/${expectedName} matches the exported baseline ZIP bytes and SHA-256.`]
        : [`~/Downloads/${expectedName} does not match the exported baseline ZIP; do not upload or use it as CONNECT_AI_BASELINE_URL.`],
    validationCommands: [
      command('Compare the local Downloads mirror with the exported baseline ZIP', `shasum -a 256 "${baselineArtifact?.path || `release/Connect-AI-${version}-baseline-arm64-mac.zip`}" "$HOME/Downloads/${expectedName}"`),
      command('Upload only the exported baseline ZIP or a verified byte-identical mirror', `test "${expectedSha256 || '<baseline sha256>'}" = "$(shasum -a 256 "${baselineArtifact?.path || `release/Connect-AI-${version}-baseline-arm64-mac.zip`}" | awk '{print $1}')"`)
    ],
  };
}

function remoteBaselineCandidateSnapshot(remoteReport, baselineArtifact) {
  const version = readJson('package.json')?.version || '0.4.8';
  const baselineZip = `release/Connect-AI-${version}-baseline-arm64-mac.zip`;
  const expectedName = `Connect-AI-${version}-arm64-mac.zip`;
  const candidate = (remoteReport?.remoteAssets || []).find((asset) => asset.name === expectedName) || null;
  const expectedBytes = baselineArtifact?.bytes ?? null;
  const sameByteSize = Boolean(candidate && expectedBytes != null && candidate.size === expectedBytes);
  return {
    sourceReport: remoteReport ? 'release/github-release-assets-report.strict.json' : null,
    asset: expectedName,
    status: !candidate ? 'missing' : sameByteSize ? 'size-match-sha-unverified' : 'not-approved-baseline-url',
    remoteUrl: candidate?.url || null,
    remoteBytes: candidate?.size ?? null,
    expectedBaselineBytes: expectedBytes,
    expectedBaselineSha256: baselineArtifact?.sha256 || null,
    currentEvidence: !candidate
      ? ['No same-name remote baseline zip is present on the GitHub Release.']
      : sameByteSize
        ? ['Remote same-name zip has the same byte size as the exported baseline; download and compare SHA-256 before using it as CONNECT_AI_BASELINE_URL.']
        : [`Remote same-name zip byte size ${candidate.size} differs from exported baseline ${expectedBytes}; do not use this URL as CONNECT_AI_BASELINE_URL.`],
	    validationCommands: [
	      command('Download the remote same-name zip before trusting it as a baseline URL', `gh release download desktop-v${version} --repo wonseokjung/connect-ai --pattern '${expectedName}' --dir /tmp/connect-ai-baseline-check`),
	      command('Compare remote same-name zip SHA-256 with exported baseline SHA-256', `shasum -a 256 /tmp/connect-ai-baseline-check/${expectedName} ${baselineZip}`),
	    ],
	  };
	}

function githubApiPermissionSnapshot(githubOperator) {
  const variableList = namedCheck(githubOperator, 'GitHub variable list access');
  const secretList = namedCheck(githubOperator, 'GitHub secret list access');
  const failures = [variableList, secretList].filter((check) => check && check.ok !== true);
  const ready = Boolean(variableList?.ok === true && secretList?.ok === true);
  return {
    sourceReport: 'release/operator-readiness.github.json',
    generatedAt: githubOperator?.generatedAt || null,
    status: ready ? 'ready' : 'missing-or-unverified',
    requiredPermissions: [
      'Repository metadata: read',
      'Repository contents: read',
      'Actions variables: read',
      'Actions secrets: read',
    ],
    currentEvidence: failures.length ? detailsFrom(failures) : ['GitHub variables and secrets API list checks passed.'],
    validationCommands: [
      command('Verify repository variable list API permission', "gh api 'repos/wonseokjung/connect-ai/actions/variables?per_page=1' --jq '.total_count'"),
      command('Verify repository secret list API permission', "gh api 'repos/wonseokjung/connect-ai/actions/secrets?per_page=1' --jq '.total_count'"),
      command('Run full GitHub readiness check through release env', 'npm run release:operator-checklist:github:strict:report:env'),
    ],
    remediationCommands: [
      command('Store a token with variables/secrets read permission', 'gh secret set CONNECT_AI_RELEASE_AUDIT_TOKEN'),
    ],
  };
}

function githubReleaseUploadPermissionSnapshot(remoteRemediationApplyPlan, remoteRemediationApplyVerification) {
  const github = remoteRemediationApplyPlan?.github || {};
  const actions = Number(remoteRemediationApplyPlan?.summary?.actions || 0);
  const canUpload = github.canUploadReleaseAssets === true;
  const ready = actions === 0 || canUpload;
  const errors = Array.isArray(github.errors) ? github.errors : [];
  return {
    sourceReport: 'release/github-release-remediation-apply-plan.json',
    verifierReport: 'release/github-release-remediation-apply-plan-report.strict.json',
    generatedAt: remoteRemediationApplyPlan?.generatedAt || null,
    verifierGeneratedAt: remoteRemediationApplyVerification?.generatedAt || null,
    status: ready ? 'ready' : 'missing-or-unverified',
    repo: github.repo || 'missing',
    viewerPermission: github.viewerPermission || 'missing',
    canReadRelease: github.canReadRelease ?? null,
    canUploadReleaseAssets: github.canUploadReleaseAssets ?? null,
    releaseTag: github.releaseTag || 'missing',
    releaseExists: github.releaseExists ?? null,
    ghAvailable: github.ghAvailable ?? null,
    actions,
    requiredPermissions: [
      'Repository collaborator permission: write, maintain, or admin',
      'GitHub token scope/permission: read the release and upload/delete GitHub Release assets',
      'release/github-release-remediation-apply-plan.json github.canUploadReleaseAssets true when actions > 0',
    ],
    currentEvidence: [
      `repo=${github.repo || 'missing'}`,
      `viewerPermission=${github.viewerPermission || 'missing'}`,
      `canReadRelease=${github.canReadRelease ?? 'missing'}`,
      `canUploadReleaseAssets=${github.canUploadReleaseAssets ?? 'missing'}`,
      `releaseTag=${github.releaseTag || 'missing'}`,
      `releaseExists=${github.releaseExists ?? 'missing'}`,
      `ghAvailable=${github.ghAvailable ?? 'missing'}`,
      `actions=${actions}`,
      ...errors.map((error) => `github error: ${error}`),
    ],
    validationCommands: [
      command('Confirm current GitHub CLI account and repository permission', 'gh auth status\ngh repo view wonseokjung/connect-ai --json viewerPermission,url'),
      command('Refresh remote remediation upload permission diagnostics', 'npm run release:github-release-remediation-apply:plan'),
      command('Verify upload permission diagnostics before publication', 'npm run verify:github-release-remediation-apply-plan:strict:report'),
    ],
    remediationCommands: [
      command('Authenticate with a release-capable token if permission is read-only', 'gh auth login --hostname github.com --scopes repo,workflow'),
    ],
  };
}

function credentialGroup({ id, title, owner = 'operator', localInputs, githubVariables = [], githubSecrets = [], alternatives = [], failures, commands, validation }) {
  const detail = unique(detailsFrom(failures));
  return {
    id,
    title,
    owner,
    status: detail.length ? 'missing-or-unverified' : 'ready',
    localInputs,
    githubVariables,
    githubSecrets,
    alternatives,
    currentEvidence: detail.length ? detail : ['No blocker evidence in current source reports.'],
    commands,
    validation,
  };
}

function renderList(values) {
  return values.length ? values.map((value) => `- \`${value}\``).join('\n') : '- none';
}

function renderCommands(commands) {
  if (!commands.length) return '- none';
  return commands.map((item) => `- ${item.step}\n\n  \`\`\`bash\n  ${item.command.replace(/\n/g, '\n  ')}\n  \`\`\`${item.note ? `\n  ${item.note}` : ''}`).join('\n');
}

function renderMarkdown(report) {
  const sourceLines = report.sourceReports.map((source) => {
    const state = source.present ? 'present' : 'missing';
    const summaryText = source.summary ? `${source.summary.blockers} blocker(s), ${source.summary.warnings} warning(s)` : 'no summary';
    const status = source.status ? `, status=${source.status}` : '';
    const strict = source.strict == null ? '' : `, strict=${source.strict}`;
    const selected = source.selected == null ? '' : `, selected=${source.selected}`;
    const freshness = source.freshness ? `, freshness=${source.freshness}` : '';
    const supersededBy = source.supersededBy ? `, supersededBy=${source.supersededBy}` : '';
    return `- ${source.path}: ${state}; ${summaryText}${status}${strict}${selected}${freshness}${supersededBy}`;
  }).join('\n');

  const groupSections = report.credentialGroups.map((group) => {
    const evidence = group.currentEvidence.slice(0, 8).map((item) => `- ${item}`).join('\n');
    return `## ${group.title}

Status: ${group.status}
Owner: ${group.owner}

### Local Inputs

${renderList(group.localInputs)}

### GitHub Variables

${renderList(group.githubVariables)}

### GitHub Secrets

${renderList(group.githubSecrets)}

### Alternatives

${group.alternatives.length ? group.alternatives.map((item) => `- ${item}`).join('\n') : '- none'}

### Current Evidence

${evidence}

### Commands

${renderCommands(group.commands)}

### Validation

${renderCommands(group.validation)}
`;
  }).join('\n');

  const remote = report.remoteAssetRemediation;
  const remoteCommands = remote.requiredCommands.slice(0, 12).map((item) => `- ${item.asset}\n\n  \`\`\`bash\n  ${item.command}\n  \`\`\``).join('\n') || '- none';
  const baseline = report.baselineArtifact;
  const baselineSha = baseline?.suggestedVariables?.CONNECT_AI_BASELINE_SHA256 || 'missing';
  const zipSha = baseline?.suggestedVariables?.CONNECT_AI_ZIP_SHA256 || 'missing';
  const localMirror = report.localBaselineMirror;
  const remoteBaseline = report.remoteBaselineCandidate;
  const githubApi = report.githubApiPermissions;
  const githubUpload = report.githubReleaseUploadPermission;
  const githubApiSnapshot = githubApi ? `## GitHub API Permission Diagnostic

- Source report: \`${githubApi.sourceReport || 'missing'}\`
- Generated: ${githubApi.generatedAt || 'missing'}
- Status: ${githubApi.status || 'missing'}

### Required Permissions

${renderList(githubApi.requiredPermissions || [])}

### Current Evidence

${(githubApi.currentEvidence || []).map((item) => `- ${item}`).join('\n') || '- none'}

### Validation Commands

${renderCommands(githubApi.validationCommands || [])}

### Remediation Commands

${renderCommands(githubApi.remediationCommands || [])}
` : '';
  const githubUploadSnapshot = githubUpload ? `## GitHub Release Upload Permission Diagnostic

- Source report: \`${githubUpload.sourceReport || 'missing'}\`
- Verification report: \`${githubUpload.verifierReport || 'missing'}\`
- Generated: ${githubUpload.generatedAt || 'missing'}
- Status: ${githubUpload.status || 'missing'}
- Repository: \`${githubUpload.repo || 'missing'}\`
- Viewer permission: ${githubUpload.viewerPermission || 'missing'}
- Can read release: ${githubUpload.canReadRelease ?? 'missing'}
- Can upload release assets: ${githubUpload.canUploadReleaseAssets ?? 'missing'}
- Release tag: \`${githubUpload.releaseTag || 'missing'}\`
- Release exists: ${githubUpload.releaseExists ?? 'missing'}
- Pending upload/remediation actions: ${githubUpload.actions ?? 'missing'}

### Required Permissions

${renderList(githubUpload.requiredPermissions || [])}

### Current Evidence

${(githubUpload.currentEvidence || []).map((item) => `- ${item}`).join('\n') || '- none'}

### Validation Commands

${renderCommands(githubUpload.validationCommands || [])}

### Remediation Commands

${renderCommands(githubUpload.remediationCommands || [])}
` : '';
  const baselineSnapshot = baseline ? `## Baseline Export Snapshot

- Source report: \`${baseline.sourceReport}\`
- Verification report: \`${baseline.verificationReport || 'missing'}\`
- Status: ${baseline.ok ? 'ready' : 'not-ready'}
- Verified: ${baseline.verified ? 'true' : 'false'}
- ZIP: \`${baseline.path || 'missing'}\`
- Bytes: ${baseline.bytes ?? 'missing'}
- SHA-256: \`${baseline.sha256 || 'missing'}\`
- \`CONNECT_AI_BASELINE_SHA256\`: \`${baselineSha}\`
- \`CONNECT_AI_ZIP_SHA256\`: \`${zipSha}\`
` : '';
  const localMirrorSnapshot = localMirror ? `## Local Baseline Mirror

- Source: ${localMirror.source || 'missing'}
- Asset: \`${localMirror.asset || 'missing'}\`
- Status: ${localMirror.status || 'missing'}
- Approved upload source: \`${localMirror.approvedUploadSource || 'missing'}\`
- Download mirror: \`${localMirror.path || 'missing'}\`
- Mirror bytes: ${localMirror.bytes ?? 'missing'}
- Mirror SHA-256: \`${localMirror.sha256 || 'missing'}\`
- Matches exported baseline: ${localMirror.matchesExport ? 'true' : 'false'}

### Current Evidence

${(localMirror.currentEvidence || []).map((item) => `- ${item}`).join('\n') || '- none'}

### Validation Commands

${renderCommands(localMirror.validationCommands || [])}
` : '';
  const remoteBaselineSnapshot = remoteBaseline ? `## Remote Baseline Candidate Check

- Source report: \`${remoteBaseline.sourceReport || 'missing'}\`
- Asset: \`${remoteBaseline.asset || 'missing'}\`
- Status: ${remoteBaseline.status || 'missing'}
- Remote URL: ${remoteBaseline.remoteUrl ? `\`${remoteBaseline.remoteUrl}\`` : 'missing'}
- Remote bytes: ${remoteBaseline.remoteBytes ?? 'missing'}
- Expected baseline bytes: ${remoteBaseline.expectedBaselineBytes ?? 'missing'}
- Expected baseline SHA-256: \`${remoteBaseline.expectedBaselineSha256 || 'missing'}\`

### Current Evidence

${(remoteBaseline.currentEvidence || []).map((item) => `- ${item}`).join('\n') || '- none'}

### Validation Commands

${renderCommands(remoteBaseline.validationCommands || [])}
` : '';

  return `# Connect AI Release Credential Handoff

Generated: ${report.generatedAt}
Product: ${report.product.name} ${report.product.version}
Status: ${report.status}

## Summary

- Blocked credential groups: ${report.summary.blockedCredentialGroups}
- Missing source reports: ${report.summary.missingSourceReports}
- Remote required asset actions: ${report.summary.remoteRequiredActions}
- Remote advisory asset reviews: ${report.summary.remoteAdvisoryActions}

## Safety Rules

${report.safetyRules.map((rule) => `- ${rule}`).join('\n')}

## Operator Sequence

${renderCommands(report.operatorSequence)}

${githubApiSnapshot}

${githubUploadSnapshot}

${baselineSnapshot}

${localMirrorSnapshot}

${remoteBaselineSnapshot}

${groupSections}

## Remote Asset Remediation

- Status: ${remote.status}
- Required actions: ${remote.requiredActions}
- Advisory reviews: ${remote.advisoryActions}
- Source report: ${remote.sourceReport || 'missing'}
- Apply dry-run report: ${remote.applyPlanReport || 'missing'}
- Apply dry-run status: ${remote.applyPlanStatus || 'missing'}
- Apply dry-run actions: ${remote.applyPlanActions ?? 'missing'}

${remoteCommands}

## Source Reports

${sourceLines}
`;
}

function main() {
  const pkg = readJson('package.json');
  const envProcess = readJson('release/release-env-report.process.json');
  const envLocal = readJson('release/release-env-report.json');
  const signing = readJson('release/signing-readiness.json');
  const githubSetup = readJson('release/github-release-setup-report.json');
  const githubOperator = readJson('release/operator-readiness.github.json');
  const readiness = readJson('release/production-readiness-summary.json');
  const unblockPlan = readJson('release/release-unblock-plan.json');
  const baselineExport = readJson('release/baseline-export-report.json');
  const baselineExportVerification = readJson('release/baseline-export-report-verification.strict.json');
  const remoteRemediationPlan = readJson('release/github-release-remediation-plan.json');
  const remoteRemediationReport = readJson('release/github-release-remediation-plan-report.json');
  const remoteRemediationStrictReport = readJson('release/github-release-remediation-plan-report.strict.json');
  const remoteRemediationApplyPlan = readJson('release/github-release-remediation-apply-plan.json');
  const remoteRemediationApplyVerification = readJson('release/github-release-remediation-apply-plan-report.strict.json');
  const remoteInventory = remoteAssetReportInventory();
  const remoteReport = remoteInventory.selected?.report || null;
  const remoteReportPath = remoteInventory.selected?.path || null;

  const baselineFailures = [
    ...matchingFailures(envProcess, [/baseline/i]),
    ...matchingFailures(githubSetup, [/CONNECT_AI_BASELINE/i, /CONNECT_AI_ZIP_SHA256/i]),
    ...matchingFailures(githubOperator, [/baseline/i]),
  ];
  const auditTokenFailures = [
    ...matchingFailures(envProcess, [/audit token/i, /GH_TOKEN/i]),
    ...matchingFailures(githubSetup, [/CONNECT_AI_RELEASE_AUDIT_TOKEN/i]),
    ...matchingFailures(githubOperator, [/variable list access/i, /secret list access/i]),
  ];
  const certificateFailures = [
    ...matchingFailures(signing, [/Developer ID/i, /certificate/i, /keychain password/i]),
    ...matchingFailures(githubSetup, [/BUILD_CERTIFICATE/i, /P12_PASSWORD/i, /KEYCHAIN_PASSWORD/i]),
    ...matchingFailures(githubOperator, [/Developer ID/i, /certificate import/i]),
  ];
  const notarizationFailures = [
    ...matchingFailures(signing, [/notarization/i, /APPLE_/i]),
    ...matchingFailures(githubSetup, [/notarization/i, /APPLE_/i]),
    ...matchingFailures(githubOperator, [/notarization/i, /APPLE_/i]),
  ];
	  const baselineArtifact = baselineArtifactSnapshot(baselineExport, baselineExportVerification);
	  const localBaselineMirror = localBaselineMirrorSnapshot(pkg, baselineArtifact);
	  const remoteBaselineCandidate = remoteBaselineCandidateSnapshot(remoteReport, baselineArtifact);
	  const baselineUrlCandidate = remoteBaselineCandidate.remoteUrl || '<https current-version baseline zip url>';
	  const baselineSha = baselineArtifact.sha256 || '<64 hex baseline zip sha256>';
	  baselineArtifact.suggestedVariables.CONNECT_AI_BASELINE_URL = baselineUrlCandidate;

	  const credentialGroups = [
    credentialGroup({
      id: 'baseline-artifact',
      title: 'Baseline Artifact',
      localInputs: ['CONNECT_AI_BASELINE_URL (https .zip URL containing current package version)', 'CONNECT_AI_BASELINE_SHA256 (64 hex SHA-256)', 'CONNECT_AI_BASELINE_TOKEN (optional private URL token)'],
      githubVariables: ['CONNECT_AI_BASELINE_URL', 'CONNECT_AI_BASELINE_SHA256'],
      githubSecrets: ['CONNECT_AI_BASELINE_TOKEN (only for private baseline URL)'],
      failures: baselineFailures,
      commands: [
        command('Export the current baseline app as an uploadable ZIP', 'npm run release:baseline-export'),
        command('Calculate the baseline ZIP SHA-256', 'shasum -a 256 release/Connect-AI-0.4.8-baseline-arm64-mac.zip'),
        command('Compare Downloads mirror before using it as an upload source', `shasum -a 256 release/Connect-AI-0.4.8-baseline-arm64-mac.zip "$HOME/Downloads/Connect-AI-${pkg?.version || '0.4.8'}-arm64-mac.zip"`),
	        command('Set GitHub baseline variables only after remote baseline guard approval', guardedBaselineVariableCommand(baselineUrlCandidate, baselineSha)),
      ],
      validation: [
        command('Check baseline export report', 'cat release/baseline-export-report.json'),
        command('Verify baseline export bytes, SHA-256, source app.asar, and freshness', 'npm run verify:baseline-export:strict:report'),
        command('Check release env without printing values', 'npm run release:env-check:strict:report'),
        command('Refresh baseline freshness evidence', 'npm run release:baseline-freshness:strict:report'),
      ],
    }),
    credentialGroup({
      id: 'github-readiness-audit-token',
      title: 'GitHub Readiness Audit Token',
      localInputs: ['CONNECT_AI_RELEASE_AUDIT_TOKEN or GH_TOKEN'],
      githubVariables: [],
      githubSecrets: ['CONNECT_AI_RELEASE_AUDIT_TOKEN'],
      alternatives: ['A token with repository Metadata: read, Contents: read, Actions variables: read, and Actions secrets: read.'],
      failures: auditTokenFailures,
      commands: [
        command('Set the repository readiness audit token', 'gh secret set CONNECT_AI_RELEASE_AUDIT_TOKEN'),
      ],
      validation: [
        command('Verify repository variable list API permission', "gh api 'repos/wonseokjung/connect-ai/actions/variables?per_page=1' --jq '.total_count'"),
        command('Verify repository secret list API permission', "gh api 'repos/wonseokjung/connect-ai/actions/secrets?per_page=1' --jq '.total_count'"),
        command('Verify GitHub variable and secret list permissions', 'npm run release:operator-checklist:github:strict:report:env'),
      ],
    }),
    credentialGroup({
      id: 'developer-id-certificate',
      title: 'Developer ID Application Certificate',
      localInputs: ['BUILD_CERTIFICATE_PATH or BUILD_CERTIFICATE_BASE64 (single-line decodable base64 for CI)', 'P12_PASSWORD', 'KEYCHAIN_PASSWORD'],
      githubVariables: [],
      githubSecrets: ['BUILD_CERTIFICATE_BASE64', 'P12_PASSWORD', 'KEYCHAIN_PASSWORD'],
      alternatives: ['CONNECT_AI_CERTIFICATE_PATH or CONNECT_AI_CERTIFICATE_BASE64 may be used by local scripts.'],
      failures: certificateFailures,
      commands: [
        command('Create CI-safe certificate base64', "base64 -i /absolute/path/DeveloperIDApplication.p12 | tr -d '\\n'"),
        command('Set GitHub signing secrets', "base64 -i /absolute/path/DeveloperIDApplication.p12 | tr -d '\\n' | gh secret set BUILD_CERTIFICATE_BASE64\ngh secret set P12_PASSWORD\ngh secret set KEYCHAIN_PASSWORD"),
        command('Import local signing material from .env.release.local', 'npm run signing:import:env'),
      ],
      validation: [
        command('Check signing readiness report', 'npm run signing:check:report:env'),
        command('Confirm keychain identity', '/usr/bin/security find-identity -v -p codesigning'),
      ],
    }),
    credentialGroup({
      id: 'apple-notarization',
      title: 'Apple Notarization Credentials',
      localInputs: ['APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER', 'or APPLE_API_KEY_BASE64 (single-line decodable base64) + APPLE_API_KEY_ID + APPLE_API_ISSUER', 'or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID', 'or APPLE_KEYCHAIN_PROFILE for local-only profile'],
      githubVariables: [],
      githubSecrets: ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
      alternatives: ['APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID', 'APPLE_KEYCHAIN_PROFILE only works if the CI runner already has that notarytool profile.'],
      failures: notarizationFailures,
      commands: [
        command('Set preferred App Store Connect API key secrets', "base64 -i /absolute/path/AuthKey_KEYID.p8 | tr -d '\\n' | gh secret set APPLE_API_KEY_BASE64\ngh secret set APPLE_API_KEY_ID\ngh secret set APPLE_API_ISSUER"),
        command('Or set Apple ID notarization secrets', 'gh secret set APPLE_ID\ngh secret set APPLE_APP_SPECIFIC_PASSWORD\ngh secret set APPLE_TEAM_ID'),
        command('Store local notarytool profile from .env.release.local', 'npm run signing:notary-profile:report:env'),
      ],
      validation: [
        command('Check notarization inputs through signing readiness', 'npm run signing:check:report:env'),
        command('Check release env groups', 'npm run release:env-check:strict:report'),
      ],
    }),
  ];

  const requiredRemoteActions = Array.isArray(remoteRemediationPlan?.requiredActions)
    ? remoteRemediationPlan.requiredActions.map((action) => ({
        asset: action.asset,
        reasons: action.reasons || [],
        command: action.command || '',
      }))
    : (remoteReport?.remediation?.actions || [])
        .filter((action) => action.severity === 'required')
        .map((action) => ({
          asset: action.asset,
          reasons: action.reasons || [],
          command: (action.commands || [])[0] || '',
        }));
  const advisoryRemoteActions = Array.isArray(remoteRemediationPlan?.advisoryReviews)
    ? remoteRemediationPlan.advisoryReviews.map((action) => ({
        asset: action.asset,
        reasons: action.reasons || [],
        command: action.suggestedCommand || '',
      }))
    : (remoteReport?.remediation?.actions || [])
        .filter((action) => action.severity === 'advisory')
        .map((action) => ({
          asset: action.asset,
          reasons: action.reasons || [],
          command: (action.commands || [])[0] || '',
        }));
  const sourceReports = [
    reportState('release env contract', 'release/release-env-contract-report.json'),
    reportState('baseline export', 'release/baseline-export-report.json'),
    reportState('baseline export verification', 'release/baseline-export-report-verification.strict.json'),
    reportState('release env process', 'release/release-env-report.process.json'),
    reportState('release env local', 'release/release-env-report.json'),
    reportState('signing readiness', 'release/signing-readiness.json'),
    reportState('GitHub setup', 'release/github-release-setup-report.json'),
    reportState('GitHub operator readiness', 'release/operator-readiness.github.json'),
    reportState('production readiness summary', 'release/production-readiness-summary.json'),
    reportState('release unblock plan', 'release/release-unblock-plan.json'),
    reportState('commercial release readiness', 'release/commercial-release-readiness-report.strict.json'),
    reportState('commercial finalization', 'release/commercial-finalization-report.json'),
    reportState('commercial finalization verification', 'release/commercial-finalization-report-verification.strict.json'),
    reportState('GitHub Release remediation plan', 'release/github-release-remediation-plan.json'),
    reportState('GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.json'),
    reportState('strict GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.strict.json'),
    reportState('GitHub Release remediation apply dry-run plan', 'release/github-release-remediation-apply-plan.json'),
    reportState('GitHub Release remediation apply dry-run verification', 'release/github-release-remediation-apply-plan-report.strict.json'),
    remoteAssetReportState('strict GitHub Release assets', 'release/github-release-assets-report.strict.json', remoteInventory),
    remoteAssetReportState('local GitHub Release assets', 'release/github-release-assets-report.json', remoteInventory),
  ];
  const missingSourceReports = sourceReports.filter((source) => !source.present).length;
  const blockedCredentialGroups = credentialGroups.filter((group) => group.status !== 'ready').length;
	  const githubApiPermissions = githubApiPermissionSnapshot(githubOperator);
  const githubReleaseUploadPermission = githubReleaseUploadPermissionSnapshot(
    remoteRemediationApplyPlan,
    remoteRemediationApplyVerification,
  );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: readiness?.productionReady === true ? 'production-ready' : 'external-credentials-required',
    product: {
      name: pkg?.build?.productName || pkg?.name || 'Connect AI',
      version: pkg?.version || null,
      appId: pkg?.build?.appId || null,
      electronVersion: pkg?.build?.electronVersion || null,
    },
    summary: {
      blockedCredentialGroups,
      credentialGroups: credentialGroups.length,
      missingSourceReports,
      remoteRequiredActions: requiredRemoteActions.length,
      remoteAdvisoryActions: advisoryRemoteActions.length,
      remoteUploadPermissionReady: githubReleaseUploadPermission.status === 'ready',
      readinessBlockers: summary(readiness).blockers,
      unblockGroups: Array.isArray(unblockPlan?.unblockGroups) ? unblockPlan.unblockGroups.length : 0,
    },
    baselineArtifact,
    localBaselineMirror,
    remoteBaselineCandidate,
    githubApiPermissions,
    githubReleaseUploadPermission,
    credentialGroups,
    remoteAssetRemediation: {
      status: remoteRemediationPlan?.status || remoteReport?.remediation?.status || 'missing-report',
      sourceReport: remoteRemediationPlan ? 'release/github-release-remediation-plan.json' : remoteReportPath,
      verifierReports: [
        remoteRemediationReport ? 'release/github-release-remediation-plan-report.json' : null,
        remoteRemediationStrictReport ? 'release/github-release-remediation-plan-report.strict.json' : null,
      ].filter(Boolean),
      applyPlanReport: remoteRemediationApplyPlan ? 'release/github-release-remediation-apply-plan.json' : null,
      applyPlanVerifierReport: remoteRemediationApplyVerification ? 'release/github-release-remediation-apply-plan-report.strict.json' : null,
      applyPlanVerifierSummary: remoteRemediationApplyVerification?.summary || null,
      applyPlanStatus: remoteRemediationApplyPlan?.status || null,
      applyPlanActions: Number(remoteRemediationApplyPlan?.summary?.actions || 0),
      upstreamAssetReport: remoteRemediationPlan?.sourceReport || remoteReportPath,
      requiredActions: requiredRemoteActions.length,
      advisoryActions: advisoryRemoteActions.length,
      requiredCommands: requiredRemoteActions,
      advisoryReviews: advisoryRemoteActions,
    },
    operatorSequence: [
      command('Export the current baseline ZIP and SHA report', 'npm run release:baseline-export'),
      command('Verify the exported baseline ZIP before using its SHA in CI', 'npm run verify:baseline-export:strict:report'),
      command('Generate secret-free release env bootstrap files', 'npm run release:env-bootstrap\nnpm run verify:env-bootstrap:strict:report'),
      command('Create ignored local release env from the bootstrap template', 'cp release/release-env.local.template .env.release.local && chmod 600 .env.release.local'),
      command('Verify release env contract drift before editing credentials', 'npm run verify:release-env-contract'),
      command('Validate local release env groups', 'npm run release:env-check:strict:report'),
      command('Regression-test release env validation and GitHub setup dry-run', 'npm run verify:release-env-validation'),
      command('Validate signing and notarization inputs', 'npm run signing:check:report:env'),
      command('Dry-run GitHub repository variable/secret setup', 'npm run release:github-setup'),
      command('Apply GitHub repository variable/secret setup after review', 'npm run release:github-setup:apply'),
      command('Verify GitHub operator readiness', 'npm run release:operator-checklist:github:strict:report:env'),
      command('Verify this credential handoff before running the guarded release', 'npm run verify:credential-handoff:strict:report'),
      command('Run guarded production release sequence', 'npm run release:operator-runbook:process:apply'),
      command('Verify GitHub release publish plan', 'npm run verify:github-release-publish-plan:strict:report'),
      command('Verify remote GitHub release assets', 'npm run verify:github-release-assets:strict:env'),
      command('Refresh remote release remediation plan', 'npm run release:github-release-remediation-plan'),
      command('Verify remote release remediation plan', 'npm run verify:github-release-remediation-plan:strict:report'),
      command('Dry-run remote remediation apply against local manifest', 'npm run release:github-release-remediation-apply:plan'),
      command('Verify remote remediation apply dry-run', 'npm run verify:github-release-remediation-apply-plan:strict:report'),
      command('Apply remote remediation after production gates are clean', 'npm run release:github-release-remediation-apply:env'),
      command('Refresh production readiness summary', 'npm run release:readiness-summary:strict:report'),
      command('Refresh publication seal', 'npm run release:publication-seal:strict:report'),
      command('Finalize commercial readiness after current evidence converges', 'npm run release:commercial-finalize'),
      command('Require commercial readiness after publication verification', 'npm run release:commercial-finalize:commercial'),
      command('Verify commercial readiness after finalization', 'npm run verify:commercial-finalization:commercial'),
    ],
    safetyRules: [
      'Never commit .env.release.local, p12 files, p8 files, passwords, API keys, or GitHub tokens.',
      'This handoff lists key names and commands only; it must never contain actual secret values.',
      'Do not publish until strict decision, promotion plan, production readiness, and publication seal all have productionReady=true.',
      'Do not upload remote release assets until release/RELEASE_NOTES.md is signed-and-notarized and release/baseline-freshness-report.json is ok=true.',
      'Do not use a baseline SHA for CI until release/baseline-export-report-verification.strict.json has zero blockers and zero warnings.',
      'Use release/Connect-AI-0.4.8-baseline-arm64-mac.zip as the approved upload source unless a mirror has matching bytes and SHA-256.',
      'Use release/release-asset-manifest.json as the only allowlist for GitHub Release asset upload.',
      'Remote remediation upload requires github.canUploadReleaseAssets=true when release/github-release-remediation-apply-plan.json reports actions > 0.',
      'Prefer release:github-release-remediation-apply:plan before release:github-release-remediation-apply so local bytes and checksums are revalidated immediately before upload.',
    ],
    sourceReports,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  console.log(`Connect AI release credential handoff: ${report.status}`);
  console.log(`Summary: ${blockedCredentialGroups} blocked credential group(s), ${requiredRemoteActions.length} required remote action(s), ${advisoryRemoteActions.length} advisory remote review(s)`);
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
}

main();
