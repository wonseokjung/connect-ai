import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';
import {
  APPROVED_MAIN_DELTA_EXTRACTED_OUT_FILES,
  approveMainProcessSecurityDeltaFromFiles,
  approveProductionPackageMetadataDelta,
} from './app-asar-policy.mjs';

const {
  DEFAULT_VERSION,
  DEFAULT_ASAR_SHA256,
  baselineResources,
  cleanupBaselineApp,
  resolveBaselineApp,
  sha256,
} = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const baseline = resolveBaselineApp();
const appPath = baseline.appPath;
const { asarPath, updateYamlPath, infoPlistPath } = baselineResources(baseline);
const INSTALLED_PARITY_REPORT = path.join(releaseDir, 'installed-app-parity-report.json');

function die(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: desktopDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function listFiles(root) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])
  );
}

function stable(value) {
  return JSON.stringify(sortDeep(value), null, 2);
}

function comparePackage(extractedDir, failures, approvedMainProcessDelta) {
  const installed = readJson(path.join(extractedDir, 'package.json'));
  const local = readJson(path.join(desktopDir, 'package.json'));
  const packageMetadata = approveProductionPackageMetadataDelta({
    baselinePackage: installed,
    candidatePackage: local,
    localPackage: local,
  });
  approvedMainProcessDelta.packageMetadata = packageMetadata;
  if (!packageMetadata.ok) failures.push(packageMetadata.reason || 'production package metadata differs from baseline app.asar/package.json');
}

function compareTree(label, localRoot, installedRoot, failures, options = {}) {
  const { approvedMainProcessDelta } = options;
  const localFiles = listFiles(localRoot);
  const installedFiles = listFiles(installedRoot);
  const localSet = new Set(localFiles);
  const installedSet = new Set(installedFiles);

  for (const rel of installedFiles) {
    if (!localSet.has(rel)) failures.push(`${label}: missing local file ${rel}`);
  }
  for (const rel of localFiles) {
    if (!installedSet.has(rel)) failures.push(`${label}: extra local file ${rel}`);
  }
  for (const rel of installedFiles) {
    if (!localSet.has(rel)) continue;
    const a = sha256(path.join(localRoot, rel));
    const b = sha256(path.join(installedRoot, rel));
    if (
      a !== b &&
      label === 'out' &&
      approvedMainProcessDelta?.ok &&
      APPROVED_MAIN_DELTA_EXTRACTED_OUT_FILES.has(rel)
    ) {
      approvedMainProcessDelta.allowedBundleMismatches.push(rel);
      continue;
    }
    if (a !== b) failures.push(`${label}: content mismatch ${rel}`);
  }
}

function writeReport(failures, approvedMainProcessDelta) {
  fs.mkdirSync(releaseDir, { recursive: true });
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  const uniqueAllowedMismatches = [...new Set(approvedMainProcessDelta.allowedBundleMismatches)].sort();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: failures.length === 0,
    status: failures.length ? 'failed' : 'passed',
    product: {
      version: pkg.version,
      appId: pkg.build?.appId || null,
    },
    baseline: {
      version: DEFAULT_VERSION,
      source: baseline.source,
      appPath,
      asarSha256: DEFAULT_ASAR_SHA256,
    },
    summary: {
      blockers: failures.length,
      approvedMainProcessBundleMismatches: uniqueAllowedMismatches.length,
    },
    approvedDeltas: [
      {
        id: 'main-process-security-hardening',
        ok: approvedMainProcessDelta.ok,
        reason: approvedMainProcessDelta.reason,
        source: approvedMainProcessDelta.source,
        changedSources: approvedMainProcessDelta.changedSources,
        allowedBundleMismatches: uniqueAllowedMismatches,
        addedSources: approvedMainProcessDelta.addedSources,
        removedSources: approvedMainProcessDelta.removedSources,
        approvedSecurityDependencyPackages: approvedMainProcessDelta.approvedSecurityDependencyPackages,
        packageMetadata: approvedMainProcessDelta.packageMetadata || null,
        requiredMarkers: approvedMainProcessDelta.requiredMarkers,
      },
    ],
    failures,
  };
  fs.writeFileSync(INSTALLED_PARITY_REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

function plist(key) {
  return run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlistPath]).trim();
}

function plistJson() {
  return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoPlistPath]));
}

