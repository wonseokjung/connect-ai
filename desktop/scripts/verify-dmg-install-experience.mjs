import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';
import {
  appAsarContentOk,
  appAsarPolicyDetail,
  approveMainProcessSecurityDeltaFromAsar,
  summarizeAppAsarPolicy,
} from './app-asar-policy.mjs';

const { DEFAULT_ASAR_SHA256, DEFAULT_VERSION, baselineResources, resolveBaselineApp, sha256 } = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
const expectedElectronRuntime = pkg.build?.electronVersion || String(pkg.devDependencies?.electron || '').replace(/^[^\d]*/, '');
const dmgName = `Connect-AI-${DEFAULT_VERSION}-mac-arm64.dmg`;
const dmgPath = path.join(releaseDir, dmgName);
const reportPath = path.join(releaseDir, 'dmg-install-experience.json');
const checks = [];
const inspectedAppAsars = [];
const expectedSignedEntitlements = [
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.device.audio-input',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
    env: process.env,
    timeout: options.timeout || 120000,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
  };
}

function firstLine(value) {
  const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => !line.startsWith('Processing:')) || lines[0] || 'no diagnostic output';
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
  });
}

function plist(appPath, key) {
  const file = path.join(appPath, 'Contents', 'Info.plist');
  return run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file]);
}

function plistFile(file, key) {
  return run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file]);
}

function readInfoPlist(appPath, label) {
  const file = path.join(appPath, 'Contents', 'Info.plist');
  const result = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]);
  if (!result.ok) {
    add(`${label} Info.plist parse`, false, firstLine(result.stderr || result.stdout || result.error));
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    add(`${label} Info.plist parse`, false, error.message);
    return null;
  }
}

function sorted(value) {
  return [...value].sort();
}

function sameSet(left, right) {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function inspectAppTransportSecurity(info, label) {
  const ats = info.NSAppTransportSecurity || {};
  const domains = ats.NSExceptionDomains || {};

  add(`${label} ATS arbitrary loads disabled`, ats.NSAllowsArbitraryLoads === false, String(ats.NSAllowsArbitraryLoads));
  add(`${label} ATS local networking`, ats.NSAllowsLocalNetworking === true, String(ats.NSAllowsLocalNetworking));
  add(`${label} ATS exception domain allowlist`, sameSet(Object.keys(domains), ['127.0.0.1', 'localhost']), Object.keys(domains).join(', ') || 'none');

  for (const domain of ['127.0.0.1', 'localhost']) {
    const item = domains[domain] || {};
    add(`${label} ATS ${domain} HTTP exception`, item.NSTemporaryExceptionAllowsInsecureHTTPLoads === true, JSON.stringify(item));
    add(`${label} ATS ${domain} no subdomains`, item.NSIncludesSubdomains === false, JSON.stringify(item));
  }
}

function inspectCodeSignature(appPath, label) {
  const verify = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { timeout: 180000 });
  add(
    `${label} code signature resource seal`,
    verify.ok,
    verify.ok ? 'codesign --verify --deep --strict passed' : firstLine(verify.stderr || verify.stdout || verify.error),
  );

  const entitlements = run('/usr/bin/codesign', ['-d', '--entitlements', ':-', appPath]);
  const entitlementText = entitlements.stdout || '';
  const hasExpectedEntitlements = entitlements.ok &&
    entitlementText.includes('<plist') &&
    expectedSignedEntitlements.every((key) => entitlementText.includes(key)) &&
    !entitlementText.includes('com.apple.security.get-task-allow');
  add(
    `${label} signed entitlement allowlist`,
    hasExpectedEntitlements,
    hasExpectedEntitlements ? expectedSignedEntitlements.join(', ') : firstLine(entitlements.stderr || entitlements.stdout || entitlements.error),
  );
}

function fileCount(root) {
  let count = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) count += 1;
    }
  }
  if (fs.existsSync(root)) walk(root);
  return count;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function attachDmg(mountPoint) {
  let last = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const attach = run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mountPoint, dmgPath]);
    if (attach.ok) return attach;
    last = attach;
    sleepSync(750 * attempt);
  }
  return last;
}

