import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
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
  DEFAULT_VERSION,
  DEFAULT_ASAR_SHA256,
  baselineResources,
  resolveBaselineApp,
  sha256,
} = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const strict = process.argv.includes('--strict');
const checks = [];

function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: options.cwd || desktopDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env,
    });
    return { ok: true, status: 0, stdout, stderr: '' };
  } catch (error) {
    if (!options.allowFail) throw error;
    return {
      ok: false,
      status: error.status || 1,
      stdout: Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf8') : String(error.stdout || ''),
      stderr: Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : String(error.stderr || ''),
    };
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hashBase64(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('base64');
}

function unquoteYamlValue(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function readLatestMacYaml(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  const fileEntry = {};
  let inFiles = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'files:') {
      inFiles = true;
      continue;
    }
    let match = line.match(/^- url:\s*(.+)$/);
    if (match) {
      fileEntry.url = unquoteYamlValue(match[1]);
      continue;
    }
    match = line.match(/^sha512:\s*(.+)$/);
    if (match) {
      if (inFiles && !fileEntry.sha512) fileEntry.sha512 = unquoteYamlValue(match[1]);
      else out.sha512 = unquoteYamlValue(match[1]);
      continue;
    }
    match = line.match(/^size:\s*(\d+)$/);
    if (match) {
      fileEntry.size = Number(match[1]);
      continue;
    }
    match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/);
    if (match) {
      out[match[1]] = unquoteYamlValue(match[2]);
      inFiles = false;
    }
  }
  out.files = Object.keys(fileEntry).length ? [fileEntry] : [];
  return out;
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
  walk(root);
  return out.sort();
}

function firstLine(value) {
  const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => !line.startsWith('Processing:')) || lines[0] || 'no diagnostic output';
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function add(name, ok, detail, failLevel = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : failLevel,
    detail,
  });
}

function maybeBlocker() {
  return strict ? 'blocker' : 'warn';
}

function plist(appPath, key) {
  return run('/usr/libexec/PlistBuddy', [
    '-c',
    `Print :${key}`,
    path.join(appPath, 'Contents', 'Info.plist'),
  ], { allowFail: true });
}

function plistFile(file, key) {
  return run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file], { allowFail: true });
}

function hasNotarizationCredentials() {
  const env = process.env;
  return Boolean(
    env.APPLE_KEYCHAIN_PROFILE ||
      (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) ||
      (env.APPLE_API_KEY && fs.existsSync(env.APPLE_API_KEY) && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) ||
      (env.APPLE_API_KEY_BASE64 && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)
  );
}

function checkPackageConfig() {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  const build = pkg.build || {};
  const mac = build.mac || {};
  const publish = Array.isArray(build.publish) ? build.publish[0] || {} : {};

  add('package version', pkg.version === DEFAULT_VERSION, `${pkg.version} expected ${DEFAULT_VERSION}`);
  add('bundle identifier', build.appId === 'ai.ezer.connect-desktop', build.appId || 'missing');
  add('product name', build.productName === 'Connect AI', build.productName || 'missing');
  add('Electron version pin', build.electronVersion === '42.4.1', build.electronVersion || 'missing');
  add('hardened runtime', mac.hardenedRuntime === true, String(mac.hardenedRuntime));
  add('mac entitlements', mac.entitlements === 'build/entitlements.mac.plist' && mac.entitlementsInherit === 'build/entitlements.mac.plist', `${mac.entitlements || 'missing'} / ${mac.entitlementsInherit || 'missing'}`);
  add('notarization enabled', mac.notarize === true, String(mac.notarize));
  add('GitHub updater metadata', publish.provider === 'github' && publish.owner === 'wonseokjung' && publish.repo === 'connect-ai', `${publish.provider || 'missing'}:${publish.owner || 'missing'}/${publish.repo || 'missing'}`);
}

