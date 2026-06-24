import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const checkOnly = args.has('--check');
const shouldImportP12 = args.has('--import-p12');
const shouldRestoreApiKey = args.has('--restore-api-key');
const shouldStoreNotaryProfile = args.has('--store-notary-profile');
const noExit = args.has('--no-exit');
const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const statuses = [];

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
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
  const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => !line.startsWith('Processing:')) || lines[0] || 'no diagnostic output';
}

function add(name, ok, detail, level = 'blocker') {
  statuses.push({ name, ok: Boolean(ok), detail, level: ok ? 'pass' : level });
}

function envPresent(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function missing(names) {
  return names.filter((name) => !envPresent(name));
}

function groupComplete(names) {
  return missing(names).length === 0;
}

function base64LooksValid(name) {
  const value = String(process.env[name] || '').replace(/\s/g, '');
  return value.length > 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function missingDetail(names) {
  return names.length ? `missing ${names.join(', ')}` : 'configured';
}

function parseArgValue(name) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
}

function githubEnvAppend(key, value) {
  if (!process.env.GITHUB_ENV) return;
  fs.appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`);
}

function userKeychains() {
  const result = run('/usr/bin/security', ['list-keychains', '-d', 'user']);
  if (!result.ok) return [];
  return [...result.stdout.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function setUserKeychainsWith(keychainPath) {
  const keychains = [keychainPath, ...userKeychains().filter((item) => item !== keychainPath)];
  run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...keychains], { inherit: true });
}

function certificateSource() {
  const cliP12 = parseArgValue('--p12');
  if (cliP12) return { type: 'path', value: cliP12, name: '--p12' };
  for (const name of ['BUILD_CERTIFICATE_PATH', 'CONNECT_AI_CERTIFICATE_PATH']) {
    if (envPresent(name)) return { type: 'path', value: process.env[name], name };
  }
  for (const name of ['BUILD_CERTIFICATE_BASE64', 'CONNECT_AI_CERTIFICATE_BASE64']) {
    if (envPresent(name)) return { type: 'base64', value: process.env[name], name };
  }
  return null;
}

function keychainPath() {
  return process.env.CSC_KEYCHAIN ||
    process.env.CONNECT_AI_KEYCHAIN_PATH ||
    path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'connect-ai-signing.keychain-db');
}

function importP12() {
  const source = certificateSource();
  const p12Password = process.env.P12_PASSWORD || process.env.CONNECT_AI_CERTIFICATE_PASSWORD;
  const keychainPassword = process.env.KEYCHAIN_PASSWORD || process.env.CONNECT_AI_KEYCHAIN_PASSWORD;

  if (!source) {
    add('certificate source', false, 'set BUILD_CERTIFICATE_BASE64 or BUILD_CERTIFICATE_PATH');
    return;
  }
  if (!p12Password) {
    add('certificate password', false, 'set P12_PASSWORD');
    return;
  }
  if (!keychainPassword) {
    add('keychain password', false, 'set KEYCHAIN_PASSWORD');
    return;
  }

  const p12File = source.type === 'path'
    ? path.resolve(source.value)
    : path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'connect-ai-build-certificate.p12');
  if (source.type === 'base64') fs.writeFileSync(p12File, Buffer.from(source.value, 'base64'));
  if (!fs.existsSync(p12File)) {
    add('certificate source', false, `missing: ${p12File}`);
    return;
  }

  const keychain = keychainPath();
  if (!fs.existsSync(keychain)) {
    const created = run('/usr/bin/security', ['create-keychain', '-p', keychainPassword, keychain]);
    if (!created.ok) {
      add('create signing keychain', false, firstLine(created.stderr || created.stdout || created.error));
      return;
    }
  }

  run('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychain], { inherit: true });
  const unlocked = run('/usr/bin/security', ['unlock-keychain', '-p', keychainPassword, keychain]);
  if (!unlocked.ok) {
    add('unlock signing keychain', false, firstLine(unlocked.stderr || unlocked.stdout || unlocked.error));
    return;
  }

  const imported = run('/usr/bin/security', ['import', p12File, '-P', p12Password, '-A', '-t', 'cert', '-f', 'pkcs12', '-k', keychain]);
  if (!imported.ok && !/already exists/i.test(imported.stderr)) {
    add('import Developer ID certificate', false, firstLine(imported.stderr || imported.stdout || imported.error));
    return;
  }

  setUserKeychainsWith(keychain);
  run('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', keychainPassword, keychain], { inherit: true });
  process.env.CSC_KEYCHAIN = keychain;
  githubEnvAppend('CSC_KEYCHAIN', keychain);
  add('import Developer ID certificate', true, keychain);
}

function restoreApiKey() {
  if (!process.env.APPLE_API_KEY_BASE64) {
    add('restore App Store Connect API key file', true, 'APPLE_API_KEY_BASE64 not set; using other notarization mode if available', 'warn');
    return;
  }
  if (!process.env.APPLE_API_KEY_ID) {
    add('restore App Store Connect API key file', false, 'APPLE_API_KEY_ID is required with APPLE_API_KEY_BASE64');
    return;
  }
  const apiKeyPath = path.join(process.env.RUNNER_TEMP || os.tmpdir(), `AuthKey_${process.env.APPLE_API_KEY_ID}.p8`);
  fs.writeFileSync(apiKeyPath, Buffer.from(process.env.APPLE_API_KEY_BASE64, 'base64'), { mode: 0o600 });
  fs.chmodSync(apiKeyPath, 0o600);
  process.env.APPLE_API_KEY = apiKeyPath;
  githubEnvAppend('APPLE_API_KEY', apiKeyPath);
  add('restore App Store Connect API key file', true, apiKeyPath);
}

function storeNotaryProfile() {
  const profile = process.env.APPLE_KEYCHAIN_PROFILE || 'connect-ai-notary';
  const appleId = process.env.APPLE_ID;
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !password || !teamId) {
    add('store notarytool profile', false, 'set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID');
    return;
  }
  const stored = run('/usr/bin/xcrun', [
    'notarytool',
    'store-credentials',
    profile,
    '--apple-id',
    appleId,
    '--password',
    password,
    '--team-id',
    teamId,
  ]);
  if (!stored.ok) {
    add('store notarytool profile', false, firstLine(stored.stderr || stored.stdout || stored.error));
    return;
  }
  process.env.APPLE_KEYCHAIN_PROFILE = profile;
  githubEnvAppend('APPLE_KEYCHAIN_PROFILE', profile);
  add('store notarytool profile', true, profile);
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

function checkSigning() {
  const identityArgs = ['find-identity', '-v', '-p', 'codesigning'];
  if (process.env.CSC_KEYCHAIN && fs.existsSync(process.env.CSC_KEYCHAIN)) identityArgs.push(process.env.CSC_KEYCHAIN);
  const identities = run('/usr/bin/security', identityArgs);
  const text = `${identities.stdout}\n${identities.stderr}`;
  const hasDeveloperId = /Developer ID Application/.test(text);
  add('Developer ID Application identity', hasDeveloperId, hasDeveloperId ? 'available' : firstLine(text));

  const source = certificateSource();
  const certificatePasswordOk = envPresent('P12_PASSWORD') || envPresent('CONNECT_AI_CERTIFICATE_PASSWORD');
  const keychainPasswordOk = envPresent('KEYCHAIN_PASSWORD') || envPresent('CONNECT_AI_KEYCHAIN_PASSWORD');
  let sourceOk = false;
  let sourceDetail = 'set BUILD_CERTIFICATE_BASE64, BUILD_CERTIFICATE_PATH, CONNECT_AI_CERTIFICATE_BASE64, or CONNECT_AI_CERTIFICATE_PATH';
  if (source?.type === 'path') {
    const resolved = path.resolve(source.value);
    sourceOk = fs.existsSync(resolved);
    sourceDetail = sourceOk ? `${source.name} file exists` : `${source.name} file is missing`;
  } else if (source?.type === 'base64') {
    sourceOk = base64LooksValid(source.name);
    sourceDetail = sourceOk ? `${source.name} base64 present` : `${source.name} does not look like base64`;
  }
  if (!hasDeveloperId) {
    add('certificate import source', sourceOk, sourceDetail);
    add('certificate password', certificatePasswordOk, certificatePasswordOk ? 'P12 password configured' : 'set P12_PASSWORD or CONNECT_AI_CERTIFICATE_PASSWORD');
    add('keychain password', keychainPasswordOk, keychainPasswordOk ? 'keychain password configured' : 'set KEYCHAIN_PASSWORD or CONNECT_AI_KEYCHAIN_PASSWORD');
  }
  const certificateImportReady = hasDeveloperId || Boolean(sourceOk && certificatePasswordOk && keychainPasswordOk);
  add('certificate import inputs', certificateImportReady, hasDeveloperId ? 'existing Developer ID identity available' : certificateImportReady ? 'p12 source and passwords configured' : 'existing identity or complete p12 import inputs required');

  const apiKeyFileNames = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  const apiKeyFileMissing = missing(apiKeyFileNames);
  const apiKeyFileExists = envPresent('APPLE_API_KEY') && fs.existsSync(process.env.APPLE_API_KEY);
  const apiKeyFileReady = groupComplete(apiKeyFileNames) && apiKeyFileExists;
  if (envPresent('APPLE_API_KEY')) {
    add('APPLE_API_KEY file', apiKeyFileExists, apiKeyFileExists ? 'file exists' : 'path does not exist');
  }

  const apiKeyBase64Names = ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  const apiKeyBase64Missing = missing(apiKeyBase64Names);
  const apiKeyBase64Ready = groupComplete(apiKeyBase64Names) && base64LooksValid('APPLE_API_KEY_BASE64');
  if (envPresent('APPLE_API_KEY_BASE64')) {
    add('APPLE_API_KEY_BASE64 shape', base64LooksValid('APPLE_API_KEY_BASE64'), base64LooksValid('APPLE_API_KEY_BASE64') ? 'base64 present' : 'does not look like base64');
  }

  const profileReady = envPresent('APPLE_KEYCHAIN_PROFILE');
  const appleIdNames = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
  const appleIdMissing = missing(appleIdNames);
  const appleIdReady = appleIdMissing.length === 0;
  const notaryReady = profileReady || appleIdReady || apiKeyFileReady || apiKeyBase64Ready;
  const notaryDetail = notaryReady
    ? [
        profileReady ? 'APPLE_KEYCHAIN_PROFILE' : null,
        appleIdReady ? 'Apple ID group' : null,
        apiKeyFileReady ? 'API key file group' : null,
        apiKeyBase64Ready ? 'API key base64 group' : null,
      ].filter(Boolean).join(', ')
    : [
        `profile: ${missingDetail(['APPLE_KEYCHAIN_PROFILE'])}`,
        `Apple ID: ${missingDetail(appleIdMissing)}`,
        `API key file: ${apiKeyFileMissing.length ? missingDetail(apiKeyFileMissing) : 'APPLE_API_KEY path missing'}`,
        `API key base64: ${apiKeyBase64Missing.length ? missingDetail(apiKeyBase64Missing) : 'invalid APPLE_API_KEY_BASE64'}`,
      ].join('; ');
  add('notarization credentials', notaryReady, notaryDetail);
}

function printReport() {
  console.log(`Connect AI macOS signing setup (${strict ? 'strict' : 'doctor'})`);
  for (const status of statuses) {
    const label = status.ok ? 'PASS' : status.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${status.name} - ${status.detail}`);
  }
  const blockers = statuses.filter((item) => !item.ok && item.level === 'blocker').length;
  const warnings = statuses.filter((item) => !item.ok && item.level === 'warn').length;
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  fs.mkdirSync(releaseDir, { recursive: true });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    mode: {
      checkOnly,
      importP12: shouldImportP12,
      restoreApiKey: shouldRestoreApiKey,
      storeNotaryProfile: shouldStoreNotaryProfile,
    },
    platform: {
      os: process.platform,
      arch: process.arch,
    },
    summary: {
      blockers,
      warnings,
      total: statuses.length,
    },
    checks: statuses,
  };
  const out = path.join(releaseDir, 'signing-readiness.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(desktopDir, out)}`);
  if (strict && blockers > 0 && !noExit) process.exit(1);
}

if (process.platform !== 'darwin') {
  add('macOS signing host', false, 'requires macOS security/xcrun tools');
  printReport();
  process.exit(strict && !noExit ? 1 : 0);
}

if (shouldRestoreApiKey) restoreApiKey();
if (shouldImportP12) importP12();
if (shouldStoreNotaryProfile) storeNotaryProfile();
if (checkOnly || strict || (!shouldRestoreApiKey && !shouldImportP12 && !shouldStoreNotaryProfile)) checkSigning();
printReport();
