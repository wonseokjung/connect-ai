import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const checks = [];

function add(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: desktopDir,
    encoding: 'utf8',
    env: process.env,
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
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function processDetail(result) {
  return result.error
    || firstLine(result.stderr)
    || firstLine(result.stdout)
    || `status=${result.status}`;
}

function writeEnvFile(file, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(desktopDir, relativePath), 'utf8'));
}

function backupReports(relativePaths) {
  return new Map(relativePaths.map((relativePath) => {
    const file = path.join(desktopDir, relativePath);
    return [
      relativePath,
      fs.existsSync(file)
        ? { exists: true, data: fs.readFileSync(file) }
        : { exists: false, data: null },
    ];
  }));
}

function restoreReports(backups) {
  for (const [relativePath, backup] of backups.entries()) {
    const file = path.join(desktopDir, relativePath);
    if (backup.exists) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, backup.data);
    } else {
      fs.rmSync(file, { force: true });
    }
  }
}

function expectCheck(report, name, ok) {
  const check = (report.checks || []).find((item) => item.name === name);
  add(
    `report check ${name}`,
    Boolean(check) && check.ok === ok,
    check ? `ok=${check.ok} detail=${check.detail}` : 'missing',
  );
}

function expectSummary(report, blockers, warnings, label) {
  add(
    `${label} summary`,
    report?.summary?.blockers === blockers && report?.summary?.warnings === warnings,
    `${report?.summary?.blockers ?? 'missing'} blocker(s), ${report?.summary?.warnings ?? 'missing'} warning(s)`,
  );
}

