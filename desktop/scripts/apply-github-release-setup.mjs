import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const processEnvMode = args.has('--process-env');
const strict = args.has('--strict');
const noExit = args.has('--no-exit');
const checks = [];
const actions = [];

function argValue(name, fallback = '') {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({ name, ok: Boolean(ok), detail, level: ok ? 'pass' : level });
}

function parseLine(line, lineNumber, file) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const source = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
  const index = source.indexOf('=');
  if (index <= 0) throw new Error(`${file}:${lineNumber}: expected KEY=value`);
  const key = source.slice(0, index).trim();
  let value = source.slice(index + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`${file}:${lineNumber}: invalid env key ${key}`);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function loadEnvFile(file) {
  const resolved = path.resolve(desktopDir, file);
  if (!fs.existsSync(resolved)) throw new Error(`missing release env file: ${path.relative(desktopDir, resolved)}`);
  const out = {};
  const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const entry = parseLine(lines[i], i + 1, path.relative(desktopDir, resolved));
    if (!entry) continue;
    const [key, value] = entry;
    out[key] = value;
  }
  return out;
}

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

function envPresent(env, name) {
  return Boolean(String(env[name] || '').trim());
}

function firstPresent(env, names) {
  return names.find((name) => envPresent(env, name)) || '';
}

function placeholderLike(value) {
  const text = String(value || '').trim();
  return !text ||
    /^(replace-with|github-fine-grained-token|zip-sha256|only-if|example\.com|https:\/\/example\.com)/i.test(text) ||
    text.includes('/absolute/path/');
}

function sha256LooksValid(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function baselineUrlLooksValid(value) {
  const text = String(value || '').trim();
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.pathname.endsWith('.zip');
  } catch {
    return false;
  }
}

function baselineUrlMatchesVersion(value) {
  const text = String(value || '');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
    return text.includes(pkg.version);
  } catch {
    return true;
  }
}

function baselineUrlGuard(value) {
  const url = String(value || '').trim();
  if (!url) return { ok: true, detail: 'baseline URL not set' };
  const remote = readJson('release/remote-baseline-candidate-report.strict.json');
  const bootstrap = readJson('release/release-env-bootstrap.json');
  const candidateUrl = remote?.candidate?.url || bootstrap?.baselineUrlRecommendation?.candidateUrl || '';
  if (!candidateUrl || url !== candidateUrl) {
    return { ok: true, detail: 'not the guarded remote same-name candidate URL' };
  }
  const approved = remote?.approvedForBaselineUrl === true &&
    remote?.safeForDirectUse === true &&
    remote?.status === 'approved-for-baseline-url' &&
    remote?.remote?.sha256 === remote?.expected?.sha256;
  if (approved) {
    return { ok: true, detail: `approved remote baseline candidate ${remote.remote.sha256}` };
  }
  const status = remote?.status || bootstrap?.baselineUrlRecommendation?.status || 'missing remote baseline candidate report';
  return {
    ok: false,
    detail: `remote same-name candidate is not approved for CONNECT_AI_BASELINE_URL: ${status}`,
  };
}

