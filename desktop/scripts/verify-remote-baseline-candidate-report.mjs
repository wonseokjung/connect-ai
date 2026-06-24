import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const sourcePath = strict
  ? 'release/remote-baseline-candidate-report.strict.json'
  : 'release/remote-baseline-candidate-report.json';
const reportPath = strict
  ? 'release/remote-baseline-candidate-report-verification.strict.json'
  : 'release/remote-baseline-candidate-report-verification.json';
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

function httpsZipUrl(value, version) {
  return typeof value === 'string' &&
    /^https:\/\//.test(value) &&
    value.endsWith('.zip') &&
    (!version || value.includes(version));
}

function generatedAtMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
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

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    source: sourcePath,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI remote baseline candidate report verification (${strict ? 'strict' : 'local'})`);
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
  const report = readJson(sourcePath);
  const envBootstrap = readJson('release/release-env-bootstrap.json');
  const baselineExport = readJson('release/baseline-export-report.json');
  const counts = summary(report);
  const allowedRejectedStatuses = [
    'remote-size-mismatch',
    'remote-sha-mismatch',
    'remote-unreachable',
    'remote-download-failed',
  ];
  const expectedSha = report?.expected?.sha256 || '';
  const expectedBytes = Number(report?.expected?.bytes || 0);
  const remoteBytes = report?.remote?.bytes == null ? null : Number(report.remote.bytes);
  const remoteSha = report?.remote?.sha256 || null;
  const approved = report?.approvedForBaselineUrl === true;
  const rejected = allowedRejectedStatuses.includes(report?.status);

  add('remote baseline candidate report exists', Boolean(report && !report.parseError), report?.parseError || sourcePath);
  if (!report || report.parseError) {
    printAndExit();
    return;
  }

  add('remote baseline candidate schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('remote baseline candidate strict mode', !strict || report.strict === true, `strict=${report.strict}`);
  add('remote baseline candidate generatedAt', generatedAtMs(report.generatedAt) > 0, report.generatedAt || 'missing');
  add('remote baseline candidate summary clean', counts.blockers === 0 && counts.warnings === 0, `${counts.blockers} blocker(s), ${counts.warnings} warning(s)`);
  add('remote baseline candidate product version', report.product?.version === pkg?.version, `${report.product?.version || 'missing'} expected ${pkg?.version || 'missing'}`);
  add('remote baseline candidate URL shape', httpsZipUrl(report.candidate?.url, pkg?.version || ''), report.candidate?.url || 'missing');
  add('remote baseline candidate source URL consistency', report.candidate?.sourcesConsistent === true, (report.candidate?.sourceUrls || []).join(', ') || 'fallback');
  add('remote baseline candidate expected path matches export', report.expected?.path === baselineExport?.export?.path, `${report.expected?.path || 'missing'} expected ${baselineExport?.export?.path || 'missing'}`);
  add('remote baseline candidate expected bytes match export', expectedBytes === Number(baselineExport?.export?.bytes || 0), `${expectedBytes || 'missing'} expected ${baselineExport?.export?.bytes || 'missing'}`);
  add('remote baseline candidate expected SHA shape', /^[a-f0-9]{64}$/i.test(expectedSha), expectedSha || 'missing');
  add('remote baseline candidate expected SHA matches export', expectedSha === baselineExport?.export?.sha256, `${expectedSha || 'missing'} expected ${baselineExport?.export?.sha256 || 'missing'}`);
  add('remote baseline candidate approved source verified', report.expected?.actualBytes === expectedBytes && report.expected?.actualSha256 === expectedSha, `${report.expected?.actualBytes ?? 'missing'} bytes, ${report.expected?.actualSha256 || 'missing'}`);
  add('remote baseline candidate reachable or explicitly failed', Boolean(report.remote?.statusCode || report.remote?.error), report.remote?.statusCode ? `HTTP ${report.remote.statusCode}` : report.remote?.error || 'missing');
  add('remote baseline candidate no approval without SHA', !approved || (report.validationMode === 'download-sha256' && remoteSha === expectedSha), `approved=${approved}, mode=${report.validationMode || 'missing'}, remoteSha=${remoteSha || 'missing'}`);
  add('remote baseline candidate approval semantics', approved ? report.status === 'approved-for-baseline-url' : rejected, `status=${report.status || 'missing'}, approved=${approved}`);
  add('remote baseline candidate safe-use semantics', report.safeForDirectUse === approved, `safeForDirectUse=${report.safeForDirectUse}, approved=${approved}`);

  if (approved) {
    add('remote baseline approved bytes match', remoteBytes === expectedBytes, `${remoteBytes ?? 'missing'} expected ${expectedBytes}`);
    add('remote baseline approved SHA match', remoteSha === expectedSha, `${remoteSha || 'missing'} expected ${expectedSha}`);
  } else if (report.status === 'remote-size-mismatch') {
    add('remote baseline rejected by size mismatch', remoteBytes != null && remoteBytes !== expectedBytes, `${remoteBytes ?? 'missing'} expected ${expectedBytes}`);
  } else if (report.status === 'remote-sha-mismatch') {
    add('remote baseline rejected by SHA mismatch', remoteSha && remoteSha !== expectedSha, `${remoteSha || 'missing'} expected ${expectedSha}`);
  }

  add(
    'remote baseline env bootstrap remains operator gated unless approved',
    approved || envBootstrap?.baselineUrlRecommendation?.safeForDirectUse === false,
    `approved=${approved}, bootstrapSafe=${envBootstrap?.baselineUrlRecommendation?.safeForDirectUse}`,
  );
  add('remote baseline candidate secret scan', !hasSecretMaterial(JSON.stringify(report)), 'no private key, certificate body, GitHub token, or API key literal patterns');

  printAndExit();
}

main();
