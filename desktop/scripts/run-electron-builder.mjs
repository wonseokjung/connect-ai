import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const env = { ...process.env };

if (process.platform === 'darwin' && !env.PYTHON_PATH && fs.existsSync('/usr/bin/python3')) {
  env.PYTHON_PATH = '/usr/bin/python3';
}

function hasDeveloperIdIdentity() {
  if (process.platform !== 'darwin') return false;
  const args = ['find-identity', '-v', '-p', 'codesigning'];
  if (env.CSC_KEYCHAIN && fs.existsSync(env.CSC_KEYCHAIN)) args.push(env.CSC_KEYCHAIN);
  const result = spawnSync('/usr/bin/security', args, {
    encoding: 'utf8',
    env,
  });
  return /Developer ID Application/.test(`${result.stdout || ''}\n${result.stderr || ''}`);
}

function hasProductionSigningMaterial() {
  return Boolean(
    env.CSC_LINK ||
      env.CSC_NAME ||
      env.CSC_KEYCHAIN ||
      env.BUILD_CERTIFICATE_BASE64 ||
      env.BUILD_CERTIFICATE_PATH ||
      env.CONNECT_AI_CERTIFICATE_BASE64 ||
      env.CONNECT_AI_CERTIFICATE_PATH,
  );
}

if (
  process.platform === 'darwin' &&
  env.CONNECT_AI_ADHOC_SIGN_APP !== '0' &&
  !hasDeveloperIdIdentity() &&
  !hasProductionSigningMaterial()
) {
  env.CONNECT_AI_ADHOC_SIGN_APP = '1';
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

execFileSync(
  npx,
  ['--yes', '--package', 'electron-builder@26.15.3', 'electron-builder', '--publish', 'never'],
  {
    env,
    stdio: 'inherit',
  }
);