function base64LooksValid(value) {
  const text = String(value || '').replace(/\s/g, '');
  if (text.length <= 32 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  try {
    const decoded = Buffer.from(text, 'base64');
    if (decoded.length < 16) return false;
    return decoded.toString('base64').replace(/=+$/, '') === text.replace(/=+$/, '');
  } catch {
    return false;
  }
}

function readBase64FileSecret(env, names) {
  const key = firstPresent(env, names);
  if (!key) return null;
  const file = path.resolve(desktopDir, env[key]);
  if (!fs.existsSync(file)) return { key, ok: false, detail: `${key} file missing` };
  return {
    key,
    ok: true,
    value: fs.readFileSync(file).toString('base64'),
    detail: `${key} file encoded as base64`,
  };
}

function commandExists(command) {
  const result = spawnSync('/usr/bin/which', [command], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function runGh(commandArgs, input = '') {
  const result = spawnSync('gh', commandArgs, {
    cwd: desktopDir,
    encoding: 'utf8',
    env: process.env,
    input,
    timeout: 120000,
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
  return lines[0] || 'no diagnostic output';
}

function queueVariable(name, value, source) {
  if (!value || placeholderLike(value)) {
    add(`GitHub variable ${name}`, false, `${source || name} missing or placeholder`);
    return;
  }
  if (name === 'CONNECT_AI_BASELINE_URL') {
    add('GitHub variable CONNECT_AI_BASELINE_URL shape', baselineUrlLooksValid(value), 'https URL ending in .zip');
    add('GitHub variable CONNECT_AI_BASELINE_URL version', baselineUrlMatchesVersion(value), 'baseline zip URL includes package version');
    const guard = baselineUrlGuard(value);
    add('GitHub variable CONNECT_AI_BASELINE_URL remote candidate guard', guard.ok, guard.detail);
    if (!baselineUrlLooksValid(value) || !baselineUrlMatchesVersion(value) || !guard.ok) return;
  }
  if (name === 'CONNECT_AI_BASELINE_SHA256') {
    add('GitHub variable CONNECT_AI_BASELINE_SHA256 shape', sha256LooksValid(value), '64 hex SHA-256');
    if (!sha256LooksValid(value)) return;
  }
  actions.push({ type: 'variable', name, source: source || name, redacted: false });
  if (!apply) {
    add(`GitHub variable ${name}`, true, `dry-run would set from ${source || name}`);
    return;
  }
  const result = runGh(['variable', 'set', name, '--body', value]);
  add(`GitHub variable ${name}`, result.ok, result.ok ? 'set' : firstLine(result.stderr || result.stdout || result.error));
}

function queueSecret(name, value, source) {
  if (!value || placeholderLike(value)) {
    add(`GitHub secret ${name}`, false, `${source || name} missing or placeholder`);
    return;
  }
  if (name === 'BUILD_CERTIFICATE_BASE64' || name === 'APPLE_API_KEY_BASE64') {
    add(`GitHub secret ${name} base64 shape`, base64LooksValid(value), 'base64 content decodes; value redacted');
    if (!base64LooksValid(value)) return;
  }
  actions.push({ type: 'secret', name, source: source || name, redacted: true });
  if (!apply) {
    add(`GitHub secret ${name}`, true, `dry-run would set from ${source || name}`);
    return;
  }
  const result = runGh(['secret', 'set', name], value);
  add(`GitHub secret ${name}`, result.ok, result.ok ? 'set from redacted stdin' : firstLine(result.stderr || result.stdout || result.error));
}

function queueOptionalSecret(name, value, source) {
  if (!value || placeholderLike(value)) {
    add(`optional GitHub secret ${name}`, true, `${source || name} not configured`, 'warn');
    return;
  }
  queueSecret(name, value, source);
}

function snapshotProcessEnv() {
  const names = [
    'CONNECT_AI_BASELINE_URL',
    'CONNECT_AI_BASELINE_SHA256',
    'CONNECT_AI_ZIP_SHA256',
    'CONNECT_AI_BASELINE_TOKEN',
    'CONNECT_AI_RELEASE_AUDIT_TOKEN',
    'GH_TOKEN',
    'BUILD_CERTIFICATE_PATH',
    'BUILD_CERTIFICATE_BASE64',
    'CONNECT_AI_CERTIFICATE_PATH',
    'CONNECT_AI_CERTIFICATE_BASE64',
    'P12_PASSWORD',
    'CONNECT_AI_CERTIFICATE_PASSWORD',
    'KEYCHAIN_PASSWORD',
    'CONNECT_AI_KEYCHAIN_PASSWORD',
    'APPLE_KEYCHAIN_PROFILE',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
    'APPLE_API_KEY',
    'APPLE_API_KEY_BASE64',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ];
  return Object.fromEntries(names.filter((name) => envPresent(process.env, name)).map((name) => [name, process.env[name]]));
}

function buildCertificateBase64(env) {
  if (envPresent(env, 'BUILD_CERTIFICATE_BASE64')) return { ok: true, source: 'BUILD_CERTIFICATE_BASE64', value: env.BUILD_CERTIFICATE_BASE64 };
  if (envPresent(env, 'CONNECT_AI_CERTIFICATE_BASE64')) return { ok: true, source: 'CONNECT_AI_CERTIFICATE_BASE64', value: env.CONNECT_AI_CERTIFICATE_BASE64 };
  return readBase64FileSecret(env, ['BUILD_CERTIFICATE_PATH', 'CONNECT_AI_CERTIFICATE_PATH']);
}

function buildAppleApiKeyBase64(env) {
  if (envPresent(env, 'APPLE_API_KEY_BASE64')) return { ok: true, source: 'APPLE_API_KEY_BASE64', value: env.APPLE_API_KEY_BASE64 };
  return readBase64FileSecret(env, ['APPLE_API_KEY']);
}

function applyReleaseSetup(env) {
  const gh = commandExists('gh');
  add('GitHub CLI', Boolean(gh), gh || 'missing gh command', apply ? 'blocker' : 'warn');
  if (!gh && apply) return;

  if (gh) {
    const auth = runGh(['auth', 'status']);
    add('GitHub CLI auth', auth.ok, auth.ok ? 'authenticated' : firstLine(auth.stderr || auth.stdout || auth.error), apply ? 'blocker' : 'warn');
    if (!auth.ok && apply) return;
  }

  queueVariable('CONNECT_AI_BASELINE_URL', env.CONNECT_AI_BASELINE_URL, 'CONNECT_AI_BASELINE_URL');
  queueVariable(
    'CONNECT_AI_BASELINE_SHA256',
    env.CONNECT_AI_BASELINE_SHA256 || env.CONNECT_AI_ZIP_SHA256,
    env.CONNECT_AI_BASELINE_SHA256 ? 'CONNECT_AI_BASELINE_SHA256' : 'CONNECT_AI_ZIP_SHA256',
  );
  queueOptionalSecret('CONNECT_AI_BASELINE_TOKEN', env.CONNECT_AI_BASELINE_TOKEN, 'CONNECT_AI_BASELINE_TOKEN');
  queueSecret(
    'CONNECT_AI_RELEASE_AUDIT_TOKEN',
    env.CONNECT_AI_RELEASE_AUDIT_TOKEN || env.GH_TOKEN,
    env.CONNECT_AI_RELEASE_AUDIT_TOKEN ? 'CONNECT_AI_RELEASE_AUDIT_TOKEN' : 'GH_TOKEN',
  );

  const certificate = buildCertificateBase64(env);
  if (!certificate?.ok) {
    add('GitHub secret BUILD_CERTIFICATE_BASE64', false, certificate?.detail || 'missing BUILD_CERTIFICATE_BASE64 or certificate path');
  } else {
    queueSecret('BUILD_CERTIFICATE_BASE64', certificate.value, certificate.source || certificate.detail);
  }
  queueSecret('P12_PASSWORD', env.P12_PASSWORD || env.CONNECT_AI_CERTIFICATE_PASSWORD, env.P12_PASSWORD ? 'P12_PASSWORD' : 'CONNECT_AI_CERTIFICATE_PASSWORD');
  queueSecret('KEYCHAIN_PASSWORD', env.KEYCHAIN_PASSWORD || env.CONNECT_AI_KEYCHAIN_PASSWORD, env.KEYCHAIN_PASSWORD ? 'KEYCHAIN_PASSWORD' : 'CONNECT_AI_KEYCHAIN_PASSWORD');

  const apiKey = buildAppleApiKeyBase64(env);
  const apiKeyGroupReady = Boolean(apiKey?.ok && envPresent(env, 'APPLE_API_KEY_ID') && envPresent(env, 'APPLE_API_ISSUER'));
  const appleIdGroupReady = envPresent(env, 'APPLE_ID') && envPresent(env, 'APPLE_APP_SPECIFIC_PASSWORD') && envPresent(env, 'APPLE_TEAM_ID');
  add(
    'CI notarization credential group',
    apiKeyGroupReady || appleIdGroupReady,
    apiKeyGroupReady
      ? 'App Store Connect API key base64 group'
      : appleIdGroupReady
        ? 'Apple ID app-specific password group'
        : 'missing API key base64 group or Apple ID group',
  );

  if (apiKeyGroupReady) {
    queueSecret('APPLE_API_KEY_BASE64', apiKey.value, apiKey.source || apiKey.detail);
    queueSecret('APPLE_API_KEY_ID', env.APPLE_API_KEY_ID, 'APPLE_API_KEY_ID');
    queueSecret('APPLE_API_ISSUER', env.APPLE_API_ISSUER, 'APPLE_API_ISSUER');
  } else if (appleIdGroupReady) {
    queueSecret('APPLE_ID', env.APPLE_ID, 'APPLE_ID');
    queueSecret('APPLE_APP_SPECIFIC_PASSWORD', env.APPLE_APP_SPECIFIC_PASSWORD, 'APPLE_APP_SPECIFIC_PASSWORD');
    queueSecret('APPLE_TEAM_ID', env.APPLE_TEAM_ID, 'APPLE_TEAM_ID');
  }

  if (envPresent(env, 'APPLE_KEYCHAIN_PROFILE')) {
    add(
      'APPLE_KEYCHAIN_PROFILE GitHub Actions suitability',
      false,
      'not sufficient on GitHub-hosted macOS unless the profile is created in the runner; use API key base64 or Apple ID group for CI',
      'warn',
    );
  }
}

function writeReport(source, env) {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    strict,
    noExit,
    source,
    keys: Object.keys(env).sort(),
    summary: { blockers, warnings },
    checks,
    actions,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  const out = path.join(releaseDir, 'github-release-setup-report.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI GitHub release setup (${apply ? 'apply' : 'dry-run'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  for (const action of actions) {
    console.log(`${apply ? 'DONE' : 'PLAN'}    ${action.type} ${action.name} from ${action.source}${action.redacted ? ' (redacted)' : ''}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, out)}`);
  if ((strict || apply) && blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const envFile = argValue('--file', '.env.release.local');
  let env = {};
  let source = processEnvMode ? 'process env' : envFile;
  try {
    env = processEnvMode ? snapshotProcessEnv() : loadEnvFile(envFile);
    add('release setup source', true, source);
  } catch (error) {
    add('release setup source', false, error.message);
    writeReport(source, env);
    return;
  }

  applyReleaseSetup(env);
  writeReport(source, env);
}

main();
