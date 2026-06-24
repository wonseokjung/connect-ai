import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoDir = path.resolve(desktopDir, '..');
const releaseDir = path.join(desktopDir, 'release');
const noExit = process.argv.includes('--no-exit');
const checks = [];

const contract = {
  requiredVariables: [
    'CONNECT_AI_BASELINE_URL',
    'CONNECT_AI_BASELINE_SHA256',
  ],
  variableAliases: [
    'CONNECT_AI_ZIP_SHA256',
  ],
  optionalSecrets: [
    'CONNECT_AI_BASELINE_TOKEN',
  ],
  auditTokenSources: [
    'CONNECT_AI_RELEASE_AUDIT_TOKEN',
    'GH_TOKEN',
  ],
  certificateSources: [
    'BUILD_CERTIFICATE_PATH',
    'BUILD_CERTIFICATE_BASE64',
    'CONNECT_AI_CERTIFICATE_PATH',
    'CONNECT_AI_CERTIFICATE_BASE64',
  ],
  certificatePasswords: [
    'P12_PASSWORD',
    'CONNECT_AI_CERTIFICATE_PASSWORD',
    'KEYCHAIN_PASSWORD',
    'CONNECT_AI_KEYCHAIN_PASSWORD',
  ],
  notarizationSources: [
    'APPLE_KEYCHAIN_PROFILE',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
    'APPLE_API_KEY',
    'APPLE_API_KEY_BASE64',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ],
};

const allKeys = [
  ...contract.requiredVariables,
  ...contract.variableAliases,
  ...contract.optionalSecrets,
  ...contract.auditTokenSources,
  ...contract.certificateSources,
  ...contract.certificatePasswords,
  ...contract.notarizationSources,
];

const primaryTemplateKeys = [
  ...contract.requiredVariables,
  'CONNECT_AI_RELEASE_AUDIT_TOKEN',
  'BUILD_CERTIFICATE_PATH',
  'P12_PASSWORD',
  'KEYCHAIN_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_BASE64',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_KEYCHAIN_PROFILE',
];

