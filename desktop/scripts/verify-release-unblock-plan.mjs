import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const requireClean = process.argv.includes('--require-clean');
const checks = [];

const planPath = 'release/release-unblock-plan.json';
const markdownPath = 'release/RELEASE_UNBLOCK_PLAN.md';
const reportPath = strict ? 'release/release-unblock-plan-report.strict.json' : 'release/release-unblock-plan-report.json';
const requiredSourcePaths = [
  'release/production-readiness-summary.json',
  'release/release-decision.strict.json',
  'release/release-promotion-plan.json',
  'release/release-env-contract-report.json',
  'release/release-env-report.process.json',
  'release/signing-readiness.json',
  'release/github-release-setup-report.json',
  'release/operator-readiness.github.json',
  'release/github-release-publish-plan.json',
  'release/github-release-remediation-plan.json',
  'release/github-release-remediation-plan-report.json',
  'release/github-release-remediation-plan-report.strict.json',
  'release/github-release-remediation-apply-plan.json',
  'release/commercial-release-readiness-report.strict.json',
  'release/commercial-finalization-report.json',
  'release/commercial-finalization-report-verification.strict.json',
  'release/release-manifest.json',
  'release/baseline-export-report.json',
  'release/baseline-freshness-report.json',
  'release/release-credential-handoff.json',
  'release/release-credential-handoff-report.strict.json',
  'release/release-setup-plan.json',
  'release/release-setup-plan-report.strict.json',
  'release/release-publication-seal.json',
];
const requiredGroupIds = [
  'baseline-artifact',
  'remote-baseline-url-guard',
  'github-audit-token-permissions',
  'developer-id-certificate',
  'notarization-credentials',
  'github-actions-release-inputs',
  'github-release-upload-permission',
  'signed-notarized-release-build',
  'publish-and-remote-asset-verification',
];

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
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

function expectedStatus(readiness) {
  if (readiness?.productionReady) return 'production-ready';
  if (readiness?.localCandidateReady) return 'local-candidate-awaiting-external-unblock';
  return 'not-ready';
}

function countGroups(groups, predicate) {
  return groups.filter(predicate).length;
}

function pathSet(items) {
  return new Set(items.map((item) => item.path).filter(Boolean));
}

