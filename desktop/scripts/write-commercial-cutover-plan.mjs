import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const jsonPath = path.join(releaseDir, 'commercial-cutover-plan.json');
const markdownPath = path.join(releaseDir, 'COMMERCIAL_CUTOVER_PLAN.md');

const sourceDefinitions = [
  ['engineering readiness', 'release/engineering-readiness-report.json'],
  ['production readiness', 'release/production-readiness-summary.json'],
  ['publication seal', 'release/release-publication-seal.json'],
  ['credential handoff', 'release/release-credential-handoff.json'],
  ['credential handoff verification', 'release/release-credential-handoff-report.strict.json'],
  ['release env bootstrap', 'release/release-env-bootstrap.json'],
  ['release env bootstrap verification', 'release/release-env-bootstrap-report.strict.json'],
  ['unblock plan', 'release/release-unblock-plan.json'],
  ['unblock plan verification', 'release/release-unblock-plan-report.strict.json'],
  ['GitHub Release remediation plan', 'release/github-release-remediation-plan.json'],
  ['GitHub Release remediation verification', 'release/github-release-remediation-plan-report.strict.json'],
  ['GitHub Release remediation apply dry-run plan', 'release/github-release-remediation-apply-plan.json'],
  ['GitHub Release remediation apply dry-run verification', 'release/github-release-remediation-apply-plan-report.strict.json'],
  ['GitHub Release asset report', 'release/github-release-assets-report.strict.json'],
  ['GitHub Release publish plan', 'release/github-release-publish-plan.json'],
  ['GitHub Release publish plan verification', 'release/github-release-publish-plan-report.strict.json'],
  ['release setup plan', 'release/release-setup-plan.json'],
  ['release setup plan verification', 'release/release-setup-plan-report.strict.json'],
  ['remote baseline approval', 'release/remote-baseline-approval-report.strict.json'],
  ['production release runbook', 'release/production-release-runbook-report.json'],
  ['production release runbook verification', 'release/production-release-runbook-report-verification.strict.json'],
  ['release decision', 'release/release-decision.strict.json'],
  ['release promotion plan', 'release/release-promotion-plan.json'],
  ['release asset manifest', 'release/release-asset-manifest.json'],
  ['asset manifest verification', 'release/asset-manifest-report.json'],
  ['status refresh', 'release/status-refresh-report.json'],
  ['status refresh verification', 'release/status-refresh-report-verification.strict.json'],
  ['local preflight', 'release/preflight-report.json'],
  ['strict preflight', 'release/preflight-report.strict.json'],
  ['baseline export', 'release/baseline-export-report.json'],
  ['baseline export verification', 'release/baseline-export-report-verification.strict.json'],
  ['baseline freshness', 'release/baseline-freshness-report.json'],
  ['release environment process report', 'release/release-env-report.process.json'],
  ['signing readiness', 'release/signing-readiness.json'],
  ['GitHub operator readiness', 'release/operator-readiness.github.json'],
];

