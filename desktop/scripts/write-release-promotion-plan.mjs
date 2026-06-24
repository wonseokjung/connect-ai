import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const jsonPath = path.join(releaseDir, 'release-promotion-plan.json');
const markdownPath = path.join(releaseDir, 'RELEASE_PROMOTION_PLAN.md');

function readJson(relativePath, required = true) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`missing ${relativePath}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function actionById(decision, id) {
  return (decision.remainingActions || []).find((item) => item.id === id) || null;
}

function asLines(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [String(value)];
}

function failedChecks(report) {
  return (report?.checks || []).filter((check) => check.ok !== true);
}

function summary(report) {
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
}

function githubOperatorStatus(report, requireReport) {
  if (!report) {
    return {
      present: false,
      clean: !requireReport,
      summary: null,
      detail: requireReport
        ? 'missing release/operator-readiness.github.json; run npm run release:operator-checklist:github:strict'
        : 'not generated; set CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS=1 to require this gate locally',
    };
  }

  const reportSummary = summary(report);
  const modeOk = report.github === true && report.strict === true;
  const clean = modeOk && reportSummary.blockers === 0 && reportSummary.warnings === 0;
  const failed = failedChecks(report)
    .map((check) => `${check.name}: ${check.detail}`)
    .join('; ');
  return {
    present: true,
    clean,
    summary: reportSummary,
    detail: clean
      ? 'GitHub repository variables/secrets are readable and complete'
      : `${reportSummary.blockers} blocker(s), ${reportSummary.warnings} warning(s)${modeOk ? '' : `, github=${Boolean(report.github)} strict=${Boolean(report.strict)}`}${failed ? `; ${failed}` : ''}`,
  };
}

function githubReleaseAssetPaths(pkg) {
  return [
    `release/Connect-AI-${pkg.version}-mac-arm64.dmg`,
    `release/Connect-AI-${pkg.version}-mac-arm64.dmg.blockmap`,
    'release/latest-mac.yml',
    'release/release-manifest.json',
    'release/release-tag-report.json',
    'release/ui-parity-report.json',
    'release/performance-parity-report.json',
    'release/macos-security-contract.json',
    'release/security-audit-report.json',
    'release/dmg-install-experience.json',
    'release/release-launch-smoke.json',
    'release/release-dmg-launch-smoke.json',
    'release/provenance.json',
    'release/RELEASE_NOTES.md',
    'release/SHA256SUMS.txt',
    'release/SHA512SUMS.txt',
    'release/update-channel-report.json',
    'release/sbom.cdx.json',
    'release/sbom.spdx.json',
    'release/evidence-report.strict.json',
    'release/operator-readiness.json',
    'release/operator-readiness.github.json',
    'release/signing-readiness.json',
    'release/release-decision.strict.json',
    'release/release-promotion-plan.json',
    'release/RELEASE_PROMOTION_PLAN.md',
    'release/release-asset-manifest.json',
  ];
}

function ciOnlyDiagnosticPaths() {
  return [
    'release/secret-hygiene-report.json',
    'release/preflight-report.strict.json',
    'release/release-launch-smoke.log',
    'release/release-dmg-launch-smoke.log',
    'release/release-env-report.process.json',
    'release/github-release-setup-report.json',
    'release/production-release-runbook-report.json',
    'release/production-readiness-summary.json',
    'release/PRODUCTION_READINESS_SUMMARY.md',
    'release/release-setup-plan.json',
    'release/RELEASE_SETUP_PLAN.md',
    'release/release-unblock-plan.json',
    'release/RELEASE_UNBLOCK_PLAN.md',
    'release/release-unblock-plan-report.json',
    'release/release-unblock-plan-report.strict.json',
    'release/release-publication-seal.json',
    'release/RELEASE_PUBLICATION_SEAL.md',
  ];
}

function baselineInput(pkg, baselineExport) {
  const publish = Array.isArray(pkg?.build?.publish) ? pkg.build.publish[0] : null;
  const owner = publish?.owner || 'wonseokjung';
  const repo = publish?.repo || 'connect-ai';
  const tag = `desktop-v${pkg.version}`;
  const asset = `Connect-AI-${pkg.version}-arm64-mac.zip`;
  return {
    url: `https://github.com/${owner}/${repo}/releases/download/${tag}/${asset}`,
    sha256: baselineExport?.export?.sha256 || '<baseline zip sha256>',
  };
}

function guardedBaselineVariableCommand(baseline) {
  return [
    'npm run verify:remote-baseline-approved:refresh',
    `gh variable set CONNECT_AI_BASELINE_URL --body "${baseline.url}"`,
    `gh variable set CONNECT_AI_BASELINE_SHA256 --body "${baseline.sha256}"`,
  ].join('\n');
}