function summary(report) {
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
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

  console.log(`Connect AI release unblock plan verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${reportPath}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const plan = readJson(planPath);
  const readiness = readJson('release/production-readiness-summary.json');
  const manifest = readJson('release/release-asset-manifest.json');
  const remediationPlan = readJson('release/github-release-remediation-plan.json');
  const remediationReport = readJson('release/github-release-remediation-plan-report.json');
  const remediationStrictReport = readJson('release/github-release-remediation-plan-report.strict.json');
  const remediationApplyPlan = readJson('release/github-release-remediation-apply-plan.json');
  const commercialReadiness = readJson('release/commercial-release-readiness-report.strict.json');
  const commercialFinalization = readJson('release/commercial-finalization-report.json');
  const commercialFinalizationVerification = readJson('release/commercial-finalization-report-verification.strict.json');
  const baselineExport = readJson('release/baseline-export-report.json');
  const credentialHandoff = readJson('release/release-credential-handoff.json');

  add('release unblock plan exists', Boolean(plan), planPath);
  add('release unblock plan notes exist', fileExists(markdownPath), markdownPath);
  if (!plan) {
    printAndExit();
    return;
  }

  const groups = Array.isArray(plan.unblockGroups) ? plan.unblockGroups : [];
  const sourceReports = Array.isArray(plan.sourceReports) ? plan.sourceReports : [];
  const sourcePaths = pathSet(sourceReports);
  const groupIds = groups.map((group) => group.id);
  const groupIdSet = new Set(groupIds);
  const duplicateGroupIds = groupIds.filter((id, index) => groupIds.indexOf(id) !== index);
  const blockingGroups = countGroups(groups, (group) => group.ok !== true && group.blocking !== false);
  const warningGroups = countGroups(groups, (group) => group.ok !== true && group.blocking === false);

  add('release unblock plan schema version', plan.schemaVersion === 1, String(plan.schemaVersion));
  add('release unblock plan product version', typeof plan.product?.version === 'string' && plan.product.version.length > 0, plan.product?.version || 'missing');
  add('release unblock plan status matches readiness summary', plan.status === expectedStatus(readiness), `${plan.status} expected ${expectedStatus(readiness)}`);
  add('release unblock plan productionReady freshness', plan.productionReady === Boolean(readiness?.productionReady), `plan=${plan.productionReady} readiness=${Boolean(readiness?.productionReady)}`);
  add('release unblock plan localCandidateReady freshness', plan.localCandidateReady === Boolean(readiness?.localCandidateReady), `plan=${plan.localCandidateReady} readiness=${Boolean(readiness?.localCandidateReady)}`);
  add('release unblock plan group array', groups.length > 0, `${groups.length} group(s)`);
  add('release unblock plan required groups', requiredGroupIds.every((id) => groupIdSet.has(id)), `required=${requiredGroupIds.join(', ')}`);
  add('release unblock plan duplicate groups', duplicateGroupIds.length === 0, duplicateGroupIds.length ? duplicateGroupIds.join(', ') : 'none');
  add('release unblock plan group count summary', plan.summary?.groups === groups.length, `${plan.summary?.groups} expected ${groups.length}`);
  add('release unblock plan blocker summary', plan.summary?.blockers === blockingGroups, `${plan.summary?.blockers} expected ${blockingGroups}`);
  add('release unblock plan warning summary', plan.summary?.warnings === warningGroups, `${plan.summary?.warnings} expected ${warningGroups}`);
  const remoteBaselineGroup = groups.find((item) => item.id === 'remote-baseline-url-guard');
  const remoteBaselineGroupDetail = JSON.stringify(remoteBaselineGroup?.detail || '');
  add(
    'release unblock remote baseline guard summary',
    plan.summary?.remoteBaselineGuardVerified === (remoteBaselineGroup?.ok === true),
    `summary=${plan.summary?.remoteBaselineGuardVerified}, group=${remoteBaselineGroup?.ok}`,
  );
  add(
    'release unblock plan unresolved blocker coverage',
    !readiness?.summary || Number(readiness.summary.blockers || 0) === 0 || blockingGroups > 0,
    `readiness=${readiness?.summary?.blockers ?? 'missing'} blocker(s), unblock=${blockingGroups} blocker group(s)`,
  );
  add(
    'release unblock plan production implies local candidate',
    plan.productionReady !== true || plan.localCandidateReady === true,
    `productionReady=${plan.productionReady}, localCandidateReady=${plan.localCandidateReady}`,
  );

  const order = Array.isArray(plan.recommendedOrder) ? plan.recommendedOrder : [];
  add('release unblock plan recommended order length', order.length === groups.length, `${order.length} expected ${groups.length}`);
  add(
    'release unblock plan recommended order coverage',
    order.length === groups.length && order.every((item, index) => item.id === groups[index]?.id && item.index === index + 1 && item.status === groups[index]?.status),
    'recommended order mirrors unblockGroups',
  );

  for (const id of requiredGroupIds) {
    const group = groups.find((item) => item.id === id);
    add(`release unblock group ${id}`, Boolean(group), group ? group.title : 'missing');
    if (!group) continue;
    add(`release unblock group ${id} status`, group.status === (group.ok ? 'ready' : group.blocking === false ? 'waiting' : 'blocked'), `${group.status}`);
    add(`release unblock group ${id} details`, Array.isArray(group.detail) && group.detail.length > 0, `${group.detail?.length || 0} detail(s)`);
    add(`release unblock group ${id} required inputs`, Array.isArray(group.requiredInputs) && group.requiredInputs.length > 0, `${group.requiredInputs?.length || 0} input(s)`);
    add(`release unblock group ${id} commands`, Array.isArray(group.commands) && group.commands.every((item) => item.step && item.command), `${group.commands?.length || 0} command(s)`);
    add(`release unblock group ${id} verification`, Array.isArray(group.verification) && group.verification.every((item) => item.step && item.command), `${group.verification?.length || 0} command(s)`);
    add(
      `release unblock group ${id} source report coverage`,
      Array.isArray(group.sourceReports) && group.sourceReports.length > 0 && group.sourceReports.every((sourcePath) => sourcePaths.has(sourcePath)),
      (group.sourceReports || []).join(', ') || 'missing',
    );
  }

  const notarizationGroup = groups.find((item) => item.id === 'notarization-credentials');
  const notarizationCommandText = (notarizationGroup?.commands || [])
    .map((item) => `${item.step || ''}\n${item.command || ''}`)
    .join('\n');
  add(
    'release unblock notarization profile command',
    notarizationCommandText.includes('signing:notary-profile:report:env'),
    'Apple ID notarytool profile report command is documented for local profile mode',
  );

  for (const sourcePath of requiredSourcePaths) {
    const source = sourceReports.find((item) => item.path === sourcePath);
    add(`release unblock source report ${sourcePath}`, Boolean(source), source ? 'listed' : 'missing');
    if (source) {
      add(`release unblock source report present ${sourcePath}`, source.present === fileExists(sourcePath), `reported=${source.present} actual=${fileExists(sourcePath)}`);
    }
  }
  add(
    'release unblock remote asset source report',
    sourceReports.some((item) => item.path === 'release/github-release-assets-report.strict.json' || item.path === 'release/github-release-assets-report.json'),
    'strict or local remote asset report listed',
  );
  add(
    'release unblock remediation source reports',
    sourceReports.some((item) => item.path === 'release/github-release-remediation-plan.json') &&
      sourceReports.some((item) => item.path === 'release/github-release-remediation-plan-report.json') &&
      sourceReports.some((item) => item.path === 'release/github-release-remediation-plan-report.strict.json') &&
      sourceReports.some((item) => item.path === 'release/github-release-remediation-apply-plan.json') &&
      sourceReports.some((item) => item.path === 'release/github-release-remediation-apply-plan-report.strict.json'),
    'remediation plan, both verifier reports, apply dry-run report, and apply dry-run verifier listed',
  );
  add(
    'release unblock commercial finalization source reports',
    sourceReports.some((item) => item.path === 'release/commercial-release-readiness-report.strict.json') &&
      sourceReports.some((item) => item.path === 'release/commercial-finalization-report.json') &&
      sourceReports.some((item) => item.path === 'release/commercial-finalization-report-verification.strict.json'),
    'commercial readiness, commercial finalization, and finalization verification reports listed',
  );

  const uploadPermissionGroup = groups.find((item) => item.id === 'github-release-upload-permission');
  const publishGroup = groups.find((item) => item.id === 'publish-and-remote-asset-verification');
  const baselineGroup = groups.find((item) => item.id === 'baseline-artifact');
	  if (baselineGroup) {
	    const groupSourcePaths = new Set(baselineGroup.sourceReports || []);
	    const commandText = (baselineGroup.commands || []).map((item) => `${item.step || ''}\n${item.command || ''}`).join('\n');
	    const baselineUrl = credentialHandoff?.remoteBaselineCandidate?.remoteUrl || '';
	    const baselineSha = baselineExport?.export?.sha256 || credentialHandoff?.baselineArtifact?.sha256 || '';
	    add(
	      'release unblock baseline group export source coverage',
	      groupSourcePaths.has('release/baseline-export-report.json'),
	      (baselineGroup.sourceReports || []).join(', '),
	    );
    add(
      'release unblock baseline group export command',
	      commandText.includes('release:baseline-export'),
	      'release:baseline-export',
	    );
	    add(
	      'release unblock baseline group candidate URL and SHA',
	      baselineUrlLooksValid(baselineUrl, plan.product?.version || '') &&
	        /^[a-f0-9]{64}$/i.test(baselineSha) &&
	        commandText.includes(baselineUrl) &&
	        commandText.includes(baselineSha),
	      'baseline group command projects the guarded candidate URL and exported SHA',
	    );
	    add(
	      'release unblock baseline group GitHub variable guard',
	      commandText.includes('verify:remote-baseline-approved:refresh') &&
	        commandText.includes('gh variable set CONNECT_AI_BASELINE_URL'),
	      'GitHub baseline variable command is guarded by the remote baseline approval gate',
	    );
	  }
  if (remoteBaselineGroup) {
    const groupSourcePaths = new Set(remoteBaselineGroup.sourceReports || []);
    const commandText = [
      ...(remoteBaselineGroup.commands || []),
      ...(remoteBaselineGroup.verification || []),
    ].map((item) => `${item.step || ''}\n${item.command || ''}`).join('\n');
    add(
      'release unblock remote baseline guard source coverage',
      groupSourcePaths.has('release/release-credential-handoff.json') &&
        groupSourcePaths.has('release/release-credential-handoff-report.strict.json') &&
        groupSourcePaths.has('release/release-setup-plan.json') &&
        groupSourcePaths.has('release/release-setup-plan-report.strict.json'),
      (remoteBaselineGroup.sourceReports || []).join(', '),
    );
    add(
      'release unblock remote baseline guard evidence',
      remoteBaselineGroup.ok === true &&
        remoteBaselineGroupDetail.includes('not-approved-baseline-url') &&
        remoteBaselineGroupDetail.includes('setupVerified=true') &&
        remoteBaselineGroupDetail.includes('credentialHandoffVerified=true') &&
        remoteBaselineGroupDetail.includes('safetyRuleDocumented=true'),
      remoteBaselineGroupDetail || 'missing remote baseline guard detail',
    );
    add(
      'release unblock remote baseline guard commands',
      commandText.includes('release:credential-handoff') &&
        commandText.includes('verify:credential-handoff:strict:report') &&
        commandText.includes('release:setup-plan') &&
        commandText.includes('verify:setup-plan:strict:report'),
      'release:credential-handoff, verify:credential-handoff:strict:report, release:setup-plan, verify:setup-plan:strict:report',
    );
  }
  if (uploadPermissionGroup) {
    const groupSourcePaths = new Set(uploadPermissionGroup.sourceReports || []);
    const commandText = [
      ...(uploadPermissionGroup.commands || []),
      ...(uploadPermissionGroup.verification || []),
    ].map((item) => `${item.step || ''}\n${item.command || ''}`).join('\n');
    const requiredInputsText = (uploadPermissionGroup.requiredInputs || []).join('\n');
    const groupDetailText = JSON.stringify(uploadPermissionGroup.detail || []);
    const uploadActions = Number(
      remediationApplyPlan?.summary?.actions ??
        commercialReadiness?.summary?.remoteApplyActions ??
        0
    );
    const uploadPermissionReady = uploadActions === 0 ||
      remediationApplyPlan?.github?.canUploadReleaseAssets === true ||
      commercialReadiness?.summary?.remoteUploadPermissionReady === true;
    add(
      'release unblock upload permission source coverage',
      groupSourcePaths.has('release/github-release-remediation-apply-plan.json') &&
        groupSourcePaths.has('release/github-release-remediation-apply-plan-report.strict.json') &&
        groupSourcePaths.has('release/commercial-release-readiness-report.strict.json'),
      (uploadPermissionGroup.sourceReports || []).join(', '),
    );
    add(
      'release unblock upload permission group state',
      uploadPermissionGroup.ok === uploadPermissionReady &&
        uploadPermissionGroup.status === (uploadPermissionReady ? 'ready' : 'blocked'),
      `group=${uploadPermissionGroup.status}/${uploadPermissionGroup.ok}, expected=${uploadPermissionReady ? 'ready' : 'blocked'}, actions=${uploadActions}`,
    );
    add(
      'release unblock upload permission diagnostics',
      groupDetailText.includes('repo=') &&
        groupDetailText.includes('viewerPermission=') &&
        groupDetailText.includes('canUploadReleaseAssets=') &&
        groupDetailText.includes(`actions=${uploadActions}`),
      groupDetailText || 'missing upload permission detail',
    );
    add(
      'release unblock upload permission required inputs',
      /write, maintain, or admin/i.test(requiredInputsText) &&
        /uploading\/deleting GitHub Release assets/i.test(requiredInputsText),
      requiredInputsText || 'missing required inputs',
    );
    add(
      'release unblock upload permission commands',
      commandText.includes('gh repo view wonseokjung/connect-ai --json viewerPermission,url') &&
        commandText.includes('release:github-release-remediation-apply:plan') &&
        commandText.includes('verify:github-release-remediation-apply-plan:strict:report') &&
        commandText.includes('verify:commercial-release:strict:report'),
      'gh repo view, remediation apply dry-run, apply-plan verifier, and commercial readiness verifier',
    );
  }
  if (publishGroup) {
    const groupSourcePaths = new Set(publishGroup.sourceReports || []);
    const commandText = [
      ...(publishGroup.commands || []),
      ...(publishGroup.verification || []),
    ].map((item) => `${item.step || ''}\n${item.command || ''}`).join('\n');
    add(
      'release unblock publish group remediation source coverage',
        groupSourcePaths.has('release/github-release-remediation-plan.json') &&
        groupSourcePaths.has('release/github-release-remediation-plan-report.json') &&
        groupSourcePaths.has('release/github-release-remediation-plan-report.strict.json') &&
        groupSourcePaths.has('release/github-release-remediation-apply-plan.json') &&
        groupSourcePaths.has('release/github-release-remediation-apply-plan-report.strict.json'),
      (publishGroup.sourceReports || []).join(', '),
    );
    add(
      'release unblock publish group remediation commands',
      commandText.includes('release:github-release-remediation-plan') &&
        commandText.includes('verify:github-release-remediation-plan:strict:report') &&
        commandText.includes('release:github-release-remediation-apply:plan') &&
        commandText.includes('verify:github-release-remediation-apply-plan:strict:report') &&
        commandText.includes('release:github-release-remediation-apply:env'),
      'release:github-release-remediation-plan, verify:github-release-remediation-plan:strict:report, release:github-release-remediation-apply:plan, verify:github-release-remediation-apply-plan:strict:report, and release:github-release-remediation-apply:env',
    );
    add(
      'release unblock publish group commercial finalization source coverage',
      groupSourcePaths.has('release/commercial-release-readiness-report.strict.json') &&
        groupSourcePaths.has('release/commercial-finalization-report.json') &&
        groupSourcePaths.has('release/commercial-finalization-report-verification.strict.json'),
      (publishGroup.sourceReports || []).join(', '),
    );
    add(
      'release unblock publish group commercial finalization commands',
      commandText.includes('release:commercial-finalize:commercial') &&
        commandText.includes('verify:commercial-finalization:commercial'),
      'release:commercial-finalize:commercial and verify:commercial-finalization:commercial',
    );
  }

  add(
    'release unblock remediation plan verified',
    Boolean(remediationPlan) &&
      Boolean(remediationReport) &&
      Boolean(remediationStrictReport) &&
      summary(remediationReport).blockers === 0 &&
      summary(remediationReport).warnings === 0 &&
      summary(remediationStrictReport).blockers === 0 &&
      summary(remediationStrictReport).warnings === 0,
    `plan=${remediationPlan?.status || 'missing'}, local=${summary(remediationReport).blockers}/${summary(remediationReport).warnings}, strict=${summary(remediationStrictReport).blockers}/${summary(remediationStrictReport).warnings}`,
  );
	  add(
	    'release unblock remediation apply plan verified',
	    Boolean(remediationApplyPlan) &&
      remediationApplyPlan.apply === false &&
      remediationApplyPlan.status === 'dry-run-ready' &&
      summary(remediationApplyPlan).blockers === 0 &&
      summary(remediationApplyPlan).warnings === 0 &&
      Number(remediationApplyPlan.summary?.actions || 0) === Number(remediationPlan?.summary?.requiredActions || 0),
    `apply=${remediationApplyPlan?.status || 'missing'}, actions=${remediationApplyPlan?.summary?.actions ?? 'missing'}, required=${remediationPlan?.summary?.requiredActions ?? 'missing'}`,
  );
  const commercialReadyRequired = commercialReadiness?.publishedReleaseReady === true ||
    commercialFinalization?.publishedReleaseReady === true;
  add(
    'release unblock commercial finalization reports verified',
    Boolean(commercialReadiness) &&
      Boolean(commercialFinalization) &&
      Boolean(commercialFinalizationVerification) &&
      summary(commercialFinalization).blockers === 0 &&
      summary(commercialFinalization).warnings === 0 &&
      summary(commercialFinalizationVerification).blockers === 0 &&
      summary(commercialFinalizationVerification).warnings === 0 &&
      (!commercialReadyRequired || (
        summary(commercialReadiness).blockers === 0 &&
        summary(commercialReadiness).warnings === 0 &&
        commercialReadiness.commercialReady === true &&
        commercialFinalization.commercialReady === true
      )),
    `readiness=${summary(commercialReadiness).blockers}/${summary(commercialReadiness).warnings}, finalization=${summary(commercialFinalization).blockers}/${summary(commercialFinalization).warnings}, verification=${summary(commercialFinalizationVerification).blockers}/${summary(commercialFinalizationVerification).warnings}, commercialReadyRequired=${commercialReadyRequired}`,
  );

  if (fileExists(markdownPath)) {
    const markdown = fs.readFileSync(path.join(desktopDir, markdownPath), 'utf8');
    add('release unblock notes status freshness', markdown.includes(`Status: ${plan.status}`), `Status: ${plan.status}`);
    add('release unblock notes blocker summary', markdown.includes(`Blocked action groups: ${plan.summary?.blockers}`), `Blocked action groups: ${plan.summary?.blockers}`);
    for (const group of groups) {
      add(`release unblock notes include ${group.id}`, markdown.includes(group.title), group.title);
    }
  }

  const releaseAssetPaths = new Set((manifest?.githubReleaseAssets || []).map((asset) => asset.path));
  const ciOnlyPaths = new Set((manifest?.ciOnlyArtifacts || []).map((asset) => asset.path));
  add('release asset manifest available to check unblock policy', Boolean(manifest), 'release/release-asset-manifest.json');
  if (manifest) {
    for (const relativePath of [planPath, markdownPath]) {
      add(
        `${relativePath} CI-only diagnostic`,
        !releaseAssetPaths.has(relativePath) && (!fileExists(relativePath) || ciOnlyPaths.has(relativePath)),
        'release unblock diagnostics are never GitHub Release assets',
      );
    }
  }

  if (requireClean) {
    add('release unblock plan clean', blockingGroups === 0 && warningGroups === 0, `${blockingGroups} blocker group(s), ${warningGroups} warning group(s)`);
  }

  printAndExit();
}

main();
