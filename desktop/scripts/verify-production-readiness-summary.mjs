import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const requireProduction = process.argv.includes('--require-production');
const requirePublished = process.argv.includes('--require-published');
const checks = [];

const summaryPath = 'release/production-readiness-summary.json';
const notesPath = 'release/PRODUCTION_READINESS_SUMMARY.md';
const reportPath = strict
  ? 'release/production-readiness-summary-verification.strict.json'
  : 'release/production-readiness-summary-verification.json';

const localGateIds = [
  'local-decision-ready',
  'local-evidence-clean',
  'baseline-export-clean',
  'baseline-export-verified',
  'baseline-freshness-clean',
  'remote-baseline-guard-ready',
];
const productionGateIds = [
  ...localGateIds,
  'strict-evidence-clean',
  'release-env-ready',
  'signing-ready',
  'github-setup-ready',
  'github-operator-ready',
  'promotion-ready',
  'strict-decision-ready',
];
const publicationGateIds = [
  'publish-plan-ready',
  'asset-manifest-ready',
  'remote-assets-verified',
  'remote-remediation-plan-verified',
  'remote-remediation-baseline-url-guard-ready',
  'remote-remediation-apply-plan-ready',
  'remote-remediation-upload-permission-ready',
];
const requiredGateIds = [...productionGateIds, ...publicationGateIds];
const requiredSourcePaths = [
  'release/release-decision.json',
  'release/release-decision.strict.json',
  'release/evidence-report.json',
  'release/evidence-report.strict.json',
  'release/baseline-export-report.json',
  'release/baseline-export-report-verification.strict.json',
  'release/baseline-freshness-report.json',
  'release/release-promotion-plan.json',
  'release/release-env-report.json',
  'release/release-env-report.process.json',
  'release/signing-readiness.json',
  'release/operator-readiness.json',
  'release/operator-readiness.github.json',
  'release/github-release-setup-report.json',
  'release/github-release-publish-plan.json',
  'release/github-release-remediation-apply-plan.json',
  'release/github-release-remediation-apply-plan-report.strict.json',
  'release/release-credential-handoff.json',
  'release/release-credential-handoff-report.strict.json',
  'release/release-setup-plan.json',
  'release/release-setup-plan-report.strict.json',
  'release/preflight-report.json',
  'release/release-asset-manifest.json',
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

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function asNumber(value) {
  return Number(value || 0);
}

function expectedStatus({ productionReady, publishedReleaseReady, localCandidateReady }) {
  if (publishedReleaseReady) return 'published-release-ready';
  if (productionReady) return 'production-ready-awaiting-publication';
  if (localCandidateReady) return 'local-candidate-awaiting-external-setup';
  return 'not-ready';
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

function writeReport() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    requireProduction,
    requirePublished,
    source: summaryPath,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI production readiness summary verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${reportPath}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const readiness = readJson(summaryPath);
  const pkg = readJson('package.json');
  add('production readiness summary exists', Boolean(readiness && !readiness.parseError), readiness?.parseError || summaryPath);
  add('production readiness summary notes exist', fs.existsSync(path.join(desktopDir, notesPath)), notesPath);
  if (!readiness || readiness.parseError) {
    writeReport();
    return;
  }

  const gates = Array.isArray(readiness.gates) ? readiness.gates : [];
  const nextActions = Array.isArray(readiness.nextActions) ? readiness.nextActions : [];
  const sourceReports = Array.isArray(readiness.sourceReports) ? readiness.sourceReports : [];
  const gateById = new Map(gates.map((gate) => [gate.id, gate]));
  const sourcePathSet = new Set(sourceReports.map((source) => source.path).filter(Boolean));
  const missingRequiredGates = requiredGateIds.filter((id) => !gateById.has(id));
  const missingRequiredSources = requiredSourcePaths.filter((sourcePath) => !sourcePathSet.has(sourcePath));
  const duplicateGateIds = gates
    .map((gate) => gate.id)
    .filter((id, index, ids) => id && ids.indexOf(id) !== index);
  const failedBlocking = gates.filter((gate) => !gate.ok && gate.blocking !== false);
  const failedWarnings = gates.filter((gate) => !gate.ok && gate.blocking === false);
  const localCandidateReady = localGateIds.every((id) => gateById.get(id)?.ok === true);
  const productionReady = productionGateIds.every((id) => gateById.get(id)?.ok === true);
  const publishedReleaseReady = productionReady && publicationGateIds.every((id) => gateById.get(id)?.ok === true);
  const commercialReady = publishedReleaseReady;
  const failedGateIds = gates.filter((gate) => !gate.ok).map((gate) => gate.id).sort();
  const nextActionIds = nextActions.map((action) => action.id).sort();
  const serialized = JSON.stringify(readiness);

  add('production readiness schema version', readiness.schemaVersion === 1, String(readiness.schemaVersion));
  add('production readiness generatedAt', Number.isFinite(Date.parse(readiness.generatedAt || '')), readiness.generatedAt || 'missing');
  add('production readiness product version', readiness.product?.version === pkg?.version, `${readiness.product?.version || 'missing'} expected ${pkg?.version || 'missing'}`);
  add('production readiness product appId', readiness.product?.appId === pkg?.build?.appId, `${readiness.product?.appId || 'missing'} expected ${pkg?.build?.appId || 'missing'}`);
  add('production readiness strict metadata', strict ? readiness.strict === true : typeof readiness.strict === 'boolean', `strict=${readiness.strict}`);
  add('production readiness boolean fields', typeof readiness.localCandidateReady === 'boolean' && typeof readiness.productionReady === 'boolean' && typeof readiness.publishedReleaseReady === 'boolean' && typeof readiness.commercialReady === 'boolean', `local=${readiness.localCandidateReady}, production=${readiness.productionReady}, published=${readiness.publishedReleaseReady}, commercial=${readiness.commercialReady}`);
  add('production readiness local candidate projection', readiness.localCandidateReady === localCandidateReady, `reported=${readiness.localCandidateReady} expected=${localCandidateReady}`);
  add('production readiness production projection', readiness.productionReady === productionReady, `reported=${readiness.productionReady} expected=${productionReady}`);
  add('production readiness published projection', readiness.publishedReleaseReady === publishedReleaseReady, `reported=${readiness.publishedReleaseReady} expected=${publishedReleaseReady}`);
  add('production readiness commercial projection', readiness.commercialReady === commercialReady, `reported=${readiness.commercialReady} expected=${commercialReady}`);
  add('production readiness status', readiness.status === expectedStatus({ productionReady, publishedReleaseReady, localCandidateReady }), `${readiness.status || 'missing'} expected ${expectedStatus({ productionReady, publishedReleaseReady, localCandidateReady })}`);
  add('production readiness summary blockers', asNumber(readiness.summary?.blockers) === failedBlocking.length, `${readiness.summary?.blockers ?? 'missing'} expected ${failedBlocking.length}`);
  add('production readiness summary warnings', asNumber(readiness.summary?.warnings) === failedWarnings.length, `${readiness.summary?.warnings ?? 'missing'} expected ${failedWarnings.length}`);
  add('production readiness gate array', gates.length >= requiredGateIds.length, `${gates.length} gate(s)`);
  add('production readiness required gates', missingRequiredGates.length === 0, missingRequiredGates.length ? `missing ${missingRequiredGates.join(', ')}` : 'required gates present');
  add('production readiness duplicate gate ids', duplicateGateIds.length === 0, duplicateGateIds.length ? duplicateGateIds.join(', ') : 'none');
  add('production readiness gate phase vocabulary', gates.every((gate) => ['local', 'production', 'publication'].includes(gate.phase)), 'expected local/production/publication phases');
  add('production readiness next actions', failedGateIds.join(',') === nextActionIds.join(','), `next=${nextActionIds.join(',') || 'none'} failed=${failedGateIds.join(',') || 'none'}`);
  add('production readiness source report array', sourceReports.length >= requiredSourcePaths.length, `${sourceReports.length} source report(s)`);
  add('production readiness required source reports', missingRequiredSources.length === 0, missingRequiredSources.length ? `missing ${missingRequiredSources.join(', ')}` : 'required sources listed');
  const remoteBaselineGate = gateById.get('remote-baseline-guard-ready');
  const remoteBaselineGateDetail = JSON.stringify(remoteBaselineGate?.detail || '');
  add(
    'production readiness remote baseline guard evidence',
    remoteBaselineGate?.ok === true &&
      remoteBaselineGateDetail.includes('not-approved-baseline-url') &&
      remoteBaselineGateDetail.includes('setupVerified=true') &&
      remoteBaselineGateDetail.includes('credentialHandoffVerified=true') &&
      remoteBaselineGateDetail.includes('safetyRuleDocumented=true'),
    remoteBaselineGateDetail || 'missing remote baseline guard gate',
  );
  const remediationBaselineGate = gateById.get('remote-remediation-baseline-url-guard-ready');
  const remediationBaselineGateDetail = JSON.stringify(remediationBaselineGate?.detail || '');
  add(
    'production readiness remediation baseline URL guard evidence',
    remediationBaselineGate?.ok === true &&
      remediationBaselineGateDetail.includes('approved-source-verified-remote-baseline-rejected') &&
      remediationBaselineGateDetail.includes('approvedUploadSource=release/Connect-AI-0.4.8-baseline-arm64-mac.zip') &&
      remediationBaselineGateDetail.includes('remoteStatus=not-approved-baseline-url') &&
      remediationBaselineGateDetail.includes('verificationClean=true') &&
      remediationBaselineGateDetail.includes('applyPlanClean=true'),
    remediationBaselineGateDetail || 'missing remediation baseline URL guard gate',
  );

  for (const source of sourceReports) {
    const actualExists = fs.existsSync(path.join(desktopDir, source.path || ''));
    add(`production readiness source present ${source.path}`, source.present === actualExists, `reported=${source.present} actual=${actualExists}`, source.required ? 'blocker' : 'warn');
    if (actualExists && String(source.path || '').endsWith('.json')) {
      const actual = readJson(source.path);
      add(`production readiness source parses ${source.path}`, Boolean(actual && !actual.parseError), actual?.parseError || 'valid JSON', source.required ? 'blocker' : 'warn');
    }
    if (source.present && source.summary) {
      add(`production readiness source summary ${source.path}`, Number.isFinite(source.summary.blockers) && Number.isFinite(source.summary.warnings), `${source.summary.blockers} blocker(s), ${source.summary.warnings} warning(s)`, source.required ? 'blocker' : 'warn');
    }
  }

  add('production readiness secret material scan', !hasSecretMaterial(serialized), 'no private key, certificate body, GitHub token, or API key literal patterns');

  if (requireProduction) {
    add('production readiness require production', readiness.productionReady === true, `productionReady=${readiness.productionReady}`);
  }
  if (requirePublished) {
    add('production readiness require published', readiness.publishedReleaseReady === true, `publishedReleaseReady=${readiness.publishedReleaseReady}`);
  }

  writeReport();
}

main();
