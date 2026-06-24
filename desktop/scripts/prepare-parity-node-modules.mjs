import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';

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
const nodeModulesPath = path.join(desktopDir, 'node_modules');
const packagingMode = process.argv.includes('--packaging');
const restoreDevToolchainMode = process.argv.includes('--restore-dev-toolchain');
const saveDevToolchainMode = process.argv.includes('--save-dev-toolchain');
const devToolchainDir = path.join(desktopDir, '.connect-ai-dev-toolchain');
const devToolchainLocalFilesDirName = 'local-files';
const devToolPackages = ['@electron/asar', '@types/node', 'electron', 'electron-builder', 'typescript'];
const requiredDevToolPackages = ['@electron/asar', '@types/node', 'electron', 'electron-builder', 'typescript'];
const approvedSecurityPatchPackages = new Map([
  ['imapflow', '1.4.1'],
  ['mailparser', '3.9.10'],
  ['nodemailer', '9.0.1'],
]);
const parityPreservedLocalPaths = [
  'package.json',
  'package-lock.json',
  'DISTRIBUTION.md',
  'RELEASE_OPERATOR_CHECKLIST.md',
  'scripts/prepare-parity-node-modules.mjs',
  'scripts/write-release-security-audit.mjs',
  'scripts/write-production-readiness-summary.mjs',
  'scripts/write-release-asset-manifest.mjs',
  'scripts/verify-release-asset-manifest.mjs',
  'scripts/write-release-promotion-plan.mjs',
];

function die(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: desktopDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
}