function readJson(relativePath, required = false) {
  const file = path.join(desktopDir, relativePath);
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

function summary(report) {
  if (!report || report.parseError) return null;
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
}

function statusText(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(statusText).filter(Boolean).join(', ') || null;
  if (typeof value === 'object') {
    const parts = Object.entries(value)
      .map(([key, inner]) => {
        const rendered = statusText(inner);
        return rendered ? `${key}=${rendered}` : null;
      })
      .filter(Boolean);
    return parts.join(', ') || JSON.stringify(value);
  }
  return String(value);
}

function reportEntry(label, relativePath) {
  const report = readJson(relativePath);
  return {
    label,
    path: relativePath,
    present: Boolean(report),
    generatedAt: report?.generatedAt || null,
    status: statusText(report?.status),
    strict: report?.strict ?? null,
    ok: report?.ok ?? null,
    engineeringReady: report?.engineeringReady ?? null,
    localCandidateReady: report?.localCandidateReady ?? null,
    productionReady: report?.productionReady ?? null,
    publishedReleaseReady: report?.publishedReleaseReady ?? null,
    summary: summary(report),
    parseError: report?.parseError || null,
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function command(step, commandText, note = '') {
  return { step, command: commandText, note };
}

function assetManifestProductionStatus(manifest) {
  return statusText(manifest?.productionStatus) || statusText(manifest?.status) || 'missing';
}

function gateStatus(ok, blocking = true) {
  if (ok) return 'ready';
  return blocking ? 'blocked' : 'waiting';
}

function commandText(commands) {
  return (Array.isArray(commands) ? commands : [])
    .map((item) => `${item.step || ''}\n${item.command || ''}`)
    .join('\n');
}

function cleanStrictReport(report) {
  const value = summary(report);
  return Boolean(report && !report.parseError && value?.blockers === 0 && value?.warnings === 0);
}

function remoteBaselineGuardEvidence(setupPlan, credentialHandoff, setupVerification, credentialVerification, approvalReport) {
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
  const approvalCounts = summary(approvalReport) || { blockers: 0, warnings: 0 };
  const approvalReportCaptured = Boolean(
    approvalReport &&
      !approvalReport.parseError &&
      (
        (approvalReport.approvedForBaselineUrl === true &&
          approvalReport.status === 'approved-for-baseline-url' &&
          approvalCounts.blockers === 0 &&
          approvalCounts.warnings === 0) ||
        (approvalReport.approvedForBaselineUrl !== true &&
          approvalReport.status === 'not-approved-for-baseline-url' &&
          approvalCounts.blockers > 0 &&
          approvalCounts.warnings === 0)
      )
  );
  const approvalReady = Boolean(
    approvalReportCaptured &&
      approvalReport.approvedForBaselineUrl === true &&
      approvalReport.status === 'approved-for-baseline-url' &&
      approvalCounts.blockers === 0 &&
      approvalCounts.warnings === 0
  );
  return {
    ok,
    status,
    asset: candidate.asset || null,
    remoteBytes: candidate.remoteBytes ?? null,
    expectedBaselineBytes: candidate.expectedBaselineBytes ?? null,
    expectedBaselineSha256: expectedSha || null,
    approvalStatus: approvalReport?.status || null,
    approvedForBaselineUrl: approvalReport?.approvedForBaselineUrl ?? null,
    approvalReportCaptured,
    approvalReady,
    approvalBlockers: approvalCounts.blockers,
    approvalWarnings: approvalCounts.warnings,
    setupVerified,
    credentialHandoffVerified: handoffVerified,
    validationDocumented,
    safetyRuleDocumented,
  };
}

function statusRefreshVerificationAcceptable(report) {
  if (!report || report.parseError || report.strict !== true) return false;
  const failed = (report.checks || []).filter((check) => check.ok !== true);
  return failed.every((check) => check.name === 'status refresh report clean commercial cutover');
}

function deriveStatus({ engineeringReady, productionReady, publishedReleaseReady, localCandidateReady }) {
  if (publishedReleaseReady) return 'published-commercial-ready';
  if (productionReady) return 'production-ready-awaiting-publication';
  if (engineeringReady) return 'engineering-ready-awaiting-commercial-cutover';
  if (localCandidateReady) return 'local-candidate-awaiting-commercial-cutover';
  return 'engineering-gates-incomplete';
}

function groupInputSummary(groups) {
  const localInputs = [];
  const githubVariables = [];
  const githubSecrets = [];
  for (const group of groups) {
    localInputs.push(...asArray(group.localInputs));
    githubVariables.push(...asArray(group.githubVariables));
    githubSecrets.push(...asArray(group.githubSecrets));
  }
  return {
    localInputs: unique(localInputs),
    githubVariables: unique(githubVariables),
    githubSecrets: unique(githubSecrets),
  };
}

function renderCommandList(commands) {
  if (!commands.length) return '- none';
  return commands.map((item, index) => {
    const note = item.note ? `\n   ${item.note}` : '';
    return `${index + 1}. ${item.step}\n\n   \`\`\`sh\n   ${item.command.replace(/\n/g, '\n   ')}\n   \`\`\`${note}`;
  }).join('\n\n');
}

function renderBullets(items) {
  if (!items.length) return '- none';
  return items.map((item) => `- ${item}`).join('\n');
}

function renderMarkdown(plan) {
  const reportLines = plan.sourceReports.map((report) => {
    const counts = report.summary ? `${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)` : 'no summary';
    const status = report.status ? `, status=${report.status}` : '';
    const ready = report.productionReady == null ? '' : `, productionReady=${report.productionReady}`;
    return `- ${report.path}: ${report.present ? 'present' : 'missing'}; ${counts}${status}${ready}`;
  }).join('\n');

  const phaseSections = plan.cutoverPhases.map((phase) => `## ${phase.title}

Status: ${phase.status}
Owner: ${phase.owner}

Current evidence:

${renderBullets(phase.currentEvidence)}

Required inputs:

${renderBullets(phase.requiredInputs)}

Commands:

${renderCommandList(phase.commands)}

Validation:

${renderCommandList(phase.validation)}
`).join('\n');

  const remoteCommands = plan.remoteAssetRemediation.requiredCommands.slice(0, 16).map((item) => `- ${item.asset}

  \`\`\`sh
  ${item.command}
  \`\`\``).join('\n') || '- none';

  return `# Connect AI Commercial Cutover Plan

Generated: ${plan.generatedAt}
Product: ${plan.product.name} ${plan.product.version}
Status: ${plan.status}

## Summary

- Engineering ready: ${plan.summary.engineeringReady}
- Local candidate ready: ${plan.summary.localCandidateReady}
- Production ready: ${plan.summary.productionReady}
- Published release ready: ${plan.summary.publishedReleaseReady}
- Baseline export verified: ${plan.summary.baselineExportVerified}
- Remote baseline guard verified: ${plan.summary.remoteBaselineGuardVerified}
- Remote baseline URL approved: ${plan.summary.remoteBaselineApprovalReady}
- Status refresh verified: ${plan.summary.statusRefreshVerified}
- Blocked credential groups: ${plan.summary.blockedCredentialGroups}
- Blocked unblock groups: ${plan.summary.blockedUnblockGroups} / ${plan.summary.totalUnblockGroups}
- Remote upload permission ready: ${plan.summary.remoteUploadPermissionReady}
- Remote required actions: ${plan.summary.remoteRequiredActions}
- Remote advisory reviews: ${plan.summary.remoteAdvisoryActions}
- External blockers: ${plan.summary.externalBlockers}

## Recommended Sequence

${renderBullets(plan.recommendedSequence.map((item) => `${item.index}. ${item.title} (${item.status})`))}

## Source Reports

${reportLines}

${phaseSections}

## Remote Baseline Guard

- Status: ${plan.remoteBaselineGuard.status}
- Asset: ${plan.remoteBaselineGuard.asset || 'missing'}
- Remote bytes: ${plan.remoteBaselineGuard.remoteBytes ?? 'missing'}
- Expected baseline bytes: ${plan.remoteBaselineGuard.expectedBaselineBytes ?? 'missing'}
- Expected baseline SHA-256: ${plan.remoteBaselineGuard.expectedBaselineSha256 || 'missing'}
- Setup verified: ${plan.remoteBaselineGuard.setupVerified}
- Credential handoff verified: ${plan.remoteBaselineGuard.credentialHandoffVerified}
- Validation documented: ${plan.remoteBaselineGuard.validationDocumented}
- Safety rule documented: ${plan.remoteBaselineGuard.safetyRuleDocumented}

## Remote Asset Remediation Snapshot

- Status: ${plan.remoteAssetRemediation.status}
- Upstream report: \`${plan.remoteAssetRemediation.upstreamAssetReport || 'missing'}\`
- Upload permission: ${plan.remoteAssetRemediation.uploadPermission?.status || 'missing'}; repo=${plan.remoteAssetRemediation.uploadPermission?.repo || 'missing'}; viewerPermission=${plan.remoteAssetRemediation.uploadPermission?.viewerPermission || 'missing'}; canUploadReleaseAssets=${plan.remoteAssetRemediation.uploadPermission?.canUploadReleaseAssets ?? 'missing'}
- Required actions: ${plan.remoteAssetRemediation.requiredActions}
- Advisory reviews: ${plan.remoteAssetRemediation.advisoryActions}

${remoteCommands}

## Safety Rules

${renderBullets(plan.safetyRules)}
`;
}

function main() {
  const pkg = readJson('package.json', true);
  const engineering = readJson('release/engineering-readiness-report.json');
  const readiness = readJson('release/production-readiness-summary.json');
  const seal = readJson('release/release-publication-seal.json');
  const credential = readJson('release/release-credential-handoff.json');
  const credentialVerification = readJson('release/release-credential-handoff-report.strict.json');
  const unblock = readJson('release/release-unblock-plan.json');
  const remediation = readJson('release/github-release-remediation-plan.json');
  const remediationApplyPlan = readJson('release/github-release-remediation-apply-plan.json');
  const remediationApplyVerification = readJson('release/github-release-remediation-apply-plan-report.strict.json');
  const assetManifest = readJson('release/release-asset-manifest.json');
  const baselineExportVerification = readJson('release/baseline-export-report-verification.strict.json');
  const statusRefreshVerification = readJson('release/status-refresh-report-verification.strict.json');
  const releaseSetup = readJson('release/release-setup-plan.json');
  const releaseSetupVerification = readJson('release/release-setup-plan-report.strict.json');
  const remoteBaselineApproval = readJson('release/remote-baseline-approval-report.strict.json');

  const credentialGroups = Array.isArray(credential?.credentialGroups) ? credential.credentialGroups : [];
  const blockedCredentialGroups = credentialGroups.filter((group) => group.status !== 'ready');
  const unblockGroups = Array.isArray(unblock?.unblockGroups) ? unblock.unblockGroups : [];
  const blockedUnblockGroups = unblockGroups.filter((group) => group.ok !== true && group.blocking !== false);
  const uploadPermission = credential?.githubReleaseUploadPermission || {};
  const remoteUploadPermissionReady = Boolean(
    uploadPermission.status === 'ready' ||
      Number(remediationApplyPlan?.summary?.actions || 0) === 0 ||
      remediationApplyPlan?.github?.canUploadReleaseAssets === true
  );
  const inputSummary = groupInputSummary(blockedCredentialGroups.length ? blockedCredentialGroups : credentialGroups);
  const requiredRemoteCommands = Array.isArray(credential?.remoteAssetRemediation?.requiredCommands)
    ? credential.remoteAssetRemediation.requiredCommands
    : Array.isArray(remediation?.requiredActions)
      ? remediation.requiredActions.map((action) => ({
        asset: action.asset,
        reasons: asArray(action.reasons),
        command: action.command,
      }))
      : [];

  const engineeringReady = engineering?.engineeringReady === true && Number(engineering?.summary?.blockers || 0) === 0;
  const localCandidateReady = engineering?.localCandidateReady === true || readiness?.localCandidateReady === true;
  const productionReady = readiness?.productionReady === true && seal?.productionReady === true;
  const publishedReleaseReady = readiness?.publishedReleaseReady === true && seal?.publishedReleaseReady === true;
  const baselineExportVerified = baselineExportVerification?.strict === true &&
    summary(baselineExportVerification)?.blockers === 0 &&
    summary(baselineExportVerification)?.warnings === 0;
  const statusRefreshVerified = statusRefreshVerificationAcceptable(statusRefreshVerification);
  const remoteBaselineGuard = remoteBaselineGuardEvidence(releaseSetup, credential, releaseSetupVerification, credentialVerification, remoteBaselineApproval);
  const status = deriveStatus({ engineeringReady, productionReady, publishedReleaseReady, localCandidateReady });

  const engineeringEvidence = [
    `engineering readiness status: ${engineering?.status || 'missing'}`,
    `engineering blockers: ${Number(engineering?.summary?.blockers || 0)}`,
    `engineering warnings: ${Number(engineering?.summary?.warnings || 0)}`,
    `local candidate ready: ${localCandidateReady}`,
    `baseline export verified: ${baselineExportVerified}`,
    `status refresh verified: ${statusRefreshVerified}`,
  ];

  const credentialEvidence = blockedCredentialGroups.length
    ? blockedCredentialGroups.map((group) => `${group.title || group.id}: ${asArray(group.currentEvidence).slice(0, 3).join('; ')}`)
    : ['All credential groups are ready in release/release-credential-handoff.json.'];
  credentialEvidence.push(
    `remote baseline guard: status=${remoteBaselineGuard.status}, asset=${remoteBaselineGuard.asset || 'missing'}, verified=${remoteBaselineGuard.ok}`,
    `remote baseline approval: status=${remoteBaselineGuard.approvalStatus || 'missing'}, approved=${remoteBaselineGuard.approvedForBaselineUrl}, blockers=${remoteBaselineGuard.approvalBlockers}`,
  );

  const signingEvidence = [
    `production readiness status: ${readiness?.status || 'missing'}`,
    `production readiness blockers: ${Number(readiness?.summary?.blockers || 0)}`,
    `publication seal status: ${seal?.status || 'missing'}`,
    `publication seal productionReady: ${seal?.productionReady === true}`,
  ];

  const remoteEvidence = [
    `remediation status: ${credential?.remoteAssetRemediation?.status || remediation?.status || 'missing'}`,
    `upload permission: status=${uploadPermission.status || 'missing'}, repo=${uploadPermission.repo || remediationApplyPlan?.github?.repo || 'missing'}, viewerPermission=${uploadPermission.viewerPermission || remediationApplyPlan?.github?.viewerPermission || 'missing'}, canUploadReleaseAssets=${uploadPermission.canUploadReleaseAssets ?? remediationApplyPlan?.github?.canUploadReleaseAssets ?? 'missing'}, ready=${remoteUploadPermissionReady}`,
    `required actions: ${Number(credential?.remoteAssetRemediation?.requiredActions ?? remediation?.summary?.requiredActions ?? 0)}`,
    `advisory reviews: ${Number(credential?.remoteAssetRemediation?.advisoryActions ?? remediation?.summary?.advisoryReviews ?? 0)}`,
    `remediation apply dry-run: ${remediationApplyPlan?.status || 'missing'}, actions=${remediationApplyPlan?.summary?.actions ?? 'missing'}`,
    `asset manifest production status: ${assetManifestProductionStatus(assetManifest)}`,
  ];

  const cutoverPhases = [
    {
      id: 'engineering-candidate-freeze',
      title: 'Engineering Candidate Freeze',
      owner: 'engineering',
      ok: engineeringReady,
      status: gateStatus(engineeringReady),
      currentEvidence: engineeringEvidence,
      requiredInputs: [],
      commands: [
        command('Refresh all local release diagnostics', 'npm run release:status-refresh'),
        command('Refresh the engineering readiness summary', 'npm run release:engineering-readiness'),
      ],
      validation: [
        command('Verify status refresh convergence report', 'npm run verify:status-refresh-report:strict:report'),
        command('Verify local preflight', 'npm run release:preflight'),
        command('Verify final asset manifest policy', 'npm run verify:asset-manifest'),
      ],
    },
    {
      id: 'external-credential-handoff',
      title: 'External Credential Handoff',
      owner: 'operator',
      ok: blockedCredentialGroups.length === 0,
      status: gateStatus(blockedCredentialGroups.length === 0),
      currentEvidence: credentialEvidence,
      requiredInputs: [
        ...inputSummary.localInputs,
        ...inputSummary.githubVariables.map((item) => `GitHub variable: ${item}`),
        ...inputSummary.githubSecrets.map((item) => `GitHub secret: ${item}`),
      ],
      commands: asArray(credential?.operatorSequence).slice(0, 10),
      validation: [
        command('Verify credential handoff consistency', 'npm run verify:credential-handoff:strict:report'),
        command('Verify release setup plan and remote baseline guard', 'npm run verify:setup-plan:strict:report'),
        command('Verify GitHub operator readiness using release env', 'npm run release:operator-checklist:github:strict:report:env'),
        command('Validate signing and notarization inputs', 'npm run signing:check:report:env'),
      ],
    },
    {
      id: 'signed-notarized-production-build',
      title: 'Signed And Notarized Production Build',
      owner: 'operator',
      ok: productionReady,
      status: gateStatus(productionReady),
      currentEvidence: signingEvidence,
      requiredInputs: blockedUnblockGroups.flatMap((group) => asArray(group.requiredInputs)).slice(0, 24),
      commands: [
        command('Run the guarded production release sequence from process env', 'npm run release:operator-runbook:process:apply'),
        command('Run strict release verification with release env', 'npm run verify:release:env'),
        command('Refresh production readiness after signed build', 'npm run release:readiness-summary:strict:report'),
        command('Refresh publication seal after signed build', 'npm run release:publication-seal:strict:report'),
      ],
      validation: [
        command('Verify production readiness summary', 'npm run verify:readiness-summary-report:strict:report'),
        command('Verify publication seal production gate', 'npm run verify:publication-seal:production'),
      ],
    },
    {
      id: 'remote-release-asset-remediation',
      title: 'Remote Release Asset Remediation',
      owner: 'operator',
      ok: Number(credential?.remoteAssetRemediation?.requiredActions ?? remediation?.summary?.requiredActions ?? 0) === 0,
      status: gateStatus(Number(credential?.remoteAssetRemediation?.requiredActions ?? remediation?.summary?.requiredActions ?? 0) === 0),
      currentEvidence: remoteEvidence,
      requiredInputs: ['GitHub token with Release asset upload permission', 'Local release/ files matching release/release-asset-manifest.json'],
      commands: [
        command('Review exact remote remediation commands', 'cat release/GITHUB_RELEASE_REMEDIATION_PLAN.md'),
        command('Dry-run remote remediation apply against the local manifest', 'npm run release:github-release-remediation-apply:plan'),
        command('Apply remote remediation after production gates are clean', 'npm run release:github-release-remediation-apply:env'),
      ],
      validation: [
        command('Refresh dry-run apply plan before upload', 'npm run release:github-release-remediation-apply:plan'),
        command('Verify remote GitHub Release assets after remediation', 'npm run verify:github-release-assets:strict:env'),
        command('Refresh remote remediation plan', 'npm run release:github-release-remediation-plan'),
        command('Verify remediation plan is clean', 'npm run verify:github-release-remediation-plan:published'),
      ],
    },
    {
      id: 'published-release-seal',
      title: 'Published Release Seal',
      owner: 'operator',
      ok: publishedReleaseReady,
      status: gateStatus(publishedReleaseReady),
      currentEvidence: [
        `published release ready: ${publishedReleaseReady}`,
        `production ready: ${productionReady}`,
        `readiness publishedReleaseReady: ${readiness?.publishedReleaseReady === true}`,
        `seal publishedReleaseReady: ${seal?.publishedReleaseReady === true}`,
      ],
      requiredInputs: ['productionReady=true across decision, promotion, readiness, and publication seal', 'Remote assets match manifest checksums'],
      commands: [
        command('Publish through the guarded process-env runbook', 'npm run release:operator-runbook:process:publish'),
        command('Or publish manifest-listed assets directly after productionReady is true', `npm run release:publish-assets -- --tag desktop-v${pkg.version}`),
      ],
      validation: [
        command('Verify uploaded GitHub Release assets', 'npm run verify:github-release-assets:strict:env'),
        command('Refresh production readiness after publication', 'npm run release:readiness-summary:strict:report'),
        command('Refresh publication seal after publication', 'npm run release:publication-seal:strict:report'),
        command('Require published-ready publication seal', 'npm run verify:publication-seal:published'),
      ],
    },
  ];

  const sourceReports = sourceDefinitions.map(([label, relativePath]) => reportEntry(label, relativePath));
  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId || null,
    },
    status,
    summary: {
      engineeringReady,
      localCandidateReady,
      productionReady,
      publishedReleaseReady,
      baselineExportVerified,
      remoteBaselineGuardVerified: remoteBaselineGuard.ok,
      remoteBaselineApprovalReady: remoteBaselineGuard.approvalReady,
      statusRefreshVerified,
      blockedCredentialGroups: blockedCredentialGroups.length,
      credentialGroups: credentialGroups.length,
      totalUnblockGroups: unblockGroups.length,
      blockedUnblockGroups: blockedUnblockGroups.length,
      unblockGroups: blockedUnblockGroups.length,
      remoteUploadPermissionReady,
      remoteRequiredActions: Number(credential?.remoteAssetRemediation?.requiredActions ?? remediation?.summary?.requiredActions ?? 0),
      remoteAdvisoryActions: Number(credential?.remoteAssetRemediation?.advisoryActions ?? remediation?.summary?.advisoryReviews ?? 0),
      externalBlockers: Number(engineering?.summary?.externalBlockers || readiness?.summary?.blockers || 0),
      missingSourceReports: sourceReports.filter((report) => !report.present).length,
    },
    recommendedSequence: cutoverPhases.map((phase, index) => ({
      index: index + 1,
      id: phase.id,
      title: phase.title,
      status: phase.status,
      owner: phase.owner,
    })),
    cutoverPhases,
    remoteAssetRemediation: {
      status: credential?.remoteAssetRemediation?.status || remediation?.status || null,
      upstreamAssetReport: credential?.remoteAssetRemediation?.upstreamAssetReport || remediation?.sourceReport || null,
      applyPlanReport: remediationApplyPlan ? 'release/github-release-remediation-apply-plan.json' : null,
      applyPlanVerifierReport: remediationApplyVerification ? 'release/github-release-remediation-apply-plan-report.strict.json' : null,
      applyPlanVerifierSummary: remediationApplyVerification?.summary || null,
      applyPlanStatus: remediationApplyPlan?.status || null,
      applyPlanActions: Number(remediationApplyPlan?.summary?.actions || 0),
      uploadPermission: {
        sourceReport: uploadPermission.sourceReport || (remediationApplyPlan ? 'release/github-release-remediation-apply-plan.json' : null),
        verifierReport: uploadPermission.verifierReport || (remediationApplyVerification ? 'release/github-release-remediation-apply-plan-report.strict.json' : null),
        status: uploadPermission.status || (remoteUploadPermissionReady ? 'ready' : 'missing-or-unverified'),
        repo: uploadPermission.repo || remediationApplyPlan?.github?.repo || null,
        viewerPermission: uploadPermission.viewerPermission || remediationApplyPlan?.github?.viewerPermission || null,
        canReadRelease: uploadPermission.canReadRelease ?? remediationApplyPlan?.github?.canReadRelease ?? null,
        canUploadReleaseAssets: uploadPermission.canUploadReleaseAssets ?? remediationApplyPlan?.github?.canUploadReleaseAssets ?? null,
        actions: Number(uploadPermission.actions ?? remediationApplyPlan?.summary?.actions ?? 0),
      },
      requiredActions: Number(credential?.remoteAssetRemediation?.requiredActions ?? remediation?.summary?.requiredActions ?? 0),
      advisoryActions: Number(credential?.remoteAssetRemediation?.advisoryActions ?? remediation?.summary?.advisoryReviews ?? 0),
      requiredCommands: requiredRemoteCommands,
    },
    remoteBaselineGuard,
    safetyRules: unique([
      ...asArray(credential?.safetyRules),
      'Use release/release-asset-manifest.json as the only allowlist for GitHub Release assets.',
      'Do not publish until productionReady=true and release/RELEASE_NOTES.md is signed-and-notarized.',
      'Do not proceed with commercial cutover until release/baseline-export-report-verification.strict.json is strict and clean.',
      'Do not use any remote same-name Connect AI zip as CONNECT_AI_BASELINE_URL unless its SHA-256 matches release/Connect-AI-0.4.8-baseline-arm64-mac.zip.',
      'Do not proceed with commercial cutover until release/status-refresh-report-verification.strict.json is strict and has no blockers except the commercial-cutover self-check during graph refresh.',
      'This cutover plan must list variable names and commands only, never secret values.',
    ]),
    sourceReports,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(plan));

  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
  console.log(`Status: ${plan.status}`);
  console.log(`Summary: ${plan.summary.blockedCredentialGroups} credential group(s), ${plan.summary.unblockGroups} unblock group(s), ${plan.summary.remoteRequiredActions} remote action(s)`);
}

main();
