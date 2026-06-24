import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const jsonPath = path.join(releaseDir, 'release-setup-plan.json');
const markdownPath = path.join(releaseDir, 'RELEASE_SETUP_PLAN.md');

const REPORTS = [
  ['release env contract', 'release/release-env-contract-report.json'],
  ['release env', 'release/release-env-report.process.json'],
  ['release env', 'release/release-env-report.json'],
  ['signing readiness', 'release/signing-readiness.json'],
  ['operator readiness', 'release/operator-readiness.json'],
  ['GitHub operator readiness', 'release/operator-readiness.github.json'],
  ['strict release decision', 'release/release-decision.strict.json'],
  ['release promotion', 'release/release-promotion-plan.json'],
  ['release manifest', 'release/release-manifest.json'],
  ['baseline export', 'release/baseline-export-report.json'],
  ['baseline freshness', 'release/baseline-freshness-report.json'],
  ['GitHub Release setup', 'release/github-release-setup-report.json'],
  ['production release runbook', 'release/production-release-runbook-report.json'],
  ['production readiness summary', 'release/production-readiness-summary.json'],
  ['release unblock plan', 'release/release-unblock-plan.json'],
  ['release unblock plan verification', 'release/release-unblock-plan-report.json'],
  ['release credential handoff', 'release/release-credential-handoff.json'],
  ['release credential handoff verification', 'release/release-credential-handoff-report.json'],
  ['strict release credential handoff verification', 'release/release-credential-handoff-report.strict.json'],
  ['release publication seal', 'release/release-publication-seal.json'],
  ['commercial release readiness', 'release/commercial-release-readiness-report.strict.json'],
  ['commercial finalization', 'release/commercial-finalization-report.json'],
  ['commercial finalization verification', 'release/commercial-finalization-report-verification.strict.json'],
  ['GitHub Release publish plan', 'release/github-release-publish-plan.json'],
  ['GitHub Release publish plan verification', 'release/github-release-publish-plan-report.strict.json'],
  ['GitHub Release asset report', 'release/github-release-assets-report.json'],
  ['GitHub Release remediation plan', 'release/github-release-remediation-plan.json'],
  ['GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.json'],
  ['strict GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.strict.json'],
  ['GitHub Release remediation apply dry-run plan', 'release/github-release-remediation-apply-plan.json'],
  ['GitHub Release remediation apply dry-run verification', 'release/github-release-remediation-apply-plan-report.strict.json'],
];

