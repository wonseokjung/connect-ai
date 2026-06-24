const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_VERSION = '0.4.8';
const DEFAULT_APP_PATH = '/Applications/Connect AI.app';
const DEFAULT_ZIP_SHA256 = '04754ba3152760a0871be07273a7066d1728c4bc09b0d7ef0bb32afefa599554';
const DEFAULT_ASAR_SHA256 = '34ec1a57065395c8d83d47054b3bdabf0f1bfb3ff97b906c993379aa1cdc3d0b';
const DEFAULT_ZIP_PATH = path.join(os.homedir(), 'Downloads', 'Connect-AI-0.4.8-arm64-mac.zip');
const tempDirs = new Set();
let cleanupRegistered = false;

function sha256(file, fsImpl = fs) {
  return crypto.createHash('sha256').update(fsImpl.readFileSync(file)).digest('hex');
}

function findApp(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith('.app')) return full;
      if (entry.name !== '__MACOSX') stack.push(full);
    }
  }
  return '';
}

function removeTempDir(dir) {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
  tempDirs.delete(dir);
}

function cleanupBaselineApp(baseline) {
  removeTempDir(baseline?.tempDir);
}

function registerTempDir(dir) {
  tempDirs.add(dir);
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once('exit', () => {
    for (const tempDir of [...tempDirs]) removeTempDir(tempDir);
  });
}

function resolveBaselineApp() {
  if (process.env.CONNECT_AI_APP) {
    const appPath = path.resolve(process.env.CONNECT_AI_APP);
    if (!fs.existsSync(appPath)) throw new Error(`CONNECT_AI_APP does not exist: ${appPath}`);
    return { appPath, source: appPath, fromZip: false, selectionReason: 'explicit CONNECT_AI_APP' };
  }

  const zipPath = path.resolve(process.env.CONNECT_AI_ZIP || DEFAULT_ZIP_PATH);
  if (!fs.existsSync(zipPath)) {
    if (!process.env.CONNECT_AI_ZIP && fs.existsSync(DEFAULT_APP_PATH)) {
      return {
        appPath: DEFAULT_APP_PATH,
        source: DEFAULT_APP_PATH,
        fromZip: false,
        selectionReason: `default zip missing, using installed app fallback (${DEFAULT_ZIP_PATH})`,
      };
    }
    throw new Error(`Connect AI ${DEFAULT_VERSION} baseline zip not found: ${zipPath}. Set CONNECT_AI_ZIP or CONNECT_AI_APP.`);
  }

  const expectedZipSha = process.env.CONNECT_AI_ZIP_SHA256 || (process.env.CONNECT_AI_ZIP ? '' : DEFAULT_ZIP_SHA256);
  if (expectedZipSha) {
    const actualZipSha = sha256(zipPath);
    if (actualZipSha !== expectedZipSha) {
      throw new Error(`Connect AI baseline zip SHA changed: ${actualZipSha}. Expected ${expectedZipSha}`);
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-baseline-zip-'));
  registerTempDir(tmp);
  try {
    execFileSync('/usr/bin/unzip', ['-q', zipPath, '-d', tmp], { stdio: ['ignore', 'pipe', 'inherit'] });
    const appPath = findApp(tmp);
    if (!appPath) throw new Error(`No .app bundle found in baseline zip: ${zipPath}`);
    return {
      appPath,
      source: zipPath,
      fromZip: true,
      zipPath,
      tempDir: tmp,
      selectionReason: process.env.CONNECT_AI_ZIP ? 'explicit CONNECT_AI_ZIP' : 'default current-version download zip',
    };
  } catch (error) {
    removeTempDir(tmp);
    throw error;
  }
}

function baselineResources(baseline) {
  const resourcesDir = path.join(baseline.appPath, 'Contents', 'Resources');
  return {
    resourcesDir,
    asarPath: path.join(resourcesDir, 'app.asar'),
    updateYamlPath: path.join(resourcesDir, 'app-update.yml'),
    infoPlistPath: path.join(baseline.appPath, 'Contents', 'Info.plist'),
  };
}

module.exports = {
  DEFAULT_VERSION,
  DEFAULT_APP_PATH,
  DEFAULT_ZIP_SHA256,
  DEFAULT_ASAR_SHA256,
  DEFAULT_ZIP_PATH,
  baselineResources,
  cleanupBaselineApp,
  resolveBaselineApp,
  sha256,
};
