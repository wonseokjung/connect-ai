import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const jsonPath = path.join(releaseDir, 'release-unblock-plan.json');
const markdownPath = path.join(releaseDir, 'RELEASE_UNBLOCK_PLAN.md');

function readJson(relativePath, required = false) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`missing ${relativePath}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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

function matchingFailures(report, patterns) {
  const regexes = patterns.map((pattern) => pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i'));
  return failedChecks(report).filter((check) => {
    const text = `${check.name}: ${check.detail}`;
    return regexes.some((regex) => regex.test(text));
  });
}

function detailsFrom(failures) {
  return failures.map((check) => `${check.name}: ${check.detail}`);
}

function remoteRemediationDetails(report) {
  const remediation = report?.remediation;
  const summary = remediation?.summary;
  if (!summary) return [];
  const details = [
    `remote asset remediation: ${remediation.status}, required=${summary.required}, advisory=${summary.advisory}`,
  ];
  const required = (remediation.actions || []).filter((action) => action.severity === 'required').slice(0, 5);
  for (const action of required) {
    details.push(`${action.asset}: ${Array.isArray(action.reasons) ? action.reasons.join('; ') : 'remote drift'}`);
  }
  return details;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
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

function commandText(commands) {
  return (Array.isArray(commands) ? commands : [])
    .map((item) => `${item.step || ''}\n${item.command || ''}`)
    .join('\n');
}

function cleanStrictReport(report) {
  const value = summary(report);
  return Boolean(report && !report.parseError && value.blockers === 0 && value.warnings === 0);
}

function remoteUploadPermissionEvidence(remoteRemediationApplyPlan, commercialReadiness) {
  const github = remoteRemediationApplyPlan?.github || {};
  const actions = Number(
    remoteRemediationApplyPlan?.summary?.actions ??
      commercialReadiness?.summary?.remoteApplyActions ??
      0
  );
  const canUpload = github.canUploadReleaseAssets === true;
  const commercialSummaryReady = commercialReadiness?.summary?.remoteUploadPermissionReady;
  const ok = actions === 0 || canUpload || commercialSummaryReady === true;
  const errors = Array.isArray(github.errors) ? github.errors : [];
  return {
    ok,
    actions,
    detail: [
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
  };
}

function remoteBaselineGuardEvidence(setupPlan, credentialHandoff, setupVerification, credentialVerification) {
  const setupCandidate = setupPlan?.remoteBaselineCandidate || null;
  const handoffCandidate = credentialHandoff?.remoteBaselineCandidate || null;
  const candidate = setupCandidate || handoffCandidate || {};
  const status = candidate.status || 'missing';
  const expectedSha = candidate.expectedBaselineSha256 || '';
  const validation = `${commandText(setupCandidate?.validationCommands)}\n${commandText(handoffCandidate?.validationCommands)}`;
  const safetyRules = (setupPlan?.safetyRules || []).join('\n');
  const setupVerified = cleanStrictReport(setupVerification);
  const handoffVerified = cleanStrictReport(credentialVerification);
  const validationDocumented = validation.includes('gh release download') && validation.includes('shasum -a 256');
  const safetyRuleDocumented = safetyRules.includes('same-name Connect AI zip') &&
    safetyRules.includes('SHA-256 matches release/Connect-AI-0.4.8-baseline-arm64-mac.zip');
  const ok = Boolean(
    setupCandidate &&
      handoffCandidate &&
      ['missing', 'not-approved-baseline-url', 'size-match-sha-unverified'].includes(status) &&
      setupCandidate.status === handoffCandidate.status &&
      setupCandidate.asset === handoffCandidate.asset &&
      (status !== 'not-approved-baseline-url' ||
        (candidate.remoteBytes !== candidate.expectedBaselineBytes && /^[a-f0-9]{64}$/i.test(expectedSha))) &&
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

function group({
  id,
  title,
  owner = 'operator',
  phase = 'production',
  blocking = true,
  ok,
  detail,
  requiredInputs = [],
  commands = [],
  verification = [],
  sourceReports = [],
}) {
  return {
    id,
    title,
    owner,
    phase,
    blocking,
    ok: Boolean(ok),
    status: ok ? 'ready' : blocking ? 'blocked' : 'waiting',
    detail: Array.isArray(detail) ? detail : [detail].filter(Boolean),
    requiredInputs,
    commands,
    verification,
    sourceReports,
  };
}

function reportState(label, relativePath) {
  const report = readJson(relativePath);
  return {
    label,
    path: relativePath,
    present: Boolean(report),
    generatedAt: report?.generatedAt || null,
    status: report?.status || null,
    productionReady: report?.productionReady ?? null,
    localCandidateReady: report?.localCandidateReady ?? null,
    publishedReleaseReady: report?.publishedReleaseReady ?? null,
    commercialReady: report?.commercialReady ?? null,
    strict: report?.strict ?? null,
    github: report?.github ?? null,
    processEnv: report?.processEnv ?? null,
    summary: report ? summary(report) : null,
  };
}

function readLatestJsonPath(paths) {
  const candidates = paths
    .map((relativePath) => {
      const file = path.join(desktopDir, relativePath);
      if (!fs.existsSync(file)) return null;
      const report = readJson(relativePath, false);
      const generatedAtMs = Date.parse(report?.generatedAt || '');
      return {
        relativePath,
        report,
        timestamp: Number.isFinite(generatedAtMs) ? generatedAtMs : fs.statSync(file).mtimeMs,
      };
    })
    .filter(Boolean)
    .filter((candidate) => candidate.report && !candidate.report.parseError);
  if (!candidates.length) return paths[0];
  candidates.sort((left, right) => {
    if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
    return Number(right.report.strict === true) - Number(left.report.strict === true);
  });
  return candidates[0].relativePath;
}

function commandList(items) {
  if (!items.length) return '- none';
  return items.map((item, index) => {
    const note = item.note ? `\n   ${item.note}` : '';
    return `${index + 1}. ${item.step}\n\n   \`\`\`sh\n   ${item.command.replace(/\n/g, '\n   ')}\n   \`\`\`${note}`;
  }).join('\n\n');
}

