import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const refresh = process.argv.includes('--refresh');
const sourcePath = strict
  ? 'release/remote-baseline-candidate-report.strict.json'
  : 'release/remote-baseline-candidate-report.json';
const sourceVerificationPath = strict
  ? 'release/remote-baseline-candidate-report-verification.strict.json'
  : 'release/remote-baseline-candidate-report-verification.json';
const reportPath = strict
  ? 'release/remote-baseline-approval-report.strict.json'
  : 'release/remote-baseline-approval-report.json';
const markdownPath = 'release/REMOTE_BASELINE_APPROVAL.md';
const checks = [];

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function summary(report) {
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
}

function publishTarget(pkg) {
  const publish = Array.isArray(pkg?.build?.publish) ? pkg.build.publish[0] : null;
  const owner = publish?.owner || 'wonseokjung';
  const repo = publish?.repo || 'connect-ai';
  const tag = pkg?.version ? `desktop-v${pkg.version}` : '';
  const asset = pkg?.version ? `Connect-AI-${pkg.version}-arm64-mac.zip` : '';
  return {
    owner,
    repo,
    tag,
    asset,
    url: pkg?.version ? `https://github.com/${owner}/${repo}/releases/download/${tag}/${asset}` : '',
  };
}

function generatedAtMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function sha256LooksValid(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function hasSecretMaterial(text) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
    /-----BEGIN CERTIFICATE-----/,
    /\bghp_[A-Za-z0-9_]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bAIza[0-9A-Za-z_-]{20,}\b/,
    /\bsk-[A-Za-z0-9]{24,}\b/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function runNpm(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(`Refreshing remote baseline source report: npm run ${script}`);
  const result = spawnSync(npm, ['run', script], {
    cwd: desktopDir,
    stdio: 'inherit',
    env: process.env,
  });
  add(
    `remote baseline approval refresh ${script}`,
    result.status === 0,
    result.status === 0 ? 'completed' : `exit ${result.status ?? 'unknown'}`,
  );
}

function sourceSummary(label, relativePath) {
  const report = readJson(relativePath);
  const value = summary(report);
  return {
    label,
    path: relativePath,
    present: Boolean(report),
    parseError: report?.parseError || null,
    generatedAt: report?.generatedAt || null,
    strict: report?.strict ?? null,
    status: report?.status || null,
    approvedForBaselineUrl: report?.approvedForBaselineUrl ?? null,
    safeForDirectUse: report?.safeForDirectUse ?? null,
    validationMode: report?.validationMode || null,
    summary: report && !report.parseError ? value : null,
  };
}

function renderMarkdown(report) {
  const checkLines = report.checks.map((check) => {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    return `- ${label}: ${check.name} - ${check.detail}`;
  }).join('\n');
  return `# Connect AI Remote Baseline Approval

Generated: ${report.generatedAt}
Status: ${report.status}
Approved for CONNECT_AI_BASELINE_URL: ${report.approvedForBaselineUrl}
Candidate URL: ${report.candidate.url || 'missing'}
Expected URL: ${report.candidate.expectedUrl || 'missing'}
Expected SHA-256: ${report.expected.sha256 || 'missing'}
Remote SHA-256: ${report.remote.sha256 || 'missing'}

## Checks

${checkLines}
`;
}

function writeReport(report) {
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(desktopDir, markdownPath), renderMarkdown(report));
  console.log(`Connect AI remote baseline approval (${strict ? 'strict' : 'local'})`);
  for (const check of report.checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)`);
  console.log(`Status: ${report.status}`);
  console.log(`Wrote ${reportPath}`);
  if (report.summary.blockers > 0 && !noExit) process.exit(1);
}

function main() {
  if (refresh) {
    runNpm(strict ? 'verify:remote-baseline-candidate:strict:report' : 'verify:remote-baseline-candidate');
    runNpm(strict ? 'verify:remote-baseline-candidate-report:strict:report' : 'verify:remote-baseline-candidate-report');
  }

  const pkg = readJson('package.json');
  const target = publishTarget(pkg);
  const candidate = readJson(sourcePath);
  const candidateVerification = readJson(sourceVerificationPath);
  const baselineExport = readJson('release/baseline-export-report.json');
  const candidateSummary = summary(candidate);
  const verificationSummary = summary(candidateVerification);
  const expectedSha = candidate?.expected?.sha256 || '';
  const expectedBytes = Number(candidate?.expected?.bytes || 0);
  const remoteSha = candidate?.remote?.sha256 || '';
  const remoteBytes = candidate?.remote?.bytes == null ? null : Number(candidate.remote.bytes);
  const approved = candidate?.approvedForBaselineUrl === true;
  const safe = candidate?.safeForDirectUse === true;

  add('remote baseline approval package version', Boolean(pkg?.version), pkg?.version || 'missing');
  add('remote baseline approval source report exists', Boolean(candidate && !candidate.parseError), candidate?.parseError || sourcePath);
  if (candidate && !candidate.parseError) {
    add('remote baseline approval source strict mode', !strict || candidate.strict === true, `strict=${candidate.strict}`);
    add('remote baseline approval source generatedAt', generatedAtMs(candidate.generatedAt) > 0, candidate.generatedAt || 'missing');
    add('remote baseline approval source summary clean', candidateSummary.blockers === 0 && candidateSummary.warnings === 0, `${candidateSummary.blockers} blocker(s), ${candidateSummary.warnings} warning(s)`);
    add('remote baseline approval verifier exists', Boolean(candidateVerification && !candidateVerification.parseError), candidateVerification?.parseError || sourceVerificationPath);
    add('remote baseline approval verifier clean', verificationSummary.blockers === 0 && verificationSummary.warnings === 0, `${verificationSummary.blockers} blocker(s), ${verificationSummary.warnings} warning(s)`);
    add('remote baseline approval candidate URL matches current release asset', candidate.candidate?.url === target.url, `${candidate.candidate?.url || 'missing'} expected ${target.url || 'missing'}`);
    add('remote baseline approval candidate asset matches current version', candidate.candidate?.asset === target.asset, `${candidate.candidate?.asset || 'missing'} expected ${target.asset || 'missing'}`);
    add('remote baseline approval expected SHA shape', sha256LooksValid(expectedSha), expectedSha || 'missing');
    add('remote baseline approval expected SHA matches baseline export', expectedSha === baselineExport?.export?.sha256, `${expectedSha || 'missing'} expected ${baselineExport?.export?.sha256 || 'missing'}`);
    add('remote baseline approval expected bytes match baseline export', expectedBytes > 0 && expectedBytes === Number(baselineExport?.export?.bytes || 0), `${expectedBytes || 'missing'} expected ${baselineExport?.export?.bytes || 'missing'}`);
    add('remote baseline approval source artifact still verified', candidate.expected?.actualBytes === expectedBytes && candidate.expected?.actualSha256 === expectedSha, `${candidate.expected?.actualBytes ?? 'missing'} bytes, ${candidate.expected?.actualSha256 || 'missing'}`);
    add('remote baseline approval status', candidate.status === 'approved-for-baseline-url', candidate.status || 'missing');
    add('remote baseline approval flag', approved, `approvedForBaselineUrl=${candidate.approvedForBaselineUrl}`);
    add('remote baseline approval safe-use flag', safe, `safeForDirectUse=${candidate.safeForDirectUse}`);
    add('remote baseline approval downloaded SHA validation', candidate.validationMode === 'download-sha256', candidate.validationMode || 'missing');
    add('remote baseline approval remote bytes match expected', remoteBytes === expectedBytes, `${remoteBytes ?? 'missing'} expected ${expectedBytes || 'missing'}`);
    add('remote baseline approval remote SHA matches expected', remoteSha === expectedSha, `${remoteSha || 'missing'} expected ${expectedSha || 'missing'}`);
    add('remote baseline approval report secret scan', !hasSecretMaterial(JSON.stringify(candidate)), 'no private key, certificate body, GitHub token, or API key literal patterns');
  }

  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    refresh,
    status: blockers === 0 ? 'approved-for-baseline-url' : 'not-approved-for-baseline-url',
    approvedForBaselineUrl: blockers === 0,
    candidate: {
      url: candidate?.candidate?.url || null,
      expectedUrl: target.url || null,
      asset: candidate?.candidate?.asset || null,
      expectedAsset: target.asset || null,
      sourceStatus: candidate?.status || null,
    },
    expected: {
      bytes: expectedBytes || null,
      sha256: expectedSha || null,
      baselineExportPath: baselineExport?.export?.path || null,
    },
    remote: {
      bytes: remoteBytes,
      sha256: remoteSha || null,
      validationMode: candidate?.validationMode || null,
    },
    sourceReports: [
      sourceSummary('remote baseline candidate', sourcePath),
      sourceSummary('remote baseline candidate verification', sourceVerificationPath),
      sourceSummary('baseline export', 'release/baseline-export-report.json'),
    ],
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  writeReport(report);
}

main();
