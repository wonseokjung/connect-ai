import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const requireProduction = process.argv.includes('--require-production');
const planPath = 'release/release-setup-plan.json';
const markdownPath = 'release/RELEASE_SETUP_PLAN.md';
const reportPath = strict
  ? 'release/release-setup-plan-report.strict.json'
  : 'release/release-setup-plan-report.json';
const checks = [];

const requiredSourcePaths = [
  'release/release-env-contract-report.json',
  'release/release-env-report.process.json',
  'release/release-env-report.json',
  'release/signing-readiness.json',
  'release/operator-readiness.json',
  'release/operator-readiness.github.json',
  'release/release-decision.strict.json',
  'release/release-promotion-plan.json',
  'release/release-manifest.json',
  'release/baseline-export-report.json',
  'release/baseline-freshness-report.json',
  'release/github-release-setup-report.json',
  'release/production-release-runbook-report.json',
  'release/production-readiness-summary.json',
  'release/release-unblock-plan.json',
  'release/release-unblock-plan-report.json',
  'release/release-credential-handoff.json',
  'release/release-credential-handoff-report.json',
  'release/release-credential-handoff-report.strict.json',
  'release/release-publication-seal.json',
  'release/commercial-release-readiness-report.strict.json',
  'release/commercial-finalization-report.json',
  'release/commercial-finalization-report-verification.strict.json',
  'release/github-release-publish-plan.json',
  'release/github-release-publish-plan-report.strict.json',
  'release/github-release-assets-report.json',
  'release/github-release-remediation-plan.json',
  'release/github-release-remediation-plan-report.json',
  'release/github-release-remediation-plan-report.strict.json',
  'release/github-release-remediation-apply-plan.json',
  'release/github-release-remediation-apply-plan-report.strict.json',
];