function bulletList(items) {
  if (!items.length) return '- none';
  return items.map((item) => `- ${item}`).join('\n');
}

function renderMarkdown(plan) {
  const sourceLines = plan.sourceReports.map((report) => {
    const present = report.present ? 'present' : 'missing';
    const counts = report.summary ? `${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)` : 'no summary';
    const status = report.status ? `, status=${report.status}` : '';
    return `- ${report.path}: ${present}; ${counts}${status}`;
  }).join('\n');

  const groupSections = plan.unblockGroups.map((item) => {
    const status = item.ok ? 'READY' : item.blocking ? 'BLOCKED' : 'WAITING';
    return `## ${item.title}

Status: ${status}
Owner: ${item.owner}
Phase: ${item.phase}

Current detail:

${bulletList(item.detail)}

Required inputs:

${bulletList(item.requiredInputs)}

Commands:

${commandList(item.commands)}

Verification:

${commandList(item.verification)}

Source reports:

${bulletList(item.sourceReports)}
`;
  }).join('\n');

  return `# Connect AI Release Unblock Plan

Generated: ${plan.generatedAt}
Status: ${plan.status}
Production ready: ${plan.productionReady}
Local candidate ready: ${plan.localCandidateReady}
Blocked action groups: ${plan.summary.blockers}
Warnings: ${plan.summary.warnings}

## Recommended Order

${bulletList(plan.recommendedOrder.map((item) => `${item.index}. ${item.title} (${item.status})`))}

## Source Reports

${sourceLines}

${groupSections}
`;
}

