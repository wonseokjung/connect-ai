import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const processEnvMode = process.argv.includes('--process-env');
const noExit = process.argv.includes('--no-exit');
const checks = [];

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
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
  const envFile = path.resolve(desktopDir, file);
  const out = {};
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const entry = parseLine(lines[i], i + 1, path.relative(desktopDir, envFile));
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

function processEnvSnapshot() {
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
  return Object.fromEntries(names.filter((name) => String(process.env[name] || '').trim()).map((name) => [name, process.env[name]]));
}

function envPresent(env, name) {
  return Boolean(String(env[name] || '').trim());
}

function missing(env, names) {
  return names.filter((name) => !envPresent(env, name));
}

function groupComplete(env, names) {
  return missing(env, names).length === 0;
}

function base64LooksValid(env, name) {
  const value = String(env[name] || '').replace(/\s/g, '');
  if (value.length <= 32 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length < 16) return false;
    return decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '');
  } catch {
    return false;
  }
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

function placeholderLike(value) {
  const text = String(value || '').trim();
  return !text ||
    /^(replace-with|github-fine-grained-token|zip-sha256|only-if|example\.com|https:\/\/example\.com)/i.test(text) ||
    text.includes('/absolute/path/');
}

function fileModeOk(file) {
  if (process.platform === 'win32') return true;
  const mode = fs.statSync(file).mode & 0o777;
  return (mode & 0o077) === 0;
}

function checkTemplate() {
  const template = path.join(desktopDir, '.env.release.example');
  add('release env template', fs.existsSync(template), '.env.release.example');
  if (!fs.existsSync(template)) return;

  let parsed = {};
  try {
    parsed = loadEnvFile('.env.release.example');
    add('release env template parse', true, `${Object.keys(parsed).length} key(s)`);
  } catch (error) {
    add('release env template parse', false, error.message);
    return;
  }

  for (const name of ['CONNECT_AI_BASELINE_URL', 'CONNECT_AI_BASELINE_SHA256', 'CONNECT_AI_RELEASE_AUDIT_TOKEN', 'BUILD_CERTIFICATE_PATH', 'P12_PASSWORD', 'KEYCHAIN_PASSWORD']) {
    add(`release env template key ${name}`, Object.prototype.hasOwnProperty.call(parsed, name), name);
  }
  add(
    'release env template notarization options',
    Object.prototype.hasOwnProperty.call(parsed, 'APPLE_API_KEY') &&
      Object.prototype.hasOwnProperty.call(parsed, 'APPLE_API_KEY_ID') &&
      Object.prototype.hasOwnProperty.call(parsed, 'APPLE_API_ISSUER') &&
      fs.readFileSync(template, 'utf8').includes('APPLE_KEYCHAIN_PROFILE'),
    'API key and keychain profile options documented',
  );
}

function checkGitignore() {
  const gitignore = path.join(desktopDir, '.gitignore');
  const text = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  add('release env local file ignored', text.includes('.env.release.local'), '.env.release.local');
  add('release env wildcard local files ignored', text.includes('.env.release.*.local'), '.env.release.*.local');
}

