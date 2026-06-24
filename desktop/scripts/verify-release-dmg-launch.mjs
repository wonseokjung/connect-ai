import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
const dmgPath = path.join(releaseDir, `Connect-AI-${pkg.version}-mac-arm64.dmg`);
const reportPath = path.join(releaseDir, 'release-dmg-launch-smoke.json');
const logPath = path.join(releaseDir, 'release-dmg-launch-smoke.log');
const timeoutMs = Number(process.env.CONNECT_AI_RELEASE_LAUNCH_MS || 8000);

let mountTmpPath = '';
let mountPoint = '';
let appPath = '';
let executablePath = '';
let infoPlistPath = '';
let isolatedHomePath = '';
let logStdoutFd = null;
let logStderrFd = null;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
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
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || 'no diagnostic output';
}

function plistValue(key) {
  if (!fs.existsSync(infoPlistPath) || !fs.existsSync('/usr/libexec/PlistBuddy')) return null;
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlistPath], {
    encoding: 'utf8',
  });
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeReport(report) {
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function closeLogStreams() {
  for (const fd of [logStdoutFd, logStderrFd]) {
    if (!Number.isInteger(fd)) continue;
    try {
      fs.closeSync(fd);
    } catch {
      // The descriptor may already be closed by the platform after process cleanup.
    }
  }
  logStdoutFd = null;
  logStderrFd = null;
}

function logExcerpt() {
  if (!fs.existsSync(logPath)) return '';
  return fs
    .readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 30)
    .join('\n');
}

function relativeToDesktop(file) {
  return file ? path.relative(desktopDir, file).split(path.sep).join('/') : null;
}

function mountedAppPath(root) {
  const direct = path.join(root, 'Connect AI.app');
  if (fs.existsSync(direct)) return direct;
  const app = fs.readdirSync(root).find((entry) => entry.endsWith('.app'));
  return app ? path.join(root, app) : direct;
}

function terminate(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Process already exited.
    }
  }
}

async function terminateAndWait(child) {
  terminate(child);
  await sleep(1000);
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 0);
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Process group is already gone.
  }
}

async function killMatchingAppProcesses() {
  if (!appPath && !executablePath) return;
  for (const signal of ['TERM', 'KILL']) {
    if (appPath) spawnSync('/usr/bin/pkill', [`-${signal}`, '-f', appPath], { encoding: 'utf8' });
    if (executablePath) spawnSync('/usr/bin/pkill', [`-${signal}`, '-f', executablePath], { encoding: 'utf8' });
    await sleep(500);
  }
}

function baseReport(ok, detail, extra = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'dmg',
    ok,
    durationMs: 0,
    timeoutMs,
    platform: process.platform,
    arch: process.arch,
    dmgPath: relativeToDesktop(dmgPath),
    mountPoint: mountPoint || null,
    appPath: relativeToDesktop(appPath),
    executablePath: relativeToDesktop(executablePath),
    bundleIdentifier: plistValue('CFBundleIdentifier'),
    version: plistValue('CFBundleShortVersionString'),
    isolatedHome: Boolean(isolatedHomePath),
    logPath: relativeToDesktop(logPath),
    detail,
    ...extra,
  };
}

function mountDmg() {
  mountTmpPath = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-dmg-launch-'));
  mountPoint = path.join(mountTmpPath, 'mnt');
  fs.mkdirSync(mountPoint);
  let attach = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    attach = run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mountPoint, dmgPath]);
    if (attach.ok) break;
    sleepSync(1000 * attempt);
  }
  if (!attach.ok) {
    throw new Error(`failed to mount DMG: ${firstLine(attach.stderr || attach.stdout || attach.error)}`);
  }
  appPath = mountedAppPath(mountPoint);
  executablePath = path.join(appPath, 'Contents', 'MacOS', 'Connect AI');
  infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
}

function cleanupMount() {
  if (mountPoint) detachMount(mountPoint);
  if (mountTmpPath) {
    fs.rmSync(mountTmpPath, { recursive: true, force: true });
  }
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
    run('/usr/bin/hdiutil', ['detach', target, '-force']);
    sleepSync(500 * attempt);
  }
  return !isMounted(target);
}

