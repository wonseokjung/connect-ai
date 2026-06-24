import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';
import {
  appAsarContentOk,
  appAsarPolicyDetail,
  approveMainProcessSecurityDeltaFromAsar,
  summarizeAppAsarPolicy,
} from './app-asar-policy.mjs';

const {
  DEFAULT_APP_PATH,
  DEFAULT_ASAR_SHA256,
  DEFAULT_VERSION,
  DEFAULT_ZIP_SHA256,
  DEFAULT_ZIP_PATH,
  baselineResources,
  resolveBaselineApp,
  sha256,
} = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const jsonPath = path.join(releaseDir, 'baseline-freshness-report.json');
const markdownPath = path.join(releaseDir, 'BASELINE_FRESHNESS.md');
const checks = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
    env: options.env || process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : null,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
  });
}

function plistValue(infoPlistPath, key) {
  if (!fs.existsSync(infoPlistPath)) return null;
  const result = run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlistPath]);
  return result.ok ? result.stdout : null;
}

function parseUpdateYaml(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) out[match[1].trim()] = match[2].trim();
  }
  return out;
}

function parseVersionFromName(name) {
  const match = String(name || '').match(/Connect[- ]AI[- ](\d+\.\d+\.\d+)/i);
  return match?.[1] || null;
}

function compareVersion(left, right) {
  const leftParts = String(left || '').split('.').map((part) => Number(part));
  const rightParts = String(right || '').split('.').map((part) => Number(part));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const b = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function versionStatus(version, expectedVersion) {
  if (!version) return 'unknown-version';
  const comparison = compareVersion(version, expectedVersion);
  if (comparison === 0) return 'current';
  return comparison < 0 ? 'older-than-current' : 'newer-than-package';
}

function discoverDownloadCandidates(expectedVersion, selectedSource) {
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(downloadsDir)) {
    return {
      downloadsDir,
      present: false,
      artifacts: [],
    };
  }
  const artifacts = fs.readdirSync(downloadsDir)
    .filter((name) => /^Connect[- ]AI.*\.(zip|dmg)$/i.test(name))
    .map((name) => {
      const absolutePath = path.join(downloadsDir, name);
      const stat = fs.statSync(absolutePath);
      const version = parseVersionFromName(name);
      return {
        name,
        path: absolutePath,
        kind: path.extname(name).slice(1).toLowerCase(),
        bytes: stat.size,
        mtime: stat.mtime.toISOString(),
        version,
        versionStatus: versionStatus(version, expectedVersion),
        selected: path.resolve(selectedSource || '') === absolutePath,
      };
    })
    .sort((left, right) => {
      const versionComparison = compareVersion(right.version || '0.0.0', left.version || '0.0.0');
      if (versionComparison !== 0) return versionComparison;
      return right.mtime.localeCompare(left.mtime);
    });
  return {
    downloadsDir,
    present: true,
    artifacts,
  };
}

function selectedBaselineCandidate({ baseline, info, expectedVersion }) {
  if (!baseline) return null;
  const version = info?.version || parseVersionFromName(path.basename(baseline.source || ''));
  return {
    source: baseline.source,
    appPath: baseline.appPath,
    mode: sourceMode(baseline),
    selectionReason: baseline.selectionReason || null,
    version,
    versionStatus: versionStatus(version, expectedVersion),
  };
}

function extractAsar(asarPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-baseline-freshness-'));
  const localAsarBin = path.join(desktopDir, 'node_modules', '.bin', process.platform === 'win32' ? 'asar.cmd' : 'asar');
  const result = fs.existsSync(localAsarBin)
    ? run(localAsarBin, ['extract', asarPath, tmp])
    : run('npx', ['--yes', '@electron/asar', 'extract', asarPath, tmp]);
  if (!result.ok) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(result.stderr || result.stdout || result.error || 'asar extract failed');
  }
  return tmp;
}

