import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';

const {
  DEFAULT_ASAR_SHA256,
  DEFAULT_VERSION,
  baselineResources,
  resolveBaselineApp,
  sha256,
} = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const defaultZipName = `Connect-AI-${DEFAULT_VERSION}-baseline-arm64-mac.zip`;
const zipPath = path.resolve(desktopDir, process.env.CONNECT_AI_BASELINE_EXPORT_PATH || path.join('release', defaultZipName));
const jsonPath = path.join(releaseDir, 'baseline-export-report.json');
const markdownPath = path.join(releaseDir, 'BASELINE_EXPORT.md');
const checks = [];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : null,
  };
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
  });
}

function summary() {
  return {
    blockers: checks.filter((check) => !check.ok && check.level === 'blocker').length,
    warnings: checks.filter((check) => !check.ok && check.level === 'warn').length,
  };
}

function renderMarkdown(report) {
  const checkLines = report.checks.map((check) => {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    return `- ${label}: ${check.name} - ${check.detail}`;
  }).join('\n');
  return `# Connect AI Baseline Export

Generated: ${report.generatedAt}
Status: ${report.status}
Product version: ${report.product.version}

## Export

- Source: ${report.source.appPath || 'missing'}
- Source app.asar SHA-256: ${report.source.appAsarSha256 || 'missing'}
- ZIP: ${report.export.path}
- ZIP bytes: ${report.export.bytes || 'missing'}
- ZIP SHA-256: ${report.export.sha256 || 'missing'}

## Operator Use

1. Upload the ZIP to the private or public baseline URL used by CI.
2. Set \`CONNECT_AI_BASELINE_URL\` to that URL.
3. Set \`CONNECT_AI_BASELINE_SHA256\` and \`CONNECT_AI_ZIP_SHA256\` to the ZIP SHA-256 above.

## Checks

${checkLines}
`;
}

function main() {
  fs.mkdirSync(releaseDir, { recursive: true });
  let baseline = null;
  let resources = null;
  let appAsarSha = null;
  try {
    baseline = resolveBaselineApp();
    resources = baselineResources(baseline);
    appAsarSha = fs.existsSync(resources.asarPath) ? sha256(resources.asarPath) : null;
  } catch (error) {
    add('baseline source resolves', false, error.message);
  }

  add('baseline app bundle exists', Boolean(baseline?.appPath && fs.existsSync(baseline.appPath)), baseline?.appPath || 'missing');
  add('baseline app.asar exists', Boolean(resources?.asarPath && fs.existsSync(resources.asarPath)), resources?.asarPath || 'missing');
  add('baseline app.asar expected hash', appAsarSha === DEFAULT_ASAR_SHA256, appAsarSha || 'missing');
  add('ditto available', fs.existsSync('/usr/bin/ditto'), '/usr/bin/ditto');

  if (summary().blockers === 0) {
    fs.rmSync(zipPath, { force: true });
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const result = run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', baseline.appPath, zipPath]);
    add('baseline zip export command', result.ok, result.stderr || result.stdout || `wrote ${zipPath}`);
  }

  const zipExists = fs.existsSync(zipPath);
  const zipSha = zipExists ? sha256(zipPath) : null;
  const zipBytes = zipExists ? fs.statSync(zipPath).size : null;
  add('baseline zip exists', zipExists, zipExists ? `${zipBytes} bytes` : zipPath);
  add('baseline zip sha256 shape', Boolean(zipSha && /^[a-f0-9]{64}$/.test(zipSha)), zipSha || 'missing');

  const finalSummary = summary();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: finalSummary.blockers === 0 ? 'exported' : 'not-exported',
    ok: finalSummary.blockers === 0,
    product: {
      version: DEFAULT_VERSION,
    },
    source: {
      source: baseline?.source || null,
      appPath: baseline?.appPath || null,
      fromZip: Boolean(baseline?.fromZip),
      appAsarPath: resources?.asarPath || null,
      appAsarExpectedSha256: DEFAULT_ASAR_SHA256,
      appAsarSha256: appAsarSha,
    },
    export: {
      path: path.relative(desktopDir, zipPath),
      absolutePath: zipPath,
      bytes: zipBytes,
      sha256: zipSha,
      suggestedVariables: {
        CONNECT_AI_BASELINE_URL: '<upload this zip to an HTTPS URL and set that URL>',
        CONNECT_AI_BASELINE_SHA256: zipSha,
        CONNECT_AI_ZIP_SHA256: zipSha,
      },
    },
    summary: finalSummary,
    checks,
  };

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  if (baseline?.tempDir) fs.rmSync(baseline.tempDir, { recursive: true, force: true });

  console.log('Connect AI baseline export');
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${finalSummary.blockers} blocker(s), ${finalSummary.warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, zipPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
  if (finalSummary.blockers > 0) process.exit(1);
}

main();
