import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const appPath = path.join(releaseDir, 'mac-arm64', 'Connect AI.app');
const executablePath = path.join(appPath, 'Contents', 'MacOS', 'Connect AI');
const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
const reportPath = path.join(releaseDir, 'release-launch-smoke.json');
const logPath = path.join(releaseDir, 'release-launch-smoke.log');
const timeoutMs = Number(process.env.CONNECT_AI_RELEASE_LAUNCH_MS || 8000);
let isolatedHomePath = '';
let logStdoutFd = null;
let logStderrFd = null;

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
  for (const signal of ['TERM', 'KILL']) {
    spawnSync('/usr/bin/pkill', [`-${signal}`, '-f', appPath], { encoding: 'utf8' });
    spawnSync('/usr/bin/pkill', [`-${signal}`, '-f', executablePath], { encoding: 'utf8' });
    await sleep(500);
  }
}

function fail(detail, extra = {}) {
  closeLogStreams();
  if (isolatedHomePath) {
    fs.rmSync(isolatedHomePath, { recursive: true, force: true });
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: false,
    durationMs: 0,
    timeoutMs,
    platform: process.platform,
    arch: process.arch,
    appPath: path.relative(desktopDir, appPath),
    executablePath: path.relative(desktopDir, executablePath),
    bundleIdentifier: plistValue('CFBundleIdentifier'),
    version: plistValue('CFBundleShortVersionString'),
    isolatedHome: Boolean(isolatedHomePath),
    logPath: path.relative(desktopDir, logPath),
    detail,
    ...extra,
  };
  writeReport(report);
  console.error(detail);
  if (report.logExcerpt) console.error(report.logExcerpt);
  process.exit(1);
}

async function main() {
  if (process.platform !== 'darwin') {
    fail('release launch smoke requires macOS');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 3000) {
    fail('CONNECT_AI_RELEASE_LAUNCH_MS must be at least 3000');
  }
  if (!fs.existsSync(executablePath)) {
    fail(`missing release app executable: ${executablePath}`);
  }

  fs.mkdirSync(releaseDir, { recursive: true });
  isolatedHomePath = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-release-smoke-'));
  fs.writeFileSync(logPath, '');
  logStdoutFd = fs.openSync(logPath, 'a');
  logStderrFd = fs.openSync(logPath, 'a');
  const startedAt = Date.now();
  let childExit = null;
  let launchError = null;

  const child = spawn(executablePath, ['--no-sandbox'], {
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
    closeLogStreams();
    fail(`failed to launch release app: ${launchError.message}`, {
      launchError: launchError.message,
      logExcerpt: logExcerpt(),
    });
  }

  const exitBeforeTimeout = childExit ? { ...childExit } : null;
  if (exitBeforeTimeout) {
    closeLogStreams();
    fail('release app exited before launch smoke timeout', {
      durationMs: exitBeforeTimeout.at - startedAt,
      exitCode: exitBeforeTimeout.code,
      signal: exitBeforeTimeout.signal,
      logExcerpt: logExcerpt(),
    });
  }

  await terminateAndWait(child);
  await killMatchingAppProcesses();
  closeLogStreams();
  const cleanupExit = childExit ? { ...childExit } : null;
  fs.rmSync(isolatedHomePath, { recursive: true, force: true });

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: true,
    durationMs,
    timeoutMs,
    platform: process.platform,
    arch: process.arch,
    appPath: path.relative(desktopDir, appPath),
    executablePath: path.relative(desktopDir, executablePath),
    bundleIdentifier: plistValue('CFBundleIdentifier'),
    version: plistValue('CFBundleShortVersionString'),
    pid: child.pid,
    exitCode: null,
    signal: null,
    survivedTimeoutBoundary: true,
    terminatedAfterTimeout: true,
    cleanupExitCode: cleanupExit?.code ?? null,
    cleanupSignal: cleanupExit?.signal ?? null,
    isolatedHome: true,
    logPath: path.relative(desktopDir, logPath),
  };
  writeReport(report);
  console.log(`Release launch smoke passed in ${durationMs}ms`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
}

main().catch((error) => {
  fail(error.stack || error.message || String(error));
});