function compareBundleMetadata(failures) {
  const expected = {
    CFBundleIdentifier: 'ai.ezer.connect-desktop',
    CFBundleShortVersionString: DEFAULT_VERSION,
    CFBundleVersion: DEFAULT_VERSION,
    CFBundleName: 'Connect AI',
    CFBundleDisplayName: 'Connect AI',
    LSApplicationCategoryType: 'public.app-category.productivity',
    LSMinimumSystemVersion: '11.0',
    NSHumanReadableCopyright: 'Copyright © 2026 EZER AI',
    NSCameraUsageDescription: 'This app needs access to the camera',
    NSMicrophoneUsageDescription: 'This app needs access to the microphone',
    NSBluetoothPeripheralUsageDescription: 'This app needs access to Bluetooth',
    NSBluetoothAlwaysUsageDescription: 'This app needs access to Bluetooth',
  };
  for (const [key, value] of Object.entries(expected)) {
    const actual = plist(key);
    if (actual !== value) failures.push(`Info.plist ${key}: expected ${value}, got ${actual}`);
  }

  const installedPlist = plistJson();
  const expectedStructured = {
    NSQuitAlwaysKeepsWindows: false,
    NSRequiresAquaSystemAppearance: false,
    NSSupportsAutomaticGraphicsSwitching: true,
    NSPrefersDisplaySafeAreaCompatibilityMode: false,
    LSEnvironment: { MallocNanoZone: '0' },
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true,
      NSExceptionDomains: {
        '127.0.0.1': {
          NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
          NSTemporaryExceptionAllowsInsecureHTTPSLoads: false,
          NSTemporaryExceptionMinimumTLSVersion: '1.0',
          NSTemporaryExceptionRequiresForwardSecrecy: false,
          NSIncludesSubdomains: false,
        },
        localhost: {
          NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
          NSTemporaryExceptionAllowsInsecureHTTPSLoads: false,
          NSTemporaryExceptionMinimumTLSVersion: '1.0',
          NSTemporaryExceptionRequiresForwardSecrecy: false,
          NSIncludesSubdomains: false,
        },
      },
    },
  };
  for (const [key, value] of Object.entries(expectedStructured)) {
    if (stable(installedPlist[key]) !== stable(value)) {
      failures.push(`Info.plist ${key}: structured value differs from baseline app expectation`);
    }
  }

  const updateYaml = fs.readFileSync(updateYamlPath, 'utf8').trim();
  const expectedUpdateYaml = [
    'owner: wonseokjung',
    'repo: connect-ai',
    'provider: github',
    'updaterCacheDirName: connect-ai-desktop-updater',
  ].join('\n');
  if (updateYaml !== expectedUpdateYaml) failures.push('app-update.yml differs from baseline updater metadata');
}

function extractBaselineAsar() {
  if (!fs.existsSync(asarPath)) die(`baseline app.asar not found: ${asarPath}`);
  const actualSha = sha256(asarPath);
  if (actualSha !== DEFAULT_ASAR_SHA256) {
    die(`baseline app.asar SHA changed: ${actualSha}. Expected ${DEFAULT_ASAR_SHA256}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-baseline-'));
  const localAsarBin = path.join(desktopDir, 'node_modules', '.bin', process.platform === 'win32' ? 'asar.cmd' : 'asar');
  try {
    if (fs.existsSync(localAsarBin)) {
      run(localAsarBin, ['extract', asarPath, tmp]);
    } else {
      run('npx', ['--yes', '@electron/asar', 'extract', asarPath, tmp], { cwd: desktopDir });
    }
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw error;
  }
  return tmp;
}

function main() {
  const failures = [];
  let extracted = null;
  let approvedMainProcessDelta = null;

  try {
    extracted = extractBaselineAsar();
    approvedMainProcessDelta = approveMainProcessSecurityDeltaFromFiles({
      baselineMapPath: path.join(extracted, 'out', 'main.js.map'),
      candidateMapPath: path.join(desktopDir, 'out', 'main.js.map'),
      localMainPath: path.join(desktopDir, 'src', 'main.ts'),
    });

    compareBundleMetadata(failures);
    comparePackage(extracted, failures, approvedMainProcessDelta);

    for (const rel of ['out', 'src/renderer', 'assets', 'training']) {
      compareTree(rel, path.join(desktopDir, rel), path.join(extracted, rel), failures, { approvedMainProcessDelta });
    }

    writeReport(failures, approvedMainProcessDelta);
  } finally {
    if (extracted) fs.rmSync(extracted, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    cleanupBaselineApp(baseline);
  }

  if (failures.length) {
    console.error(`Connect AI desktop parity check failed (${failures.length}):`);
    for (const f of failures.slice(0, 80)) console.error(`- ${f}`);
    if (failures.length > 80) console.error(`- ... ${failures.length - 80} more`);
    process.exit(1);
  }

  if (approvedMainProcessDelta.allowedBundleMismatches.length) {
    console.log(`Approved main-process security delta: ${[...new Set(approvedMainProcessDelta.allowedBundleMismatches)].sort().join(', ')}`);
  }
  console.log(`Connect AI desktop parity check passed against ${baseline.source} v${DEFAULT_VERSION}`);
}

main();