function checkBaseline() {
  let baseline;
  try {
    baseline = resolveBaselineApp();
    add('baseline app', true, baseline.source);
  } catch (error) {
    add('baseline app', false, error.message);
    return null;
  }

  const resources = baselineResources(baseline);
  if (fs.existsSync(resources.asarPath)) {
    const actual = sha256(resources.asarPath);
    add('baseline app.asar hash', actual === DEFAULT_ASAR_SHA256, actual);
  } else {
    add('baseline app.asar hash', false, `missing: ${resources.asarPath}`);
  }

  const localIcon = path.join(desktopDir, 'build', 'icon.icns');
  const baselineIcon = path.join(resources.resourcesDir, 'icon.icns');
  if (fs.existsSync(localIcon) && fs.existsSync(baselineIcon)) {
    const localHash = sha256(localIcon);
    const baselineHash = sha256(baselineIcon);
    add('mac icon parity', localHash === baselineHash, localHash);
  } else {
    add('mac icon parity', false, `missing local or baseline icon: ${localIcon} / ${baselineIcon}`);
  }

  const baselineLlamacpp = path.join(resources.resourcesDir, 'llamacpp');
  const baselineArmServer = path.join(baselineLlamacpp, 'mac-arm64', 'llama-server');
  const baselineX64Server = path.join(baselineLlamacpp, 'mac-x64', 'llama-server');
  add(
    'baseline llama.cpp resources',
    fs.existsSync(baselineArmServer) && fs.existsSync(baselineX64Server),
    `mac-arm64=${fs.existsSync(baselineArmServer)}, mac-x64=${fs.existsSync(baselineX64Server)}`,
  );

  return baseline;
}

function checkAudit() {
  const audit = run('npm', ['audit', '--omit=dev', '--json'], { allowFail: true });
  try {
    const parsed = JSON.parse(audit.stdout || '{}');
    const total = Number(parsed.metadata?.vulnerabilities?.total || 0);
    add('production npm audit', total === 0, `${total} production vulnerabilities`);
  } catch {
    add('production npm audit', audit.ok, firstLine(audit.stderr || audit.stdout));
  }
}

function extractAsar(asarPath, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `connect-ai-${label}-asar-`));
  const localAsarBin = path.join(desktopDir, 'node_modules', '.bin', process.platform === 'win32' ? 'asar.cmd' : 'asar');
  if (fs.existsSync(localAsarBin)) {
    run(localAsarBin, ['extract', asarPath, tmp]);
  } else {
    run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', '@electron/asar', 'extract', asarPath, tmp]);
  }
  return tmp;
}

function checkReleaseAsarParity(releaseAsar) {
  const baseline = resolveBaselineApp();
  const { asarPath } = baselineResources(baseline);
  const releaseHash = sha256(releaseAsar);
  const policy = summarizeAppAsarPolicy(approveMainProcessSecurityDeltaFromAsar({
    baselineAsarPath: asarPath,
    candidateAsarPath: releaseAsar,
    localMainPath: path.join(desktopDir, 'src', 'main.ts'),
  }));
  add(
    'release app.asar parity',
    appAsarContentOk({
      expectedSha256: DEFAULT_ASAR_SHA256,
      candidateSha256: releaseHash,
      policy,
    }),
    appAsarPolicyDetail({
      expectedSha256: DEFAULT_ASAR_SHA256,
      candidateSha256: releaseHash,
      policy,
    }),
  );
}

function checkDirectoryParity(name, baselineDir, releaseDir) {
  if (!fs.existsSync(baselineDir) && !fs.existsSync(releaseDir)) {
    add(name, true, 'not present in baseline or release');
    return;
  }
  if (!fs.existsSync(baselineDir) || !fs.existsSync(releaseDir)) {
    add(name, false, `baseline exists=${fs.existsSync(baselineDir)}, release exists=${fs.existsSync(releaseDir)}`);
    return;
  }

  const baselineFiles = listFiles(baselineDir);
  const releaseFiles = listFiles(releaseDir);
  const baselineSet = new Set(baselineFiles);
  const releaseSet = new Set(releaseFiles);
  const missing = baselineFiles.filter((file) => !releaseSet.has(file));
  const extra = releaseFiles.filter((file) => !baselineSet.has(file));
  const changed = [];

  if (!missing.length && !extra.length) {
    for (const file of baselineFiles) {
      if (sha256(path.join(baselineDir, file)) !== sha256(path.join(releaseDir, file))) {
        changed.push(file);
        if (changed.length >= 10) break;
      }
    }
  }

  const ok = !missing.length && !extra.length && !changed.length;
  add(name, ok, ok ? `${baselineFiles.length} files match baseline` : `missing=${missing.length}, extra=${extra.length}, changed=${changed.length}${changed.length ? `, first changed=${changed[0]}` : ''}`);
}

function listFilesAndSymlinks(root) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relativePath = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push({ path: relativePath, type: 'file' });
      } else if (entry.isSymbolicLink()) {
        out.push({
          path: relativePath,
          type: 'symlink',
          target: fs.readlinkSync(full),
          valid: fs.existsSync(full),
        });
      }
    }
  }
  walk(root);
  return out.sort((left, right) => left.path.localeCompare(right.path));
}