const requiredCommands = [
  'npm run release:setup-plan',
  'npm run verify:setup-plan:strict:report',
  'npm run verify:release-env-contract',
  'npm run release:env-bootstrap',
  'npm run verify:env-bootstrap:strict:report',
  'npm run release:operator-runbook:process:strict:report',
  'npm run signing:notary-profile:report:env',
  'npm run release:readiness-summary:strict:report',
  'npm run release:unblock-plan',
  'npm run verify:unblock-plan',
  'npm run release:publication-seal:strict:report',
  'npm run release:commercial-finalize',
  'npm run release:publish-assets:plan:env',
  'npm run verify:github-release-publish-plan:strict:report',
  'npm run verify:github-release-assets:strict:env',
  'npm run verify:github-release-remediation-plan:strict:report',
  'npm run release:github-release-remediation-apply:plan',
  'npm run verify:github-release-remediation-apply-plan:strict:report',
  'npm run release:operator-runbook:publish',
  'npm run release:operator-runbook:process:publish',
  'npm run release:commercial-finalize:commercial',
  'npm run verify:commercial-finalization:commercial',
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

function failedChecks(report) {
  return (report?.checks || []).filter((check) => check.ok !== true);
}

function remainingActions(report) {
  return (report?.remainingActions || []).filter((action) => action.blocking === true);
}

function flattenIssuesFromSourceReports(sourceReports) {
  const issues = [];
  for (const source of sourceReports || []) {
    for (const check of source.failedChecks || []) {
      issues.push({
        source: source.label,
        path: source.path,
        name: check.name,
        level: check.level || 'blocker',
        detail: check.detail,
      });
    }
    for (const action of source.remainingActions || []) {
      if (!action.blocking) continue;
      const details = Array.isArray(action.detail) ? action.detail : [action.detail];
      for (const detail of details.filter(Boolean)) {
        issues.push({
          source: source.label,
          path: source.path,
          name: action.id,
          level: 'blocker',
          detail,
        });
      }
    }
  }

  const seen = new Set();
  const unique = [];
  for (const issue of issues) {
    const key = `${issue.source}\0${issue.name}\0${issue.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

function issueKey(issue) {
  return `${issue.source}\0${issue.path}\0${issue.name}\0${issue.level}\0${issue.detail}`;
}

function generatedAtMatches(source, actual) {
  if (!actual || actual.parseError) return true;
  return (source.generatedAt || null) === (actual.generatedAt || null);
}

function summaryMatches(source, actual) {
  if (!actual || actual.parseError || !actual.summary) return source.summary == null;
  return Boolean(source.summary) &&
    Number(source.summary.blockers || 0) === summary(actual).blockers &&
    Number(source.summary.warnings || 0) === summary(actual).warnings;
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

function commandText(plan) {
  return Object.values(plan.commands || {})
    .flatMap((items) => Array.isArray(items) ? items : [])
    .map((item) => `${item.step || ''}\n${item.command || ''}\n${item.note || ''}`)
    .join('\n');
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

function expectedStatus({ productionReady, localCandidateReady }) {
  if (productionReady) return 'production-ready';
  if (localCandidateReady) return 'local-candidate-awaiting-external-setup';
  return 'not-ready';
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireProduction,
    source: planPath,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI release setup plan verification (${strict ? 'strict' : 'local'})`);
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
  const plan = readJson(planPath);
  const markdown = fileExists(markdownPath) ? fs.readFileSync(path.join(desktopDir, markdownPath), 'utf8') : '';
  add('release setup plan exists', Boolean(plan && !plan.parseError), plan?.parseError || planPath);
  add('release setup plan notes exist', fileExists(markdownPath), markdownPath);
  if (!plan || plan.parseError) {
    printAndExit();
    return;
  }

  const sourceReports = Array.isArray(plan.sourceReports) ? plan.sourceReports : [];
  const sourcePathSet = new Set(sourceReports.map((source) => source.path));
  const missingRequiredSources = requiredSourcePaths.filter((sourcePath) => !sourcePathSet.has(sourcePath));
  const duplicateSourcePaths = [...sourcePathSet].filter((sourcePath) => sourceReports.filter((source) => source.path === sourcePath).length > 1);
  const strictDecision = readJson('release/release-decision.strict.json');
  const promotion = readJson('release/release-promotion-plan.json');
  const readiness = readJson('release/production-readiness-summary.json');
  const publicationSeal = readJson('release/release-publication-seal.json');
  const baselineFreshness = readJson('release/baseline-freshness-report.json');
  const productionReady = Boolean(strictDecision?.productionReady && promotion?.productionReady && readiness?.productionReady && publicationSeal?.productionReady && baselineFreshness?.ok);
  const localCandidateReady = Boolean((strictDecision?.localCandidateReady || promotion?.localCandidateReady) && (!baselineFreshness || baselineFreshness.ok));
  const expectedIssues = flattenIssuesFromSourceReports(sourceReports);
  const expectedIssueKeys = new Set(expectedIssues.map(issueKey));
  const actualIssueKeys = new Set((plan.currentIssues || []).map(issueKey));
  const missingIssues = [...expectedIssueKeys].filter((key) => !actualIssueKeys.has(key));
  const extraIssues = [...actualIssueKeys].filter((key) => !expectedIssueKeys.has(key));
  const commands = commandText(plan);
  const serialized = `${JSON.stringify(plan, null, 2)}\n${markdown}`;
  const remoteBaselineCandidate = plan.remoteBaselineCandidate || {};
  const localBaselineMirror = plan.localBaselineMirror || {};
  const remoteBaselineValidationText = (remoteBaselineCandidate.validationCommands || [])
    .map((item) => `${item.step || ''}\n${item.command || ''}`)
    .join('\n');
  const localBaselineValidationText = (localBaselineMirror.validationCommands || [])
    .map((item) => `${item.step || ''}\n${item.command || ''}`)
    .join('\n');
  const packageVersion = pkg?.version || '0.4.8';
  const expectedMacZipName = `Connect-AI-${packageVersion}-arm64-mac.zip`;
  const expectedBaselineZipPath = `release/Connect-AI-${packageVersion}-baseline-arm64-mac.zip`;
  const credentialHandoff = readJson('release/release-credential-handoff.json');
  const handoffMirror = credentialHandoff?.localBaselineMirror || {};

  add('release setup schema version', plan.schemaVersion === 1, String(plan.schemaVersion));
  add('release setup generatedAt', Number.isFinite(Date.parse(plan.generatedAt || '')), plan.generatedAt || 'missing');
  add('release setup product version', plan.product?.version === pkg?.version, `${plan.product?.version || 'missing'} expected ${pkg?.version || 'missing'}`);
  add('release setup product appId', plan.product?.appId === pkg?.build?.appId, `${plan.product?.appId || 'missing'} expected ${pkg?.build?.appId || 'missing'}`);
  add('release setup boolean fields', typeof plan.productionReady === 'boolean' && typeof plan.localCandidateReady === 'boolean', `production=${plan.productionReady}, local=${plan.localCandidateReady}`);
  add('release setup production projection', plan.productionReady === productionReady, `reported=${plan.productionReady} expected=${productionReady}`);
  add('release setup local candidate projection', plan.localCandidateReady === localCandidateReady, `reported=${plan.localCandidateReady} expected=${localCandidateReady}`);
  add('release setup status projection', plan.status === expectedStatus({ productionReady, localCandidateReady }), `${plan.status || 'missing'} expected ${expectedStatus({ productionReady, localCandidateReady })}`);
  add('release setup source report array', sourceReports.length >= requiredSourcePaths.length, `${sourceReports.length} source report(s)`);
  add('release setup required source reports', missingRequiredSources.length === 0, missingRequiredSources.length ? `missing ${missingRequiredSources.join(', ')}` : 'required sources listed');
  add('release setup duplicate source paths', duplicateSourcePaths.length === 0, duplicateSourcePaths.length ? duplicateSourcePaths.join(', ') : 'none');

  for (const source of sourceReports) {
    const actualExists = fileExists(source.path || '');
    const actual = actualExists && String(source.path || '').endsWith('.json') ? readJson(source.path) : null;
    add(`release setup source present ${source.path}`, source.present === actualExists, `reported=${source.present} actual=${actualExists}`);
    if (actualExists && String(source.path || '').endsWith('.json')) {
      add(`release setup source parses ${source.path}`, Boolean(actual && !actual.parseError), actual?.parseError || 'valid JSON');
      add(`release setup source generatedAt ${source.path}`, generatedAtMatches(source, actual), `reported=${source.generatedAt || 'missing'} actual=${actual?.generatedAt || 'missing'}`, 'warn');
      add(`release setup source summary ${source.path}`, summaryMatches(source, actual), source.summary ? `${source.summary.blockers} blocker(s), ${source.summary.warnings} warning(s)` : 'no summary', 'warn');
    }
    if (source.present) {
      add(`release setup source failed checks ${source.path}`, Array.isArray(source.failedChecks), `${source.failedChecks?.length ?? 'missing'} failed check(s)`);
      add(`release setup source remaining actions ${source.path}`, Array.isArray(source.remainingActions), `${source.remainingActions?.length ?? 'missing'} action(s)`);
    }
  }

  add('release setup current issues array', Array.isArray(plan.currentIssues), `${plan.currentIssues?.length ?? 'missing'} issue(s)`);
  add('release setup current issue projection', missingIssues.length === 0 && extraIssues.length === 0, `missing=${missingIssues.length}, extra=${extraIssues.length}`);
  add('release setup GitHub variables', ['CONNECT_AI_BASELINE_URL', 'CONNECT_AI_BASELINE_SHA256'].every((name) => plan.github?.requiredVariables?.includes(name)), (plan.github?.requiredVariables || []).join(', '));
  add('release setup GitHub secrets', ['CONNECT_AI_RELEASE_AUDIT_TOKEN', 'BUILD_CERTIFICATE_BASE64', 'P12_PASSWORD', 'KEYCHAIN_PASSWORD'].every((name) => plan.github?.requiredSecrets?.includes(name)), (plan.github?.requiredSecrets || []).join(', '));
  add('release setup notarization groups', Array.isArray(plan.github?.notarizationSecretGroups) && plan.github.notarizationSecretGroups.length >= 2, `${plan.github?.notarizationSecretGroups?.length || 0} group(s)`);
  add('release setup remote baseline candidate guard', Boolean(plan.remoteBaselineCandidate), plan.remoteBaselineCandidate ? 'present' : 'missing');
	  add('release setup remote baseline candidate source', remoteBaselineCandidate.sourceReport === 'release/github-release-assets-report.strict.json' || remoteBaselineCandidate.status === 'missing', remoteBaselineCandidate.sourceReport || 'missing');
	  add('release setup remote baseline candidate status', ['missing', 'not-approved-baseline-url', 'size-match-sha-unverified'].includes(remoteBaselineCandidate.status), remoteBaselineCandidate.status || 'missing');
	  add(
	    'release setup baseline URL candidate shape',
	    !remoteBaselineCandidate.remoteUrl || baselineUrlLooksValid(remoteBaselineCandidate.remoteUrl, pkg?.version || ''),
	    remoteBaselineCandidate.remoteUrl || 'missing',
	  );
	  add(
	    'release setup baseline commands use candidate URL and SHA',
	    !remoteBaselineCandidate.remoteUrl ||
	      (commands.includes(remoteBaselineCandidate.remoteUrl) &&
	        commands.includes(remoteBaselineCandidate.expectedBaselineSha256 || 'missing')),
	    'candidate URL and expected SHA are projected into local, GitHub, and workflow commands',
	  );
	  add(
	    'release setup GitHub baseline command guard',
	    commands.includes('verify:remote-baseline-approved:refresh') &&
	      commands.includes('gh variable set CONNECT_AI_BASELINE_URL'),
	    'GitHub baseline variable command is guarded by the remote baseline approval gate',
	  );
	  add(
	    'release setup workflow baseline command guard',
	    commands.includes('verify:remote-baseline-approved:refresh\n' +
	      'gh workflow run "Build Connect AI Desktop" -f baseline_url='),
	    'manual CI workflow command is guarded by the remote baseline approval gate',
	  );
	  add('release setup local baseline mirror guard', Boolean(plan.localBaselineMirror), plan.localBaselineMirror ? 'present' : 'missing');
  add('release setup local baseline mirror status', ['missing', 'verified-match', 'mismatch'].includes(localBaselineMirror.status), localBaselineMirror.status || 'missing');
  add(
    'release setup local baseline mirror handoff projection',
    Boolean(credentialHandoff) &&
      localBaselineMirror.status === handoffMirror.status &&
      localBaselineMirror.asset === handoffMirror.asset &&
      localBaselineMirror.approvedUploadSource === handoffMirror.approvedUploadSource &&
      localBaselineMirror.expectedBaselineSha256 === handoffMirror.expectedBaselineSha256 &&
      localBaselineMirror.matchesExport === handoffMirror.matchesExport,
    `setup=${localBaselineMirror.status || 'missing'} handoff=${handoffMirror.status || 'missing'}`,
  );
  add(
    'release setup local baseline mirror validation commands',
    localBaselineValidationText.includes('shasum -a 256') &&
      localBaselineValidationText.includes(expectedMacZipName) &&
      commands.includes('Verify the approved baseline upload source and optional Downloads mirror'),
    'local mirror and exported baseline SHA comparison documented before env setup',
  );
  add(
    'release setup remote baseline candidate validation commands',
    remoteBaselineValidationText.includes(`gh release download desktop-v${packageVersion}`) &&
      remoteBaselineValidationText.includes('shasum -a 256') &&
      commands.includes('Reject remote same-name zip unless it matches exported baseline SHA-256'),
    'remote same-name zip download and SHA comparison documented before baseline URL fill',
  );
  add('release setup local env template', plan.localEnv?.template === '.env.release.example' && plan.localEnv?.templatePresent === fileExists('.env.release.example'), JSON.stringify(plan.localEnv || {}));
  add('release setup command sections', ['localEnv', 'github', 'verification', 'release'].every((name) => Array.isArray(plan.commands?.[name]) && plan.commands[name].length > 0), Object.keys(plan.commands || {}).join(', '));
  for (const command of requiredCommands) {
    add(`release setup command ${command}`, commands.includes(command), command);
  }
  add('release setup safety rules', Array.isArray(plan.safetyRules) && plan.safetyRules.length >= 8, `${plan.safetyRules?.length || 0} rule(s)`);
  add('release setup production safety rule', /productionReady: true/.test((plan.safetyRules || []).join('\n')) && /baseline-freshness-report\.json/.test((plan.safetyRules || []).join('\n')), 'productionReady and baseline freshness gates documented');
  add('release setup local baseline safety rule', /approved upload source/i.test((plan.safetyRules || []).join('\n')) && /matching bytes and SHA-256/i.test((plan.safetyRules || []).join('\n')), 'approved upload source and mirror SHA rule documented');
  add('release setup remote baseline safety rule', /same-name Connect AI zip/.test((plan.safetyRules || []).join('\n')) && (plan.safetyRules || []).join('\n').includes(`SHA-256 matches ${expectedBaselineZipPath}`), 'remote same-name zip cannot be used as baseline unless SHA matches');
  add('release setup asset manifest safety rule', /release\/release-asset-manifest\.json/.test((plan.safetyRules || []).join('\n')), 'release asset manifest upload allowlist documented');
  add('release setup secret material scan', !hasSecretMaterial(serialized), 'no private key, certificate body, GitHub token, or API key literal patterns');
  add('release setup markdown status', markdown.includes(`Status: ${plan.status}`), `Status: ${plan.status}`);
  add('release setup markdown source reports', requiredSourcePaths.every((sourcePath) => markdown.includes(sourcePath)), 'required source paths documented');
  add('release setup markdown commands', requiredCommands.every((command) => markdown.includes(command)), 'required commands documented');
  add('release setup markdown local baseline mirror', markdown.includes('Approved Baseline Upload Source') && markdown.includes(localBaselineMirror.status || 'missing'), 'local baseline mirror upload source documented');
  add('release setup markdown remote baseline guard', markdown.includes('Remote Baseline Candidate Guard') && markdown.includes(remoteBaselineCandidate.status || 'missing'), 'remote baseline guard documented');

  if (requireProduction) {
    add('release setup require production', plan.productionReady === true, `productionReady=${plan.productionReady}`);
  }

  printAndExit();
}

main();
