import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';

const { DEFAULT_VERSION } = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const pkgPath = path.join(desktopDir, 'package.json');
const contractPath = path.join(desktopDir, 'MACOS_SECURITY_CONTRACT.md');
const entitlementsPath = path.join(desktopDir, 'build', 'entitlements.mac.plist');
const mainSourcePath = path.join(desktopDir, 'src', 'main.ts');
const releaseAppPath = path.join(releaseDir, 'mac-arm64', 'Connect AI.app');
const releaseInfoPlistPath = path.join(releaseAppPath, 'Contents', 'Info.plist');
const reportPath = path.join(releaseDir, 'macos-security-contract.json');
const checks = [];

const allowedEntitlements = [
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.device.audio-input',
];

const forbiddenEntitlements = [
  'com.apple.security.get-task-allow',
];

const requiredPrivacyStrings = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
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

function firstLine(value) {
  const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => !line.startsWith('Processing:')) || lines[0] || 'no diagnostic output';
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readPlist(file) {
  if (!fs.existsSync(file)) return null;
  const result = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]);
  if (!result.ok) {
    add(`plist parse ${path.relative(desktopDir, file)}`, false, firstLine(result.stderr || result.stdout || result.error));
    return null;
  }
  return JSON.parse(result.stdout);
}

function sorted(value) {
  return [...value].sort();
}

function sameSet(left, right) {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function checkContractText() {
  add('security contract document', fs.existsSync(contractPath), path.relative(desktopDir, contractPath));
  if (!fs.existsSync(contractPath)) return;
  const text = fs.readFileSync(contractPath, 'utf8');
  for (const key of allowedEntitlements) {
    add(`contract documents ${key}`, text.includes(key), key);
  }
  for (const key of forbiddenEntitlements) {
    add(`contract forbids ${key}`, text.includes(key), key);
  }
  add('contract forbids ATS arbitrary loads', text.includes('NSAllowsArbitraryLoads') && text.includes('false'), 'NSAllowsArbitraryLoads false');
}

function checkPackageConfig(pkg) {
  const mac = pkg.build?.mac || {};
  const extendInfo = mac.extendInfo || {};

  add('package version', pkg.version === DEFAULT_VERSION, `${pkg.version} expected ${DEFAULT_VERSION}`);
  add('package hardened runtime', mac.hardenedRuntime === true, String(mac.hardenedRuntime));
  add('package notarization enabled', mac.notarize === true, String(mac.notarize));
  add('package entitlements path', mac.entitlements === 'build/entitlements.mac.plist', mac.entitlements || 'missing');
  add('package inherited entitlements path', mac.entitlementsInherit === 'build/entitlements.mac.plist', mac.entitlementsInherit || 'missing');
  add('package gatekeeper build assessment disabled', mac.gatekeeperAssess === false, String(mac.gatekeeperAssess));
  add('package minimum macOS', mac.minimumSystemVersion === '11.0', mac.minimumSystemVersion || 'missing');

  const ats = extendInfo.NSAppTransportSecurity || {};
  const domains = ats.NSExceptionDomains || {};
  add('package ATS arbitrary loads disabled', ats.NSAllowsArbitraryLoads === false, String(ats.NSAllowsArbitraryLoads));
  add('package ATS local networking', ats.NSAllowsLocalNetworking === true, String(ats.NSAllowsLocalNetworking));
  add('package ATS exception domain allowlist', sameSet(Object.keys(domains), ['127.0.0.1', 'localhost']), Object.keys(domains).join(', ') || 'none');
  for (const domain of ['127.0.0.1', 'localhost']) {
    const item = domains[domain] || {};
    add(`package ATS ${domain} HTTP exception`, item.NSTemporaryExceptionAllowsInsecureHTTPLoads === true, JSON.stringify(item));
    add(`package ATS ${domain} no subdomains`, item.NSIncludesSubdomains === false, JSON.stringify(item));
  }

  for (const key of requiredPrivacyStrings) {
    add(`package privacy string ${key}`, typeof extendInfo[key] === 'string' && extendInfo[key].length > 0, extendInfo[key] || 'missing');
  }
}

function checkEntitlements(entitlements) {
  if (!entitlements) {
    add('entitlements file', false, `missing: ${entitlementsPath}`);
    return;
  }
  const keys = Object.keys(entitlements);
  add('entitlement exact allowlist', sameSet(keys, allowedEntitlements), keys.join(', ') || 'none');
  for (const key of allowedEntitlements) {
    add(`entitlement ${key}`, entitlements[key] === true, String(entitlements[key]));
  }
  for (const key of forbiddenEntitlements) {
    add(`forbidden entitlement ${key}`, entitlements[key] !== true, String(entitlements[key]));
  }
}

function checkMainProcessSecurity() {
  add('main process source exists', fs.existsSync(mainSourcePath), path.relative(desktopDir, mainSourcePath));
  if (!fs.existsSync(mainSourcePath)) return;
  const text = fs.readFileSync(mainSourcePath, 'utf8');
  add(
    'main external URL allowlist',
    text.includes('EXTERNAL_URL_PROTOCOLS') &&
      text.includes("new Set(['http:', 'https:', 'mailto:'])") &&
      text.includes('function safeExternalUrl') &&
      text.includes('function openExternalSafe'),
    'window.open and renderer external URLs are constrained to http/https/mailto',
  );
  add(
    'main window open handler uses safe opener',
    text.match(/setWindowOpenHandler\(\(\{ url \}\) => \{ openExternalSafe\(url\); return \{ action: 'deny' \}; \}\)/g)?.length === 3 &&
      !text.includes("setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; })"),
    'main, revenue, and office windows deny window.open after safe external routing',
  );
  add(
    'main workspace path confinement helpers',
    text.includes('function resolveWorkspacePath') &&
      text.includes('function isInsidePath') &&
      text.includes('function activeWorkspaceRoot'),
    'renderer file/terminal paths are resolved through the active workspace',
  );
  add(
    'main renderer file IPC uses workspace path confinement',
    text.includes("ipcMain.handle('fs:tree'") &&
      text.includes("ipcMain.handle('fs:read'") &&
      text.includes("ipcMain.handle('fs:write'") &&
      text.includes("ipcMain.handle('fs:reveal'") &&
      text.includes('resolveWorkspacePath(p)') &&
      text.includes('resolveWorkspacePath(root)'),
    'fs tree/read/write/reveal normalize inputs before touching disk',
  );
  add(
    'main renderer terminal cwd uses workspace path confinement',
    text.includes("ipcMain.handle('term:run'") &&
      text.includes('resolveWorkspacePath(ws || loadConfig().workspace || defaultWorkspace())') &&
      text.includes('!st.isDirectory()'),
    'terminal commands reject cwd outside the active workspace',
  );
}

function checkReleaseInfoPlist(plist) {
  if (!plist) {
    add('release Info.plist', false, `missing: ${releaseInfoPlistPath}`);
    return;
  }
  add('release bundle identifier', plist.CFBundleIdentifier === 'ai.ezer.connect-desktop', plist.CFBundleIdentifier || 'missing');
  add('release bundle version', plist.CFBundleShortVersionString === DEFAULT_VERSION, plist.CFBundleShortVersionString || 'missing');
  add('release category', plist.LSApplicationCategoryType === 'public.app-category.productivity', plist.LSApplicationCategoryType || 'missing');
  add('release minimum macOS', plist.LSMinimumSystemVersion === '11.0', plist.LSMinimumSystemVersion || 'missing');
  add('release Electron asar integrity', plist.ElectronAsarIntegrity?.['Resources/app.asar']?.algorithm === 'SHA256', JSON.stringify(plist.ElectronAsarIntegrity || {}));

  const ats = plist.NSAppTransportSecurity || {};
  const domains = ats.NSExceptionDomains || {};
  add('release ATS arbitrary loads disabled', ats.NSAllowsArbitraryLoads === false, String(ats.NSAllowsArbitraryLoads));
  add('release ATS local networking', ats.NSAllowsLocalNetworking === true, String(ats.NSAllowsLocalNetworking));
  add('release ATS exception domain allowlist', sameSet(Object.keys(domains), ['127.0.0.1', 'localhost']), Object.keys(domains).join(', ') || 'none');

  for (const key of requiredPrivacyStrings) {
    add(`release privacy string ${key}`, typeof plist[key] === 'string' && plist[key].length > 0, plist[key] || 'missing');
  }
}

function checkSignedEntitlementsIfAvailable() {
  if (!fs.existsSync(releaseAppPath)) {
    add('signed entitlement extraction', false, `missing: ${releaseAppPath}`, 'warn');
    return;
  }
  const result = run('/usr/bin/codesign', ['-d', '--entitlements', ':-', releaseAppPath]);
  const output = result.stdout.trim();
  if (!result.ok || !output.includes('<plist')) {
    add('signed entitlement extraction', false, firstLine(result.stderr || result.stdout || result.error || 'entitlements not embedded or not readable'), 'warn');
    return;
  }
  const parsed = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: output,
    encoding: 'utf8',
  });
  if (parsed.status !== 0) {
    add('signed entitlement extraction', false, firstLine(parsed.stderr || parsed.stdout || 'unable to parse signed entitlements'), 'warn');
    return;
  }
  const entitlements = JSON.parse(parsed.stdout);
  const keys = Object.keys(entitlements);
  add('signed entitlement extraction', true, 'codesign entitlements available');
  add('signed entitlement exact allowlist', sameSet(keys, allowedEntitlements), keys.join(', ') || 'none');
  for (const key of forbiddenEntitlements) {
    add(`signed forbidden entitlement ${key}`, entitlements[key] !== true, String(entitlements[key]));
  }
}

