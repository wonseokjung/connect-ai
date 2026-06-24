import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoDir = path.resolve(desktopDir, '..');
const releaseDir = path.join(desktopDir, 'release');
const reportPath = path.join(releaseDir, 'secret-hygiene-report.json');
const checks = [];

const secretEnvNames = [
  'BUILD_CERTIFICATE_BASE64',
  'CONNECT_AI_CERTIFICATE_BASE64',
  'P12_PASSWORD',
  'CONNECT_AI_CERTIFICATE_PASSWORD',
  'KEYCHAIN_PASSWORD',
  'CONNECT_AI_KEYCHAIN_PASSWORD',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_BASE64',
  'CONNECT_AI_BASELINE_TOKEN',
  'CONNECT_AI_RELEASE_AUDIT_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
];

const ignoreSamples = [
  'desktop/.env.release.local',
  'desktop/.env.release.prod.local',
  'desktop/DeveloperIDApplication.p12',
  'desktop/AuthKey_TEST.p8',
  'desktop/release/secret-hygiene-report.json',
];

const reportExtensions = new Set(['.json', '.md', '.txt', '.yml', '.yaml', '.log']);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoDir,
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

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
  });
}

function relativeToRepo(file) {
  return path.relative(repoDir, file).split(path.sep).join('/');
}

function isIgnored(relativePath) {
  const result = run('git', ['check-ignore', '-q', relativePath], { cwd: repoDir });
  return result.ok;
}

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return new Map();
  const out = new Map();
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const source = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const index = source.indexOf('=');
    if (index <= 0) continue;
    const key = source.slice(0, index).trim();
    let value = source.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

function looksPlaceholder(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  return [
    'replace-with',
    'example.com',
    '/absolute/path/',
    'github-fine-grained-token',
    'only-if',
    'p12-password',
    'temporary-keychain-password',
    'KEYID',
    'ISSUER-UUID',
    'apple-id@example.com',
    'app-specific-password',
  ].some((marker) => text.includes(marker));
}

function safeSecretValue(value) {
  const text = String(value || '').trim();
  if (text.length < 8) return '';
  if (looksPlaceholder(text)) return '';
  return text;
}

function walkFiles(root, options = {}) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (current !== root && options.skipDir?.(current)) continue;
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    } else if (stat.isFile()) {
      out.push(current);
    }
  }
  return out.sort();
}

function releaseTextFiles() {
  return walkFiles(releaseDir).filter((file) => reportExtensions.has(path.extname(file).toLowerCase()));
}

function checkIgnoreRules() {
  for (const sample of ignoreSamples) {
    add(`git ignore ${sample}`, isIgnored(sample), sample);
  }
}

function checkEnvExample() {
  const example = path.join(desktopDir, '.env.release.example');
  add('release env example exists', fs.existsSync(example), 'desktop/.env.release.example');
  if (!fs.existsSync(example)) return;
  const parsed = parseEnvFile(example);
  for (const key of secretEnvNames) {
    if (!parsed.has(key)) continue;
    add(`release env example placeholder ${key}`, looksPlaceholder(parsed.get(key)), `${key}=placeholder`);
  }
}

function checkLocalSecretFiles() {
  const candidates = [
    ...walkFiles(desktopDir, {
      skipDir(file) {
        return ['node_modules', 'release', 'out', '.connect-ai-dev-toolchain'].includes(path.basename(file));
      },
    }).filter((file) => {
      const relative = relativeToRepo(file);
      const name = path.basename(file);
      return (
        name === '.env.release.local' ||
        /^\.env\.release\..+\.local$/.test(name) ||
        /\.p12$/i.test(name) ||
        /\.p8$/i.test(name) ||
        /^AuthKey_.*\.p8$/i.test(name)
      );
    }),
  ];

  if (candidates.length === 0) {
    add('local secret file inventory', true, 'no local secret files present');
    return;
  }

  for (const file of candidates) {
    const relative = relativeToRepo(file);
    add(`local secret file ignored ${relative}`, isIgnored(relative), relative);
  }
}