function readJson(relativePath, required = false) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`missing ${relativePath}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(desktopDir, relativePath));
}

function summaryOf(report) {
  if (!report?.summary) return null;
  return {
    blockers: Number(report.summary.blockers || 0),
    warnings: Number(report.summary.warnings || 0),
  };
}

function failedChecks(report) {
  return (report?.checks || []).filter((check) => check.ok !== true);
}

function remainingActions(decision) {
  return (decision?.remainingActions || []).map((action) => ({
    id: action.id,
    owner: action.owner,
    blocking: Boolean(action.blocking),
    detail: action.detail,
  }));
}

function reportEntry(label, relativePath) {
  const report = readJson(relativePath);
  const summary = summaryOf(report);
  return {
    label,
    path: relativePath,
    present: Boolean(report),
    generatedAt: report?.generatedAt || null,
    strict: report?.strict ?? null,
    github: report?.github ?? null,
    status: report?.status || null,
    productionReady: report?.productionReady ?? null,
    localCandidateReady: report?.localCandidateReady ?? null,
    summary,
    failedChecks: failedChecks(report).map((check) => ({
      name: check.name,
      level: check.level || 'blocker',
      detail: check.detail,
    })),
    remainingActions: remainingActions(report),
  };
}

function flattenIssues(reports) {
  const issues = [];
  for (const report of reports) {
    for (const check of report.failedChecks || []) {
      issues.push({
        source: report.label,
        path: report.path,
        name: check.name,
        level: check.level || 'blocker',
        detail: check.detail,
      });
    }
    for (const action of report.remainingActions || []) {
      if (!action.blocking) continue;
      const details = Array.isArray(action.detail) ? action.detail : [action.detail];
      for (const detail of details.filter(Boolean)) {
        issues.push({
          source: report.label,
          path: report.path,
          name: action.id,
          level: 'blocker',
          detail,
        });
      }
    }
  }
  return issues;
}

function uniqueIssues(issues) {
  const seen = new Set();
  const out = [];
  for (const issue of issues) {
    const key = `${issue.source}\0${issue.name}\0${issue.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function command(step, commandText, note = '') {
  return { step, command: commandText, note };
}

function guardedBaselineVariableCommand(baselineUrl, baselineSha, { includeSha = true } = {}) {
  const guard = [
    'npm run verify:remote-baseline-approved:refresh',
  ];
  const commands = [
    ...guard,
    `gh variable set CONNECT_AI_BASELINE_URL --body "${baselineUrl}"`,
  ];
  if (includeSha) commands.push(`gh variable set CONNECT_AI_BASELINE_SHA256 --body "${baselineSha}"`);
  return commands.join('\n');
}

function guardedBaselineEnvProjection(baselineUrl, baselineSha) {
  return [
    'npm run verify:remote-baseline-approved:refresh',
    `printf '%s\\n' 'CONNECT_AI_BASELINE_URL=${baselineUrl}' 'CONNECT_AI_BASELINE_SHA256=${baselineSha}'`,
  ].join('\n');
}

function guardedReleaseWorkflowCommand(baselineUrl, baselineSha) {
  return [
    'npm run verify:remote-baseline-approved:refresh',
    `gh workflow run "Build Connect AI Desktop" -f baseline_url="${baselineUrl}" -f baseline_sha256="${baselineSha}" -f publish_release=true`,
  ].join('\n');
}

function remoteBaselineCandidateFromHandoff(handoff) {
  const candidate = handoff?.remoteBaselineCandidate || null;
  if (!candidate) return {
    sourceReport: 'release/release-credential-handoff.json',
    status: 'missing',
    currentEvidence: ['release/release-credential-handoff.json does not contain remoteBaselineCandidate. Regenerate credential handoff.'],
    validationCommands: [
      command('Regenerate credential handoff before trusting a remote baseline URL', 'npm run release:credential-handoff\nnpm run verify:credential-handoff:strict:report'),
    ],
  };
  return candidate;
}

function localBaselineMirrorFromHandoff(handoff) {
  const mirror = handoff?.localBaselineMirror || null;
  if (!mirror) {
    return {
      source: 'release/release-credential-handoff.json',
      status: 'missing',
      currentEvidence: ['release/release-credential-handoff.json does not contain localBaselineMirror. Regenerate credential handoff.'],
      validationCommands: [
        command('Regenerate credential handoff before trusting a local baseline mirror', 'npm run release:credential-handoff\nnpm run verify:credential-handoff:strict:report'),
      ],
    };
  }
  return mirror;
}

function setupCommands(pkg, remoteBaselineCandidate, localBaselineMirror) {
  const baselineUrlCandidate = remoteBaselineCandidate?.remoteUrl || '<https current-version baseline zip url>';
  const baselineSha = remoteBaselineCandidate?.expectedBaselineSha256 ||
    localBaselineMirror?.expectedBaselineSha256 ||
    '<64 hex baseline zip sha256>';
  const remoteBaselineValidationCommands = Array.isArray(remoteBaselineCandidate?.validationCommands)
    ? remoteBaselineCandidate.validationCommands
    : [];
  const remoteBaselineValidationCommandText = remoteBaselineValidationCommands
    .map((item) => item.command)
    .filter(Boolean)
    .join('\n');
  const localMirrorValidationCommands = Array.isArray(localBaselineMirror?.validationCommands)
    ? localBaselineMirror.validationCommands
    : [];
  const localMirrorValidationCommandText = localMirrorValidationCommands
    .map((item) => item.command)
    .filter(Boolean)
    .join('\n');
  return {
    localEnv: [
      command('Export the current baseline app and SHA report', 'npm run release:baseline-export'),
      command('Verify the approved baseline upload source and optional Downloads mirror', localMirrorValidationCommandText || 'npm run release:credential-handoff\nnpm run verify:credential-handoff:strict:report'),
      command('Generate a secret-free release env bootstrap template from current evidence', 'npm run release:env-bootstrap\nnpm run verify:env-bootstrap:strict:report'),
      command('Create the ignored local release env file from the generated bootstrap template', 'cp release/release-env.local.template .env.release.local && chmod 600 .env.release.local'),
      command('Reject remote same-name zip unless it matches exported baseline SHA-256', remoteBaselineValidationCommandText || 'npm run release:credential-handoff\nnpm run verify:credential-handoff:strict:report'),
      command('Print baseline URL and SHA-256 only after remote baseline guard approval', guardedBaselineEnvProjection(baselineUrlCandidate, baselineSha)),
      command('Use a local Developer ID p12 file for local release work', 'BUILD_CERTIFICATE_PATH=/absolute/path/DeveloperIDApplication.p12\nP12_PASSWORD=<p12 password>\nKEYCHAIN_PASSWORD=<temporary keychain password>'),
      command('Or generate the CI-safe p12 base64 value', "base64 -i /absolute/path/DeveloperIDApplication.p12 | tr -d '\\n'"),
      command('Use App Store Connect API key notarization locally', 'APPLE_API_KEY=/absolute/path/AuthKey_KEYID.p8\nAPPLE_API_KEY_ID=<key id>\nAPPLE_API_ISSUER=<issuer uuid>'),
      command('Or generate the CI-safe App Store Connect API key base64 value', "base64 -i /absolute/path/AuthKey_KEYID.p8 | tr -d '\\n'"),
    ],
    github: [
      command('Confirm GitHub CLI authentication for the target repository', 'gh auth status'),
      command('Set CI baseline URL and SHA-256 only after remote baseline guard approval', guardedBaselineVariableCommand(baselineUrlCandidate, baselineSha)),
      command('Set a private baseline token only if the baseline URL is private', 'gh secret set CONNECT_AI_BASELINE_TOKEN'),
      command('Set the GitHub readiness audit token', 'gh secret set CONNECT_AI_RELEASE_AUDIT_TOKEN'),
      command('Set the Developer ID certificate p12 as base64', "base64 -i /absolute/path/DeveloperIDApplication.p12 | tr -d '\\n' | gh secret set BUILD_CERTIFICATE_BASE64"),
      command('Set the Developer ID certificate password', 'gh secret set P12_PASSWORD'),
      command('Set the temporary signing keychain password', 'gh secret set KEYCHAIN_PASSWORD'),
      command('Preferred notarization: set App Store Connect API key base64', "base64 -i /absolute/path/AuthKey_KEYID.p8 | tr -d '\\n' | gh secret set APPLE_API_KEY_BASE64"),
      command('Preferred notarization: set API key id', 'gh secret set APPLE_API_KEY_ID'),
      command('Preferred notarization: set API issuer id', 'gh secret set APPLE_API_ISSUER'),
      command('Alternative notarization: set Apple ID group', 'gh secret set APPLE_ID && gh secret set APPLE_APP_SPECIFIC_PASSWORD && gh secret set APPLE_TEAM_ID'),
      command('Dry-run GitHub repository setup from .env.release.local', 'npm run release:github-setup'),
      command('Apply GitHub repository setup from .env.release.local', 'npm run release:github-setup:apply'),
    ],
    verification: [
      command('Regenerate this setup plan', 'npm run release:setup-plan'),
      command('Verify this setup plan', 'npm run verify:setup-plan:strict:report'),
      command('Regenerate credential handoff and remote baseline candidate diagnostics', 'npm run release:credential-handoff\nnpm run verify:credential-handoff:strict:report'),
      command('Verify release env contract drift', 'npm run verify:release-env-contract'),
      command('Verify release env bootstrap coverage', 'npm run release:env-bootstrap\nnpm run verify:env-bootstrap:strict:report'),
      command('Check local .env.release.local without printing values', 'npm run release:env-check'),
      command('Regression-test release env shape validation and GitHub setup dry-run', 'npm run verify:release-env-validation'),
      command('Write a strict local env readiness report without stopping the operator run', 'npm run release:env-check:strict:report'),
      command('Check signing inputs from .env.release.local', 'npm run signing:doctor:env'),
      command('Write a strict signing readiness report without stopping the operator run', 'npm run signing:check:report'),
      command('Import certificate and restore API key material from .env.release.local', 'npm run signing:import:env'),
      command('Store an Apple ID notarytool profile without printing values', 'npm run signing:notary-profile:report:env'),
      command('Check GitHub repository variables and secret names', 'npm run release:operator-checklist:github:strict:env'),
      command('Check strict process env readiness in CI', 'npm run release:env-check:process:strict'),
      command('Write strict process env readiness in CI without stopping diagnostic upload', 'npm run release:env-check:process:strict:report'),
      command('Refresh uploadable baseline ZIP evidence', 'npm run release:baseline-export'),
      command('Refresh baseline freshness evidence after release manifest generation', 'npm run release:baseline-freshness:strict:report'),
      command('Check signing input readiness in CI', 'npm run signing:check:env'),
      command('Write strict signing input readiness in CI without stopping diagnostic upload', 'npm run signing:check:report:env'),
      command('Run strict release preflight with release env', 'npm run release:preflight:strict:env'),
      command('Run the one-command production release runbook in diagnostic mode', 'npm run release:operator-runbook'),
      command('Run the CI/process-env production release runbook report', 'npm run release:operator-runbook:process:strict:report'),
      command('Summarize production readiness without printing values', 'npm run release:readiness-summary:strict:report'),
      command('Summarize remaining external unblock groups', 'npm run release:unblock-plan'),
      command('Verify release unblock plan consistency', 'npm run verify:unblock-plan'),
      command('Write the publication seal for final production and publish gates', 'npm run release:publication-seal:strict:report'),
      command('Finalize commercial readiness after current evidence converges', 'npm run release:commercial-finalize'),
    ],
    release: [
      command('Run GitHub setup, signing import, signed DMG build, verification, and publish dry-run as one guarded sequence', 'npm run release:operator-runbook:apply'),
      command('Run the same guarded sequence from CI/process environment variables', 'npm run release:operator-runbook:process:apply'),
      command('Build signed and notarized DMG', 'npm run dist'),
      command('Run strict release verification', 'npm run verify:release:env'),
      command('Refresh the production readiness summary before final asset manifest verification', 'npm run release:readiness-summary:strict:report'),
      command('Refresh the release unblock plan before final asset manifest verification', 'npm run release:unblock-plan'),
      command('Verify the release unblock plan before final asset manifest verification', 'npm run verify:unblock-plan:strict'),
      command('Refresh the publication seal before final asset manifest verification', 'npm run release:publication-seal:strict:report'),
      command('Generate publish plan without uploading', 'npm run release:publish-assets:plan:env'),
      command('Verify publish plan without uploading', 'npm run verify:github-release-publish-plan:strict:report'),
      command('Run the CI release workflow manually after remote baseline approval', guardedReleaseWorkflowCommand(baselineUrlCandidate, baselineSha)),
      command('Verify remote GitHub Release assets after publication', 'npm run verify:github-release-assets:strict:env'),
      command('Write and verify remote remediation commands after publication', 'npm run release:github-release-remediation-plan\nnpm run verify:github-release-remediation-plan:strict:report'),
      command('Dry-run and verify remote remediation apply after publication', 'npm run release:github-release-remediation-apply:plan\nnpm run verify:github-release-remediation-apply-plan:strict:report'),
      command('Finalize commercial readiness after publication verification', 'npm run release:commercial-finalize:commercial'),
      command('Verify commercial readiness after finalization', 'npm run verify:commercial-finalization:commercial'),
      command('Publish through the one-command runbook only after productionReady is true', 'npm run release:operator-runbook:publish'),
      command('Publish through the process-env runbook only after productionReady is true', 'npm run release:operator-runbook:process:publish'),
      command('Publish manifest-listed assets only after productionReady is true', `npm run release:publish-assets -- --tag desktop-v${pkg.version}`),
    ],
  };
}

function markdownList(items, mapper) {
  if (!items.length) return '- none';
  return items.map(mapper).join('\n');
}

function commandList(commands) {
  return commands
    .map((item, index) => {
      const note = item.note ? `\n   ${item.note}` : '';
      return `${index + 1}. ${item.step}\n\n   \`\`\`sh\n   ${item.command.replace(/\n/g, '\n   ')}\n   \`\`\`${note}`;
    })
    .join('\n\n');
}

function renderMarkdown(plan) {
  const reportLines = markdownList(plan.sourceReports, (report) => {
    const summary = report.summary ? `${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)` : 'no summary';
    return `- ${report.path}: ${report.present ? 'present' : 'missing'}; ${summary}`;
  });
  const blockerLines = markdownList(
    plan.currentIssues.filter((issue) => issue.level === 'blocker'),
    (issue) => `- ${issue.source}: ${issue.name} - ${issue.detail}`,
  );
  const warningLines = markdownList(
    plan.currentIssues.filter((issue) => issue.level !== 'blocker'),
    (issue) => `- ${issue.source}: ${issue.name} - ${issue.detail}`,
  );
  const variableLines = markdownList(plan.github.requiredVariables, (name) => `- ${name}`);
  const secretLines = markdownList(plan.github.requiredSecrets, (name) => `- ${name}`);
  const notaryLines = markdownList(plan.github.notarizationSecretGroups, (group) => `- ${group.join(' + ')}`);
  const localNotaryLines = markdownList(plan.github.localNotarizationCredentialGroups, (group) => `- ${group.join(' + ')}`);
  const remoteBaseline = plan.remoteBaselineCandidate;
  const localMirror = plan.localBaselineMirror;
  const localMirrorSection = localMirror ? `## Approved Baseline Upload Source

- Source: ${localMirror.source || 'missing'}
- Asset: \`${localMirror.asset || 'missing'}\`
- Status: ${localMirror.status || 'missing'}
- Approved upload source: \`${localMirror.approvedUploadSource || 'missing'}\`
- Download mirror: \`${localMirror.path || 'missing'}\`
- Mirror bytes: ${localMirror.bytes ?? 'missing'}
- Mirror SHA-256: \`${localMirror.sha256 || 'missing'}\`
- Matches exported baseline: ${localMirror.matchesExport ? 'true' : 'false'}

Current evidence:

${markdownList(localMirror.currentEvidence || [], (item) => `- ${item}`)}

Validation commands:

${commandList(localMirror.validationCommands || [])}
` : '';
  const remoteBaselineSection = remoteBaseline ? `## Remote Baseline Candidate Guard

- Source report: \`${remoteBaseline.sourceReport || 'missing'}\`
- Asset: \`${remoteBaseline.asset || 'missing'}\`
- Status: ${remoteBaseline.status || 'missing'}
- Remote URL: ${remoteBaseline.remoteUrl ? `\`${remoteBaseline.remoteUrl}\`` : 'missing'}
- Remote bytes: ${remoteBaseline.remoteBytes ?? 'missing'}
- Expected baseline bytes: ${remoteBaseline.expectedBaselineBytes ?? 'missing'}
- Expected baseline SHA-256: \`${remoteBaseline.expectedBaselineSha256 || 'missing'}\`

Current evidence:

${markdownList(remoteBaseline.currentEvidence || [], (item) => `- ${item}`)}

Validation commands:

${commandList(remoteBaseline.validationCommands || [])}
` : '';

  return `# Connect AI Release Setup Plan

Generated: ${plan.generatedAt}
Product: ${plan.product.name} ${plan.product.version}
Status: ${plan.status}
Production ready: ${plan.productionReady}
Local candidate ready: ${plan.localCandidateReady}

## Source Reports

${reportLines}

## Current Blockers

${blockerLines}

## Current Warnings

${warningLines}

## GitHub Repository Inputs

Required repository variables:

${variableLines}

Required repository secrets:

${secretLines}

GitHub Actions notarization requires one complete secret group:

${notaryLines}

Local notarization can also use these credential groups:

${localNotaryLines}

Fine-grained audit token permissions:

- Metadata: read
- Contents: read
- Actions variables: read
- Actions secrets: read

${localMirrorSection}

${remoteBaselineSection}

## Local Env Setup

${commandList(plan.commands.localEnv)}

## GitHub Setup

${commandList(plan.commands.github)}

## Verification

${commandList(plan.commands.verification)}

## Release Execution

${commandList(plan.commands.release)}

## Safety Rules

${markdownList(plan.safetyRules, (item) => `- ${item}`)}
`;
}

