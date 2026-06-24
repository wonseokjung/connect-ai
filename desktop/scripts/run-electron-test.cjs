const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const packageJson = require('../package.json');

const desktopDir = path.resolve(__dirname, '..');
const script = process.argv[2];
const timeoutMs = Number(process.env.CONNECT_AI_ELECTRON_TEST_TIMEOUT || 90000);
const electronVersion = process.env.CONNECT_AI_ELECTRON_VERSION || packageJson.build?.electronVersion || '42.4.1';

if (!script) {
  console.error('Usage: node scripts/run-electron-test.cjs <script>');
  process.exit(2);
}

const localBin = path.join(desktopDir, 'node_modules', '.bin');
const command = 'npx';
const args = ['--yes', '--package', `electron@${electronVersion}`, 'electron', path.resolve(desktopDir, script)];
const doneFile = path.join(os.tmpdir(), `connect-ai-electron-test-${process.pid}-${Date.now()}.json`);
let finished = false;
let donePoll;

function readDone() {
  if (!fs.existsSync(doneFile)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(doneFile, 'utf8'));
    return Number.isInteger(parsed.code) ? parsed.code : null;
  } catch {
    return null;
  }
}

function killChild() {
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
}

function exitOnce(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (donePoll) clearInterval(donePoll);
  try { fs.rmSync(doneFile, { force: true }); } catch {}
  process.exit(code);
}

const env = {
  ...process.env,
  CONNECT_AI_ELECTRON_TEST_DONE_FILE: doneFile,
  PATH: (process.env.PATH || '')
    .split(path.delimiter)
    .filter((entry) => path.resolve(entry || '.') !== localBin)
    .join(path.delimiter),
};

const child = spawn(command, args, {
  cwd: os.tmpdir(),
  stdio: 'inherit',
  detached: process.platform !== 'win32',
  env,
});

const timer = setTimeout(() => {
  const doneCode = readDone();
  if (doneCode !== null) {
    console.error(`Electron test completed but process stayed alive; cleaning up: ${script}`);
    killChild();
    exitOnce(doneCode);
    return;
  }
  console.error(`Electron test timed out after ${timeoutMs}ms: ${script}`);
  killChild();
}, timeoutMs);

donePoll = setInterval(() => {
  const doneCode = readDone();
  if (doneCode === null) return;
  console.error(`Electron test completed; cleaning up process group: ${script}`);
  killChild();
  exitOnce(doneCode);
}, 500);

child.on('exit', (code, signal) => {
  const doneCode = readDone();
  if (doneCode !== null) exitOnce(doneCode);
  if (signal) {
    console.error(`Electron test exited with signal ${signal}`);
    exitOnce(1);
  }
  exitOnce(code ?? 0);
});

child.on('error', (error) => {
  console.error(error?.stack || error);
  exitOnce(1);
});