function main() {
  const pkg = readJson('package.json', true);
  const readiness = readJson('release/production-readiness-summary.json');
  const decision = readJson('release/release-decision.strict.json');
  const promotion = readJson('release/release-promotion-plan.json');
  const baselineExport = readJson('release/baseline-export-report.json');
  const baselineFreshness = readJson('release/baseline-freshness-report.json');
  const envProcess = readJson('release/release-env-report.process.json');
  const signing = readJson('release/signing-readiness.json');
  const githubSetup = readJson('release/github-release-setup-report.json');
  const githubOperator = readJson('release/operator-readiness.github.json');
  const publishPlan = readJson('release/github-release-publish-plan.json');
  const strictRemoteAssetsPath = 'release/github-release-assets-report.strict.json';
  const localRemoteAssetsPath = 'release/github-release-assets-report.json';
  const remoteAssetsPath = readLatestJsonPath([strictRemoteAssetsPath, localRemoteAssetsPath]);
  const remoteAssets = readJson(remoteAssetsPath, false);
  const remoteRemediationPlan = readJson('release/github-release-remediation-plan.json', false);
  const remoteRemediationReport = readJson('release/github-release-remediation-plan-report.json', false);
  const remoteRemediationStrictReport = readJson('release/github-release-remediation-plan-report.strict.json', false);
  const remoteRemediationApplyPlan = readJson('release/github-release-remediation-apply-plan.json', false);
  const credentialHandoff = readJson('release/release-credential-handoff.json', false);
  const credentialHandoffVerification = readJson('release/release-credential-handoff-report.strict.json', false);
  const releaseSetup = readJson('release/release-setup-plan.json', false);
  const releaseSetupVerification = readJson('release/release-setup-plan-report.strict.json', false);
  const commercialReadiness = readJson('release/commercial-release-readiness-report.strict.json', false);
  const commercialFinalization = readJson('release/commercial-finalization-report.json', false);
  const commercialFinalizationVerification = readJson('release/commercial-finalization-report-verification.strict.json', false);
  const remoteBaselineGuard = remoteBaselineGuardEvidence(
    releaseSetup,
    credentialHandoff,
    releaseSetupVerification,
    credentialHandoffVerification,
  );
  const baselineUrlCandidate = credentialHandoff?.remoteBaselineCandidate?.remoteUrl ||
    releaseSetup?.remoteBaselineCandidate?.remoteUrl ||
    '<https current-version baseline zip url>';
  const baselineSha = baselineExport?.export?.sha256 ||
    credentialHandoff?.baselineArtifact?.sha256 ||
    '<64 hex baseline zip sha256>';
  const remoteUploadPermission = remoteUploadPermissionEvidence(remoteRemediationApplyPlan, commercialReadiness);

  const baselineFailures = [
    ...(!baselineExport || baselineExport.ok !== true || summary(baselineExport).blockers > 0
      ? [{
          name: 'baseline export report',
          level: 'blocker',
          detail: baselineExport ? `${summary(baselineExport).blockers} blocker(s), ${summary(baselineExport).warnings} warning(s)` : 'missing release/baseline-export-report.json',
        }]
      : []),
    ...failedChecks(baselineFreshness),
    ...matchingFailures(envProcess, [/baseline/i]),
    ...matchingFailures(githubSetup, [/CONNECT_AI_BASELINE/i, /CONNECT_AI_ZIP_SHA256/i]),
    ...matchingFailures(githubOperator, [/baseline/i]),
  ];
  const auditTokenFailures = [
    ...matchingFailures(envProcess, [/audit token/i, /GH_TOKEN/i]),
    ...matchingFailures(githubSetup, [/CONNECT_AI_RELEASE_AUDIT_TOKEN/i]),
    ...matchingFailures(githubOperator, [/variable list access/i, /secret list access/i]),
  ];
  const signingFailures = [
    ...matchingFailures(signing, [/Developer ID/i, /certificate/i, /keychain password/i]),
    ...matchingFailures(githubOperator, [/Developer ID/i, /certificate import/i]),
  ];
  const notarizationFailures = [
    ...matchingFailures(signing, [/notarization/i, /APPLE_/i]),
    ...matchingFailures(githubOperator, [/notarization/i, /APPLE_/i]),
    ...matchingFailures(githubSetup, [/notarization/i, /APPLE_/i]),
  ];
  const githubActionsFailures = [
    ...failedChecks(githubSetup).filter((check) => check.level === 'blocker'),
    ...matchingFailures(githubOperator, [/variable list access/i, /secret list access/i]),
  ];
  const promotionFailures = [
    ...matchingFailures(publishPlan, [/production-ready/i, /signed status/i, /readiness summary/i]),
    ...((readiness?.nextActions || []).filter((action) => action.blocking).map((action) => ({
      name: action.id,
      level: 'blocker',
      detail: Array.isArray(action.detail) ? action.detail.join('; ') : action.detail,
    }))),
  ];
  const remoteFailures = [
    ...matchingFailures(publishPlan, [/GitHub operator readiness report clean/i]),
    ...failedChecks(remoteAssets).filter((check) => check.level === 'blocker' || check.level === 'warn'),
  ];
  const remoteRemediationFailures = [
    ...failedChecks(remoteRemediationReport).filter((check) => check.level === 'blocker' || check.level === 'warn'),
    ...failedChecks(remoteRemediationStrictReport).filter((check) => check.level === 'blocker' || check.level === 'warn'),
  ];
  const remoteRemediationApplyFailures = !remoteRemediationApplyPlan ||
    remoteRemediationApplyPlan.apply !== false ||
    remoteRemediationApplyPlan.status !== 'dry-run-ready' ||
    summary(remoteRemediationApplyPlan).blockers > 0 ||
    summary(remoteRemediationApplyPlan).warnings > 0
    ? [{
        name: 'remote remediation apply dry-run',
        level: 'blocker',
        detail: remoteRemediationApplyPlan
          ? `${remoteRemediationApplyPlan.status || 'missing'}, actions=${remoteRemediationApplyPlan.summary?.actions ?? 'missing'}`
          : 'missing release/github-release-remediation-apply-plan.json',
      }]
    : [];
  const commercialReadyRequired = commercialReadiness?.publishedReleaseReady === true ||
    commercialFinalization?.publishedReleaseReady === true;
  const commercialPublicationFailures = [
    ...(!commercialReadiness
      ? [{
          name: 'commercial release readiness',
          level: 'blocker',
          detail: 'missing release/commercial-release-readiness-report.strict.json',
        }]
      : []),
    ...(!commercialFinalization || summary(commercialFinalization).blockers > 0 || summary(commercialFinalization).warnings > 0
      ? [{
          name: 'commercial finalization',
          level: 'blocker',
          detail: commercialFinalization
            ? `${summary(commercialFinalization).blockers} blocker(s), ${summary(commercialFinalization).warnings} warning(s), commercialReady=${commercialFinalization.commercialReady}`
            : 'missing release/commercial-finalization-report.json',
        }]
      : []),
    ...(!commercialFinalizationVerification || summary(commercialFinalizationVerification).blockers > 0 || summary(commercialFinalizationVerification).warnings > 0
      ? [{
          name: 'commercial finalization verification',
          level: 'blocker',
          detail: commercialFinalizationVerification
            ? `${summary(commercialFinalizationVerification).blockers} blocker(s), ${summary(commercialFinalizationVerification).warnings} warning(s)`
            : 'missing release/commercial-finalization-report-verification.strict.json',
        }]
      : []),
    ...(commercialReadyRequired && (
      summary(commercialReadiness).blockers > 0 ||
      summary(commercialReadiness).warnings > 0 ||
      commercialReadiness?.commercialReady !== true ||
      commercialFinalization?.commercialReady !== true
    )
      ? [{
          name: 'published commercial readiness',
          level: 'blocker',
          detail: `publishedReleaseReady=true requires commercial readiness to be clean and commercialReady=true; readiness=${summary(commercialReadiness).blockers}/${summary(commercialReadiness).warnings}/${commercialReadiness?.commercialReady}, finalization=${commercialFinalization?.commercialReady}`,
        }]
      : []),
  ];

  const unblockGroups = [
    group({
      id: 'baseline-artifact',
      title: 'Baseline artifact URL and checksum',
      ok: baselineFailures.length === 0,
      detail: baselineFailures.length ? unique(detailsFrom(baselineFailures)) : ['Baseline artifact settings and baseline freshness report are clean.'],
      requiredInputs: [
        'CONNECT_AI_BASELINE_URL: reachable https .zip URL for the current Connect-AI-0.4.8 arm64 mac package',
        'CONNECT_AI_BASELINE_SHA256: 64 hex SHA-256 of that zip',
        'CONNECT_AI_BASELINE_TOKEN: only when the baseline URL is private',
        'release/baseline-export-report.json: ok true, with export.sha256 copied to baseline SHA variables',
        'release/baseline-freshness-report.json: ok true',
      ],
      commands: [
        command('Export the current baseline app as an uploadable ZIP', 'npm run release:baseline-export'),
        command('Calculate a local baseline zip SHA-256', 'shasum -a 256 release/Connect-AI-0.4.8-baseline-arm64-mac.zip'),
	        command('Set GitHub baseline variables only after remote baseline guard approval', guardedBaselineVariableCommand(baselineUrlCandidate, baselineSha)),
        command('Set optional private baseline token', 'gh secret set CONNECT_AI_BASELINE_TOKEN'),
        command('Refresh baseline freshness report', 'npm run release:baseline-freshness:strict:report'),
      ],
      verification: [
        command('Require clean baseline export evidence', 'npm run release:baseline-export'),
        command('Require fresh baseline evidence', 'npm run release:baseline-freshness:strict'),
        command('Verify release env contract drift', 'npm run verify:release-env-contract'),
        command('Regression-test release env shape validation', 'npm run verify:release-env-validation'),
        command('Check process env in CI or exported shell', 'npm run release:env-check:process:strict:report'),
        command('Check GitHub repository readiness', 'npm run release:operator-checklist:github:strict:report'),
      ],
      sourceReports: ['release/baseline-export-report.json', 'release/baseline-freshness-report.json', 'release/release-env-contract-report.json', 'release/release-env-report.process.json', 'release/github-release-setup-report.json', 'release/operator-readiness.github.json'],
    }),
    group({
      id: 'remote-baseline-url-guard',
      title: 'Remote baseline URL guard',
      owner: 'engineering',
      phase: 'local',
      ok: remoteBaselineGuard.ok,
      detail: remoteBaselineGuard.detail,
      requiredInputs: [
        'release/release-credential-handoff.json remoteBaselineCandidate',
        'release/release-setup-plan.json remoteBaselineCandidate and safety rule',
        'release/Connect-AI-0.4.8-baseline-arm64-mac.zip SHA-256 must match any candidate baseline URL before use',
      ],
      commands: [
        command('Refresh credential handoff remote baseline candidate', 'npm run release:credential-handoff'),
        command('Refresh release setup plan remote baseline guard', 'npm run release:setup-plan'),
      ],
      verification: [
        command('Verify credential handoff remote baseline candidate', 'npm run verify:credential-handoff:strict:report'),
        command('Verify release setup plan remote baseline guard', 'npm run verify:setup-plan:strict:report'),
      ],
      sourceReports: [
        'release/release-credential-handoff.json',
        'release/release-credential-handoff-report.strict.json',
        'release/release-setup-plan.json',
        'release/release-setup-plan-report.strict.json',
      ],
    }),
    group({
      id: 'github-audit-token-permissions',
      title: 'GitHub readiness audit token permissions',
      ok: auditTokenFailures.length === 0,
      detail: auditTokenFailures.length ? unique(detailsFrom(auditTokenFailures)) : ['GitHub variable and secret names are readable.'],
      requiredInputs: [
        'CONNECT_AI_RELEASE_AUDIT_TOKEN or GH_TOKEN',
        'Fine-grained token permissions: Metadata read, Contents read, Actions variables read, Actions secrets read',
      ],
      commands: [
        command('Set GitHub readiness audit token', 'gh secret set CONNECT_AI_RELEASE_AUDIT_TOKEN'),
        command('Run GitHub readiness report', 'npm run release:operator-checklist:github:strict:report'),
      ],
      verification: [
        command('Require clean GitHub readiness', 'npm run release:operator-checklist:github:strict'),
      ],
      sourceReports: ['release/operator-readiness.github.json', 'release/github-release-setup-report.json'],
    }),
    group({
      id: 'developer-id-certificate',
      title: 'Developer ID Application certificate',
      ok: signingFailures.length === 0,
      detail: signingFailures.length ? unique(detailsFrom(signingFailures)) : ['Developer ID Application signing inputs are ready.'],
      requiredInputs: [
        'BUILD_CERTIFICATE_PATH or BUILD_CERTIFICATE_BASE64 (single-line decodable base64 for CI)',
        'P12_PASSWORD',
        'KEYCHAIN_PASSWORD',
      ],
      commands: [
        command('Create CI-safe p12 base64', "base64 -i /absolute/path/DeveloperIDApplication.p12 | tr -d '\\n'"),
        command('Set GitHub signing secrets', "base64 -i /absolute/path/DeveloperIDApplication.p12 | tr -d '\\n' | gh secret set BUILD_CERTIFICATE_BASE64\ngh secret set P12_PASSWORD\ngh secret set KEYCHAIN_PASSWORD"),
        command('Import local signing material from .env.release.local', 'npm run signing:import:env'),
      ],
      verification: [
        command('Check signing readiness without printing values', 'npm run signing:check:report:env'),
        command('Check keychain identity', '/usr/bin/security find-identity -v -p codesigning'),
      ],
      sourceReports: ['release/signing-readiness.json', 'release/operator-readiness.github.json'],
    }),
    group({
      id: 'notarization-credentials',
      title: 'Apple notarization credentials',
      ok: notarizationFailures.length === 0,
      detail: notarizationFailures.length ? unique(detailsFrom(notarizationFailures)) : ['One notarization credential group is ready.'],
      requiredInputs: [
        'Preferred CI group: APPLE_API_KEY_BASE64 (single-line decodable base64) + APPLE_API_KEY_ID + APPLE_API_ISSUER',
        'Alternative CI group: APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID',
        'Local-only group: APPLE_KEYCHAIN_PROFILE',
      ],
      commands: [
        command('Create CI-safe App Store Connect API key base64', "base64 -i /absolute/path/AuthKey_KEYID.p8 | tr -d '\\n'"),
        command('Set preferred App Store Connect API key secrets', "base64 -i /absolute/path/AuthKey_KEYID.p8 | tr -d '\\n' | gh secret set APPLE_API_KEY_BASE64\ngh secret set APPLE_API_KEY_ID\ngh secret set APPLE_API_ISSUER"),
        command('Or set Apple ID notarization secrets', 'gh secret set APPLE_ID\ngh secret set APPLE_APP_SPECIFIC_PASSWORD\ngh secret set APPLE_TEAM_ID'),
        command('Store local notarytool profile from .env.release.local', 'npm run signing:notary-profile:report:env'),
      ],
      verification: [
        command('Check signing and notarization inputs', 'npm run signing:check:report:env'),
        command('Run strict release env check', 'npm run release:env-check:strict:report'),
      ],
      sourceReports: ['release/signing-readiness.json', 'release/release-env-report.process.json'],
    }),
    group({
      id: 'github-actions-release-inputs',
      title: 'GitHub Actions release variables and secrets',
      ok: githubActionsFailures.length === 0,
      detail: githubActionsFailures.length ? unique(detailsFrom(githubActionsFailures)) : ['GitHub Actions variables and secret names are configured and readable.'],
      requiredInputs: [
        'Repository variables: CONNECT_AI_BASELINE_URL, CONNECT_AI_BASELINE_SHA256',
        'Repository secrets: CONNECT_AI_RELEASE_AUDIT_TOKEN, BUILD_CERTIFICATE_BASE64, P12_PASSWORD, KEYCHAIN_PASSWORD',
        'One complete notarization secret group',
      ],
      commands: [
        command('Dry-run repository setup from local release env', 'npm run release:github-setup'),
        command('Apply repository setup after reviewing dry-run', 'npm run release:github-setup:apply'),
        command('Re-run GitHub strict readiness', 'npm run release:operator-checklist:github:strict'),
      ],
      verification: [
        command('Run process-env production runbook report in CI', 'npm run release:operator-runbook:process:strict:report'),
      ],
      sourceReports: ['release/github-release-setup-report.json', 'release/operator-readiness.github.json'],
    }),
    group({
      id: 'github-release-upload-permission',
      title: 'GitHub Release upload permission',
      phase: 'publication',
      ok: remoteUploadPermission.ok,
      detail: remoteUploadPermission.ok
        ? ['GitHub CLI can upload release assets or no remote remediation upload is required.', ...remoteUploadPermission.detail]
        : remoteUploadPermission.detail,
      requiredInputs: [
        'GitHub CLI authenticated as a repository collaborator with write, maintain, or admin permission',
        'Token scope/permission that allows reading the release and uploading/deleting GitHub Release assets',
        'release/github-release-remediation-apply-plan.json github.canUploadReleaseAssets true when actions > 0',
      ],
      commands: [
        command('Confirm current GitHub CLI account and repository permission', 'gh auth status\ngh repo view wonseokjung/connect-ai --json viewerPermission,url'),
        command('Authenticate with a release-capable token if permission is read-only', 'gh auth login --hostname github.com --scopes repo,workflow'),
        command('Refresh remote remediation upload permission diagnostics', 'npm run release:github-release-remediation-apply:plan'),
        command('Verify upload permission diagnostics before publication', 'npm run verify:github-release-remediation-apply-plan:strict:report'),
      ],
      verification: [
        command('Require upload-capable remediation apply dry-run', 'npm run release:github-release-remediation-apply:plan\nnpm run verify:github-release-remediation-apply-plan:strict:report'),
        command('Require commercial release readiness to acknowledge upload permission', 'npm run verify:commercial-release:strict:report'),
      ],
      sourceReports: [
        'release/github-release-remediation-apply-plan.json',
        'release/github-release-remediation-apply-plan-report.strict.json',
        'release/commercial-release-readiness-report.strict.json',
      ],
    }),
    group({
      id: 'signed-notarized-release-build',
      title: 'Signed and notarized release build',
      ok: decision?.productionReady === true && promotion?.productionReady === true,
      detail: promotionFailures.length ? unique(detailsFrom(promotionFailures)) : ['Strict decision and promotion plan are production-ready.'],
      requiredInputs: [
        'All signing and notarization inputs are available',
        'RELEASE_NOTES.md status becomes signed-and-notarized',
        'release-decision.strict.json and release-promotion-plan.json have productionReady true',
      ],
      commands: [
        command('Run the guarded local release sequence', 'npm run release:operator-runbook:apply'),
        command('Or run the guarded process-env release sequence', 'npm run release:operator-runbook:process:apply'),
        command('Refresh final readiness, publication seal, and manifest reports', 'npm run release:publish-assets:plan:env\nnpm run verify:github-release-publish-plan:strict:report\nnpm run release:readiness-summary:strict:report\nnpm run release:unblock-plan\nnpm run verify:unblock-plan:strict\nnpm run release:publication-seal:strict:report\nnpm run release:setup-plan\nnpm run release:asset-manifest\nnpm run verify:asset-manifest:strict'),
      ],
      verification: [
        command('Verify release evidence', 'npm run verify:release:env'),
        command('Confirm production readiness summary', 'npm run release:readiness-summary:strict'),
        command('Confirm publication seal production gate', 'npm run verify:publication-seal:production'),
      ],
      sourceReports: ['release/release-decision.strict.json', 'release/release-promotion-plan.json', 'release/production-readiness-summary.json', 'release/release-manifest.json', 'release/baseline-freshness-report.json', 'release/release-publication-seal.json'],
    }),
    group({
      id: 'publish-and-remote-asset-verification',
      title: 'Publish and remote GitHub Release asset verification',
      phase: 'publication',
      ok: publishPlan &&
        summary(publishPlan).blockers === 0 &&
        remoteAssets &&
        summary(remoteAssets).blockers === 0 &&
        remoteRemediationFailures.length === 0 &&
        remoteRemediationApplyFailures.length === 0 &&
        commercialPublicationFailures.length === 0,
      detail: remoteFailures.length || remoteRemediationFailures.length || remoteRemediationApplyFailures.length || commercialPublicationFailures.length
        ? unique([
            ...detailsFrom(remoteFailures).slice(0, 20),
            ...detailsFrom(remoteRemediationFailures).slice(0, 20),
            ...detailsFrom(remoteRemediationApplyFailures).slice(0, 5),
            ...detailsFrom(commercialPublicationFailures).slice(0, 5),
            ...remoteRemediationDetails(remoteAssets),
            remoteRemediationPlan ? `remediation plan: ${remoteRemediationPlan.status}, required=${remoteRemediationPlan.summary?.requiredActions}, advisory=${remoteRemediationPlan.summary?.advisoryReviews}` : null,
            remoteRemediationApplyPlan ? `remote remediation apply dry-run: ${remoteRemediationApplyPlan.status}, actions=${remoteRemediationApplyPlan.summary?.actions}` : null,
            commercialFinalization ? `commercial finalization: ${commercialFinalization.status}, commercialReady=${commercialFinalization.commercialReady}` : null,
          ])
        : ['Publish plan, remote release assets, remediation plan verification, and commercial finalization are clean.'],
      requiredInputs: [
        'productionReady true in strict decision, promotion plan, production readiness summary, and publication seal',
        'GitHub Release tag desktop-v0.4.8',
        'GitHub CLI token with release upload permission',
      ],
      commands: [
        command('Generate publish plan', 'npm run release:publish-assets:plan:env'),
        command('Verify publish plan', 'npm run verify:github-release-publish-plan:strict:report'),
        command('Publish only after all production gates are true', 'npm run release:operator-runbook:publish'),
        command('Verify remote GitHub Release assets', 'npm run verify:github-release-assets:strict:env'),
        command('Write required remote remediation commands as an artifact', 'npm run release:github-release-remediation-plan\nnpm run verify:github-release-remediation-plan:strict:report'),
        command('Dry-run remote remediation apply against the local manifest', 'npm run release:github-release-remediation-apply:plan'),
        command('Verify remote remediation apply dry-run', 'npm run verify:github-release-remediation-apply-plan:strict:report'),
        command('Apply remote remediation after production gates are clean', 'npm run release:github-release-remediation-apply:env'),
        command('Refresh publication seal after remote verification', 'npm run release:publication-seal:strict:report'),
        command('Finalize commercial readiness after publication verification', 'npm run release:commercial-finalize:commercial'),
      ],
      verification: [
        command('Re-run production readiness summary after publication', 'npm run release:readiness-summary:strict:report'),
        command('Re-run remote remediation apply dry-run before upload', 'npm run release:github-release-remediation-apply:plan'),
        command('Re-run remote remediation apply dry-run verification before upload', 'npm run verify:github-release-remediation-apply-plan:strict:report'),
        command('Require commercial readiness after publication verification', 'npm run verify:commercial-finalization:commercial'),
      ],
      sourceReports: [
        'release/github-release-publish-plan.json',
        'release/github-release-publish-plan-report.strict.json',
        remoteAssetsPath,
        'release/github-release-remediation-plan.json',
        'release/github-release-remediation-plan-report.json',
        'release/github-release-remediation-plan-report.strict.json',
        'release/github-release-remediation-apply-plan.json',
        'release/github-release-remediation-apply-plan-report.strict.json',
        'release/commercial-release-readiness-report.strict.json',
        'release/commercial-finalization-report.json',
        'release/commercial-finalization-report-verification.strict.json',
      ],
    }),
  ];

  const blockers = unblockGroups.filter((item) => !item.ok && item.blocking).length;
  const warnings = unblockGroups.filter((item) => !item.ok && !item.blocking).length;
  const status = readiness?.productionReady
    ? 'production-ready'
    : readiness?.localCandidateReady
      ? 'local-candidate-awaiting-external-unblock'
      : 'not-ready';

  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    productionReady: Boolean(readiness?.productionReady),
    localCandidateReady: Boolean(readiness?.localCandidateReady),
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
    },
    summary: {
      blockers,
      warnings,
      groups: unblockGroups.length,
      remoteBaselineGuardVerified: remoteBaselineGuard.ok,
    },
    recommendedOrder: unblockGroups.map((item, index) => ({
      index: index + 1,
      id: item.id,
      title: item.title,
      status: item.status,
    })),
    unblockGroups,
    sourceReports: [
      reportState('production readiness summary', 'release/production-readiness-summary.json'),
      reportState('strict release decision', 'release/release-decision.strict.json'),
      reportState('release promotion plan', 'release/release-promotion-plan.json'),
      reportState('release env contract', 'release/release-env-contract-report.json'),
      reportState('process release env', 'release/release-env-report.process.json'),
      reportState('signing readiness', 'release/signing-readiness.json'),
      reportState('GitHub setup report', 'release/github-release-setup-report.json'),
      reportState('GitHub operator readiness', 'release/operator-readiness.github.json'),
      reportState('GitHub Release publish plan', 'release/github-release-publish-plan.json'),
      reportState('GitHub Release publish plan verification', 'release/github-release-publish-plan-report.strict.json'),
      reportState('GitHub Release remote assets', remoteAssetsPath),
      reportState('GitHub Release remediation plan', 'release/github-release-remediation-plan.json'),
      reportState('GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.json'),
      reportState('strict GitHub Release remediation plan report', 'release/github-release-remediation-plan-report.strict.json'),
      reportState('GitHub Release remediation apply dry-run plan', 'release/github-release-remediation-apply-plan.json'),
      reportState('GitHub Release remediation apply dry-run verification', 'release/github-release-remediation-apply-plan-report.strict.json'),
      reportState('commercial release readiness', 'release/commercial-release-readiness-report.strict.json'),
      reportState('commercial finalization', 'release/commercial-finalization-report.json'),
      reportState('commercial finalization verification', 'release/commercial-finalization-report-verification.strict.json'),
      reportState('release manifest', 'release/release-manifest.json'),
      reportState('baseline export report', 'release/baseline-export-report.json'),
      reportState('baseline freshness report', 'release/baseline-freshness-report.json'),
      reportState('release credential handoff', 'release/release-credential-handoff.json'),
      reportState('release credential handoff verification', 'release/release-credential-handoff-report.strict.json'),
      reportState('release setup plan', 'release/release-setup-plan.json'),
      reportState('release setup plan verification', 'release/release-setup-plan-report.strict.json'),
      reportState('release publication seal', 'release/release-publication-seal.json'),
    ],
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(plan));
  console.log(`Connect AI release unblock plan: ${status}`);
  console.log(`Summary: ${blockers} blocker group(s), ${warnings} warning group(s)`);
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
}

main();