async function main() {
  let child = null;
  let startedAt = Date.now();
  let childExit = null;
  let exitBeforeTimeout = null;
  let cleanupExit = null;
  let launchError = null;

  try {
    if (process.platform !== 'darwin') {
      throw new Error('release DMG launch smoke requires macOS');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 3000) {
      throw new Error('CONNECT_AI_RELEASE_LAUNCH_MS must be at least 3000');
    }
    if (!fs.existsSync(dmgPath)) {
      throw new Error(`missing release DMG: ${dmgPath}`);
    }

    mountDmg();
    if (!fs.existsSync(appPath)) {
      throw new Error(`missing app inside mounted DMG: ${appPath}`);
    }
    if (!fs.existsSync(executablePath)) {
      throw new Error(`missing app executable inside mounted DMG: ${executablePath}`);
    }

    fs.mkdirSync(releaseDir, { recursive: true });
    isolatedHomePath = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-dmg-smoke-home-'));
    fs.writeFileSync(logPath, '');
    logStdoutFd = fs.openSync(logPath, 'a');
    logStderrFd = fs.openSync(logPath, 'a');
    startedAt = Date.now();

    child = spawn(executablePath, ['--no-sandbox'], {
      cwd: desktopDir,
      detached: true,
      stdio: ['ignore', logStdoutFd, logStderrFd],
      env: {
        ...process.env,
        HOME: isolatedHomePath,
        XDG_CONFIG_HOME: path.join(isolatedHomePath, '.config'),
        XDG_CACHE_HOME: path.join(isolatedHomePath, '.cache'),
        CONNECTAI_SAFE: '1',
        CONNECT_AI_RELEASE_SMOKE: '1',
        ELECTRON_ENABLE_LOGGING: '1',
      },
    });

    child.on('exit', (code, exitSignal) => {
      childExit = {
        code,
        signal: exitSignal,
        at: Date.now(),
      };
    });

    child.on('error', (error) => {
      launchError = error;
    });

    await sleep(timeoutMs);
    const durationMs = Date.now() - startedAt;

    if (launchError) {
      throw new Error(`failed to launch app from mounted DMG: ${launchError.message}`);
    }
    exitBeforeTimeout = childExit ? { ...childExit } : null;
    if (exitBeforeTimeout) {
      throw new Error('DMG app exited before launch smoke timeout');
    }

    const pid = child.pid;
    await terminateAndWait(child);
    await killMatchingAppProcesses();
    closeLogStreams();
    cleanupExit = childExit ? { ...childExit } : null;
    child = null;

    const report = {
      ...baseReport(true, 'mounted DMG app stayed alive through launch smoke timeout'),
      durationMs,
      pid,
      exitCode: null,
      signal: null,
      survivedTimeoutBoundary: true,
      terminatedAfterTimeout: true,
      cleanupExitCode: cleanupExit?.code ?? null,
      cleanupSignal: cleanupExit?.signal ?? null,
    };
    writeReport(report);
    console.log(`Release DMG launch smoke passed in ${durationMs}ms`);
    console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (child) {
      await terminateAndWait(child);
      await killMatchingAppProcesses();
    }
    closeLogStreams();
    const report = baseReport(false, error.message || String(error), {
      durationMs,
      exitCode: exitBeforeTimeout?.code ?? childExit?.code ?? null,
      signal: exitBeforeTimeout?.signal ?? childExit?.signal ?? null,
      logExcerpt: logExcerpt(),
    });
    writeReport(report);
    console.error(report.detail);
    if (report.logExcerpt) console.error(report.logExcerpt);
    process.exitCode = 1;
  } finally {
    if (isolatedHomePath) {
      fs.rmSync(isolatedHomePath, { recursive: true, force: true });
    }
    closeLogStreams();
    cleanupMount();
  }
}

main().catch((error) => {
  closeLogStreams();
  writeReport(baseReport(false, error.stack || error.message || String(error), { logExcerpt: logExcerpt() }));
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