function mountPointAliases(target) {
  const out = new Set([target]);
  try {
    out.add(fs.realpathSync(target));
  } catch {
    // The mount point can disappear between detach and realpath.
  }
  return [...out];
}

function isMounted(target) {
  const info = run('/usr/bin/hdiutil', ['info']);
  if (!info.ok) return false;
  return mountPointAliases(target).some((item) => info.stdout.includes(item));
}

function detachMount(target) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (!isMounted(target)) return true;
    run('/usr/bin/hdiutil', ['detach', target, '-force'], { timeout: 60000 });
    sleepSync(500 * attempt);
  }
  return !isMounted(target);
}

function inspectApp(appPath, label) {
  const info = readInfoPlist(appPath, label);
  if (info) inspectAppTransportSecurity(info, label);
  inspectCodeSignature(appPath, label);

  const bundleId = plist(appPath, 'CFBundleIdentifier');
  add(`${label} bundle identifier`, bundleId.ok && bundleId.stdout === 'ai.ezer.connect-desktop', bundleId.ok ? bundleId.stdout : firstLine(bundleId.stderr || bundleId.error));

  const version = plist(appPath, 'CFBundleShortVersionString');
  add(`${label} bundle version`, version.ok && version.stdout === DEFAULT_VERSION, version.ok ? version.stdout : firstLine(version.stderr || version.error));

  const executable = path.join(appPath, 'Contents', 'MacOS', 'Connect AI');
  add(`${label} executable`, fs.existsSync(executable), executable);

  const electronFrameworkPlist = path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources', 'Info.plist');
  const electron = plistFile(electronFrameworkPlist, 'CFBundleVersion');
  add(`${label} Electron runtime`, electron.ok && electron.stdout === expectedElectronRuntime, electron.ok ? electron.stdout : firstLine(electron.stderr || electron.error));

  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  if (fs.existsSync(asarPath)) {
    const baseline = resolveBaselineApp();
    const baselineRes = baselineResources(baseline);
    const asarSha = sha256(asarPath);
    const policy = summarizeAppAsarPolicy(approveMainProcessSecurityDeltaFromAsar({
      baselineAsarPath: baselineRes.asarPath,
      candidateAsarPath: asarPath,
      localMainPath: path.join(desktopDir, 'src', 'main.ts'),
    }));
    inspectedAppAsars.push({
      label,
      path: asarPath,
      sha256: asarSha,
      policy,
    });
    add(
      `${label} app.asar`,
      appAsarContentOk({
        expectedSha256: DEFAULT_ASAR_SHA256,
        candidateSha256: asarSha,
        policy,
      }),
      appAsarPolicyDetail({
        expectedSha256: DEFAULT_ASAR_SHA256,
        candidateSha256: asarSha,
        policy,
      }),
    );
  } else {
    add(`${label} app.asar`, false, `missing: ${asarPath}`);
  }

  const unpacked = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');
  const unpackedCount = fs.existsSync(unpacked) ? fileCount(unpacked) : 0;
  add(`${label} app.asar.unpacked`, unpackedCount > 7000, `${unpackedCount} files`);
}