const workflowKeys = [
  'CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS',
  'CONNECT_AI_ZIP',
  'CONNECT_AI_ZIP_SHA256',
  'CONNECT_AI_BASELINE_URL',
  'CONNECT_AI_BASELINE_TOKEN',
  'GH_TOKEN',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY',
  'APPLE_API_KEY_BASE64',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_KEYCHAIN_PROFILE',
  'BUILD_CERTIFICATE_BASE64',
  'P12_PASSWORD',
  'KEYCHAIN_PASSWORD',
];

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function readText(relativePath) {
  const file = path.resolve(relativePath.startsWith('.') ? repoDir : desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function parseEnvKeys(text) {
  const keys = new Set();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const source = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const index = source.indexOf('=');
    if (index <= 0) continue;
    const key = source.slice(0, index).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.add(key);
  }
  return keys;
}

function missingInText(text, keys) {
  return keys.filter((key) => !String(text || '').includes(key));
}

function missingEnvKeys(parsedKeys, keys) {
  return keys.filter((key) => !parsedKeys.has(key));
}

function scriptValue(name) {
  const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
  return pkg.scripts?.[name] || '';
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8')).version;
}

function checkTemplate() {
  const relative = '.env.release.example';
  const file = path.join(desktopDir, relative);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  add('release env template exists', Boolean(text), relative);
  if (!text) return;

  const parsedKeys = parseEnvKeys(text);
  const missingPrimary = missingEnvKeys(parsedKeys, [
    ...contract.requiredVariables,
    'CONNECT_AI_RELEASE_AUDIT_TOKEN',
    'BUILD_CERTIFICATE_PATH',
    'P12_PASSWORD',
    'KEYCHAIN_PASSWORD',
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ]);
  add(
    'release env template active keys',
    missingPrimary.length === 0,
    missingPrimary.length ? `missing ${missingPrimary.join(', ')}` : `${parsedKeys.size} active key(s)`,
  );

  const missingDocumented = missingInText(text, primaryTemplateKeys);
  add(
    'release env template documents primary contract',
    missingDocumented.length === 0,
    missingDocumented.length ? `missing ${missingDocumented.join(', ')}` : `${primaryTemplateKeys.length} key(s) documented`,
  );

  const missingAliases = missingInText(text, [
    'CONNECT_AI_ZIP_SHA256',
    'CONNECT_AI_CERTIFICATE_PATH',
    'CONNECT_AI_CERTIFICATE_BASE64',
    'CONNECT_AI_CERTIFICATE_PASSWORD',
    'CONNECT_AI_KEYCHAIN_PASSWORD',
  ]);
  add(
    'release env template documents supported aliases',
    missingAliases.length === 0,
    missingAliases.length ? `missing ${missingAliases.join(', ')}` : 'alias keys documented',
  );
}

function checkScriptCoverage() {
  const verifyEnv = fs.readFileSync(path.join(desktopDir, 'scripts', 'verify-release-env.mjs'), 'utf8');
  const setup = fs.readFileSync(path.join(desktopDir, 'scripts', 'apply-github-release-setup.mjs'), 'utf8');
  const wrapper = fs.readFileSync(path.join(desktopDir, 'scripts', 'run-with-release-env.mjs'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(desktopDir, 'scripts', 'write-release-env-bootstrap.mjs'), 'utf8');
  const verifyBootstrap = fs.readFileSync(path.join(desktopDir, 'scripts', 'verify-release-env-bootstrap.mjs'), 'utf8');

  const verifyMissing = missingInText(verifyEnv, allKeys);
  add(
    'verify-release-env recognizes release env contract',
    verifyMissing.length === 0,
    verifyMissing.length ? `missing ${verifyMissing.join(', ')}` : `${allKeys.length} key(s) recognized`,
  );

  const setupMissing = missingInText(setup, allKeys);
  add(
    'apply-github-release-setup recognizes release env contract',
    setupMissing.length === 0,
    setupMissing.length ? `missing ${setupMissing.join(', ')}` : `${allKeys.length} key(s) recognized`,
  );

  add(
    'GitHub setup maps GH_TOKEN fallback to audit secret',
    setup.includes("env.CONNECT_AI_RELEASE_AUDIT_TOKEN || env.GH_TOKEN") &&
      setup.includes("env.CONNECT_AI_RELEASE_AUDIT_TOKEN ? 'CONNECT_AI_RELEASE_AUDIT_TOKEN' : 'GH_TOKEN'"),
    'CONNECT_AI_RELEASE_AUDIT_TOKEN preferred, GH_TOKEN fallback supported',
  );

  add(
    'release env wrapper maps audit token to GH_TOKEN',
    wrapper.includes('CONNECT_AI_RELEASE_AUDIT_TOKEN') &&
      wrapper.includes('childEnv.GH_TOKEN = loaded.CONNECT_AI_RELEASE_AUDIT_TOKEN') &&
      wrapper.includes('Values are not printed'),
    'wrapper loads file values without printing and maps GitHub CLI token',
  );

  const bootstrapMissing = missingInText(`${bootstrap}\n${verifyBootstrap}`, [
    ...contract.requiredVariables,
    'CONNECT_AI_ZIP_SHA256',
    'CONNECT_AI_RELEASE_AUDIT_TOKEN',
    'BUILD_CERTIFICATE_BASE64',
    'P12_PASSWORD',
    'KEYCHAIN_PASSWORD',
    'APPLE_API_KEY_BASE64',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ]);
  add(
    'release env bootstrap recognizes release env contract',
    bootstrapMissing.length === 0,
    bootstrapMissing.length ? `missing ${bootstrapMissing.join(', ')}` : 'bootstrap writer and verifier cover primary contract keys',
  );
}

function checkPackageScripts() {
  const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
  add(
    'npm script verify:release-env-contract',
    pkg.scripts?.['verify:release-env-contract'] === 'node scripts/verify-release-env-contract.mjs',
    pkg.scripts?.['verify:release-env-contract'] || 'missing',
  );
  add(
    'npm script release:env-bootstrap',
    pkg.scripts?.['release:env-bootstrap'] === 'node scripts/write-release-env-bootstrap.mjs',
    pkg.scripts?.['release:env-bootstrap'] || 'missing',
  );
  add(
    'npm script verify:env-bootstrap:strict:report',
    pkg.scripts?.['verify:env-bootstrap:strict:report'] === 'node scripts/verify-release-env-bootstrap.mjs --strict --no-exit',
    pkg.scripts?.['verify:env-bootstrap:strict:report'] || 'missing',
  );
  add(
    'npm script release:installed-bundle-delta',
    pkg.scripts?.['release:installed-bundle-delta'] === 'node scripts/write-installed-bundle-delta-report.mjs',
    pkg.scripts?.['release:installed-bundle-delta'] || 'missing',
  );
  for (const [name, expected] of [
    ['check', 'verify:release-env-contract'],
    ['release:evidence:local', 'verify:release-env-contract'],
    ['release:evidence:strict', 'verify:release-env-contract'],
  ]) {
    const value = scriptValue(name);
    add(
      `npm script ${name} includes release env contract gate`,
      value.includes(expected),
      value.includes(expected) ? expected : `missing ${expected}`,
    );
  }
  const strictEvidence = scriptValue('release:evidence:strict');
  const releaseEvidence = scriptValue('release:evidence');
  add(
    'npm script release:evidence includes installed bundle delta',
    releaseEvidence.includes('release:installed-bundle-delta') &&
      releaseEvidence.indexOf('release:installed-bundle-delta') > releaseEvidence.indexOf('release:baseline-freshness'),
    releaseEvidence.includes('release:installed-bundle-delta')
      ? 'installed bundle delta follows baseline freshness'
      : 'missing release:installed-bundle-delta',
  );
  add(
    'npm script release:evidence:strict includes commercial finalization',
    strictEvidence.includes('release:commercial-finalize') &&
      strictEvidence.includes('verify:commercial-finalization:strict:report') &&
      strictEvidence.indexOf('release:commercial-finalize') > strictEvidence.indexOf('verify:status-refresh-report:strict:report'),
    strictEvidence.includes('release:commercial-finalize')
      ? 'commercial finalization follows status refresh verification'
      : 'missing release:commercial-finalize',
  );
}

function checkWorkflow() {
  const workflow = readText('.github/workflows/build-desktop.yml') || '';
  add('GitHub Actions workflow exists', Boolean(workflow), '.github/workflows/build-desktop.yml');
  if (!workflow) return;
  const version = packageVersion();
  const expectedBaselineZip = `Connect-AI-${version}-arm64-mac.zip`;
  const expectedDmg = `desktop/release/Connect-AI-${version}-mac-arm64.dmg`;
  const expectedBlockmap = `${expectedDmg}.blockmap`;
  const hardcodedConnectVersions = [...workflow.matchAll(/Connect-AI-(\d+\.\d+\.\d+)[^\s'"${}]*/g)]
    .map((match) => match[1]);
  const staleConnectVersions = [...new Set(hardcodedConnectVersions.filter((item) => item !== version))];
  const missingWorkflowKeys = missingInText(workflow, workflowKeys);
  add(
    'workflow declares release env contract keys',
    missingWorkflowKeys.length === 0,
    missingWorkflowKeys.length ? `missing ${missingWorkflowKeys.join(', ')}` : `${workflowKeys.length} key(s) declared`,
  );
  add(
    'workflow baseline ZIP version matches package',
    workflow.includes(expectedBaselineZip),
    expectedBaselineZip,
  );
  add(
    'workflow upload artifact DMG version matches package',
    workflow.includes(expectedDmg) && workflow.includes(expectedBlockmap),
    `${expectedDmg}, ${expectedBlockmap}`,
  );
  add(
    'workflow has no stale Connect-AI artifact versions',
    staleConnectVersions.length === 0,
    staleConnectVersions.length ? `stale version(s): ${staleConnectVersions.join(', ')}; expected ${version}` : `all hardcoded Connect-AI artifact versions match ${version}`,
  );
  add(
    'workflow runs release env contract verifier before env check',
    workflow.indexOf('npm run verify:release-env-contract') >= 0 &&
      workflow.indexOf('npm run verify:release-env-contract') < workflow.indexOf('npm run release:env-check:process:strict'),
    'verify:release-env-contract precedes release:env-check:process:strict',
  );
  add(
    'workflow uploads release env contract report',
    workflow.includes('release-env-contract-report.json') &&
      workflow.includes('release-env-bootstrap.json') &&
      workflow.includes('RELEASE_ENV_BOOTSTRAP.md') &&
      workflow.includes('release-env.local.template'),
    'release env contract and bootstrap reports retained as diagnostics',
  );
  add(
    'workflow runs commercial finalization gate',
    workflow.includes('Finalize commercial release status') &&
      workflow.includes('npm run release:commercial-finalize') &&
      workflow.includes('Finalize commercial release status after publication') &&
      workflow.includes('npm run release:commercial-finalize:commercial'),
    'commercial finalization runs before and after publication',
  );
  add(
    'workflow uploads commercial finalization diagnostics',
    workflow.includes('commercial-finalization-report.json') &&
      workflow.includes('COMMERCIAL_FINALIZATION.md') &&
      workflow.includes('commercial-finalization-report-verification.strict.json'),
    'commercial finalization reports retained as CI diagnostics',
  );
}

function checkDocs() {
  const docs = [
    ['distribution guide', 'DISTRIBUTION.md'],
    ['operator checklist', 'RELEASE_OPERATOR_CHECKLIST.md'],
  ];
  for (const [label, relative] of docs) {
    const text = readText(relative) || '';
    add(`${label} exists`, Boolean(text), relative);
    if (!text) continue;
    const missingPrimary = missingInText(text, [
      ...contract.requiredVariables,
      'CONNECT_AI_ZIP_SHA256',
      'CONNECT_AI_RELEASE_AUDIT_TOKEN',
      'GH_TOKEN',
      'BUILD_CERTIFICATE_BASE64',
      'P12_PASSWORD',
      'KEYCHAIN_PASSWORD',
      'APPLE_API_KEY_BASE64',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
      'APPLE_KEYCHAIN_PROFILE',
    ]);
    add(
      `${label} documents release env contract`,
      missingPrimary.length === 0,
      missingPrimary.length ? `missing ${missingPrimary.join(', ')}` : 'primary variables and fallbacks documented',
    );
    add(
      `${label} documents release env contract verifier`,
      text.includes('verify:release-env-contract') && text.includes('release-env-contract-report.json'),
      'verifier command and report documented',
    );
    add(
      `${label} documents release env bootstrap`,
      text.includes('release:env-bootstrap') &&
        text.includes('verify:env-bootstrap:strict:report') &&
        text.includes('release/release-env-bootstrap.json') &&
        text.includes('release/release-env.local.template'),
      'bootstrap command, verifier, report, and copyable template documented',
    );
    add(
      `${label} documents commercial finalization gate`,
      text.includes('release:commercial-finalize') &&
        text.includes('verify:commercial-finalization') &&
        text.includes('release/commercial-finalization-report.json') &&
        text.includes('release/COMMERCIAL_FINALIZATION.md'),
      'commercial finalization command and reports documented',
    );
  }
}

function writeReport() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    noExit,
    contract,
    summary: { blockers, warnings },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  const out = path.join(releaseDir, 'release-env-contract-report.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  console.log('Connect AI release env contract verification');
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, out)}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

checkTemplate();
checkScriptCoverage();
checkPackageScripts();
checkWorkflow();
checkDocs();
writeReport();