function main() {
  const reports = [
    'release/release-env-report.json',
    'release/github-release-setup-report.json',
  ];
  const backups = backupReports(reports);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-release-env-validation-'));

  try {
    const base64 = Buffer.from('connect-ai-release-validation-secret-material').toString('base64');
    const validEnv = {
      CONNECT_AI_BASELINE_URL: 'https://downloads.connect-ai.test/Connect-AI-0.4.8-arm64-mac.zip',
      CONNECT_AI_BASELINE_SHA256: 'a'.repeat(64),
      CONNECT_AI_ZIP_SHA256: 'a'.repeat(64),
      CONNECT_AI_RELEASE_AUDIT_TOKEN: 'redacted-release-audit-token-for-validation',
      BUILD_CERTIFICATE_BASE64: base64,
      P12_PASSWORD: 'redacted-p12-password-for-validation',
      KEYCHAIN_PASSWORD: 'redacted-keychain-password-for-validation',
      APPLE_API_KEY_BASE64: base64,
      APPLE_API_KEY_ID: 'KEYID12345',
      APPLE_API_ISSUER: '00000000-0000-4000-8000-000000000000',
    };
    const validEnvFile = path.join(tmp, 'valid.env');
    writeEnvFile(validEnvFile, validEnv);

    const validEnvResult = runNode(['scripts/verify-release-env.mjs', '--file', validEnvFile, '--strict']);
    add('valid release env strict exits cleanly', validEnvResult.ok, processDetail(validEnvResult));
    const validEnvReport = readJson('release/release-env-report.json');
    expectSummary(validEnvReport, 0, 0, 'valid release env');
    expectCheck(validEnvReport, 'release env baseline URL shape', true);
    expectCheck(validEnvReport, 'release env baseline URL version', true);
    expectCheck(validEnvReport, 'release env baseline URL remote candidate guard', true);
    expectCheck(validEnvReport, 'release env CONNECT_AI_BASELINE_SHA256 shape', true);
    expectCheck(validEnvReport, 'release env baseline SHA aliases match', true);
    expectCheck(validEnvReport, 'release env BUILD_CERTIFICATE_BASE64 base64 shape', true);
    expectCheck(validEnvReport, 'release env APPLE_API_KEY_BASE64 base64 shape', true);

    const validSetupResult = runNode(['scripts/apply-github-release-setup.mjs', '--file', validEnvFile]);
    add('valid GitHub setup dry-run exits cleanly', validSetupResult.ok, processDetail(validSetupResult));
    const validSetupReport = readJson('release/github-release-setup-report.json');
    expectSummary(validSetupReport, 0, Number(validSetupReport.summary?.warnings || 0), 'valid GitHub setup dry-run');
    expectCheck(validSetupReport, 'GitHub variable CONNECT_AI_BASELINE_URL shape', true);
    expectCheck(validSetupReport, 'GitHub variable CONNECT_AI_BASELINE_URL version', true);
    expectCheck(validSetupReport, 'GitHub variable CONNECT_AI_BASELINE_URL remote candidate guard', true);
    expectCheck(validSetupReport, 'GitHub variable CONNECT_AI_BASELINE_SHA256 shape', true);
    expectCheck(validSetupReport, 'GitHub secret BUILD_CERTIFICATE_BASE64 base64 shape', true);
    expectCheck(validSetupReport, 'GitHub secret APPLE_API_KEY_BASE64 base64 shape', true);

    const ghTokenOnlyEnv = { ...validEnv, GH_TOKEN: 'redacted-gh-token-for-validation' };
    delete ghTokenOnlyEnv.CONNECT_AI_RELEASE_AUDIT_TOKEN;
    const ghTokenOnlyFile = path.join(tmp, 'gh-token-only.env');
    writeEnvFile(ghTokenOnlyFile, ghTokenOnlyEnv);

    const ghTokenEnvResult = runNode(['scripts/verify-release-env.mjs', '--file', ghTokenOnlyFile, '--strict']);
    add('GH_TOKEN fallback release env exits cleanly', ghTokenEnvResult.ok, processDetail(ghTokenEnvResult));
    const ghTokenEnvReport = readJson('release/release-env-report.json');
    expectSummary(ghTokenEnvReport, 0, 0, 'GH_TOKEN fallback release env');
    expectCheck(ghTokenEnvReport, 'release env GitHub audit token', true);

    const ghTokenSetupResult = runNode(['scripts/apply-github-release-setup.mjs', '--file', ghTokenOnlyFile]);
    add('GH_TOKEN fallback GitHub setup dry-run exits cleanly', ghTokenSetupResult.ok, processDetail(ghTokenSetupResult));
    const ghTokenSetupReport = readJson('release/github-release-setup-report.json');
    expectSummary(ghTokenSetupReport, 0, Number(ghTokenSetupReport.summary?.warnings || 0), 'GH_TOKEN fallback GitHub setup dry-run');
    expectCheck(ghTokenSetupReport, 'GitHub secret CONNECT_AI_RELEASE_AUDIT_TOKEN', true);

    const badShaFile = path.join(tmp, 'bad-sha.env');
    writeEnvFile(badShaFile, { ...validEnv, CONNECT_AI_BASELINE_SHA256: 'not-a-sha', CONNECT_AI_ZIP_SHA256: 'b'.repeat(64) });
    runNode(['scripts/verify-release-env.mjs', '--file', badShaFile, '--strict', '--no-exit']);
    const badShaReport = readJson('release/release-env-report.json');
    add('invalid SHA env produces blockers', Number(badShaReport.summary?.blockers || 0) >= 2, `${badShaReport.summary?.blockers || 0} blocker(s)`);
    expectCheck(badShaReport, 'release env CONNECT_AI_BASELINE_SHA256 shape', false);
    expectCheck(badShaReport, 'release env baseline SHA aliases match', false);

    const badUrlFile = path.join(tmp, 'bad-url.env');
    writeEnvFile(badUrlFile, { ...validEnv, CONNECT_AI_BASELINE_URL: 'http://downloads.connect-ai.test/Connect-AI-0.4.8-arm64-mac.zip' });
    runNode(['scripts/verify-release-env.mjs', '--file', badUrlFile, '--strict', '--no-exit']);
    const badUrlReport = readJson('release/release-env-report.json');
    add('invalid URL env produces blockers', Number(badUrlReport.summary?.blockers || 0) >= 1, `${badUrlReport.summary?.blockers || 0} blocker(s)`);
    expectCheck(badUrlReport, 'release env baseline URL shape', false);

    const remoteBaseline = readJson('release/remote-baseline-candidate-report.strict.json');
    if (remoteBaseline?.candidate?.url && remoteBaseline.approvedForBaselineUrl === false) {
      const unapprovedRemoteFile = path.join(tmp, 'unapproved-remote.env');
      writeEnvFile(unapprovedRemoteFile, { ...validEnv, CONNECT_AI_BASELINE_URL: remoteBaseline.candidate.url });
      runNode(['scripts/verify-release-env.mjs', '--file', unapprovedRemoteFile, '--strict', '--no-exit']);
      const unapprovedRemoteEnvReport = readJson('release/release-env-report.json');
      add('unapproved remote baseline env produces blockers', Number(unapprovedRemoteEnvReport.summary?.blockers || 0) >= 1, `${unapprovedRemoteEnvReport.summary?.blockers || 0} blocker(s)`);
      expectCheck(unapprovedRemoteEnvReport, 'release env baseline URL remote candidate guard', false);

      runNode(['scripts/apply-github-release-setup.mjs', '--file', unapprovedRemoteFile, '--strict', '--no-exit']);
      const unapprovedRemoteSetupReport = readJson('release/github-release-setup-report.json');
      add('unapproved remote baseline GitHub setup produces blockers', Number(unapprovedRemoteSetupReport.summary?.blockers || 0) >= 1, `${unapprovedRemoteSetupReport.summary?.blockers || 0} blocker(s)`);
      expectCheck(unapprovedRemoteSetupReport, 'GitHub variable CONNECT_AI_BASELINE_URL remote candidate guard', false);
    } else {
      add('unapproved remote baseline guard fixture available', true, 'remote baseline candidate already approved or not present');
    }

    const badBase64File = path.join(tmp, 'bad-base64.env');
    writeEnvFile(badBase64File, { ...validEnv, BUILD_CERTIFICATE_BASE64: 'not-valid-base64-content' });
    runNode(['scripts/verify-release-env.mjs', '--file', badBase64File, '--strict', '--no-exit']);
    const badBase64Report = readJson('release/release-env-report.json');
    add('invalid base64 env produces blockers', Number(badBase64Report.summary?.blockers || 0) >= 1, `${badBase64Report.summary?.blockers || 0} blocker(s)`);
    expectCheck(badBase64Report, 'release env BUILD_CERTIFICATE_BASE64 base64 shape', false);

    const badSetupResult = runNode(['scripts/apply-github-release-setup.mjs', '--file', badShaFile, '--strict']);
    add('invalid GitHub setup strict exits nonzero', !badSetupResult.ok, `status=${badSetupResult.status}`);
    const badSetupReport = readJson('release/github-release-setup-report.json');
    add('invalid GitHub setup produces blockers', Number(badSetupReport.summary?.blockers || 0) >= 1, `${badSetupReport.summary?.blockers || 0} blocker(s)`);
    expectCheck(badSetupReport, 'GitHub variable CONNECT_AI_BASELINE_SHA256 shape', false);
  } finally {
    restoreReports(backups);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('Connect AI release env validation regression');
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'BLOCKER'} ${check.name} - ${check.detail}`);
  }
  const blockers = checks.filter((check) => !check.ok).length;
  console.log(`Summary: ${blockers} blocker(s), 0 warning(s)`);
  if (blockers > 0) process.exit(1);
}

main();