function writeReport(extra = {}) {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: blockers === 0,
    product: {
      version: DEFAULT_VERSION,
      appId: 'ai.ezer.connect-desktop',
      expectedBaselineAppAsarSha256: DEFAULT_ASAR_SHA256,
      appAsarSha256: inspectedAppAsars.at(-1)?.sha256 || null,
      appAsarPolicy: inspectedAppAsars.at(-1)?.policy || null,
    },
    dmg: {
      path: `release/${dmgName}`,
      bytes: fs.existsSync(dmgPath) ? fs.statSync(dmgPath).size : 0,
      sha256: fs.existsSync(dmgPath) ? sha256(dmgPath) : null,
    },
    summary: {
      blockers,
      warnings,
    },
    checks,
    inspectedAppAsars,
    ...extra,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function printAndExit(report) {
  console.log('Connect AI DMG install experience verification');
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (report.summary.blockers > 0) process.exit(1);
}

function main() {
  if (process.platform !== 'darwin') {
    add('macOS host', false, `${process.platform}/${process.arch}`);
    printAndExit(writeReport());
    return;
  }

  add('macOS host', true, `${process.platform}/${process.arch}`);
  add('DMG artifact', fs.existsSync(dmgPath), fs.existsSync(dmgPath) ? `${fs.statSync(dmgPath).size} bytes` : `missing: ${dmgPath}`);

  if (!fs.existsSync(dmgPath)) {
    printAndExit(writeReport());
    return;
  }

  const imageInfo = run('/usr/bin/hdiutil', ['imageinfo', dmgPath]);
  add('DMG imageinfo', imageInfo.ok, imageInfo.ok ? 'hdiutil imageinfo passed' : firstLine(imageInfo.stderr || imageInfo.error));
  add('DMG compressed format', /Format:\s+UDZO/.test(imageInfo.stdout), 'Format: UDZO');
  add('DMG HFS filesystem', /Apple_HFS|HFS\+/.test(imageInfo.stdout), 'Apple_HFS/HFS+');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-dmg-install-'));
  const mountPoint = path.join(tmp, 'mnt');
  const installRoot = path.join(tmp, 'Applications');
  fs.mkdirSync(mountPoint);
  fs.mkdirSync(installRoot);
  let attached = false;

  try {
    const attach = attachDmg(mountPoint);
    attached = attach.ok;
    add('DMG readonly mount', attach.ok, attach.ok ? mountPoint : firstLine(attach.stderr || attach.stdout || attach.error));
    if (!attach.ok) return;

    const entries = fs.readdirSync(mountPoint).sort();
    add('DMG app entry', entries.includes('Connect AI.app'), entries.join(', '));

    const applications = path.join(mountPoint, 'Applications');
    const applicationsOk = fs.existsSync(applications) && fs.lstatSync(applications).isSymbolicLink() && fs.readlinkSync(applications) === '/Applications';
    add('DMG Applications shortcut', applicationsOk, fs.existsSync(applications) ? `${fs.lstatSync(applications).isSymbolicLink() ? 'symlink' : 'not symlink'} -> ${fs.lstatSync(applications).isSymbolicLink() ? fs.readlinkSync(applications) : 'n/a'}` : 'missing');

    for (const fileName of ['.DS_Store', '.background.tiff', '.VolumeIcon.icns']) {
      const file = path.join(mountPoint, fileName);
      add(`DMG visual asset ${fileName}`, fs.existsSync(file) && fs.statSync(file).size > 0, fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'missing');
    }

    const mountedApp = path.join(mountPoint, 'Connect AI.app');
    add('mounted Connect AI.app', fs.existsSync(mountedApp), mountedApp);
    if (fs.existsSync(mountedApp)) {
      inspectApp(mountedApp, 'mounted app');
    }

    const copiedApp = path.join(installRoot, 'Connect AI.app');
    const copy = run('/usr/bin/ditto', [mountedApp, copiedApp], { timeout: 240000 });
    add('drag-install copy simulation', copy.ok, copy.ok ? copiedApp : firstLine(copy.stderr || copy.stdout || copy.error));
    if (copy.ok && fs.existsSync(copiedApp)) {
      inspectApp(copiedApp, 'copied app');
    }
  } finally {
    if (attached) detachMount(mountPoint);
    const verify = run('/usr/bin/hdiutil', ['verify', dmgPath], { timeout: 180000 });
    add('DMG checksum verification', verify.ok, verify.ok ? firstLine(verify.stdout || verify.stderr) : firstLine(verify.stderr || verify.stdout || verify.error));
    fs.rmSync(tmp, { recursive: true, force: true });
    const report = writeReport();
    printAndExit(report);
  }
}

main();
