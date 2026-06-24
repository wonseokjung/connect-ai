import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const jsonPath = path.join(releaseDir, 'github-release-remediation-plan.json');
const markdownPath = path.join(releaseDir, 'GITHUB_RELEASE_REMEDIATION_PLAN.md');

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

function reportState(label, relativePath, options = {}) {
  const report = readJson(relativePath);
  const state = {
    label,
    path: relativePath,
    present: Boolean(report),
    generatedAt: report?.generatedAt || null,
    strict: report?.strict ?? null,
    status: report?.status || null,
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

function expectedAssetSet(manifest) {
  const assets = [
    ...(manifest?.githubReleaseAssets || []),
    manifest?.manifestFile ? { path: manifest.manifestFile } : null,
  ].filter(Boolean);
  return new Map(assets.map((asset) => [path.basename(asset.path), asset.path]));
}

function releaseTag(pkg, report) {
  return report?.remote?.tag || `desktop-v${pkg?.version || 'unknown'}`;
}

function sourceRemoteReport(inventory) {
  if (inventory.selected) return inventory.selected;

  const strictPath = 'release/github-release-assets-report.strict.json';
  const localPath = 'release/github-release-assets-report.json';
  const strictReport = readJson(strictPath);
  const localReport = readJson(localPath);
  return { report: strictReport || localReport, path: strictReport ? strictPath : localReport ? localPath : null };
}

function actionCommand(action) {
  return (action.commands || [])[0] || '';
}

function requiredAction(action, expectedAssets) {
  return {
    id: action.id || `upload-or-replace-asset:${action.asset}`,
    asset: action.asset,
    localPath: action.localPath || expectedAssets.get(action.asset) || null,
    expectedManifestPath: expectedAssets.get(action.asset) || null,
    expectedBytes: action.expectedBytes ?? null,
    remoteBytes: action.remoteBytes ?? null,
    remoteUrl: action.remoteUrl || null,
    reasons: action.reasons || [],
    command: actionCommand(action),
  };
}

function advisoryReview(action) {
  return {
    id: action.id || `review-extra:${action.asset}`,
    asset: action.asset,
    remoteBytes: action.remoteBytes ?? null,
    remoteUrl: action.remoteUrl || null,
    reasons: action.reasons || [],
    suggestedCommand: actionCommand(action),
  };
}

function renderCommands(actions) {
  if (!actions.length) return '- none';
  return actions.map((action, index) => `${index + 1}. \`${action.asset}\`

   Reasons: ${action.reasons.length ? action.reasons.join('; ') : 'remote drift'}

   \`\`\`sh
   ${action.command}
   \`\`\``).join('\n\n');
}

function renderAdvisory(actions) {
  if (!actions.length) return '- none';
  return actions.map((action, index) => `${index + 1}. \`${action.asset}\`

   Reasons: ${action.reasons.length ? action.reasons.join('; ') : 'extra remote asset'}

   Suggested review command:

   \`\`\`sh
   ${action.suggestedCommand || 'gh release view <tag> --json assets'}
   \`\`\``).join('\n\n');
}

function guardedWorkflow({ id, title, environment, commands, notes = [] }) {
  return { id, title, environment, commands, notes };
}

function guardedWorkflows(tag) {
  return [
    guardedWorkflow({
      id: 'local-env-guarded-publish',
      title: 'Local .env.release.local guarded publish',
      environment: '.env.release.local via run-with-release-env',
      commands: [
        'npm run release:status-refresh',
        'npm run release:credential-handoff',
        'npm run verify:credential-handoff:strict:report',
        'npm run release:setup-plan',
        'npm run verify:setup-plan:strict:report',
        'npm run verify:publication-seal:production',
        'npm run verify:asset-manifest',
        `CONNECT_AI_RELEASE_TAG=${tag} npm run release:publish-assets:env`,
        `CONNECT_AI_RELEASE_TAG=${tag} npm run verify:github-release-assets:strict:env`,
        'npm run release:github-release-remediation-plan',
        'npm run verify:github-release-remediation-plan:strict:report',
        'npm run release:readiness-summary:strict:report',
        'npm run verify:readiness-summary-report:strict:report',
        'npm run release:publication-seal:strict:report',
        'npm run verify:publication-seal:published',
      ],
      notes: [
        'Use when release credentials and GitHub token are stored in .env.release.local.',
        'release:publish-assets rechecks production gates and manifest checksums immediately before upload.',
      ],
    }),
    guardedWorkflow({
      id: 'process-env-guarded-publish',
      title: 'CI/process env guarded publish',
      environment: 'process environment secrets',
      commands: [
        'npm run release:status-refresh',
        'npm run release:credential-handoff',
        'npm run verify:credential-handoff:strict:report',
        'npm run release:setup-plan',
        'npm run verify:setup-plan:strict:report',
        'npm run verify:publication-seal:production',
        'npm run verify:asset-manifest',
        `CONNECT_AI_RELEASE_TAG=${tag} npm run release:publish-assets`,
        `CONNECT_AI_RELEASE_TAG=${tag} npm run verify:github-release-assets:strict`,
        'npm run release:github-release-remediation-plan',
        'npm run verify:github-release-remediation-plan:strict:report',
        'npm run release:readiness-summary:strict:report',
        'npm run verify:readiness-summary-report:strict:report',
        'npm run release:publication-seal:strict:report',
        'npm run verify:publication-seal:published',
      ],
      notes: [
        'Use in GitHub Actions or a shell that already has all release secrets in process env.',
        'Do not run raw gh upload commands until this guarded path is blocked by a known operational exception.',
      ],
    }),
  ];
}

function renderGuardedWorkflows(workflows) {
  if (!workflows.length) return '- none';
  return workflows.map((workflow, index) => {
    const commands = workflow.commands
      .map((command, commandIndex) => `${commandIndex + 1}. \`${command}\``)
      .join('\n');
    const notes = workflow.notes.length ? workflow.notes.map((note) => `- ${note}`).join('\n') : '- none';
    return `${index + 1}. ${workflow.title}

   Environment: ${workflow.environment}

   Notes:

   ${notes.split('\n').join('\n   ')}

   Commands:

   ${commands.split('\n').join('\n   ')}`;
  }).join('\n\n');
}

function baselineUrlGuard(credentialHandoff, setupPlan) {
  const handoffMirror = credentialHandoff?.localBaselineMirror || null;
  const setupMirror = setupPlan?.localBaselineMirror || null;
  const localBaselineMirror = handoffMirror || setupMirror || null;
  const handoffRemote = credentialHandoff?.remoteBaselineCandidate || null;
  const setupRemote = setupPlan?.remoteBaselineCandidate || null;
  const remoteBaselineCandidate = handoffRemote || setupRemote || null;
  const remoteStatus = remoteBaselineCandidate?.status || 'missing';
  const approvedExportSource = Boolean(
    localBaselineMirror?.approvedUploadSource &&
      localBaselineMirror?.expectedBaselineSha256 &&
      localBaselineMirror?.expectedBaselineBytes &&
      localBaselineMirror?.expectedBaselinePath &&
      (
        (localBaselineMirror?.matchesExport === true && localBaselineMirror?.status === 'verified-match') ||
        localBaselineMirror?.status === 'missing'
      ),
  );
  const remoteRejected = ['missing', 'not-approved-baseline-url'].includes(remoteStatus);
  const setupConsistent = !handoffMirror || !setupMirror ||
    (
      handoffMirror.status === setupMirror.status &&
      handoffMirror.asset === setupMirror.asset &&
      handoffMirror.approvedUploadSource === setupMirror.approvedUploadSource &&
      handoffMirror.expectedBaselineSha256 === setupMirror.expectedBaselineSha256 &&
      handoffMirror.matchesExport === setupMirror.matchesExport
    );
  const handoffConsistent = !handoffRemote || !setupRemote ||
    (
      handoffRemote.status === setupRemote.status &&
      handoffRemote.asset === setupRemote.asset &&
      handoffRemote.expectedBaselineSha256 === setupRemote.expectedBaselineSha256 &&
      handoffRemote.expectedBaselineBytes === setupRemote.expectedBaselineBytes
    );
  const ok = Boolean(approvedExportSource && remoteRejected && setupConsistent && handoffConsistent);
  return {
    status: ok ? 'approved-source-verified-remote-baseline-rejected' : 'needs-operator-review',
    ok,
    sourceReports: [
      credentialHandoff ? 'release/release-credential-handoff.json' : null,
      setupPlan ? 'release/release-setup-plan.json' : null,
    ].filter(Boolean),
    localBaselineMirror,
    remoteBaselineCandidate,
    setupConsistent,
    credentialHandoffConsistent: handoffConsistent,
    safetyDecision: remoteStatus === 'not-approved-baseline-url'
      ? 'Do not use the remote same-name ZIP URL as CONNECT_AI_BASELINE_URL.'
      : remoteStatus === 'missing'
        ? 'No remote same-name ZIP is available as a baseline URL.'
        : 'Remote same-name ZIP requires operator SHA validation before any baseline URL use.',
  };
}

function renderMarkdown(plan) {
  const sourceLines = plan.sourceReports.map((source) => {
    const state = source.present ? 'present' : 'missing';
    const counts = source.summary ? `${source.summary.blockers} blocker(s), ${source.summary.warnings} warning(s)` : 'no summary';
    const status = source.status ? `, status=${source.status}` : '';
    const strict = source.strict == null ? '' : `, strict=${source.strict}`;
    const selected = source.selected == null ? '' : `, selected=${source.selected}`;
    const freshness = source.freshness ? `, freshness=${source.freshness}` : '';
    const supersededBy = source.supersededBy ? `, supersededBy=${source.supersededBy}` : '';
    return `- ${source.path}: ${state}; ${counts}${status}${strict}${selected}${freshness}${supersededBy}`;
  }).join('\n');

  return `# Connect AI GitHub Release Remediation Plan

Generated: ${plan.generatedAt}
Product: ${plan.product.name} ${plan.product.version}
Release tag: ${plan.release.tag}
Status: ${plan.status}
Source report: ${plan.sourceReport || 'missing'}

## Summary

- Required upload or replace actions: ${plan.summary.requiredActions}
- Advisory extra asset reviews: ${plan.summary.advisoryReviews}
- Expected manifest assets covered: ${plan.summary.expectedManifestActionsCovered}
- Missing source reports: ${plan.summary.missingSourceReports}

## Safety Rules

${plan.safetyRules.map((rule) => `- ${rule}`).join('\n')}

## Guarded Publish Workflows

${renderGuardedWorkflows(plan.guardedWorkflows || [])}

## Baseline URL Guard

- Status: ${plan.baselineUrlGuard?.status || 'missing'}
- Approved upload source: \`${plan.baselineUrlGuard?.localBaselineMirror?.approvedUploadSource || 'missing'}\`
- Local mirror: \`${plan.baselineUrlGuard?.localBaselineMirror?.path || 'missing'}\`
- Local mirror SHA-256: \`${plan.baselineUrlGuard?.localBaselineMirror?.sha256 || 'missing'}\`
- Remote same-name ZIP: \`${plan.baselineUrlGuard?.remoteBaselineCandidate?.remoteUrl || 'missing'}\`
- Remote baseline status: ${plan.baselineUrlGuard?.remoteBaselineCandidate?.status || 'missing'}
- Safety decision: ${plan.baselineUrlGuard?.safetyDecision || 'missing'}

## Required Upload Or Replace Commands

${renderCommands(plan.requiredActions)}

## Advisory Extra Asset Reviews

${renderAdvisory(plan.advisoryReviews)}

## Verification

\`\`\`sh
npm run verify:github-release-remediation-plan
npm run verify:github-release-assets:strict:env
npm run release:github-release-remediation-plan
\`\`\`

## Source Reports

${sourceLines}
`;
}

function main() {
  const pkg = readJson('package.json');
  const manifest = readJson('release/release-asset-manifest.json');
  const credentialHandoff = readJson('release/release-credential-handoff.json');
  const setupPlan = readJson('release/release-setup-plan.json');
  const remoteInventory = remoteAssetReportInventory();
  const { report: remoteReport, path: remotePath } = sourceRemoteReport(remoteInventory);
  const remediation = remoteReport?.remediation || null;
  const actions = Array.isArray(remediation?.actions) ? remediation.actions : [];
  const expectedAssets = expectedAssetSet(manifest);
  const requiredActions = actions
    .filter((action) => action.severity === 'required')
    .map((action) => requiredAction(action, expectedAssets));
  const advisoryReviews = actions
    .filter((action) => action.severity === 'advisory')
    .map(advisoryReview);
  const missingSourceReports = [manifest, remoteReport].filter((report) => !report || report.parseError).length;
  const expectedManifestActionsCovered = requiredActions.filter((action) => action.expectedManifestPath).length;
  const status = !remoteReport || remoteReport.parseError
    ? 'missing-remote-asset-report'
    : requiredActions.length > 0
      ? 'remote-remediation-required'
      : advisoryReviews.length > 0
        ? 'extra-assets-review'
      : 'clean';
  const tag = releaseTag(pkg, remoteReport);
  const baselineGuard = baselineUrlGuard(credentialHandoff, setupPlan);

  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    sourceReport: remotePath,
    product: {
      name: pkg?.build?.productName || pkg?.name || 'Connect AI',
      version: pkg?.version || null,
      appId: pkg?.build?.appId || null,
      electronVersion: pkg?.build?.electronVersion || null,
    },
    release: {
      tag,
      url: remoteReport?.remote?.url || null,
      isDraft: remoteReport?.remote?.isDraft ?? null,
      isPrerelease: remoteReport?.remote?.isPrerelease ?? null,
    },
    sourceRemediation: {
      status: remediation?.status || 'missing',
      summary: remediation?.summary || null,
    },
    summary: {
      requiredActions: requiredActions.length,
      advisoryReviews: advisoryReviews.length,
      expectedManifestActionsCovered,
      missingSourceReports: missingSourceReports + [credentialHandoff, setupPlan].filter((report) => !report || report.parseError).length,
      sourceBlockers: summary(remoteReport).blockers,
      sourceWarnings: summary(remoteReport).warnings,
    },
    baselineUrlGuard: baselineGuard,
    safetyRules: [
      'Do not run upload or delete commands until productionReady=true in the strict decision, promotion plan, production readiness summary, and publication seal.',
      'Use release/release-asset-manifest.json as the only allowlist for upload-or-replace actions.',
      'Required actions use gh release upload --clobber so the remote asset bytes match the local checksum-pinned manifest.',
      'Prefer guarded publish workflows over raw gh upload commands because they recheck production gates and manifest checksums before upload.',
      'Do not use any remote same-name Connect AI ZIP as CONNECT_AI_BASELINE_URL unless release/release-credential-handoff.json and release/release-setup-plan.json both prove its SHA-256 matches the exported baseline ZIP.',
      'Advisory extra assets are review-only unless the tag is confirmed to be mac-arm64-only.',
      'This plan contains command templates and asset names only; it must not contain tokens, certificates, passwords, or API keys.',
    ],
    guardedWorkflows: guardedWorkflows(tag),
    requiredActions,
    advisoryReviews,
    sourceReports: [
      reportState('release asset manifest', 'release/release-asset-manifest.json'),
      remoteAssetReportState('local GitHub Release assets', 'release/github-release-assets-report.json', remoteInventory),
      remoteAssetReportState('strict GitHub Release assets', 'release/github-release-assets-report.strict.json', remoteInventory),
      reportState('GitHub Release publish plan', 'release/github-release-publish-plan.json'),
      reportState('production readiness summary', 'release/production-readiness-summary.json'),
      reportState('publication seal', 'release/release-publication-seal.json'),
      reportState('release credential handoff', 'release/release-credential-handoff.json'),
      reportState('release setup plan', 'release/release-setup-plan.json'),
    ],
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(plan));
  console.log(`Connect AI GitHub Release remediation plan: ${status}`);
  console.log(`Summary: ${requiredActions.length} required action(s), ${advisoryReviews.length} advisory review(s)`);
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
}

main();
