import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: desktopDir,
    stdio: 'inherit',
    env: process.env,
  });
}

function statusOf(result) {
  if (result.error) {
    console.error(result.error.stack || result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

let status = statusOf(run(['scripts/build-parity.mjs']));
if (status === 0) {
  status = statusOf(run(['scripts/prepare-parity-node-modules.mjs', '--packaging', '--save-dev-toolchain']));
}
if (status === 0) status = statusOf(run(['scripts/run-electron-builder.mjs']));

const restoreStatus = statusOf(run(['scripts/prepare-parity-node-modules.mjs', '--restore-dev-toolchain']));
process.exit(status || restoreStatus);