function checkLlamacppResourceParity(name, baselineDir, releaseDir) {
  if (!fs.existsSync(baselineDir) || !fs.existsSync(releaseDir)) {
    add(name, false, `baseline exists=${fs.existsSync(baselineDir)}, release exists=${fs.existsSync(releaseDir)}`);
    return;
  }

  const baselineEntries = listFilesAndSymlinks(baselineDir);
  const releaseEntries = listFilesAndSymlinks(releaseDir);
  const baselineMap = new Map(baselineEntries.map((entry) => [entry.path, entry]));
  const releaseMap = new Map(releaseEntries.map((entry) => [entry.path, entry]));
  const missing = baselineEntries.filter((entry) => !releaseMap.has(entry.path));
  const extra = releaseEntries.filter((entry) => !baselineMap.has(entry.path));
  const changedLinks = [];

  for (const baselineEntry of baselineEntries) {
    const releaseEntry = releaseMap.get(baselineEntry.path);
    if (!releaseEntry) continue;
    if (baselineEntry.type !== releaseEntry.type) {
      changedLinks.push(baselineEntry.path);
    } else if (baselineEntry.type === 'symlink' && baselineEntry.target !== releaseEntry.target) {
      changedLinks.push(baselineEntry.path);
    }
    if (changedLinks.length >= 10) break;
  }

  const releaseBrokenLinks = releaseEntries
    .filter((entry) => entry.type === 'symlink' && !entry.valid)
    .map((entry) => entry.path);
  const releaseAbsoluteLinks = releaseEntries
    .filter((entry) => entry.type === 'symlink' && path.isAbsolute(entry.target))
    .map((entry) => entry.path);
  const requiredServers = [
    path.join(releaseDir, 'mac-arm64', 'llama-server'),
    path.join(releaseDir, 'mac-x64', 'llama-server'),
  ];
  const missingServers = requiredServers.filter((file) => !fs.existsSync(file));
  const fileCount = releaseEntries.filter((entry) => entry.type === 'file').length;
  const symlinkCount = releaseEntries.filter((entry) => entry.type === 'symlink').length;
  const ok = !missing.length &&
    !extra.length &&
    !changedLinks.length &&
    !releaseBrokenLinks.length &&
    !releaseAbsoluteLinks.length &&
    !missingServers.length;

  add(
    name,
    ok,
    ok
      ? `${fileCount} files and ${symlinkCount} symlinks match baseline resource shape`
      : `missing=${missing.length}, extra=${extra.length}, changedLinks=${changedLinks.length}, brokenLinks=${releaseBrokenLinks.length}, absoluteLinks=${releaseAbsoluteLinks.length}, missingServers=${missingServers.length}`,
  );
}

function checkUpdateMetadata(dmgPath) {
  const latestMacPath = path.join(desktopDir, 'release', 'latest-mac.yml');
  if (!fs.existsSync(latestMacPath)) {
    add('latest-mac.yml artifact', false, `missing: ${latestMacPath}`);
    return;
  }
  if (!fs.existsSync(dmgPath)) {
    add('latest-mac.yml artifact', false, `DMG missing for metadata check: ${dmgPath}`);
    return;
  }

  const metadata = readLatestMacYaml(latestMacPath);
  const stat = fs.statSync(dmgPath);
  const dmgName = path.basename(dmgPath);
  const sha512 = hashBase64(dmgPath, 'sha512');
  const fileEntry = metadata.files?.[0] || {};

  add('latest-mac.yml version', metadata.version === DEFAULT_VERSION, metadata.version || 'missing');
  add('latest-mac.yml path', metadata.path === dmgName && fileEntry.url === dmgName, `path=${metadata.path || 'missing'}, url=${fileEntry.url || 'missing'}`);
  add('latest-mac.yml size', fileEntry.size === stat.size, `${fileEntry.size || 'missing'} expected ${stat.size}`);
  add('latest-mac.yml sha512', metadata.sha512 === sha512 && fileEntry.sha512 === sha512, metadata.sha512 || 'missing');
}

function mountedAppPath(mountPoint) {
  const direct = path.join(mountPoint, 'Connect AI.app');
  if (fs.existsSync(direct)) return direct;
  const app = fs.readdirSync(mountPoint).find((entry) => entry.endsWith('.app'));
  return app ? path.join(mountPoint, app) : direct;
}