function removeDir(target) {
  fs.rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

function extractBaselineAsar() {
  const baseline = resolveBaselineApp();
  const { asarPath } = baselineResources(baseline);
  if (!fs.existsSync(asarPath)) die(`baseline app.asar not found: ${asarPath}`);

  const actualSha = sha256(asarPath);
  if (actualSha !== DEFAULT_ASAR_SHA256) {
    die(`baseline app.asar SHA changed: ${actualSha}. Expected ${DEFAULT_ASAR_SHA256}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-parity-'));
  const localAsarBin = path.join(
    desktopDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'asar.cmd' : 'asar'
  );

  try {
    if (fs.existsSync(localAsarBin)) {
      run(localAsarBin, ['extract', asarPath, tmp]);
    } else {
      run('npx', ['--yes', '--package', '@electron/asar', '--', 'asar', 'extract', asarPath, tmp]);
    }
  } catch (error) {
    removeDir(tmp);
    throw error;
  }

  return { extractedDir: tmp, baseline };
}

function overlayBundledNodeModuleSources(extractedDir) {
  const mapPath = path.join(extractedDir, 'out', 'main.js.map');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  let written = 0;
  let skippedEscapes = 0;
  const nodeModulesRoot = path.resolve(nodeModulesPath);

  for (let i = 0; i < map.sources.length; i += 1) {
    const source = map.sources[i];
    const content = map.sourcesContent?.[i];
    if (!source.startsWith('../node_modules/') || typeof content !== 'string') continue;

    const relative = source.slice('../'.length);
    const target = path.resolve(desktopDir, relative);
    if (target !== nodeModulesRoot && !target.startsWith(`${nodeModulesRoot}${path.sep}`)) {
      skippedEscapes += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    written += 1;
  }

  if (skippedEscapes > 0) {
    console.warn(`WARN: skipped ${skippedEscapes} parity source overlay path(s) outside node_modules.`);
  }
  return written;
}

function snapshotLocalParityFiles() {
  const snapshot = new Map();
  for (const relativePath of parityPreservedLocalPaths) {
    const file = path.join(desktopDir, relativePath);
    if (fs.existsSync(file)) snapshot.set(relativePath, fs.readFileSync(file));
  }
  return snapshot;
}

function restoreLocalParityFiles(snapshot) {
  let restored = 0;
  for (const [relativePath, content] of snapshot.entries()) {
    const file = path.join(desktopDir, relativePath);
    if (fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), content) === 0) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    restored += 1;
  }
  if (restored > 0) {
    console.warn(`WARN: restored ${restored} local release operator file(s) after parity overlay.`);
  }
}

function backupLocalParityFiles(stagingDir) {
  const backupRoot = path.join(stagingDir, devToolchainLocalFilesDirName);
  let backedUp = 0;
  for (const relativePath of parityPreservedLocalPaths) {
    const source = path.join(desktopDir, relativePath);
    if (!fs.existsSync(source)) continue;
    const target = path.join(backupRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    backedUp += 1;
  }
  return backedUp;
}

function restoreSavedLocalParityFiles() {
  const backupRoot = path.join(devToolchainDir, devToolchainLocalFilesDirName);
  if (!fs.existsSync(backupRoot)) return 0;

  let restored = 0;
  for (const relativePath of parityPreservedLocalPaths) {
    const source = path.join(backupRoot, relativePath);
    if (!fs.existsSync(source)) continue;
    const target = path.join(desktopDir, relativePath);
    if (fs.existsSync(target) && Buffer.compare(fs.readFileSync(target), fs.readFileSync(source)) === 0) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    restored += 1;
  }

  if (restored > 0) {
    console.warn(`WARN: restored ${restored} local release operator file(s) from saved dev toolchain backup.`);
  }
  return restored;
}

function removePath(relativePath) {
  fs.rmSync(path.join(desktopDir, relativePath), { recursive: true, force: true });
}

function packageDir(root, packageName) {
  return path.join(root, ...packageName.split('/'));
}

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.cpSync(source, target, { recursive: true });
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function repairNodeLlamaCppXpackSymlinks(root = nodeModulesPath) {
  const xpackRoot = path.join(root, 'node-llama-cpp', 'llama', 'xpack');
  const xpacksRoot = path.join(xpackRoot, 'xpacks', '@xpack-dev-tools');
  const storeRoot = path.join(xpackRoot, 'store', '@xpack-dev-tools');
  if (!fs.existsSync(xpacksRoot) || !fs.existsSync(storeRoot)) return 0;

  let repaired = 0;
  for (const entry of fs.readdirSync(storeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const packageStoreRoot = path.join(storeRoot, entry.name);
    const versions = fs.readdirSync(packageStoreRoot, { withFileTypes: true })
      .filter((versionEntry) => versionEntry.isDirectory())
      .map((versionEntry) => versionEntry.name)
      .sort();
    const version = versions[versions.length - 1];
    if (!version) continue;

    const expectedTarget = path.join(packageStoreRoot, version);
    const linkPath = path.join(xpacksRoot, entry.name);
    let stat = null;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {}

    if (stat && !stat.isSymbolicLink()) continue;

    const relativeTarget = path.relative(path.dirname(linkPath), expectedTarget);
    let currentTarget = null;
    if (stat?.isSymbolicLink()) {
      currentTarget = fs.readlinkSync(linkPath);
      const currentResolved = path.resolve(path.dirname(linkPath), currentTarget);
      if (currentResolved === expectedTarget) continue;
    }

    if (stat?.isSymbolicLink()) fs.unlinkSync(linkPath);
    else fs.rmSync(linkPath, { force: true });
    fs.symlinkSync(relativeTarget, linkPath, 'dir');
    repaired += 1;
  }

  return repaired;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function installDevToolchain() {
  execFileSync(npmCommand(), ['install'], {
    cwd: desktopDir,
    stdio: 'inherit',
    env: process.env,
  });
}

function packageJsonPath(root, packageName) {
  return path.join(root, ...packageName.split('/'), 'package.json');
}

function packageExists(root, packageName) {
  return fs.existsSync(packageJsonPath(root, packageName));
}

function readPackageJson(root, packageName) {
  return JSON.parse(fs.readFileSync(packageJsonPath(root, packageName), 'utf8'));
}

function packageVersion(root, packageName) {
  try {
    return readPackageJson(root, packageName).version || '';
  } catch {
    return '';
  }
}

function approvedSecurityPatchStatus(root = nodeModulesPath) {
  const packages = [];
  for (const [packageName, expectedVersion] of approvedSecurityPatchPackages.entries()) {
    const actualVersion = packageVersion(root, packageName);
    packages.push({
      packageName,
      expectedVersion,
      actualVersion,
      ok: actualVersion === expectedVersion,
    });
  }
  return packages;
}

function approvedSecurityPatchSummary(status) {
  return status
    .map((entry) => `${entry.packageName}@${entry.actualVersion || 'missing'}${entry.ok ? '' : ` expected ${entry.expectedVersion}`}`)
    .join(', ');
}

function hasApprovedSecurityPatchPackages(root = nodeModulesPath) {
  return approvedSecurityPatchStatus(root).every((entry) => entry.ok);
}

function ensureApprovedSecurityPatchPackages() {
  if (hasApprovedSecurityPatchPackages()) return;

  const before = approvedSecurityPatchStatus();
  console.warn(`WARN: approved Connect AI security dependency overlay is missing or stale (${approvedSecurityPatchSummary(before)}); running npm install.`);
  installDevToolchain();

  const after = approvedSecurityPatchStatus();
  if (!after.every((entry) => entry.ok)) {
    die(`approved Connect AI security dependency overlay could not be prepared: ${approvedSecurityPatchSummary(after)}`);
  }
}

function snapshotApprovedSecurityPatchPackages() {
  ensureApprovedSecurityPatchPackages();

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-security-overlay-'));
  const tempNodeModules = path.join(stagingDir, 'node_modules');
  for (const packageName of approvedSecurityPatchPackages.keys()) {
    const source = packageDir(nodeModulesPath, packageName);
    const target = packageDir(tempNodeModules, packageName);
    if (!copyIfExists(source, target)) {
      removeDir(stagingDir);
      die(`approved Connect AI security dependency not found after install: ${packageName}`);
    }
  }

  const status = approvedSecurityPatchStatus(tempNodeModules);
  if (!status.every((entry) => entry.ok)) {
    removeDir(stagingDir);
    die(`approved Connect AI security dependency snapshot is invalid: ${approvedSecurityPatchSummary(status)}`);
  }

  return { stagingDir, tempNodeModules, status };
}

function restoreApprovedSecurityPatchPackages(snapshot) {
  if (!snapshot) return 0;

  let restored = 0;
  for (const packageName of approvedSecurityPatchPackages.keys()) {
    const source = packageDir(snapshot.tempNodeModules, packageName);
    const target = packageDir(nodeModulesPath, packageName);
    removeDir(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
    restored += 1;
  }

  const status = approvedSecurityPatchStatus();
  if (!status.every((entry) => entry.ok)) {
    die(`approved Connect AI security dependency overlay failed: ${approvedSecurityPatchSummary(status)}`);
  }

  return restored;
}

function hasDependencyClosure(root, packageNames) {
  const queue = [...packageNames];
  const seen = new Set();

  while (queue.length) {
    const packageName = queue.shift();
    if (!packageName || seen.has(packageName)) continue;
    seen.add(packageName);

    const packageJson = packageJsonPath(root, packageName);
    if (!fs.existsSync(packageJson)) return false;

    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    } catch {
      return false;
    }

    for (const dependencyName of Object.keys(pkg.dependencies || {})) {
      if (!seen.has(dependencyName)) queue.push(dependencyName);
    }
  }

  return true;
}

function hasRequiredDevToolchain(root = nodeModulesPath) {
  return requiredDevToolPackages.every((packageName) => packageExists(root, packageName)) &&
    hasDependencyClosure(root, devToolPackages) &&
    fs.existsSync(path.join(root, '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'));
}

function countPackageJsonFiles(root) {
  if (!fs.existsSync(root)) return 0;

  let count = 0;
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.name === 'package.json') {
        count += 1;
      }
    }
  }
  return count;
}

function useExistingDevToolchainBackup(reason) {
  const tempNodeModules = path.join(devToolchainDir, 'node_modules');
  if (!hasRequiredDevToolchain(tempNodeModules)) return null;

  console.warn(`WARN: ${reason}; reusing existing saved Connect AI dev toolchain.`);
  return {
    packageCount: countPackageJsonFiles(tempNodeModules),
    reusedExistingBackup: true,
  };
}

function preserveDevToolchain() {
  if ((packagingMode && !saveDevToolchainMode) || !fs.existsSync(nodeModulesPath)) return null;

  const stagingDir = `${devToolchainDir}.next`;
  removeDir(stagingDir);
  const tempNodeModules = path.join(stagingDir, 'node_modules');
  const queue = [...devToolPackages];
  const copied = new Set();
  let copiedCount = 0;

  try {
    while (queue.length) {
      const packageName = queue.shift();
      if (!packageName || copied.has(packageName)) continue;
      copied.add(packageName);

      const source = packageDir(nodeModulesPath, packageName);
      const target = packageDir(tempNodeModules, packageName);
      if (!copyIfExists(source, target)) continue;
      copiedCount += 1;

      const packageJson = path.join(target, 'package.json');
      if (!fs.existsSync(packageJson)) continue;
      const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
      for (const dependencyName of Object.keys({ ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) })) {
        if (!copied.has(dependencyName)) queue.push(dependencyName);
      }
    }

    copyIfExists(path.join(nodeModulesPath, '.bin'), path.join(tempNodeModules, '.bin'));
    backupLocalParityFiles(stagingDir);
  } catch (error) {
    removeDir(stagingDir);
    const fallback = useExistingDevToolchainBackup(`could not create a fresh dev toolchain backup (${error.message})`);
    if (fallback) return fallback;
    console.warn(`WARN: could not create a fresh dev toolchain backup; npm install will restore it after packaging (${error.message}).`);
    return null;
  }

  if (!hasRequiredDevToolchain(tempNodeModules)) {
    removeDir(stagingDir);
    const fallback = useExistingDevToolchainBackup('fresh dev toolchain backup was incomplete');
    if (fallback) return fallback;
    return null;
  }

  removeDir(devToolchainDir);
  fs.renameSync(stagingDir, devToolchainDir);
  return { packageCount: copiedCount };
}

function restoreDevToolchain() {
  const tempNodeModules = path.join(devToolchainDir, 'node_modules');
  if (!fs.existsSync(tempNodeModules)) {
    if (hasRequiredDevToolchain()) {
      console.log('Connect AI dev toolchain is already available.');
      return;
    }
    console.log('No saved Connect AI dev toolchain to restore; running npm install.');
    installDevToolchain();
    return;
  }
  fs.mkdirSync(nodeModulesPath, { recursive: true });
  try {
    for (const entry of fs.readdirSync(tempNodeModules, { withFileTypes: true })) {
      const source = path.join(tempNodeModules, entry.name);
      const target = path.join(nodeModulesPath, entry.name);
      removeDir(target);
      fs.cpSync(source, target, {
        recursive: true,
        force: true,
      });
    }
    restoreSavedLocalParityFiles();
  } catch (error) {
    removeDir(devToolchainDir);
    console.warn(`WARN: saved Connect AI dev toolchain could not be restored; running npm install (${error.message}).`);
    installDevToolchain();
    return;
  }
  removeDir(devToolchainDir);
  if (!hasRequiredDevToolchain()) {
    console.log('Saved Connect AI dev toolchain was incomplete; running npm install.');
    installDevToolchain();
    return;
  }
  console.log('Restored Connect AI dev toolchain after parity build.');
}

function main() {
  if (restoreDevToolchainMode) {
    restoreDevToolchain();
    return;
  }

  let extractedDir = null;
  let baseline = null;
  let approvedSecurityPatch = null;

  try {
    ({ extractedDir, baseline } = extractBaselineAsar());
    const extractedNodeModules = path.join(extractedDir, 'node_modules');
    if (!fs.existsSync(extractedNodeModules)) die(`node_modules not found in baseline app.asar: ${extractedNodeModules}`);

    approvedSecurityPatch = snapshotApprovedSecurityPatchPackages();
    const preservedDevToolchain = preserveDevToolchain();
    removeDir(nodeModulesPath);
    fs.cpSync(extractedNodeModules, nodeModulesPath, { recursive: true });
    const repairedXpackSymlinks = repairNodeLlamaCppXpackSymlinks();

    if (packagingMode) {
      const restored = restoreApprovedSecurityPatchPackages(approvedSecurityPatch);
      removeDir(approvedSecurityPatch.stagingDir);
      approvedSecurityPatch = null;
      const xpackRepair = repairedXpackSymlinks ? `, ${repairedXpackSymlinks} xpack symlink(s) repaired` : '';
      console.log(`Prepared Connect AI v${DEFAULT_VERSION} release node_modules from ${baseline.source} with ${restored} approved security dependency overlay package(s)${xpackRepair}.`);
      return;
    }

    const localParityFiles = snapshotLocalParityFiles();
    const overlaid = overlayBundledNodeModuleSources(extractedDir);

    removePath('node_modules/pino/node_modules/pino-std-serializers');
    removePath('node_modules/axios/node_modules/proxy-from-env');
    restoreLocalParityFiles(localParityFiles);
    const restoredSecurityPatchPackages = restoreApprovedSecurityPatchPackages(approvedSecurityPatch);
    removeDir(approvedSecurityPatch.stagingDir);
    approvedSecurityPatch = null;

    const devTools = preservedDevToolchain ? `, ${preservedDevToolchain.packageCount} dev tool packages saved for post-build restore` : '';
    const securityPatch = `, ${restoredSecurityPatchPackages} approved security dependency package(s) overlaid`;
    const xpackRepair = repairedXpackSymlinks ? `, ${repairedXpackSymlinks} xpack symlink(s) repaired` : '';
    console.log(`Prepared Connect AI v${DEFAULT_VERSION} parity node_modules from ${baseline.source} (${overlaid} bundled inputs overlaid${securityPatch}${devTools}${xpackRepair}).`);
  } finally {
    if (approvedSecurityPatch?.stagingDir) removeDir(approvedSecurityPatch.stagingDir);
    if (extractedDir) removeDir(extractedDir);
    cleanupBaselineApp(baseline);
  }
}

main();
