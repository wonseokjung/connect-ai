import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const reportPath = path.join(releaseDir, 'release-env-bootstrap.json');
const markdownPath = path.join(releaseDir, 'RELEASE_ENV_BOOTSTRAP.md');
const templatePath = path.join(releaseDir, 'release-env.local.template');

const localEnvKeys = [
  'CONNECT_AI_BASELINE_URL',
  'CONNECT_AI_BASELINE_SHA256',
  'CONNECT_AI_ZIP_SHA256',
  'CONNECT_AI_BASELINE_TOKEN',
  'CONNECT_AI_RELEASE_AUDIT_TOKEN',
  'BUILD_CERTIFICATE_PATH',
  'BUILD_CERTIFICATE_BASE64',
  'CONNECT_AI_CERTIFICATE_PATH',
  'CONNECT_AI_CERTIFICATE_BASE64',
  'P12_PASSWORD',
  'CONNECT_AI_CERTIFICATE_PASSWORD',
  'KEYCHAIN_PASSWORD',
  'CONNECT_AI_KEYCHAIN_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_BASE64',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_KEYCHAIN_PROFILE',
];

const secretKeys = [
  'CONNECT_AI_BASELINE_TOKEN',
  'CONNECT_AI_RELEASE_AUDIT_TOKEN',
  'BUILD_CERTIFICATE_BASE64',
  'CONNECT_AI_CERTIFICATE_BASE64',
  'P12_PASSWORD',
  'CONNECT_AI_CERTIFICATE_PASSWORD',
  'KEYCHAIN_PASSWORD',
  'CONNECT_AI_KEYCHAIN_PASSWORD',
  'APPLE_API_KEY_BASE64',
  'APPLE_APP_SPECIFIC_PASSWORD',
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

function summaryOf(report) {
  if (!report || report.parseError || !report.summary) return null;
  return {
    blockers: Number(report.summary.blockers || 0),
    warnings: Number(report.summary.warnings || 0),
  };
}

function reportState(label, relativePath) {
  const report = readJson(relativePath);
  return {
    label,
    path: relativePath,
    present: Boolean(report),
    parseError: report?.parseError || null,
    generatedAt: report?.generatedAt || null,
    status: report?.status || null,
    strict: report?.strict ?? null,
    productionReady: report?.productionReady ?? null,
    localCandidateReady: report?.localCandidateReady ?? null,
    publishedReleaseReady: report?.publishedReleaseReady ?? null,
    summary: summaryOf(report),
  };
}

function command(step, commandText, note = '') {
  return { step, command: commandText, note };
}

function guardedBaselineVariableCommand(baselineUrl, baselineSha, { includeSha = true } = {}) {
  const commands = [
    'npm run verify:remote-baseline-approved:refresh',
    `gh variable set CONNECT_AI_BASELINE_URL --body "${baselineUrl}"`,
  ];
  if (includeSha) commands.push(`gh variable set CONNECT_AI_BASELINE_SHA256 --body "${baselineSha}"`);
  return commands.join('\n');
}

function baselineUrlRecommendation({ pkg, credentialHandoff, setupPlan, baselineZip }) {
  const remoteCandidate = credentialHandoff?.remoteBaselineCandidate || setupPlan?.remoteBaselineCandidate || null;
  const publish = Array.isArray(pkg?.build?.publish) ? pkg.build.publish[0] : null;
  const owner = publish?.owner || 'wonseokjung';
  const repo = publish?.repo || 'connect-ai';
  const tag = `desktop-v${pkg.version}`;
  const fallbackAsset = `Connect-AI-${pkg.version}-arm64-mac.zip`;
  const candidateUrl = remoteCandidate?.remoteUrl ||
    `https://github.com/${owner}/${repo}/releases/download/${tag}/${fallbackAsset}`;
  return {
    candidateUrl,
    releaseTag: tag,
    asset: remoteCandidate?.asset || fallbackAsset,
    status: remoteCandidate?.status || 'candidate-unverified',
    approvedUploadSource: credentialHandoff?.localBaselineMirror?.approvedUploadSource || baselineZip,
    expectedBytes: remoteCandidate?.expectedBaselineBytes ?? credentialHandoff?.baselineArtifact?.bytes ?? null,
    expectedSha256: remoteCandidate?.expectedBaselineSha256 || credentialHandoff?.baselineArtifact?.sha256 || null,
    remoteBytes: remoteCandidate?.remoteBytes ?? null,
    safeForDirectUse: false,
    requiredBeforeUse: [
      'Upload or replace the remote same-name baseline ZIP from the approved local baseline export.',
      `Download the remote candidate and verify its SHA-256 matches ${baselineZip} before setting CONNECT_AI_BASELINE_URL.`,
      'Keep CONNECT_AI_BASELINE_URL empty in .env.release.local until the remote baseline guard has been verified.',
    ],
    validationCommands: Array.isArray(remoteCandidate?.validationCommands) ? remoteCandidate.validationCommands : [
      command('Download the remote same-name zip before trusting it as a baseline URL', `gh release download ${tag} --repo ${owner}/${repo} --pattern '${fallbackAsset}' --dir /tmp/connect-ai-baseline-check`),
      command('Compare remote same-name zip SHA-256 with exported baseline SHA-256', `shasum -a 256 /tmp/connect-ai-baseline-check/${fallbackAsset} ${baselineZip}`),
    ],
  };
}

function renderEnvTemplate({ pkg, baselineSha, baselineUrl }) {
  const baselineZip = `release/Connect-AI-${pkg.version}-baseline-arm64-mac.zip`;
  return `# Connect AI release local environment bootstrap.
# Generated by npm run release:env-bootstrap.
# Copy this file to .env.release.local, fill empty values, then run:
#   chmod 600 .env.release.local
#   npm run release:env-check:strict:report
# Do not commit .env.release.local, p12 files, p8 files, passwords, API keys, or tokens.

# Baseline artifact. Upload ${baselineZip} to an HTTPS URL that includes ${pkg.version}.
# Candidate URL after remote baseline guard verification:
# ${baselineUrl || '<https current-version baseline zip url>'}
CONNECT_AI_BASELINE_URL=
CONNECT_AI_BASELINE_SHA256=${baselineSha || ''}
CONNECT_AI_ZIP_SHA256=${baselineSha || ''}
# CONNECT_AI_BASELINE_TOKEN=

# GitHub readiness and Release asset verification token.
CONNECT_AI_RELEASE_AUDIT_TOKEN=

# Developer ID Application certificate. Prefer BUILD_CERTIFICATE_PATH locally;
# use BUILD_CERTIFICATE_BASE64 for CI.
BUILD_CERTIFICATE_PATH=
# BUILD_CERTIFICATE_BASE64=
# CONNECT_AI_CERTIFICATE_PATH=
# CONNECT_AI_CERTIFICATE_BASE64=
P12_PASSWORD=
KEYCHAIN_PASSWORD=
# CONNECT_AI_CERTIFICATE_PASSWORD=
# CONNECT_AI_KEYCHAIN_PASSWORD=

# Preferred notarization: App Store Connect API key file locally,
# APPLE_API_KEY_BASE64 in CI.
APPLE_API_KEY=
# APPLE_API_KEY_BASE64=
APPLE_API_KEY_ID=
APPLE_API_ISSUER=

# Alternative notarization groups.
# APPLE_ID=
# APPLE_APP_SPECIFIC_PASSWORD=
# APPLE_TEAM_ID=
# APPLE_KEYCHAIN_PROFILE=
`;
}

function renderMarkdown(report) {
  const sourceLines = report.sourceReports.map((source) => {
    const state = source.present ? 'present' : 'missing';
    const summary = source.summary ? `${source.summary.blockers} blocker(s), ${source.summary.warnings} warning(s)` : 'no summary';
    const status = source.status ? `, status=${source.status}` : '';
    return `- ${source.path}: ${state}; ${summary}${status}`;
  }).join('\n');
  const inputLines = report.inputGroups.map((group) => {
    const keys = group.keys.map((key) => `\`${key}\``).join(', ');
    return `- ${group.id}: ${group.status}; ${keys}`;
  }).join('\n');
  const commandLines = report.operatorCommands
    .map((item, index) => `${index + 1}. ${item.step}\n\n   \`\`\`sh\n   ${item.command.replace(/\n/g, '\n   ')}\n   \`\`\`${item.note ? `\n   ${item.note}` : ''}`)
    .join('\n\n');

  return `# Connect AI Release Env Bootstrap

Generated: ${report.generatedAt}
Product: ${report.product.name} ${report.product.version}
Status: ${report.status}

## Generated Files

- \`${report.files.template}\`: copyable local env skeleton with no secret values
- \`${report.files.report}\`: machine-readable bootstrap report
- \`${report.files.markdown}\`: this operator handoff

## Suggested Non-Secret Values

- \`CONNECT_AI_BASELINE_SHA256\`: \`${report.suggestedValues.CONNECT_AI_BASELINE_SHA256 || 'missing'}\`
- \`CONNECT_AI_ZIP_SHA256\`: \`${report.suggestedValues.CONNECT_AI_ZIP_SHA256 || 'missing'}\`
- Candidate \`CONNECT_AI_BASELINE_URL\`: \`${report.suggestedValues.CONNECT_AI_BASELINE_URL || 'missing'}\`
- Candidate URL status: ${report.baselineUrlRecommendation.status}; direct use allowed: ${report.baselineUrlRecommendation.safeForDirectUse}
- Baseline ZIP: \`${report.suggestedValues.BASELINE_ZIP || 'missing'}\`

## Baseline URL Guard

${report.baselineUrlRecommendation.requiredBeforeUse.map((rule) => `- ${rule}`).join('\n')}

## Required Input Groups

${inputLines}

## Operator Commands

${commandLines}

## Source Reports

${sourceLines}

## Safety Rules

${report.safetyRules.map((rule) => `- ${rule}`).join('\n')}
`;
}

function main() {
  const pkg = readJson('package.json');
  const baselineExport = readJson('release/baseline-export-report.json');
  const readiness = readJson('release/production-readiness-summary.json');
  const credentialHandoff = readJson('release/release-credential-handoff.json');
  const setupPlan = readJson('release/release-setup-plan.json');
  const baselineSha = baselineExport?.export?.sha256 || credentialHandoff?.baselineArtifact?.sha256 || null;
  const baselineZip = baselineExport?.export?.path || `release/Connect-AI-${pkg.version}-baseline-arm64-mac.zip`;
  const baselineUrl = baselineUrlRecommendation({ pkg, credentialHandoff, setupPlan, baselineZip });
  const blockedCredentialGroups = Number(credentialHandoff?.summary?.blockedCredentialGroups || 0);
  const inputGroups = [
    {
      id: 'baseline-artifact',
      status: baselineSha ? 'sha-ready-url-required' : 'missing-baseline-export',
      keys: ['CONNECT_AI_BASELINE_URL', 'CONNECT_AI_BASELINE_SHA256', 'CONNECT_AI_ZIP_SHA256'],
    },
    {
      id: 'github-readiness-audit-token',
      status: 'external-secret-required',
      keys: ['CONNECT_AI_RELEASE_AUDIT_TOKEN'],
    },
    {
      id: 'developer-id-certificate',
      status: 'external-secret-required',
      keys: ['BUILD_CERTIFICATE_PATH', 'BUILD_CERTIFICATE_BASE64', 'P12_PASSWORD', 'KEYCHAIN_PASSWORD'],
    },
    {
      id: 'apple-notarization',
      status: 'external-secret-required',
      keys: ['APPLE_API_KEY', 'APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_KEYCHAIN_PROFILE'],
    },
  ];
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: readiness?.productionReady === true ? 'production-ready' : 'bootstrap-ready-awaiting-secret-values',
    product: {
      name: pkg?.build?.productName || pkg?.name || 'Connect AI',
      version: pkg?.version || null,
      appId: pkg?.build?.appId || null,
      electronVersion: pkg?.build?.electronVersion || null,
    },
    files: {
      report: 'release/release-env-bootstrap.json',
      markdown: 'release/RELEASE_ENV_BOOTSTRAP.md',
      template: 'release/release-env.local.template',
      targetLocalEnv: '.env.release.local',
    },
    summary: {
      blockers: 0,
      warnings: 0,
      inputGroups: inputGroups.length,
      blockedCredentialGroups,
      baselineShaReady: Boolean(baselineSha),
      secretKeys: secretKeys.length,
    },
	    suggestedValues: {
	      BASELINE_ZIP: baselineZip,
	      CONNECT_AI_BASELINE_URL: baselineUrl.candidateUrl,
	      CONNECT_AI_BASELINE_SHA256: baselineSha,
	      CONNECT_AI_ZIP_SHA256: baselineSha,
	    },
	    baselineUrlRecommendation: baselineUrl,
	    localEnvKeys,
    secretKeys,
    inputGroups,
    operatorCommands: [
      command('Regenerate baseline export evidence', 'npm run release:baseline-export'),
      command('Generate this bootstrap pack', 'npm run release:env-bootstrap'),
      command('Copy the generated skeleton to the ignored local env file', 'cp release/release-env.local.template .env.release.local && chmod 600 .env.release.local'),
      command('Fill the empty values in .env.release.local', '$EDITOR .env.release.local', 'Do not paste values into terminal history or issue comments.'),
      command('Validate the filled local env without printing values', 'npm run release:env-check:strict:report'),
      command('Validate signing and notarization inputs from the local env', 'npm run signing:check:report:env'),
      command('Dry-run GitHub repository variable and secret setup', 'npm run release:github-setup'),
      command('Apply GitHub repository setup after reviewing the dry-run report', 'npm run release:github-setup:apply'),
      command('Refresh the commercial readiness graph', 'npm run release:status-refresh'),
      command('Run the guarded production release sequence after productionReady is true', 'npm run release:operator-runbook:process:apply'),
    ],
	    githubCommands: {
	      variables: [
	        guardedBaselineVariableCommand(
	          baselineUrl.candidateUrl || '<https current-version baseline zip url>',
	          baselineSha || '<64 hex baseline zip sha256>',
	        ),
	      ],
      secrets: [
        'gh secret set CONNECT_AI_RELEASE_AUDIT_TOKEN',
        "base64 -i /absolute/path/DeveloperIDApplication.p12 | tr -d '\\n' | gh secret set BUILD_CERTIFICATE_BASE64",
        'gh secret set P12_PASSWORD',
        'gh secret set KEYCHAIN_PASSWORD',
        "base64 -i /absolute/path/AuthKey_KEYID.p8 | tr -d '\\n' | gh secret set APPLE_API_KEY_BASE64",
        'gh secret set APPLE_API_KEY_ID',
        'gh secret set APPLE_API_ISSUER',
      ],
    },
    safetyRules: [
      'This bootstrap pack must never contain real secret values.',
      'Copy release/release-env.local.template to .env.release.local only on the operator machine.',
	      'Never commit .env.release.local, p12 files, p8 files, passwords, API keys, or GitHub tokens.',
	      'Do not set CONNECT_AI_BASELINE_URL to the candidate URL until the remote baseline ZIP has been replaced or verified to match the exported baseline SHA-256.',
	      'Do not publish until strict decision, promotion plan, production readiness summary, and publication seal all have productionReady=true.',
      'Use release/release-asset-manifest.json as the only allowlist for GitHub Release uploads.',
    ],
    sourceReports: [
      reportState('release env contract', 'release/release-env-contract-report.json'),
      reportState('baseline export', 'release/baseline-export-report.json'),
      reportState('release env process', 'release/release-env-report.process.json'),
      reportState('signing readiness', 'release/signing-readiness.json'),
      reportState('GitHub setup', 'release/github-release-setup-report.json'),
      reportState('GitHub operator readiness', 'release/operator-readiness.github.json'),
      reportState('release credential handoff', 'release/release-credential-handoff.json'),
      reportState('release setup plan', 'release/release-setup-plan.json'),
      reportState('production readiness summary', 'release/production-readiness-summary.json'),
    ],
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(templatePath, renderEnvTemplate({ pkg, baselineSha, baselineUrl: baselineUrl.candidateUrl }));
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  console.log(`Connect AI release env bootstrap: ${report.status}`);
  console.log(`Summary: ${inputGroups.length} input group(s), baselineShaReady=${Boolean(baselineSha)}`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, templatePath)}`);
}

main();