function guardedReleaseWorkflowCommand(baseline) {
  return [
    'npm run verify:remote-baseline-approved:refresh',
    `gh workflow run "Build Connect AI Desktop" -f baseline_url="${baseline.url}" -f baseline_sha256="${baseline.sha256}" -f publish_release=true`,
  ].join('\n');
}

function commandPlan(pkg, productionReady, baseline) {
  return {
    local: [
      {
        step: 'Run the one-command production release runbook in diagnostic mode',
        command: 'npm run release:operator-runbook',
      },
      {
        step: 'Load release credentials without printing secret values',
        command: 'npm run release:operator-checklist:strict:env',
      },
      {
        step: 'Import Developer ID certificate and restore notarization key material',
        command: 'npm run signing:import:env',
      },
      {
        step: 'Build signed and notarized DMG from the parity baseline',
        command: 'npm run dist',
      },
      {
        step: 'Run strict app parity, distribution, evidence, and decision gates',
        command: 'npm run verify:release:env',
      },
      {
        step: 'Confirm the promotion decision is production-ready',
        command: 'npm run release:decision:strict',
      },
      {
        step: 'Refresh the production readiness summary for the current gate state',
        command: 'npm run release:readiness-summary:strict:report',
      },
      {
        step: 'Refresh the publication seal for final production and publish gates',
        command: 'npm run release:publication-seal:strict:report',
      },
      {
        step: 'Generate a manifest-driven GitHub Release publish plan',
        command: 'npm run release:publish-assets:plan',
      },
      {
        step: 'Run the one-command production release runbook with GitHub setup, signing import, build, and verification',
        command: 'npm run release:operator-runbook:apply',
      },
    ],
    githubActions: [
      {
        step: 'Check repository variables, secrets, and GitHub CLI access without reading secret values',
        command: 'npm run release:operator-checklist:github:strict',
      },
      {
        step: 'Set CONNECT_AI_BASELINE_URL and CONNECT_AI_BASELINE_SHA256 repository variables after approval',
        command: guardedBaselineVariableCommand(baseline),
      },
      {
        step: 'Set Developer ID certificate secrets',
        command: 'gh secret set CONNECT_AI_RELEASE_AUDIT_TOKEN && gh secret set BUILD_CERTIFICATE_BASE64 && gh secret set P12_PASSWORD && gh secret set KEYCHAIN_PASSWORD',
      },
      {
        step: 'Set one notarization credential group',
        command: 'gh secret set APPLE_API_KEY_BASE64 && gh secret set APPLE_API_KEY_ID && gh secret set APPLE_API_ISSUER',
      },
      {
        step: 'Run the signed desktop release workflow after remote baseline approval',
        command: guardedReleaseWorkflowCommand(baseline),
      },
      {
        step: 'Verify the published GitHub Release assets against the manifest',
        command: 'npm run verify:github-release-assets:strict',
      },
    ],
    alreadyReady: productionReady
      ? [
          {
            step: 'Publish only manifest-listed artifacts whose release decision is production-ready',
            command: `npm run release:publish-assets -- --tag desktop-v${pkg.version}`,
          },
        ]
      : [],
  };
}

function renderCommandList(commands) {
  return commands
    .map((item, index) => `${index + 1}. ${item.step}\n\n\`\`\`sh\n${item.command}\n\`\`\``)
    .join('\n\n');
}