function attachDmg(dmgPath, mountPoint) {
  let last = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const attach = run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mountPoint, dmgPath], { allowFail: true });
    if (attach.ok) return attach;
    last = attach;
    sleepSync(1000 * attempt);
  }
  return last;
}

function checkMountedDmg(dmgPath) {
  if (process.platform !== 'darwin') {
    add('DMG mounted app verification', false, 'requires macOS hdiutil', maybeBlocker());
    return;
  }
  if (!fs.existsSync(dmgPath)) {
    add('DMG mounted app verification', false, `missing: ${dmgPath}`, maybeBlocker());
    return;
  }

  const baseline = resolveBaselineApp();
  const baselineRes = baselineResources(baseline);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-dmg-'));
  const mountPoint = path.join(tmp, 'mnt');
  fs.mkdirSync(mountPoint);

  try {
    const attach = attachDmg(dmgPath, mountPoint);
    if (!attach.ok) {
      add('DMG mounted app verification', false, firstLine(attach.stderr || attach.stdout), maybeBlocker());
      return;
    }

    const appPath = mountedAppPath(mountPoint);
    add('DMG mounted app artifact', fs.existsSync(appPath), appPath);
    if (!fs.existsSync(appPath)) return;

    const bundleId = plist(appPath, 'CFBundleIdentifier');
    add('DMG app bundle identifier', bundleId.ok && bundleId.stdout.trim() === 'ai.ezer.connect-desktop', bundleId.ok ? bundleId.stdout.trim() : firstLine(bundleId.stderr));

    const version = plist(appPath, 'CFBundleShortVersionString');
    add('DMG app bundle version', version.ok && version.stdout.trim() === DEFAULT_VERSION, version.ok ? version.stdout.trim() : firstLine(version.stderr));

    const electronFrameworkPlist = path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources', 'Info.plist');
    const electronFrameworkVersion = plistFile(electronFrameworkPlist, 'CFBundleVersion');
    add('DMG app Electron runtime', electronFrameworkVersion.ok && electronFrameworkVersion.stdout.trim() === '42.4.1', electronFrameworkVersion.ok ? electronFrameworkVersion.stdout.trim() : firstLine(electronFrameworkVersion.stderr));

    const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
    if (fs.existsSync(asarPath)) {
      const asarSha = sha256(asarPath);
      const policy = summarizeAppAsarPolicy(approveMainProcessSecurityDeltaFromAsar({
        baselineAsarPath: baselineRes.asarPath,
        candidateAsarPath: asarPath,
        localMainPath: path.join(desktopDir, 'src', 'main.ts'),
      }));
      add(
        'DMG app.asar hash',
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
      add('DMG app.asar hash', false, `missing: ${asarPath}`);
    }
    checkDirectoryParity(
      'DMG app.asar.unpacked parity',
      path.join(baselineRes.resourcesDir, 'app.asar.unpacked'),
      path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')
    );
    checkLlamacppResourceParity(
      'DMG llama.cpp resources parity',
      path.join(baselineRes.resourcesDir, 'llamacpp'),
      path.join(appPath, 'Contents', 'Resources', 'llamacpp')
    );

    const codesign = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { allowFail: true });
    add('DMG app code signature', codesign.ok, codesign.ok ? 'codesign --verify passed' : firstLine(codesign.stderr || codesign.stdout), maybeBlocker());
  } finally {
    run('/usr/bin/hdiutil', ['detach', mountPoint, '-force'], { allowFail: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function checkDmgDistributionSecurity(dmgPath) {
  if (process.platform !== 'darwin') {
    add('DMG Gatekeeper assessment', false, 'requires macOS spctl', maybeBlocker());
    add('DMG notarization stapled ticket', false, 'requires macOS xcrun stapler', maybeBlocker());
    return;
  }
  if (!fs.existsSync(dmgPath)) {
    add('DMG Gatekeeper assessment', false, `missing: ${dmgPath}`, maybeBlocker());
    add('DMG notarization stapled ticket', false, `missing: ${dmgPath}`, maybeBlocker());
    return;
  }

  const spctl = run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmgPath], { allowFail: true });
  add('DMG Gatekeeper assessment', spctl.ok, spctl.ok ? firstLine(spctl.stderr || spctl.stdout) : firstLine(spctl.stderr || spctl.stdout), maybeBlocker());

  const stapler = run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath], { allowFail: true });
  add('DMG notarization stapled ticket', stapler.ok, stapler.ok ? firstLine(stapler.stdout || stapler.stderr) : firstLine(stapler.stderr || stapler.stdout), maybeBlocker());
}

