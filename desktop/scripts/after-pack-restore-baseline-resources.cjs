const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  DEFAULT_ASAR_SHA256,
  baselineResources,
  resolveBaselineApp,
  sha256,
} = require('./baseline-app.cjs');

function findAppBundle(appOutDir) {
  const entries = fs.readdirSync(appOutDir, { withFileTypes: true });
  const app = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  if (!app) throw new Error(`No .app bundle found in ${appOutDir}`);
  return path.join(appOutDir, app.name);
}

function setPlistValue(plistPath, keyPath, value) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${keyPath} ${value}`, plistPath], {
    stdio: 'pipe',
  });
}

function normalizeAppTransportSecurity(appPath) {
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');

  setPlistValue(infoPlist, 'NSAppTransportSecurity:NSAllowsArbitraryLoads', 'false');
  setPlistValue(infoPlist, 'NSAppTransportSecurity:NSAllowsLocalNetworking', 'true');
}

function adHocSignAppBundle(appPath) {
  if (process.env.CONNECT_AI_ADHOC_SIGN_APP !== '1') return;

  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
  if (!fs.existsSync(entitlements)) {
    throw new Error(`Cannot ad-hoc sign app bundle without entitlements: ${entitlements}`);
  }

  execFileSync(
    '/usr/bin/codesign',
    ['--force', '--deep', '--options', 'runtime', '--entitlements', entitlements, '--sign', '-', appPath],
    { stdio: 'inherit' },
  );
  console.log('Applied ad-hoc hardened-runtime signature for local bundle structure verification');
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const baseline = resolveBaselineApp();
  const baselineRes = baselineResources(baseline);
  const actualSha = sha256(baselineRes.asarPath);
  if (actualSha !== DEFAULT_ASAR_SHA256) {
    throw new Error(`Baseline app.asar SHA changed: ${actualSha}. Expected ${DEFAULT_ASAR_SHA256}`);
  }

  const appPath = findAppBundle(context.appOutDir);
  const destResources = path.join(appPath, 'Contents', 'Resources');
  const destAsar = path.join(destResources, 'app.asar');
  const destUnpacked = path.join(destResources, 'app.asar.unpacked');
  const destLlamacpp = path.join(destResources, 'llamacpp');
  const sourceUnpacked = path.join(baselineRes.resourcesDir, 'app.asar.unpacked');
  const sourceLlamacpp = path.join(baselineRes.resourcesDir, 'llamacpp');

  if (!fs.existsSync(destAsar)) {
    throw new Error(`Built app.asar missing before afterPack hardening: ${destAsar}`);
  }
  if (!fs.existsSync(sourceLlamacpp)) {
    throw new Error(`Baseline llama.cpp resources missing: ${sourceLlamacpp}`);
  }
  if (fs.existsSync(sourceUnpacked)) {
    fs.rmSync(destUnpacked, { recursive: true, force: true });
    fs.cpSync(sourceUnpacked, destUnpacked, { recursive: true, verbatimSymlinks: true });
  }
  fs.rmSync(destLlamacpp, { recursive: true, force: true });
  fs.cpSync(sourceLlamacpp, destLlamacpp, { recursive: true, verbatimSymlinks: true });
  normalizeAppTransportSecurity(appPath);
  adHocSignAppBundle(appPath);

  console.log(`Preserved built app.asar and restored baseline unpacked/llama.cpp resources from ${baseline.source}`);
  console.log('Normalized macOS App Transport Security for production release metadata');
};