function renderMarkdown(plan) {
  const missingCredentials = actionById(plan.decision, 'provide_apple_release_credentials');
  const signing = actionById(plan.decision, 'sign_and_notarize');
  const githubReadiness = actionById(plan.decision, 'resolve_github_operator_readiness');
  const warnings = actionById(plan.decision, 'clean_operator_warnings');
  const credentialLines = asLines(missingCredentials?.detail)
    .map((line) => `- ${line}`)
    .join('\n') || '- none';
  const githubReadinessLines = asLines(githubReadiness?.detail)
    .map((line) => `- ${line}`)
    .join('\n') || `- ${plan.githubOperatorReadiness.detail}`;
  const warningLines = asLines(warnings?.detail)
    .map((line) => `- ${line}`)
    .join('\n') || '- none';
  const signingSummary = plan.summaries.signingReadiness
    ? `${plan.summaries.signingReadiness.blockers} blocker(s), ${plan.summaries.signingReadiness.warnings} warning(s)`
    : 'missing signing-readiness.json';
  const localCommands = renderCommandList(plan.commands.local);
  const githubCommands = renderCommandList(plan.commands.githubActions);
  const gates = plan.productionGates
    .map((gate) => `- ${gate.name}: ${gate.ok ? 'PASS' : 'WAITING'} - ${gate.detail}`)
    .join('\n');
  const releaseAssets = plan.artifactsToPromote
    .map((artifact) => `- \`${artifact}\``)
    .join('\n');
  const ciDiagnostics = plan.ciOnlyDiagnostics
    .map((artifact) => `- \`${artifact}\``)
    .join('\n');

  return `# Connect AI Release Promotion Plan

Generated: ${plan.generatedAt}
Status: ${plan.status}
Product: ${plan.product.name} ${plan.product.version}
Production ready: ${plan.productionReady}
Local candidate ready: ${plan.localCandidateReady}

## Current Gate

${signing ? signing.detail : 'No signing or notarization action remains in the current decision.'}

Signing readiness: ${signingSummary}

## Missing Operator Inputs

${credentialLines}

## GitHub Automation Readiness

${githubReadinessLines}

## Non-Blocking Cleanup

${warningLines}

## Local Promotion Commands

${localCommands}

## GitHub Actions Promotion Commands

${githubCommands}

## Production Gates

${gates}

## GitHub Release Assets

${releaseAssets}

## CI-Only Diagnostics

${ciDiagnostics}

## Rule

Do not publish the DMG as a production release unless \`release-decision.strict.json\`, \`release-promotion-plan.json\`, \`production-readiness-summary.json\`, and \`release-publication-seal.json\` have \`productionReady: true\`, \`release-manifest.json\` proves app/DMG codesign, Gatekeeper, and stapler checks, and \`RELEASE_NOTES.md\` has \`Status: signed-and-notarized\`.
`;
}

