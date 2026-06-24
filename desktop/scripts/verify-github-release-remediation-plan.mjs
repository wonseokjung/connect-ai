import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const requireClean = process.argv.includes('--require-clean');
const reportPath = strict
  ? 'release/github-release-remediation-plan-report.strict.json'
  : 'release/github-release-remediation-plan-report.json';
const planPath = 'release/github-release-remediation-plan.json';
const planMarkdownPath = 'release/GITHUB_RELEASE_REMEDIATION_PLAN.md';
const checks = [];

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

function remoteAssetSourceEntries(plan) {
  return (plan.sourceReports || [])
    .filter((source) => [
      'release/github-release-assets-report.strict.json',
      'release/github-release-assets-report.json',
    ].includes(source.path));
}

function expectedSelectedRemoteAssetSource(plan) {
  const entries = remoteAssetSourceEntries(plan)
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

function looksLikeUploadCommand(value, tag, localPath) {
  const text = String(value || '');
  return (
    (/gh\s+release\s+upload/.test(text) || /'gh'\s+'release'\s+'upload'/.test(text)) &&
    text.includes(tag) &&
    text.includes(localPath) &&
    text.includes('--clobber')
  );
}

function looksLikeDeleteReviewCommand(value, tag) {
  const text = String(value || '');
  return (
    text.length === 0 ||
    (
      (/gh\s+release\s+delete-asset/.test(text) || /'gh'\s+'release'\s+'delete-asset'/.test(text)) &&
      text.includes(tag)
    )
  );
}

function expectedAssetMap(manifest) {
  const assets = [
    ...(manifest?.githubReleaseAssets || []),
    manifest?.manifestFile ? { path: manifest.manifestFile } : null,
  ].filter(Boolean);
  return new Map(assets.map((asset) => [path.basename(asset.path), asset.path]));
}

function actionMap(actions) {
  const map = new Map();
  for (const action of actions || []) {
    if (!action?.asset) continue;
    if (!map.has(action.asset)) map.set(action.asset, []);
    map.get(action.asset).push(action);
  }
  return map;
}

function workflowById(workflows, id) {
  return (workflows || []).find((workflow) => workflow.id === id) || null;
}

function commandText(workflow) {
  return (workflow?.commands || []).join('\n');
}

function commandIndex(workflow, pattern) {
  return (workflow?.commands || []).findIndex((command) => pattern.test(command));
}

function orderedWorkflow(workflow, patterns) {
  let last = -1;
  for (const pattern of patterns) {
    const index = commandIndex(workflow, pattern);
    if (index <= last) return false;
    last = index;
  }
  return true;
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

  console.log(`Connect AI GitHub Release remediation plan verification (${strict ? 'strict' : 'local'})`);
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
  const manifest = readJson('release/release-asset-manifest.json');
  const plan = readJson(planPath);

  add('GitHub Release remediation plan exists', Boolean(plan && !plan.parseError), plan?.parseError || planPath);
  add('GitHub Release remediation plan notes exist', fileExists(planMarkdownPath), planMarkdownPath);
  add('release asset manifest available', Boolean(manifest && !manifest.parseError), 'release/release-asset-manifest.json');
  if (!plan || plan.parseError) {
    printAndExit();
    return;
  }

  const sourceReport = plan.sourceReport ? readJson(plan.sourceReport) : null;
  const credentialHandoff = readJson('release/release-credential-handoff.json');
  const setupPlan = readJson('release/release-setup-plan.json');
  const sourceActions = Array.isArray(sourceReport?.remediation?.actions) ? sourceReport.remediation.actions : [];
  const sourceRequired = sourceActions.filter((action) => action.severity === 'required');
  const sourceAdvisory = sourceActions.filter((action) => action.severity === 'advisory');
  const planRequired = Array.isArray(plan.requiredActions) ? plan.requiredActions : [];
  const planAdvisory = Array.isArray(plan.advisoryReviews) ? plan.advisoryReviews : [];
  const expectedAssets = expectedAssetMap(manifest);
  const requiredByAsset = actionMap(planRequired);
  const advisoryByAsset = actionMap(planAdvisory);
  const releaseAssetPaths = new Set((manifest?.githubReleaseAssets || []).map((asset) => asset.path));
  const ciOnlyPaths = new Set((manifest?.ciOnlyArtifacts || []).map((asset) => asset.path));
  const baselineGuard = plan.baselineUrlGuard || {};
  const guardMirror = baselineGuard.localBaselineMirror || {};
  const handoffMirror = credentialHandoff?.localBaselineMirror || {};
  const setupMirror = setupPlan?.localBaselineMirror || {};
  const guardRemote = baselineGuard.remoteBaselineCandidate || {};
  const handoffRemote = credentialHandoff?.remoteBaselineCandidate || {};
  const setupRemote = setupPlan?.remoteBaselineCandidate || {};

  add('GitHub Release remediation plan schema version', plan.schemaVersion === 1, String(plan.schemaVersion));
  add('GitHub Release remediation plan product version', plan.product?.version === pkg?.version, `${plan.product?.version || 'missing'} expected ${pkg?.version || 'missing'}`);
  add('GitHub Release remediation plan release tag', plan.release?.tag === `desktop-v${pkg?.version}`, `${plan.release?.tag || 'missing'} expected desktop-v${pkg?.version || 'missing'}`);
  add('GitHub Release remediation source report exists', Boolean(sourceReport && !sourceReport.parseError), plan.sourceReport || 'missing sourceReport');
  if (sourceReport && !sourceReport.parseError) {
    add('GitHub Release remediation source status freshness', plan.sourceRemediation?.status === sourceReport.remediation?.status, `${plan.sourceRemediation?.status || 'missing'} expected ${sourceReport.remediation?.status || 'missing'}`);
    add('GitHub Release remediation source required summary', Number(plan.sourceRemediation?.summary?.required || 0) === sourceRequired.length, `${plan.sourceRemediation?.summary?.required || 0} expected ${sourceRequired.length}`);
    add('GitHub Release remediation source advisory summary', Number(plan.sourceRemediation?.summary?.advisory || 0) === sourceAdvisory.length, `${plan.sourceRemediation?.summary?.advisory || 0} expected ${sourceAdvisory.length}`);
  }

  add('GitHub Release remediation required action summary', plan.summary?.requiredActions === planRequired.length && planRequired.length === sourceRequired.length, `${plan.summary?.requiredActions} plan, ${planRequired.length} listed, ${sourceRequired.length} source`);
  add('GitHub Release remediation advisory summary', plan.summary?.advisoryReviews === planAdvisory.length && planAdvisory.length === sourceAdvisory.length, `${plan.summary?.advisoryReviews} plan, ${planAdvisory.length} listed, ${sourceAdvisory.length} source`);
  add('GitHub Release remediation expected asset coverage summary', plan.summary?.expectedManifestActionsCovered === planRequired.filter((action) => action.expectedManifestPath).length, `${plan.summary?.expectedManifestActionsCovered} expected ${planRequired.filter((action) => action.expectedManifestPath).length}`);
  add('GitHub Release remediation baseline URL guard', Boolean(plan.baselineUrlGuard), baselineGuard.status || 'missing');
  add('GitHub Release remediation baseline URL guard status', baselineGuard.status === 'approved-source-verified-remote-baseline-rejected', baselineGuard.status || 'missing');
  add(
    'GitHub Release remediation baseline mirror projection',
    ['verified-match', 'missing'].includes(guardMirror.status) &&
      (guardMirror.matchesExport === true || guardMirror.status === 'missing') &&
      guardMirror.asset === handoffMirror.asset &&
      guardMirror.asset === setupMirror.asset &&
      guardMirror.approvedUploadSource === handoffMirror.approvedUploadSource &&
      guardMirror.approvedUploadSource === setupMirror.approvedUploadSource &&
      guardMirror.expectedBaselineSha256 === handoffMirror.expectedBaselineSha256 &&
      guardMirror.expectedBaselineSha256 === setupMirror.expectedBaselineSha256,
    `guard=${guardMirror.status || 'missing'} handoff=${handoffMirror.status || 'missing'} setup=${setupMirror.status || 'missing'}`,
  );
  add(
    'GitHub Release remediation remote baseline rejection projection',
    guardRemote.status === 'not-approved-baseline-url' &&
      guardRemote.asset === handoffRemote.asset &&
      guardRemote.asset === setupRemote.asset &&
      guardRemote.remoteBytes === handoffRemote.remoteBytes &&
      guardRemote.expectedBaselineBytes === handoffRemote.expectedBaselineBytes &&
      guardRemote.expectedBaselineSha256 === handoffRemote.expectedBaselineSha256,
    `remote=${guardRemote.remoteBytes ?? 'missing'}, expected=${guardRemote.expectedBaselineBytes ?? 'missing'}, status=${guardRemote.status || 'missing'}`,
  );
  add(
    'GitHub Release remediation baseline guard source reports',
    Array.isArray(baselineGuard.sourceReports) &&
      baselineGuard.sourceReports.includes('release/release-credential-handoff.json') &&
      baselineGuard.sourceReports.includes('release/release-setup-plan.json'),
    (baselineGuard.sourceReports || []).join(', ') || 'missing',
  );

  for (const action of sourceRequired) {
    const matches = requiredByAsset.get(action.asset) || [];
    const planned = matches[0];
    add(`GitHub Release required action coverage ${action.asset}`, matches.length === 1, `${matches.length} matching plan action(s)`);
    if (!planned) continue;
    const manifestPath = expectedAssets.get(action.asset);
    add(`GitHub Release required action manifest allowlist ${action.asset}`, Boolean(manifestPath) && planned.expectedManifestPath === manifestPath, planned.expectedManifestPath || 'missing manifest path');
    add(`GitHub Release required action local path ${action.asset}`, planned.localPath === (action.localPath || manifestPath), `${planned.localPath || 'missing'} expected ${action.localPath || manifestPath || 'missing'}`);
    add(`GitHub Release required action upload command ${action.asset}`, looksLikeUploadCommand(planned.command, plan.release?.tag, planned.localPath), planned.command || 'missing command');
    add(`GitHub Release required action reasons ${action.asset}`, Array.isArray(planned.reasons) && planned.reasons.length > 0, `${planned.reasons?.length || 0} reason(s)`);
  }

  for (const action of sourceAdvisory) {
    const matches = advisoryByAsset.get(action.asset) || [];
    const planned = matches[0];
    add(`GitHub Release advisory action coverage ${action.asset}`, matches.length === 1, `${matches.length} matching review(s)`);
    if (!planned) continue;
    add(`GitHub Release advisory command ${action.asset}`, looksLikeDeleteReviewCommand(planned.suggestedCommand, plan.release?.tag), planned.suggestedCommand || 'manual review');
    add(`GitHub Release advisory reasons ${action.asset}`, Array.isArray(planned.reasons) && planned.reasons.length > 0, `${planned.reasons?.length || 0} reason(s)`);
  }

  add('GitHub Release remediation source reports', Array.isArray(plan.sourceReports) && plan.sourceReports.length >= 4, `${plan.sourceReports?.length || 0} source report(s)`);
  add(
    'GitHub Release remediation setup and handoff sources',
    (plan.sourceReports || []).some((source) => source.path === 'release/release-credential-handoff.json') &&
      (plan.sourceReports || []).some((source) => source.path === 'release/release-setup-plan.json'),
    'release setup and credential handoff source reports listed',
  );
  const remoteAssetSources = remoteAssetSourceEntries(plan);
  const selectedRemoteAssetSource = expectedSelectedRemoteAssetSource(plan);
  const selectedRemoteAssetSources = remoteAssetSources.filter((source) => source.selected === true);
  add('GitHub Release remediation remote asset source reports', remoteAssetSources.length >= 1, `${remoteAssetSources.length} remote asset source report(s)`);
  add(
    'GitHub Release remediation selected remote asset source',
    Boolean(selectedRemoteAssetSource) &&
      selectedRemoteAssetSources.length === 1 &&
      selectedRemoteAssetSources[0].path === selectedRemoteAssetSource.path &&
      plan.sourceReport === selectedRemoteAssetSource.path,
    selectedRemoteAssetSource ? `${selectedRemoteAssetSource.path} selected=${selectedRemoteAssetSources.map((source) => source.path).join(', ') || 'none'} sourceReport=${plan.sourceReport || 'missing'}` : 'missing selected source',
  );
  for (const source of remoteAssetSources.filter((item) => item.present && !item.parseError)) {
    const isSelected = selectedRemoteAssetSource?.path === source.path;
    const expectedFreshness = isSelected ? 'selected-current' : selectedRemoteAssetSource && generatedAtMs(source) < generatedAtMs(selectedRemoteAssetSource) ? `stale-superseded-by-${selectedRemoteAssetSource.strict === true ? 'strict' : 'local'}` : 'available-not-selected';
    const expectedSupersededBy = expectedFreshness.startsWith('stale-superseded-by-') ? selectedRemoteAssetSource?.path : null;
    add(
      `GitHub Release remediation remote asset source freshness ${source.path}`,
      source.selected === isSelected &&
        source.freshness === expectedFreshness &&
        (source.supersededBy || null) === expectedSupersededBy,
      `selected=${source.selected}, freshness=${source.freshness || 'missing'}, supersededBy=${source.supersededBy || 'none'}`,
    );
  }
  add('GitHub Release remediation safety rules', Array.isArray(plan.safetyRules) && plan.safetyRules.length >= 4, `${plan.safetyRules?.length || 0} rule(s)`);
  add('GitHub Release remediation production gate rule', /productionReady=true/.test((plan.safetyRules || []).join('\n')), 'productionReady=true before upload');
  add('GitHub Release remediation manifest allowlist rule', /release\/release-asset-manifest\.json/.test((plan.safetyRules || []).join('\n')), 'manifest allowlist documented');
  add('GitHub Release remediation guarded publish safety rule', /guarded publish workflows/.test((plan.safetyRules || []).join('\n')), 'guarded publish workflows documented');
  add('GitHub Release remediation baseline URL safety rule', /CONNECT_AI_BASELINE_URL/.test((plan.safetyRules || []).join('\n')) && /SHA-256 matches the exported baseline ZIP/.test((plan.safetyRules || []).join('\n')), 'remote same-name ZIP baseline URL guard documented');

  const workflows = Array.isArray(plan.guardedWorkflows) ? plan.guardedWorkflows : [];
  const localWorkflow = workflowById(workflows, 'local-env-guarded-publish');
  const processWorkflow = workflowById(workflows, 'process-env-guarded-publish');
  const requiredWorkflowOrder = [
    /release:status-refresh/,
    /verify:publication-seal:production/,
    /verify:asset-manifest/,
    /release:publish-assets/,
    /verify:github-release-assets:strict/,
    /release:github-release-remediation-plan/,
    /verify:github-release-remediation-plan:strict:report/,
    /release:readiness-summary:strict:report/,
    /verify:readiness-summary-report:strict:report/,
    /release:publication-seal:strict:report/,
    /verify:publication-seal:published/,
  ];
  add('GitHub Release remediation guarded workflows', workflows.length >= 2, `${workflows.length} workflow(s)`);
  add('GitHub Release remediation local env guarded workflow', Boolean(localWorkflow), localWorkflow?.title || 'missing local-env-guarded-publish');
  add('GitHub Release remediation process env guarded workflow', Boolean(processWorkflow), processWorkflow?.title || 'missing process-env-guarded-publish');
  if (localWorkflow) {
    const text = commandText(localWorkflow);
    add('GitHub Release remediation local env guarded workflow order', orderedWorkflow(localWorkflow, requiredWorkflowOrder), text);
    add('GitHub Release remediation local env publish command', /CONNECT_AI_RELEASE_TAG=desktop-v\d+\.\d+\.\d+/.test(text) && text.includes('release:publish-assets:env'), text);
    add('GitHub Release remediation local env strict remote verify command', text.includes('verify:github-release-assets:strict:env'), text);
  }
  if (processWorkflow) {
    const text = commandText(processWorkflow);
    add('GitHub Release remediation process env guarded workflow order', orderedWorkflow(processWorkflow, requiredWorkflowOrder), text);
    add('GitHub Release remediation process env publish command', /CONNECT_AI_RELEASE_TAG=desktop-v\d+\.\d+\.\d+/.test(text) && text.includes('release:publish-assets') && !text.includes('release:publish-assets:env'), text);
    add('GitHub Release remediation process env strict remote verify command', text.includes('verify:github-release-assets:strict') && !text.includes('verify:github-release-assets:strict:env'), text);
  }

  if (manifest && !manifest.parseError) {
    for (const relativePath of [planPath, planMarkdownPath, reportPath]) {
      add(
        `${relativePath} CI-only diagnostic`,
        !releaseAssetPaths.has(relativePath) && (!fileExists(relativePath) || ciOnlyPaths.has(relativePath)),
        'GitHub Release remediation diagnostics are never GitHub Release assets',
      );
    }
  }

  const serialized = `${JSON.stringify(plan, null, 2)}\n${fileExists(planMarkdownPath) ? fs.readFileSync(path.join(desktopDir, planMarkdownPath), 'utf8') : ''}`;
  add('GitHub Release remediation secret material scan', !hasSecretMaterial(serialized), 'no private key, certificate body, GitHub token, or API key literal patterns');

  if (fileExists(planMarkdownPath)) {
    const markdown = fs.readFileSync(path.join(desktopDir, planMarkdownPath), 'utf8');
    add('GitHub Release remediation notes status freshness', markdown.includes(`Status: ${plan.status}`), `Status: ${plan.status}`);
    add('GitHub Release remediation notes required summary', markdown.includes(`Required upload or replace actions: ${plan.summary?.requiredActions}`), `Required upload or replace actions: ${plan.summary?.requiredActions}`);
    add('GitHub Release remediation notes advisory summary', markdown.includes(`Advisory extra asset reviews: ${plan.summary?.advisoryReviews}`), `Advisory extra asset reviews: ${plan.summary?.advisoryReviews}`);
    add('GitHub Release remediation notes guarded workflows', markdown.includes('## Guarded Publish Workflows') && markdown.includes('Local .env.release.local guarded publish') && markdown.includes('CI/process env guarded publish'), 'guarded workflow section');
    add('GitHub Release remediation notes baseline guard', markdown.includes('## Baseline URL Guard') && markdown.includes(baselineGuard.status || 'missing'), 'baseline URL guard section');
  }

  if (requireClean) {
    add('GitHub Release remediation clean', planRequired.length === 0 && planAdvisory.length === 0, `${planRequired.length} required action(s), ${planAdvisory.length} advisory review(s)`);
  }

  printAndExit();
}

main();
