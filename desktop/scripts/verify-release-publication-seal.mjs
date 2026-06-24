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

const sealPath = 'release/release-publication-seal.json';
const notesPath = 'release/RELEASE_PUBLICATION_SEAL.md';
const reportPath = strict
  ? 'release/release-publication-seal-verification.strict.json'
  : 'release/release-publication-seal-verification.json';

const requiredSourcePaths = [
  'release/release-decision.strict.json',
  'release/release-promotion-plan.json',
  'release/production-readiness-summary.json',
  'release/release-asset-manifest.json',
  'release/release-manifest.json',
  'release/baseline-export-report.json',
  'release/baseline-export-report-verification.strict.json',
  'release/baseline-freshness-report.json',
  'release/release-credential-handoff.json',
  'release/release-credential-handoff-report.strict.json',
  'release/release-setup-plan.json',
  'release/release-setup-plan-report.strict.json',
  'release/github-release-publish-plan.json',
  'release/github-release-remediation-apply-plan.json',
  'release/github-release-remediation-apply-plan-report.strict.json',
  'release/RELEASE_NOTES.md',
];

const productionGateIds = new Set([
  'local-candidate-ready',
  'baseline-export-ready',
  'baseline-export-verified-ready',
  'baseline-freshness-ready',
  'remote-baseline-guard-ready',
  'strict-decision-production-ready',
  'promotion-production-ready',
  'readiness-production-ready',
  'release-notes-signed',
  'release-manifest-signed-notarized',
]);
const requiredGateIds = [
  'local-candidate-ready',
  'baseline-export-ready',
  'baseline-export-verified-ready',
  'baseline-freshness-ready',
  'remote-baseline-guard-ready',
  'strict-decision-production-ready',
  'promotion-production-ready',
  'readiness-production-ready',
  'release-notes-signed',
  'release-manifest-signed-notarized',
  'asset-manifest-ready',
  'publish-plan-clean',
  'remote-assets-verified',
  'remote-remediation-plan-verified',
  'remote-remediation-apply-plan-ready',
  'remote-remediation-upload-permission-ready',
  'readiness-published-ready',
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
    source: sealPath,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI release publication seal verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${reportPath}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const seal = readJson(sealPath);
  const pkg = readJson('package.json');
  add('release publication seal exists', Boolean(seal && !seal.parseError), seal?.parseError || sealPath);
  add('release publication seal notes exist', fs.existsSync(path.join(desktopDir, notesPath)), notesPath);
  if (!seal || seal.parseError) {
    writeReport();
    return;
  }

  const consistencyChecks = Array.isArray(seal.consistencyChecks) ? seal.consistencyChecks : [];
  const gates = Array.isArray(seal.gates) ? seal.gates : [];
  const nextActions = Array.isArray(seal.nextActions) ? seal.nextActions : [];
  const sourceReports = Array.isArray(seal.sourceReports) ? seal.sourceReports : [];
  const sourcePathSet = new Set(sourceReports.map((source) => source.path).filter(Boolean));
  const missingRequiredSources = requiredSourcePaths.filter((sourcePath) => !sourcePathSet.has(sourcePath));
  const gateById = new Map(gates.map((gate) => [gate.id, gate]));
  const missingRequiredGates = requiredGateIds.filter((id) => !gateById.has(id));
  const duplicateGateIds = gates
    .map((gate) => gate.id)
    .filter((id, index, ids) => id && ids.indexOf(id) !== index);
  const consistencyBlockers = consistencyChecks.filter((check) => !check.ok && check.level === 'blocker').length;
  const consistencyWarnings = consistencyChecks.filter((check) => !check.ok && check.level === 'warn').length;
  const productionBlockers = gates.filter((gate) => !gate.ok && (gate.phase === 'local' || gate.phase === 'production')).length;
  const publicationBlockers = gates.filter((gate) => !gate.ok && gate.phase === 'publication').length;
  const productionReady = [...productionGateIds].every((id) => gateById.get(id)?.ok === true);
  const publicationGateIds = requiredGateIds.filter((id) => gateById.get(id)?.phase === 'publication');
  const publishedReleaseReady = productionReady && publicationGateIds.length > 0 && publicationGateIds.every((id) => gateById.get(id)?.ok === true);
  const commercialReady = publishedReleaseReady;
  const localCandidateGate = gates.find((gate) => gate.id === 'local-candidate-ready');
  const localCandidateReady = Boolean(localCandidateGate?.ok);
  const failedGateIds = gates.filter((gate) => !gate.ok).map((gate) => gate.id).sort();
  const nextActionIds = nextActions.map((action) => action.id).sort();
  const notesStatus = seal.releaseNotes?.status || null;
  const serialized = JSON.stringify(seal);

  add('release publication seal schema version', seal.schemaVersion === 1, String(seal.schemaVersion));
  add('release publication seal generatedAt', Number.isFinite(Date.parse(seal.generatedAt || '')), seal.generatedAt || 'missing');
  add('release publication seal product version', seal.product?.version === pkg?.version, `${seal.product?.version || 'missing'} expected ${pkg?.version || 'missing'}`);
  add('release publication seal product appId', seal.product?.appId === pkg?.build?.appId, `${seal.product?.appId || 'missing'} expected ${pkg?.build?.appId || 'missing'}`);
  add('release publication seal release tag', seal.product?.releaseTag === `desktop-v${pkg?.version}`, `${seal.product?.releaseTag || 'missing'} expected desktop-v${pkg?.version || 'missing'}`);
  add('release publication seal strict metadata', strict ? seal.strict === true : typeof seal.strict === 'boolean', `strict=${seal.strict}`);
  add('release publication seal readiness booleans', typeof seal.localCandidateReady === 'boolean' && typeof seal.productionReady === 'boolean' && typeof seal.publishedReleaseReady === 'boolean' && typeof seal.commercialReady === 'boolean', `local=${seal.localCandidateReady}, production=${seal.productionReady}, published=${seal.publishedReleaseReady}, commercial=${seal.commercialReady}`);
  add('release publication seal local candidate projection', seal.localCandidateReady === localCandidateReady, `reported=${seal.localCandidateReady} expected=${localCandidateReady}`);
  add('release publication seal production projection', seal.productionReady === productionReady, `reported=${seal.productionReady} expected=${productionReady}`);
  add('release publication seal published projection', seal.publishedReleaseReady === publishedReleaseReady, `reported=${seal.publishedReleaseReady} expected=${publishedReleaseReady}`);
  add('release publication seal commercial projection', seal.commercialReady === commercialReady, `reported=${seal.commercialReady} expected=${commercialReady}`);
  add('release publication seal status', seal.status === expectedStatus({ productionReady, publishedReleaseReady, localCandidateReady }), `${seal.status || 'missing'} expected ${expectedStatus({ productionReady, publishedReleaseReady, localCandidateReady })}`);
  add('release publication seal summary blockers', asNumber(seal.summary?.blockers) === consistencyBlockers, `${seal.summary?.blockers ?? 'missing'} expected ${consistencyBlockers}`);
  add('release publication seal summary warnings', asNumber(seal.summary?.warnings) === consistencyWarnings, `${seal.summary?.warnings ?? 'missing'} expected ${consistencyWarnings}`);
  add('release publication seal gate summary production blockers', asNumber(seal.gateSummary?.productionBlockers) === productionBlockers, `${seal.gateSummary?.productionBlockers ?? 'missing'} expected ${productionBlockers}`);
  add('release publication seal gate summary publication blockers', asNumber(seal.gateSummary?.publicationBlockers) === publicationBlockers, `${seal.gateSummary?.publicationBlockers ?? 'missing'} expected ${publicationBlockers}`);
  add('release publication seal gate summary count', asNumber(seal.gateSummary?.gates) === gates.length, `${seal.gateSummary?.gates ?? 'missing'} expected ${gates.length}`);
  add('release publication seal consistency check array', consistencyChecks.length > 0, `${consistencyChecks.length} check(s)`);
  add('release publication seal gate array', gates.length > 0, `${gates.length} gate(s)`);
  add('release publication seal required gates', missingRequiredGates.length === 0, missingRequiredGates.length ? `missing ${missingRequiredGates.join(', ')}` : 'required gates present');
  add('release publication seal duplicate gate ids', duplicateGateIds.length === 0, duplicateGateIds.length ? duplicateGateIds.join(', ') : 'none');
  add('release publication seal next actions', failedGateIds.join(',') === nextActionIds.join(','), `next=${nextActionIds.join(',') || 'none'} failed=${failedGateIds.join(',') || 'none'}`);
  add('release publication seal notes status projection', seal.releaseNotes?.signedAndNotarized === (notesStatus === 'signed-and-notarized'), `status=${notesStatus || 'missing'}, signed=${seal.releaseNotes?.signedAndNotarized}`);
  add('release publication seal source report array', sourceReports.length >= requiredSourcePaths.length, `${sourceReports.length} source report(s)`);
  add('release publication seal required source reports', missingRequiredSources.length === 0, missingRequiredSources.length ? `missing ${missingRequiredSources.join(', ')}` : 'required sources listed');
  const remoteBaselineGate = gateById.get('remote-baseline-guard-ready');
  const remoteBaselineGateDetail = JSON.stringify(remoteBaselineGate?.detail || '');
  const remoteBaselineConsistency = consistencyChecks.find((check) => check.id === 'remote-baseline-guard-source-coherence');
  const remoteBaselineConsistencyDetail = JSON.stringify(remoteBaselineConsistency?.detail || '');
  add(
    'release publication seal remote baseline guard evidence',
    remoteBaselineGate?.ok === true &&
      remoteBaselineConsistency?.ok === true &&
      remoteBaselineGateDetail.includes('not-approved-baseline-url') &&
      remoteBaselineGateDetail.includes('setupVerified=true') &&
      remoteBaselineGateDetail.includes('credentialHandoffVerified=true') &&
      remoteBaselineConsistencyDetail.includes('safetyRuleDocumented=true'),
    remoteBaselineGateDetail || remoteBaselineConsistencyDetail || 'missing remote baseline guard evidence',
  );
  for (const source of sourceReports) {
    const actualExists = fs.existsSync(path.join(desktopDir, source.path || ''));
    add(`release publication seal source present ${source.path}`, source.present === actualExists, `reported=${source.present} actual=${actualExists}`, source.required ? 'blocker' : 'warn');
    if (source.kind === 'json' && actualExists) {
      const actual = readJson(source.path);
      add(`release publication seal source parses ${source.path}`, Boolean(actual && !actual.parseError), actual?.parseError || 'valid JSON', source.required ? 'blocker' : 'warn');
    }
  }
  add('release publication seal secret material scan', !hasSecretMaterial(serialized), 'no private key, certificate body, GitHub token, or API key literal patterns');

  if (requireProduction) {
    add('release publication seal require production', seal.productionReady === true, `productionReady=${seal.productionReady}`);
  }
  if (requirePublished) {
    add('release publication seal require published', seal.publishedReleaseReady === true, `publishedReleaseReady=${seal.publishedReleaseReady}`);
  }

  writeReport();
}

main();