function main() {
  const pkg = readJson('package.json');
  const decision = readJson('release/release-decision.json');
  const strictDecision = readJson('release/release-decision.strict.json', false);
  const evidence = readJson('release/evidence-report.json');
  const strictEvidence = readJson('release/evidence-report.strict.json', false);
  const operator = readJson('release/operator-readiness.json');
  const githubOperator = readJson('release/operator-readiness.github.json', false);
  const manifest = readJson('release/release-manifest.json');
  const signingReadiness = readJson('release/signing-readiness.json', false);
  const releaseTag = readJson('release/release-tag-report.json', false);
  const uiParity = readJson('release/ui-parity-report.json', false);
  const performanceParity = readJson('release/performance-parity-report.json', false);
  const releaseEnv =
    readJson('release/release-env-report.process.json', false) ||
    readJson('release/release-env-report.json', false);
  const secretHygiene = readJson('release/secret-hygiene-report.json', false);
  const securityAudit = readJson('release/security-audit-report.json', false);
  const baselineExport = readJson('release/baseline-export-report.json', false);

  const requireGitHubOperatorReadiness = process.env.CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS === '1';
  const githubOperatorReadiness = githubOperatorStatus(githubOperator, requireGitHubOperatorReadiness);
  const productionReady = Boolean((strictDecision?.productionReady || decision.productionReady) && githubOperatorReadiness.clean);
  const localCandidateReady = Boolean(decision.localCandidateReady);
  const status = productionReady
    ? 'production-ready'
    : localCandidateReady
      ? 'awaiting-signing-and-notarization'
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
    },
    decision,
    strictDecision: strictDecision || null,
    githubOperatorReadiness,
    summaries: {
      evidence: evidence.summary || null,
      strictEvidence: strictEvidence?.summary || null,
      operator: operator.summary || null,
      githubOperator: githubOperatorReadiness.summary,
      signingReadiness: signingReadiness?.summary || null,
      releaseTag: releaseTag?.summary || null,
      uiParity: uiParity?.summary || null,
      performanceParity: performanceParity?.summary || null,
      releaseEnv: releaseEnv?.summary || null,
      secretHygiene: secretHygiene?.summary || null,
      securityAudit: securityAudit?.summary || null,
      releaseSecurity: {
        codesign: Boolean(manifest.security?.codesignVerify?.ok),
        gatekeeper: Boolean(manifest.security?.gatekeeper?.ok),
        stapler: Boolean(manifest.security?.stapler?.ok),
        dmgGatekeeper: Boolean(manifest.security?.dmgGatekeeper?.ok),
        dmgStapler: Boolean(manifest.security?.dmgStapler?.ok),
      },
    },
    requiredInputs: {
      localEnvFile: '.env.release.local',
      certificateAnyOf: ['BUILD_CERTIFICATE_PATH', 'BUILD_CERTIFICATE_BASE64'],
      certificateRequiredWithSource: ['P12_PASSWORD', 'KEYCHAIN_PASSWORD'],
      notarizationAnyGroup: [
        ['APPLE_KEYCHAIN_PROFILE'],
        ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
        ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
        ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
      ],
      githubVariables: ['CONNECT_AI_BASELINE_URL', 'CONNECT_AI_BASELINE_SHA256'],
      githubSecrets: [
        'CONNECT_AI_RELEASE_AUDIT_TOKEN',
        'BUILD_CERTIFICATE_BASE64',
        'P12_PASSWORD',
        'KEYCHAIN_PASSWORD',
        'APPLE_API_KEY_BASE64',
        'APPLE_API_KEY_ID',
        'APPLE_API_ISSUER',
      ],
    },
    commands: commandPlan(pkg, productionReady, baselineInput(pkg, baselineExport)),
    productionGates: [
      {
        name: 'release decision',
        ok: productionReady,
        detail: productionReady ? 'productionReady true' : 'waiting for signed-and-notarized strict decision',
      },
      {
        name: 'release tag',
        ok: releaseTag?.ok === true,
        detail: releaseTag ? `${releaseTag.summary?.blockers ?? 'unknown'} blocker(s), ${releaseTag.releaseTag?.resolved || 'missing'} resolved` : 'missing release tag report',
      },
      {
        name: 'UI and behavior parity',
        ok: uiParity?.ok === true,
        detail: uiParity ? `${uiParity.summary?.blockers ?? 'unknown'} blocker(s), ${Number.isFinite(uiParity.screenshots?.similarity) ? `${(uiParity.screenshots.similarity * 100).toFixed(2)}% screenshot similarity` : 'missing screenshot similarity'}` : 'missing UI parity report',
      },
      {
        name: 'renderer performance parity',
        ok: performanceParity?.ok === true,
        detail: performanceParity ? `${performanceParity.summary?.blockers ?? 'unknown'} blocker(s), load ${performanceParity.measurements?.local?.loadMs ?? 'missing'}ms vs baseline ${performanceParity.measurements?.baseline?.loadMs ?? 'missing'}ms` : 'missing performance parity report',
      },
      {
        name: 'local evidence',
        ok: evidence.summary?.blockers === 0,
        detail: `${evidence.summary?.blockers ?? 'unknown'} blocker(s), ${evidence.summary?.warnings ?? 'unknown'} warning(s)`,
      },
      {
        name: 'release environment readiness',
        ok: releaseEnv?.summary?.blockers === 0,
        detail: releaseEnv
          ? `${releaseEnv.processEnv ? 'process-env' : 'local-file'} report: ${releaseEnv.summary.blockers} blocker(s), ${releaseEnv.summary.warnings} warning(s)`
          : 'missing release env report',
      },
      {
        name: 'secret hygiene',
        ok: secretHygiene?.summary?.blockers === 0 && secretHygiene?.summary?.warnings === 0,
        detail: secretHygiene
          ? `${secretHygiene.summary.blockers} blocker(s), ${secretHygiene.summary.warnings} warning(s); CI-only diagnostic, not a GitHub Release asset`
          : 'missing secret hygiene report',
      },
      {
        name: 'dependency security audit',
        ok: securityAudit?.ok === true && securityAudit.summary?.blockers === 0,
        detail: securityAudit
          ? `${securityAudit.summary.blockers} blocker(s), production ${securityAudit.audits?.production?.vulnerabilities?.total ?? 'missing'} vulnerability(s), full ${securityAudit.audits?.all?.vulnerabilities?.total ?? 'missing'} vulnerability(s)`
          : 'missing security audit report',
      },
      {
        name: 'strict evidence',
        ok: strictEvidence?.summary?.blockers === 0,
        detail: strictEvidence ? `${strictEvidence.summary.blockers} blocker(s)` : 'missing strict evidence report',
      },
      {
        name: 'operator readiness',
        ok: operator.summary?.blockers === 0,
        detail: `${operator.summary?.blockers ?? 'unknown'} blocker(s), ${operator.summary?.warnings ?? 'unknown'} warning(s)`,
      },
      {
        name: 'GitHub release automation readiness',
        ok: githubOperatorReadiness.clean,
        detail: githubOperatorReadiness.detail,
      },
      {
        name: 'signed and notarized app and DMG',
        ok: Boolean(
          manifest.security?.codeSignature?.developerId === true &&
            manifest.security?.codesignVerify?.ok &&
            manifest.security?.gatekeeper?.ok &&
            manifest.security?.stapler?.ok &&
            manifest.security?.dmgGatekeeper?.ok &&
            manifest.security?.dmgStapler?.ok
        ),
        detail: 'Developer ID codesign, Gatekeeper, stapler, DMG Gatekeeper, and DMG stapler must pass',
      },
    ],
    artifactsToPromote: githubReleaseAssetPaths(pkg),
    ciOnlyDiagnostics: ciOnlyDiagnosticPaths(),
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(plan));
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
}

main();
