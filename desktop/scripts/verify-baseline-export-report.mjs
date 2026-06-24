import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';

const {
  DEFAULT_ASAR_SHA256,
  DEFAULT_VERSION,
  baselineResources,
} = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const sourceReportPath = 'release/baseline-export-report.json';
const markdownPath = 'release/BASELINE_EXPORT.md';
const freshnessReportPath = 'release/baseline-freshness-report.json';
const verificationPath = strict
  ? 'release/baseline-export-report-verification.strict.json'
  : 'release/baseline-export-report-verification.json';
const checks = [];
const packageJson = readJson('package.json');

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

function readText(relativePath) {
  const file = path.join(desktopDir, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function summary(report) {
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
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

function fullExportPath(report) {
  if (typeof report?.export?.absolutePath === 'string' && report.export.absolutePath) {
    return path.resolve(report.export.absolutePath);
  }
  if (typeof report?.export?.path === 'string' && report.export.path) {
    return path.resolve(desktopDir, report.export.path);
  }
  return null;
}

function relativeToDesktop(file) {
  return file ? path.relative(desktopDir, file) || '.' : 'missing';
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    product: {
      version: packageJson?.version || DEFAULT_VERSION,
    },
    source: sourceReportPath,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, verificationPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI baseline export verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${verificationPath}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const pkg = readJson('package.json');
  const report = readJson(sourceReportPath);
  const freshness = readJson(freshnessReportPath);
  const markdown = readText(markdownPath);

  add('baseline export report exists', Boolean(report && !report.parseError), report?.parseError || sourceReportPath);
  add('baseline export notes exist', Boolean(markdown), markdownPath);
  if (!report || report.parseError) {
    printAndExit();
    return;
  }

  const reportSummary = summary(report);
  const exportPath = fullExportPath(report);
  const exportExists = Boolean(exportPath && fs.existsSync(exportPath));
  const actualBytes = exportExists ? fs.statSync(exportPath).size : null;
  const actualSha256 = exportExists ? sha256File(exportPath) : null;
  const reportedSha256 = report.export?.sha256 || null;
  const reportedBytes = Number(report.export?.bytes || 0);
  const sourceAppAsarSha = report.source?.appAsarSha256 || null;
  const sourceAppAsarExpectedSha = report.source?.appAsarExpectedSha256 || null;
  const suggested = report.export?.suggestedVariables || {};

  add('baseline export schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('baseline export product version', report.product?.version === (pkg?.version || DEFAULT_VERSION), `${report.product?.version || 'missing'} expected ${pkg?.version || DEFAULT_VERSION}`);
  add('baseline export status', report.ok === true && report.status === 'exported', `status=${report.status || 'missing'}, ok=${Boolean(report.ok)}`);
  add('baseline export summary clean', reportSummary.blockers === 0 && reportSummary.warnings === 0, `${reportSummary.blockers} blocker(s), ${reportSummary.warnings} warning(s)`);
  add('baseline export source hash', sourceAppAsarSha === DEFAULT_ASAR_SHA256 && sourceAppAsarExpectedSha === DEFAULT_ASAR_SHA256, sourceAppAsarSha || 'missing');
  add('baseline export zip path', Boolean(exportPath), report.export?.path || report.export?.absolutePath || 'missing');
  add('baseline export zip exists', exportExists, exportPath ? relativeToDesktop(exportPath) : 'missing');
  add('baseline export zip bytes match', exportExists && reportedBytes > 0 && actualBytes === reportedBytes, exportExists ? `${actualBytes} actual, ${reportedBytes || 'missing'} reported` : 'missing zip');
  add('baseline export zip sha256 shape', /^[a-f0-9]{64}$/.test(String(reportedSha256 || '')), reportedSha256 || 'missing');
  add('baseline export zip sha256 match', exportExists && actualSha256 === reportedSha256, exportExists ? `${actualSha256} actual, ${reportedSha256 || 'missing'} reported` : 'missing zip');
  add(
    'baseline export suggested SHA variables',
    suggested.CONNECT_AI_BASELINE_SHA256 === reportedSha256 && suggested.CONNECT_AI_ZIP_SHA256 === reportedSha256,
    `baseline=${suggested.CONNECT_AI_BASELINE_SHA256 || 'missing'}, zip=${suggested.CONNECT_AI_ZIP_SHA256 || 'missing'}`,
  );
  add(
    'baseline export suggested URL placeholder',
    typeof suggested.CONNECT_AI_BASELINE_URL === 'string' && suggested.CONNECT_AI_BASELINE_URL.includes('HTTPS URL'),
    suggested.CONNECT_AI_BASELINE_URL || 'missing',
  );

  const currentSourceApp = report.source?.appPath || null;
  if (currentSourceApp && fs.existsSync(currentSourceApp)) {
    const resources = baselineResources({ appPath: currentSourceApp });
    const sourceAsarExists = fs.existsSync(resources.asarPath);
    const currentSourceSha = sourceAsarExists ? sha256File(resources.asarPath) : null;
    add('baseline export source app.asar exists now', sourceAsarExists, resources.asarPath);
    add('baseline export source app.asar still matches report', currentSourceSha === sourceAppAsarSha, currentSourceSha || 'missing');
  } else {
    add('baseline export source app current check', true, currentSourceApp ? `${currentSourceApp} not present now; retained report hash verified` : 'source app path missing');
  }

  add('baseline freshness report exists', Boolean(freshness && !freshness.parseError), freshness && !freshness.parseError ? freshnessReportPath : freshness?.parseError || `${freshnessReportPath} not generated yet`, 'warn');
  if (freshness && !freshness.parseError) {
    const freshnessSummary = summary(freshness);
    add('baseline freshness report clean', freshness.ok === true && freshness.status === 'fresh' && freshnessSummary.blockers === 0 && freshnessSummary.warnings === 0, `status=${freshness.status || 'missing'}, ${freshnessSummary.blockers} blocker(s), ${freshnessSummary.warnings} warning(s)`);
    add(
      'baseline freshness app.asar matches export source',
      freshness.baseline?.appAsar?.actualSha256 === sourceAppAsarSha &&
        freshness.baseline?.appAsar?.expectedSha256 === DEFAULT_ASAR_SHA256,
      freshness.baseline?.appAsar?.actualSha256 || 'missing',
    );
  }

  add('baseline export notes mention zip path', markdown.includes(report.export?.path || ''), report.export?.path || 'missing');
  add('baseline export notes mention zip SHA', Boolean(reportedSha256 && markdown.includes(reportedSha256)), reportedSha256 || 'missing');
  add('baseline export report secret scan', !hasSecretMaterial(JSON.stringify(report)), 'no private key, certificate body, GitHub token, or API key literal patterns');
  add('baseline export notes secret scan', !hasSecretMaterial(markdown), 'no private key, certificate body, GitHub token, or API key literal patterns');

  printAndExit();
}

main();