function checkSigningInputs() {
  const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { allowFail: true });
  const identityText = `${identities.stdout}\n${identities.stderr}`;
  const hasDeveloperId = /Developer ID Application/.test(identityText);
  add('Developer ID signing identity', hasDeveloperId, hasDeveloperId ? 'Developer ID Application identity is available' : firstLine(identityText), maybeBlocker());
  add('notarization credentials', hasNotarizationCredentials(), 'APPLE_KEYCHAIN_PROFILE or Apple ID/API key env set', maybeBlocker());
}

function checkReleaseArtifacts() {
  const appPath = path.join(desktopDir, 'release', 'mac-arm64', 'Connect AI.app');
  const dmgPath = path.join(desktopDir, 'release', `Connect-AI-${DEFAULT_VERSION}-mac-arm64.dmg`);
  const baseline = resolveBaselineApp();
  const baselineRes = baselineResources(baseline);

  if (!fs.existsSync(appPath)) {
    add('release app artifact', false, `missing: ${appPath}`, maybeBlocker());
    add('release DMG artifact', fs.existsSync(dmgPath), fs.existsSync(dmgPath) ? dmgPath : `missing: ${dmgPath}`, maybeBlocker());
    return;
  }

  add('release app artifact', true, appPath);

  const releaseAsar = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  if (fs.existsSync(releaseAsar)) {
    checkReleaseAsarParity(releaseAsar);
  } else {
    add('release app.asar parity', false, `missing: ${releaseAsar}`);
  }
  checkDirectoryParity(
    'release app.asar.unpacked parity',
    path.join(baselineRes.resourcesDir, 'app.asar.unpacked'),
    path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')
  );
  checkLlamacppResourceParity(
    'release llama.cpp resources parity',
    path.join(baselineRes.resourcesDir, 'llamacpp'),
    path.join(appPath, 'Contents', 'Resources', 'llamacpp')
  );

  const bundleId = plist(appPath, 'CFBundleIdentifier');
  add('release bundle identifier', bundleId.ok && bundleId.stdout.trim() === 'ai.ezer.connect-desktop', bundleId.ok ? bundleId.stdout.trim() : firstLine(bundleId.stderr));

  const version = plist(appPath, 'CFBundleShortVersionString');
  add('release bundle version', version.ok && version.stdout.trim() === DEFAULT_VERSION, version.ok ? version.stdout.trim() : firstLine(version.stderr));

  const electronFrameworkPlist = path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources', 'Info.plist');
  const electronFrameworkVersion = plistFile(electronFrameworkPlist, 'CFBundleVersion');
  add('release Electron runtime', electronFrameworkVersion.ok && electronFrameworkVersion.stdout.trim() === '42.4.1', electronFrameworkVersion.ok ? electronFrameworkVersion.stdout.trim() : firstLine(electronFrameworkVersion.stderr));

  add('release DMG artifact', fs.existsSync(dmgPath), fs.existsSync(dmgPath) ? dmgPath : `missing: ${dmgPath}`, maybeBlocker());
  checkUpdateMetadata(dmgPath);
  checkMountedDmg(dmgPath);
  checkDmgDistributionSecurity(dmgPath);

  const codesign = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { allowFail: true });
  add('release code signature', codesign.ok, codesign.ok ? 'codesign --verify passed' : firstLine(codesign.stderr || codesign.stdout), maybeBlocker());

  if (codesign.ok) {
    const spctl = run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], { allowFail: true });
    add('Gatekeeper assessment', spctl.ok, spctl.ok ? firstLine(spctl.stderr || spctl.stdout) : firstLine(spctl.stderr || spctl.stdout), maybeBlocker());

    const stapler = run('/usr/bin/xcrun', ['stapler', 'validate', appPath], { allowFail: true });
    add('notarization stapled ticket', stapler.ok, stapler.ok ? firstLine(stapler.stdout || stapler.stderr) : firstLine(stapler.stderr || stapler.stdout), maybeBlocker());
  }
}

function printReport() {
  console.log(`Connect AI commercial release readiness (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }

  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);

  if (strict && blockers > 0) process.exit(1);
}

checkPackageConfig();
checkBaseline();
checkAudit();
checkSigningInputs();
checkReleaseArtifacts();
printReport();