function readBaselinePackage(asarPath) {
  if (!fs.existsSync(asarPath)) return null;
  const tmp = extractAsar(asarPath);
  try {
    const packagePath = path.join(tmp, 'package.json');
    return fs.existsSync(packagePath) ? readJson(packagePath) : null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function sourceMode(baseline) {
  if (baseline.fromZip) return 'zip';
  if (baseline.source === DEFAULT_APP_PATH) return 'installed-app';
  return 'custom-app';
}

function reportSummary() {
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
  return `# Connect AI Baseline Freshness

Generated: ${report.generatedAt}
Status: ${report.status}
Product: ${report.product.name} ${report.product.version}
Baseline source: ${report.baseline.source}
Baseline mode: ${report.baseline.mode}
Default zip SHA-256: ${report.baseline.defaultZipActualSha256 || 'missing'}
Expected zip SHA-256: ${report.baseline.defaultZipExpectedSha256 || 'not configured'}
Baseline app.asar: ${report.baseline.appAsar.actualSha256 || 'missing'}

## Summary

- Blockers: ${report.summary.blockers}
- Warnings: ${report.summary.warnings}

## Baseline Candidate Discovery

- Selected source: ${report.baseline.selectedCandidate?.source || 'missing'}
- Selected version: ${report.baseline.selectedCandidate?.version || 'missing'}
- Selected status: ${report.baseline.selectedCandidate?.versionStatus || 'missing'}
- Downloads scanned: ${report.baseline.downloadCandidates.present}
- Download artifacts: ${report.baseline.downloadCandidates.artifacts.length}
- Newer download artifacts: ${report.baseline.downloadCandidates.newerThanPackageCount}
- Stale non-selected downloads: ${report.baseline.downloadCandidates.staleNonSelectedCount}

## Checks

${checkLines}

## Release Manifest

- Present: ${report.releaseManifest.present}
- Version: ${report.releaseManifest.productVersion || 'missing'}
- Baseline SHA-256: ${report.releaseManifest.baselineExpectedSha256 || 'missing'}
- Release app.asar SHA-256: ${report.releaseManifest.releaseAppAsarSha256 || 'missing'}
- Release app.asar policy: ${report.releaseManifest.releaseAppAsarPolicy?.reason || 'missing'}
`;
}

function main() {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  let baseline;
  try {
    baseline = resolveBaselineApp();
  } catch (error) {
    add('baseline source resolves', false, error.message);
    baseline = null;
  }

  const resources = baseline ? baselineResources(baseline) : null;
  const infoPlistPath = resources?.infoPlistPath || null;
  const asarPath = resources?.asarPath || null;
  const updateYamlPath = resources?.updateYamlPath || null;
  const baselineAsarSha = asarPath && fs.existsSync(asarPath) ? sha256(asarPath) : null;
  const baselinePackage = asarPath && fs.existsSync(asarPath) ? readBaselinePackage(asarPath) : null;
  const releaseManifestPath = path.join(releaseDir, 'release-manifest.json');
  const releaseManifest = fs.existsSync(releaseManifestPath) ? readJson(releaseManifestPath) : null;
  const releaseAsar = (releaseManifest?.release?.artifacts || []).find((artifact) => artifact.path?.endsWith('/app.asar'));
  const releaseAsarPath = releaseAsar?.path ? path.join(desktopDir, releaseAsar.path) : null;
  const releaseAppAsarPolicy = releaseManifest?.release?.appAsarPolicy || (
    releaseAsarPath && asarPath && fs.existsSync(releaseAsarPath) && fs.existsSync(asarPath)
      ? summarizeAppAsarPolicy(approveMainProcessSecurityDeltaFromAsar({
          baselineAsarPath: asarPath,
          candidateAsarPath: releaseAsarPath,
          localMainPath: path.join(desktopDir, 'src', 'main.ts'),
        }))
      : null
  );
  const releaseAppAsarMatchesBaseline = Boolean(releaseAsar?.sha256 && releaseAsar.sha256 === baselineAsarSha);
  const releaseAppAsarOk = appAsarContentOk({
    expectedSha256: baselineAsarSha,
    candidateSha256: releaseAsar?.sha256,
    policy: releaseAppAsarPolicy,
  });
  const updateYaml = updateYamlPath ? parseUpdateYaml(updateYamlPath) : null;

  const expectedAppId = pkg.build?.appId;
  const expectedName = pkg.build?.productName || 'Connect AI';
  const info = {
    bundleIdentifier: infoPlistPath ? plistValue(infoPlistPath, 'CFBundleIdentifier') : null,
    version: infoPlistPath ? plistValue(infoPlistPath, 'CFBundleShortVersionString') : null,
    buildVersion: infoPlistPath ? plistValue(infoPlistPath, 'CFBundleVersion') : null,
    name: infoPlistPath ? plistValue(infoPlistPath, 'CFBundleName') : null,
    displayName: infoPlistPath ? plistValue(infoPlistPath, 'CFBundleDisplayName') : null,
  };
  const selectedCandidate = selectedBaselineCandidate({ baseline, info, expectedVersion: pkg.version });
  const downloadCandidates = discoverDownloadCandidates(pkg.version, baseline?.source);
  const staleNonSelectedDownloads = downloadCandidates.artifacts.filter((candidate) =>
    candidate.versionStatus === 'older-than-current' && !candidate.selected);
  const newerDownloadCandidates = downloadCandidates.artifacts.filter((candidate) =>
    candidate.versionStatus === 'newer-than-package');
  const currentDownloadCandidates = downloadCandidates.artifacts.filter((candidate) =>
    candidate.versionStatus === 'current');
  const defaultZipExists = fs.existsSync(DEFAULT_ZIP_PATH);
  const defaultZipActualSha256 = defaultZipExists ? sha256(DEFAULT_ZIP_PATH) : null;
  const explicitBaseline = Boolean(process.env.CONNECT_AI_APP || process.env.CONNECT_AI_ZIP);

  add('baseline source resolves', Boolean(baseline), baseline?.source || 'missing');
  add(
    'baseline current download zip priority',
    explicitBaseline || !defaultZipExists || (baseline?.fromZip === true && path.resolve(baseline.source) === path.resolve(DEFAULT_ZIP_PATH)),
    defaultZipExists
      ? `default zip=${DEFAULT_ZIP_PATH}, selected=${baseline?.source || 'missing'}, reason=${baseline?.selectionReason || 'missing'}`
      : `default zip missing; selected=${baseline?.source || 'missing'}, reason=${baseline?.selectionReason || 'missing'}`,
  );
  add(
    'baseline default zip sha256 guard',
    !defaultZipExists || !DEFAULT_ZIP_SHA256 || defaultZipActualSha256 === DEFAULT_ZIP_SHA256,
    defaultZipExists
      ? `actual=${defaultZipActualSha256 || 'missing'} expected=${DEFAULT_ZIP_SHA256 || 'not configured'}`
      : `default zip missing; expected=${DEFAULT_ZIP_SHA256 || 'not configured'}`,
  );
  add('baseline app bundle exists', Boolean(baseline?.appPath && fs.existsSync(baseline.appPath)), baseline?.appPath || 'missing');
  add('baseline Info.plist exists', Boolean(infoPlistPath && fs.existsSync(infoPlistPath)), infoPlistPath || 'missing');
  add('baseline app.asar exists', Boolean(asarPath && fs.existsSync(asarPath)), asarPath || 'missing');
  add('baseline app.asar expected hash', baselineAsarSha === DEFAULT_ASAR_SHA256, baselineAsarSha || 'missing');
  add('baseline selected source version current', selectedCandidate?.versionStatus === 'current', `selected=${selectedCandidate?.version || 'missing'} package=${pkg.version}`);
  add('baseline download candidate inventory', true, `${downloadCandidates.artifacts.length} artifact(s), ${currentDownloadCandidates.length} current, ${staleNonSelectedDownloads.length} stale non-selected`);
  add(
    'newer download candidates require package upgrade',
    newerDownloadCandidates.length === 0,
    newerDownloadCandidates.map((candidate) => `${candidate.name} (${candidate.version || 'unknown'})`).join(', ') || 'none',
  );
  add('stale download candidates not selected', staleNonSelectedDownloads.every((candidate) => !candidate.selected), staleNonSelectedDownloads.map((candidate) => candidate.name).join(', ') || 'none');
  add('baseline bundle id freshness', info.bundleIdentifier === expectedAppId, info.bundleIdentifier || 'missing');
  add('baseline version freshness', info.version === pkg.version && info.version === DEFAULT_VERSION, `baseline=${info.version || 'missing'} package=${pkg.version} expected=${DEFAULT_VERSION}`);
  add('baseline build version freshness', info.buildVersion === pkg.version, `baseline=${info.buildVersion || 'missing'} package=${pkg.version}`);
  add('baseline display name freshness', info.name === expectedName && info.displayName === expectedName, `name=${info.name || 'missing'} display=${info.displayName || 'missing'}`);
  add('baseline package metadata exists', Boolean(baselinePackage), baselinePackage ? baselinePackage.name : 'missing package.json in app.asar');
  add('baseline package version freshness', baselinePackage?.version === pkg.version, `baseline=${baselinePackage?.version || 'missing'} package=${pkg.version}`);
  add('baseline package app main', baselinePackage?.main === pkg.main, `baseline=${baselinePackage?.main || 'missing'} package=${pkg.main}`);
  add('baseline update provider', updateYaml?.provider === 'github', updateYaml?.provider || 'missing');
  add('baseline update owner repo', updateYaml?.owner === 'wonseokjung' && updateYaml?.repo === 'connect-ai', `${updateYaml?.owner || 'missing'}/${updateYaml?.repo || 'missing'}`);
  add('release manifest exists', Boolean(releaseManifest), 'release/release-manifest.json');
  add('release manifest product version freshness', releaseManifest?.product?.version === pkg.version, `manifest=${releaseManifest?.product?.version || 'missing'} package=${pkg.version}`);
  add('release manifest expected version freshness', releaseManifest?.product?.expectedVersion === DEFAULT_VERSION, `manifest=${releaseManifest?.product?.expectedVersion || 'missing'} expected=${DEFAULT_VERSION}`);
  add('release manifest baseline hash freshness', releaseManifest?.baseline?.appAsar?.expectedSha256 === baselineAsarSha && releaseManifest?.baseline?.appAsar?.actualSha256 === baselineAsarSha, releaseManifest?.baseline?.appAsar?.actualSha256 || 'missing');
  add(
    'release app.asar baseline or approved hardening',
    releaseAppAsarOk,
    appAsarPolicyDetail({
      expectedSha256: baselineAsarSha,
      candidateSha256: releaseAsar?.sha256,
      policy: releaseAppAsarPolicy,
    }),
  );
  if (strict) {
    add('strict baseline source is explicit in CI', process.env.GITHUB_ACTIONS !== 'true' || sourceMode(baseline) === 'zip', sourceMode(baseline), 'warn');
  }

  const summary = reportSummary();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    status: summary.blockers === 0 ? 'fresh' : 'stale-or-misaligned',
    ok: summary.blockers === 0,
    product: {
      name: expectedName,
      packageName: pkg.name,
      version: pkg.version,
      expectedVersion: DEFAULT_VERSION,
      appId: expectedAppId,
      main: pkg.main,
    },
    baseline: {
      source: baseline?.source || null,
      mode: baseline ? sourceMode(baseline) : null,
      selectionReason: baseline?.selectionReason || null,
      defaultAppPath: DEFAULT_APP_PATH,
      defaultZipPath: DEFAULT_ZIP_PATH,
      defaultZipExpectedSha256: DEFAULT_ZIP_SHA256 || null,
      defaultZipActualSha256,
      selectedCandidate,
      downloadCandidates: {
        ...downloadCandidates,
        staleNonSelectedCount: staleNonSelectedDownloads.length,
        newerThanPackageCount: newerDownloadCandidates.length,
        currentCount: currentDownloadCandidates.length,
      },
      appPath: baseline?.appPath || null,
      fromZip: Boolean(baseline?.fromZip),
      infoPlist: info,
      appAsar: {
        path: asarPath,
        expectedSha256: DEFAULT_ASAR_SHA256,
        actualSha256: baselineAsarSha,
      },
      package: baselinePackage
        ? {
            name: baselinePackage.name,
            version: baselinePackage.version,
            main: baselinePackage.main,
          }
        : null,
      updateChannel: updateYaml,
    },
    releaseManifest: {
      present: Boolean(releaseManifest),
      generatedAt: releaseManifest?.generatedAt || null,
      productVersion: releaseManifest?.product?.version || null,
      expectedVersion: releaseManifest?.product?.expectedVersion || null,
      baselineExpectedSha256: releaseManifest?.baseline?.appAsar?.expectedSha256 || null,
      baselineActualSha256: releaseManifest?.baseline?.appAsar?.actualSha256 || null,
      releaseAppAsarSha256: releaseAsar?.sha256 || null,
      releaseAppAsarMatchesBaseline,
      releaseAppAsarApprovedDelta: Boolean(releaseAppAsarPolicy?.approvedDelta),
      releaseAppAsarPolicy,
    },
    summary,
    checks,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));

  console.log(`Connect AI baseline freshness (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${summary.blockers} blocker(s), ${summary.warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
  if (summary.blockers > 0 && !noExit) process.exit(1);
}

main();