function main() {
  const pkg = readJson('package.json', true);
  const strictDecision = readJson('release/release-decision.strict.json');
  const promotion = readJson('release/release-promotion-plan.json');
  const productionReadiness = readJson('release/production-readiness-summary.json', false);
  const publicationSeal = readJson('release/release-publication-seal.json', false);
  const baselineFreshness = readJson('release/baseline-freshness-report.json', false);
  const credentialHandoff = readJson('release/release-credential-handoff.json', false);
  const remoteBaselineCandidate = remoteBaselineCandidateFromHandoff(credentialHandoff);
  const localBaselineMirror = localBaselineMirrorFromHandoff(credentialHandoff);
  const sourceReports = REPORTS.map(([label, relativePath]) => reportEntry(label, relativePath));
  const currentIssues = uniqueIssues(flattenIssues(sourceReports));

  const productionReady = Boolean(strictDecision?.productionReady && promotion?.productionReady && productionReadiness?.productionReady && publicationSeal?.productionReady && baselineFreshness?.ok);
  const localCandidateReady = Boolean((strictDecision?.localCandidateReady || promotion?.localCandidateReady) && (!baselineFreshness || baselineFreshness.ok));
  const status = productionReady
    ? 'production-ready'
    : localCandidateReady
      ? 'local-candidate-awaiting-external-setup'
      : 'not-ready';

  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    productionReady,
    localCandidateReady,
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
      repository: pkg.repository?.url || null,
    },
    sourceReports,
    currentIssues,
    github: {
      requiredVariables: ['CONNECT_AI_BASELINE_URL', 'CONNECT_AI_BASELINE_SHA256'],
      requiredVariableShapes: {
        CONNECT_AI_BASELINE_URL: 'https .zip URL containing the package version',
        CONNECT_AI_BASELINE_SHA256: '64 hex SHA-256; must match CONNECT_AI_ZIP_SHA256 when both are set',
      },
      optionalSecrets: ['CONNECT_AI_BASELINE_TOKEN'],
      requiredSecrets: [
        'CONNECT_AI_RELEASE_AUDIT_TOKEN',
        'BUILD_CERTIFICATE_BASE64',
        'P12_PASSWORD',
        'KEYCHAIN_PASSWORD',
      ],
      notarizationSecretGroups: [
        ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
        ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
      ],
      localNotarizationCredentialGroups: [
        ['APPLE_KEYCHAIN_PROFILE'],
        ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
        ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
        ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
      ],
      auditTokenPermissions: ['Metadata: read', 'Contents: read', 'Actions variables: read', 'Actions secrets: read'],
    },
    remoteBaselineCandidate,
    localBaselineMirror,
    localEnv: {
      template: '.env.release.example',
      target: '.env.release.local',
      templatePresent: fileExists('.env.release.example'),
      targetIgnored: true,
    },
    commands: setupCommands(pkg, remoteBaselineCandidate, localBaselineMirror),
    safetyRules: [
      'Do not commit .env.release.local, p12 files, p8 files, passwords, or GitHub tokens.',
      'Do not edit release/baseline-export-report.json by hand; regenerate it with npm run release:baseline-export.',
      'Use release/Connect-AI-0.4.8-baseline-arm64-mac.zip as the approved upload source unless a Downloads mirror has matching bytes and SHA-256.',
      'Do not use any remote same-name Connect AI zip as CONNECT_AI_BASELINE_URL unless its SHA-256 matches release/Connect-AI-0.4.8-baseline-arm64-mac.zip.',
      'Do not print secret values in issue comments, release notes, logs, or screenshots.',
      'Do not publish a production release unless release/release-decision.strict.json, release/release-promotion-plan.json, release/production-readiness-summary.json, release/release-publication-seal.json have productionReady: true, and release/baseline-freshness-report.json has ok: true.',
      'Do not publish a production release unless release/RELEASE_NOTES.md has Status: signed-and-notarized.',
      'Use release/release-asset-manifest.json as the only source of truth for GitHub Release upload files.',
      'Keep release setup files as CI diagnostics; they are not end-user GitHub Release assets.',
      'Keep production readiness summary files as CI diagnostics; they are not end-user GitHub Release assets.',
      'Keep release credential handoff and credential handoff verification files as CI diagnostics; they are not end-user GitHub Release assets.',
      'Keep release unblock plan files as CI diagnostics; they are not end-user GitHub Release assets.',
      'release:github-setup is dry-run by default; only release:github-setup:apply mutates repository settings.',
      'APPLE_KEYCHAIN_PROFILE alone is not sufficient on GitHub-hosted macOS runners; use API key base64 or Apple ID secrets for CI.',
    ],
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(plan));
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
}

main();