function writeReport(pkg, entitlements, releaseInfo) {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: blockers === 0,
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
    },
    contract: {
      path: path.relative(desktopDir, contractPath),
      allowedEntitlements,
      forbiddenEntitlements,
      privacyStrings: requiredPrivacyStrings,
    },
    observed: {
      entitlements: entitlements || null,
      releaseInfo: releaseInfo
        ? {
            CFBundleIdentifier: releaseInfo.CFBundleIdentifier,
            CFBundleShortVersionString: releaseInfo.CFBundleShortVersionString,
            LSMinimumSystemVersion: releaseInfo.LSMinimumSystemVersion,
            NSAppTransportSecurity: releaseInfo.NSAppTransportSecurity,
          }
        : null,
    },
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function printReport(report) {
  console.log('Connect AI macOS security contract verification');
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (report.summary.blockers > 0) process.exit(1);
}

function main() {
  const pkg = readJson(pkgPath);
  const entitlements = readPlist(entitlementsPath);
  const releaseInfo = readPlist(releaseInfoPlistPath);

  checkContractText();
  checkPackageConfig(pkg);
  checkEntitlements(entitlements);
  checkMainProcessSecurity();
  checkReleaseInfoPlist(releaseInfo);
  checkSignedEntitlementsIfAvailable();

  const report = writeReport(pkg, entitlements, releaseInfo);
  printReport(report);
}

main();