function checkEnvCompleteness(env, sourceLabel) {
  const present = new Set(Object.keys(env).filter((name) => envPresent(env, name)));
  const secretLikeNames = [
    'CONNECT_AI_RELEASE_AUDIT_TOKEN',
    'BUILD_CERTIFICATE_BASE64',
    'CONNECT_AI_CERTIFICATE_BASE64',
    'P12_PASSWORD',
    'CONNECT_AI_CERTIFICATE_PASSWORD',
    'KEYCHAIN_PASSWORD',
    'CONNECT_AI_KEYCHAIN_PASSWORD',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_API_KEY_BASE64',
  ];

  for (const name of Object.keys(env).sort()) {
    if (placeholderLike(env[name])) {
      add(`release env ${name} placeholder`, false, `${name} still contains a template placeholder`, strict ? 'blocker' : 'warn');
    }
  }

  add(
    'release env baseline group',
    envPresent(env, 'CONNECT_AI_BASELINE_URL') && (envPresent(env, 'CONNECT_AI_BASELINE_SHA256') || envPresent(env, 'CONNECT_AI_ZIP_SHA256')),
    envPresent(env, 'CONNECT_AI_BASELINE_URL') ? 'baseline URL plus SHA expected' : `missing CONNECT_AI_BASELINE_URL in ${sourceLabel}`,
    strict ? 'blocker' : 'warn',
  );
  if (envPresent(env, 'CONNECT_AI_BASELINE_URL')) {
    add(
      'release env baseline URL shape',
      baselineUrlLooksValid(env.CONNECT_AI_BASELINE_URL),
      'https URL ending in .zip',
      strict ? 'blocker' : 'warn',
    );
    add(
      'release env baseline URL version',
      baselineUrlMatchesVersion(env.CONNECT_AI_BASELINE_URL),
      'baseline zip URL includes the package version',
      strict ? 'blocker' : 'warn',
    );
    const guard = baselineUrlGuard(env.CONNECT_AI_BASELINE_URL);
    add(
      'release env baseline URL remote candidate guard',
      guard.ok,
      guard.detail,
      strict ? 'blocker' : 'warn',
    );
  }
  const baselineShaValues = [
    ['CONNECT_AI_BASELINE_SHA256', env.CONNECT_AI_BASELINE_SHA256],
    ['CONNECT_AI_ZIP_SHA256', env.CONNECT_AI_ZIP_SHA256],
  ].filter(([, value]) => String(value || '').trim());
  for (const [name, value] of baselineShaValues) {
    add(
      `release env ${name} shape`,
      sha256LooksValid(value),
      '64 hex SHA-256',
      strict ? 'blocker' : 'warn',
    );
  }
  if (envPresent(env, 'CONNECT_AI_BASELINE_SHA256') && envPresent(env, 'CONNECT_AI_ZIP_SHA256')) {
    add(
      'release env baseline SHA aliases match',
      String(env.CONNECT_AI_BASELINE_SHA256).trim().toLowerCase() === String(env.CONNECT_AI_ZIP_SHA256).trim().toLowerCase(),
      'CONNECT_AI_BASELINE_SHA256 and CONNECT_AI_ZIP_SHA256 must match when both are set',
      strict ? 'blocker' : 'warn',
    );
  }
  add(
    'release env GitHub audit token',
    envPresent(env, 'CONNECT_AI_RELEASE_AUDIT_TOKEN') || envPresent(env, 'GH_TOKEN'),
    'CONNECT_AI_RELEASE_AUDIT_TOKEN or GH_TOKEN',
    strict ? 'blocker' : 'warn',
  );

  const certificateSource = envPresent(env, 'BUILD_CERTIFICATE_PATH') ||
    envPresent(env, 'BUILD_CERTIFICATE_BASE64') ||
    envPresent(env, 'CONNECT_AI_CERTIFICATE_PATH') ||
    envPresent(env, 'CONNECT_AI_CERTIFICATE_BASE64');
  const certificatePasswords = (envPresent(env, 'P12_PASSWORD') || envPresent(env, 'CONNECT_AI_CERTIFICATE_PASSWORD')) &&
    (envPresent(env, 'KEYCHAIN_PASSWORD') || envPresent(env, 'CONNECT_AI_KEYCHAIN_PASSWORD'));
  add(
    'release env certificate import group',
    certificateSource && certificatePasswords,
    certificateSource ? 'certificate source plus passwords expected' : 'missing certificate source',
    strict ? 'blocker' : 'warn',
  );

  for (const name of ['BUILD_CERTIFICATE_PATH', 'CONNECT_AI_CERTIFICATE_PATH', 'APPLE_API_KEY']) {
    if (envPresent(env, name)) {
      const file = path.resolve(desktopDir, env[name]);
      add(`release env file ${name}`, fs.existsSync(file), `${name} file ${fs.existsSync(file) ? 'exists' : 'missing'}`, strict ? 'blocker' : 'warn');
    }
  }
  for (const name of ['BUILD_CERTIFICATE_BASE64', 'CONNECT_AI_CERTIFICATE_BASE64', 'APPLE_API_KEY_BASE64']) {
    if (envPresent(env, name)) {
      add(`release env ${name} base64 shape`, base64LooksValid(env, name), 'base64 content shape only; value redacted', strict ? 'blocker' : 'warn');
    }
  }

  const notaryOk = groupComplete(env, ['APPLE_KEYCHAIN_PROFILE']) ||
    groupComplete(env, ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) ||
    (groupComplete(env, ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) && fs.existsSync(path.resolve(desktopDir, env.APPLE_API_KEY || ''))) ||
    (groupComplete(env, ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) && base64LooksValid(env, 'APPLE_API_KEY_BASE64'));
  add(
    'release env notarization group',
    notaryOk,
    'one of APPLE_KEYCHAIN_PROFILE, Apple ID group, API key file group, or API key base64 group',
    strict ? 'blocker' : 'warn',
  );

  const presentSecretNames = secretLikeNames.filter((name) => present.has(name));
  add('release env secret values redacted', true, `${presentSecretNames.length} secret-like key(s) present; values not written`);
}

function main() {
  const envFile = argValue('--file', '.env.release.local');
  checkTemplate();
  checkGitignore();

  let env = {};
  let source = processEnvMode ? 'process env' : envFile;
  if (processEnvMode) {
    env = processEnvSnapshot();
    add('release env source', true, 'process env');
  } else {
    const resolved = path.resolve(desktopDir, envFile);
    const exists = fs.existsSync(resolved);
    add('release env local file', exists, path.relative(desktopDir, resolved), strict ? 'blocker' : 'warn');
    if (exists) {
      add('release env local file mode', fileModeOk(resolved), 'no group/other read/write/execute bits', strict ? 'blocker' : 'warn');
      try {
        env = loadEnvFile(envFile);
        add('release env local file parse', true, `${Object.keys(env).length} key(s)`);
      } catch (error) {
        add('release env local file parse', false, error.message);
      }
      if (path.basename(resolved) === '.env.release.example') {
        add('release env example not used as secret file', false, 'copy to .env.release.local and replace placeholders', strict ? 'blocker' : 'warn');
      }
    }
  }

  if (processEnvMode || Object.keys(env).length > 0) checkEnvCompleteness(env, source);

  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    processEnv: processEnvMode,
    noExit,
    source,
    summary: {
      blockers,
      warnings,
    },
    keys: Object.keys(env).sort(),
    checks,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  const reportPath = path.join(releaseDir, processEnvMode ? 'release-env-report.process.json' : 'release-env-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI release env verification (${strict ? 'strict' : 'local'}${processEnvMode ? ', process-env' : ''})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (strict && blockers > 0 && !noExit) process.exit(1);
}

main();