function gitCandidateFiles() {
  const result = run('git', ['ls-files', '-z', '-co', '--exclude-standard', '--', 'desktop', '.github'], { cwd: repoDir });
  if (!result.ok) {
    add('repository candidate inventory', false, result.stderr || result.error || 'git ls-files failed');
    return [];
  }
  const files = result.stdout.split('\0').filter(Boolean).sort();
  add('repository candidate inventory', true, `${files.length} tracked or untracked candidate file(s)`);
  return files;
}

function checkRepositoryCandidateHygiene() {
  const files = gitCandidateFiles();
  if (!files.length) return;

  const forbiddenDirectories = files.filter((file) =>
    /^desktop\/(?:node_modules|release|out|dist|\.connect-ai-dev-toolchain)\//.test(file)
  );
  add(
    'repository candidate build artifact exclusion',
    forbiddenDirectories.length === 0,
    forbiddenDirectories.length ? forbiddenDirectories.slice(0, 10).join(', ') : 'node_modules/release/out/dist/toolchain files excluded',
  );

  const forbiddenSecrets = files.filter((file) => {
    const name = path.basename(file);
    return (
      file === 'desktop/.env.release.local' ||
      /^desktop\/\.env\.release\..+\.local$/.test(file) ||
      /\.p12$/i.test(name) ||
      /\.p8$/i.test(name) ||
      /\.keychain-db$/i.test(name) ||
      /^AuthKey_.*\.p8$/i.test(name)
    );
  });
  add(
    'repository candidate secret material exclusion',
    forbiddenSecrets.length === 0,
    forbiddenSecrets.length ? forbiddenSecrets.slice(0, 10).join(', ') : 'local env/certificate/notary key files excluded',
  );

  const largest = files
    .map((file) => {
      const absolute = path.join(repoDir, file);
      return fs.existsSync(absolute) ? { file, bytes: fs.statSync(absolute).size } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 5);
  add(
    'repository candidate largest files recorded',
    true,
    largest.map((item) => `${item.file} ${item.bytes} bytes`).join(', ') || 'no candidate files',
  );
}

function checkReleaseLeakage() {
  const values = secretEnvNames
    .map((name) => [name, safeSecretValue(process.env[name])])
    .filter(([, value]) => value);
  const files = releaseTextFiles();
  add('release text artifact scan', true, `${files.length} text artifact(s)`);

  if (values.length === 0) {
    add('release secret value scan', true, 'no sensitive env values present in this process');
  } else {
    let leakCount = 0;
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [name, value] of values) {
        if (text.includes(value)) {
          leakCount += 1;
          add(`release secret value leaked ${name}`, false, `${name} appears in ${relativeToRepo(file)}`);
        }
      }
    }
    if (leakCount === 0) {
      add('release secret value scan', true, `${values.length} sensitive env value(s) not found in release text artifacts`);
    }
  }

  const suspiciousPatterns = [
    ['GitHub token literal', /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/],
    ['private key marker', /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/],
    ['Apple private key marker', /-----BEGIN PRIVATE KEY-----/],
  ];
  for (const [label, pattern] of suspiciousPatterns) {
    const hits = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (pattern.test(text)) hits.push(relativeToRepo(file));
    }
    add(`release ${label} scan`, hits.length === 0, hits.length ? hits.join(', ') : `${files.length} file(s) clean`);
  }
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      blockers,
      warnings,
    },
    sensitiveEnvNamesPresent: secretEnvNames.filter((name) => Boolean(safeSecretValue(process.env[name]))),
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log('Connect AI release secret hygiene verification');
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (blockers > 0) process.exit(1);
}

checkIgnoreRules();
checkEnvExample();
checkLocalSecretFiles();
checkRepositoryCandidateHygiene();
checkReleaseLeakage();
printAndExit();
