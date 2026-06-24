import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const forceDownload = process.argv.includes('--download');
const reportPath = strict
  ? 'release/remote-baseline-candidate-report.strict.json'
  : 'release/remote-baseline-candidate-report.json';
const markdownPath = 'release/REMOTE_BASELINE_CANDIDATE.md';
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

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
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

function parseInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function contentLengthFromHeaders(headers) {
  const direct = parseInteger(headers['content-length']);
  if (direct != null) return direct;
  const range = String(headers['content-range'] || '');
  const match = range.match(/\/(\d+)$/);
  return match ? parseInteger(match[1]) : null;
}

function httpsZipUrl(value, version) {
  return typeof value === 'string' &&
    /^https:\/\//.test(value) &&
    value.endsWith('.zip') &&
    (!version || value.includes(version));
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

function sourceSummary(label, relativePath) {
  const report = readJson(relativePath);
  return {
    label,
    path: relativePath,
    present: Boolean(report),
    parseError: report?.parseError || null,
    generatedAt: report?.generatedAt || null,
    status: report?.status || null,
    summary: report ? summary(report) : null,
  };
}

function candidateFromSources(pkg, envBootstrap, credentialHandoff, setupPlan) {
  const candidates = [
    envBootstrap?.baselineUrlRecommendation?.candidateUrl,
    credentialHandoff?.remoteBaselineCandidate?.remoteUrl,
    setupPlan?.remoteBaselineCandidate?.remoteUrl,
  ].filter(Boolean);
  const unique = [...new Set(candidates)];
  const expectedAsset = `Connect-AI-${pkg?.version || 'unknown'}-arm64-mac.zip`;
  const fallback = pkg?.version
    ? `https://github.com/wonseokjung/connect-ai/releases/download/desktop-v${pkg.version}/${expectedAsset}`
    : '';
  return {
    url: unique[0] || fallback,
    unique,
    consistent: unique.length <= 1,
    asset: expectedAsset,
  };
}

function request(method, url, options = {}, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 8) {
      resolve({ ok: false, statusCode: 0, headers: {}, finalUrl: url, error: 'too many redirects' });
      return;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, statusCode: 0, headers: {}, finalUrl: url, error: error.message });
      return;
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request(parsed, {
      method,
      headers: options.headers || {},
      timeout: options.timeout || 30000,
    }, (res) => {
      const location = res.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(Number(res.statusCode))) {
        res.resume();
        const nextUrl = new URL(location, parsed).toString();
        request(method, nextUrl, options, redirectCount + 1).then(resolve);
        return;
      }
      res.resume();
      resolve({
        ok: Number(res.statusCode) >= 200 && Number(res.statusCode) < 400,
        statusCode: Number(res.statusCode || 0),
        headers: res.headers,
        finalUrl: url,
        error: '',
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });
    req.on('error', (error) => {
      resolve({ ok: false, statusCode: 0, headers: {}, finalUrl: url, error: error.message });
    });
    req.end();
  });
}

async function headWithFallback(url) {
  const head = await request('HEAD', url);
  if (head.ok && contentLengthFromHeaders(head.headers) != null) return { ...head, method: 'HEAD' };
  const ranged = await request('GET', url, { headers: { Range: 'bytes=0-0' } });
  return { ...ranged, method: 'GET range 0-0', headStatusCode: head.statusCode, headError: head.error };
}

function downloadAndHash(url, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 8) {
      resolve({ ok: false, bytes: 0, sha256: null, finalUrl: url, error: 'too many redirects' });
      return;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, bytes: 0, sha256: null, finalUrl: url, error: error.message });
      return;
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(parsed, { timeout: 120000 }, (res) => {
      const location = res.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(Number(res.statusCode))) {
        res.resume();
        downloadAndHash(new URL(location, parsed).toString(), redirectCount + 1).then(resolve);
        return;
      }
      if (Number(res.statusCode) < 200 || Number(res.statusCode) >= 400) {
        res.resume();
        resolve({ ok: false, bytes: 0, sha256: null, finalUrl: url, error: `HTTP ${res.statusCode}` });
        return;
      }
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        hash.update(chunk);
      });
      res.on('end', () => {
        resolve({ ok: true, bytes, sha256: hash.digest('hex'), finalUrl: url, error: '' });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('download timed out'));
    });
    req.on('error', (error) => {
      resolve({ ok: false, bytes: 0, sha256: null, finalUrl: url, error: error.message });
    });
  });
}

function renderMarkdown(report) {
  const checkLines = report.checks.map((check) => {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    return `- ${label}: ${check.name} - ${check.detail}`;
  }).join('\n');
  return `# Connect AI Remote Baseline Candidate

Generated: ${report.generatedAt}
Status: ${report.status}
Approved for CONNECT_AI_BASELINE_URL: ${report.approvedForBaselineUrl}
Candidate URL: ${report.candidate.url}
Expected SHA-256: ${report.expected.sha256 || 'missing'}

## Remote Check

- Method: ${report.remote.method || 'not-run'}
- Status: ${report.remote.statusCode || 'missing'}
- Remote bytes: ${report.remote.bytes ?? 'missing'}
- Remote SHA-256: ${report.remote.sha256 || 'not downloaded'}
- Safe for direct use: ${report.safeForDirectUse}

## Checks

${checkLines}
`;
}

function writeReport(report) {
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, reportPath), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(desktopDir, markdownPath), renderMarkdown(report));
  console.log(`Connect AI remote baseline candidate verification (${strict ? 'strict' : 'local'})`);
  for (const check of report.checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s)`);
  console.log(`Status: ${report.status}`);
  console.log(`Wrote ${reportPath}`);
  if (report.summary.blockers > 0 && !noExit) process.exit(1);
}

async function main() {
  const pkg = readJson('package.json');
  const baselineExport = readJson('release/baseline-export-report.json');
  const baselineVerification = readJson('release/baseline-export-report-verification.strict.json');
  const envBootstrap = readJson('release/release-env-bootstrap.json');
  const credentialHandoff = readJson('release/release-credential-handoff.json');
  const setupPlan = readJson('release/release-setup-plan.json');
  const candidate = candidateFromSources(pkg, envBootstrap, credentialHandoff, setupPlan);
  const expectedPath = baselineExport?.export?.path || '';
  const expectedAbsolutePath = baselineExport?.export?.absolutePath || path.join(desktopDir, expectedPath);
  const expectedBytes = Number(baselineExport?.export?.bytes || 0);
  const expectedSha = baselineExport?.export?.sha256 || '';
  const expectedExists = expectedAbsolutePath && fs.existsSync(expectedAbsolutePath);
  const actualExpectedBytes = expectedExists ? fs.statSync(expectedAbsolutePath).size : null;
  const actualExpectedSha = expectedExists ? sha256File(expectedAbsolutePath) : null;
  const baselineSummary = summary(baselineVerification);

  add('remote baseline package version', Boolean(pkg?.version), pkg?.version || 'missing');
  add('remote baseline candidate source consistency', candidate.consistent, candidate.unique.join(', ') || 'fallback');
  add('remote baseline candidate URL shape', httpsZipUrl(candidate.url, pkg?.version || ''), candidate.url || 'missing');
  add('remote baseline export report clean', baselineExport?.ok === true && baselineExport?.status === 'exported', `status=${baselineExport?.status || 'missing'}, ok=${Boolean(baselineExport?.ok)}`);
  add('remote baseline export verification clean', baselineVerification?.strict === true && baselineSummary.blockers === 0 && baselineSummary.warnings === 0, `${baselineSummary.blockers} blocker(s), ${baselineSummary.warnings} warning(s)`);
  add('remote baseline approved source exists', Boolean(expectedExists), expectedPath || 'missing');
  add('remote baseline approved source bytes', expectedExists && expectedBytes > 0 && actualExpectedBytes === expectedBytes, expectedExists ? `${actualExpectedBytes} expected ${expectedBytes}` : 'missing');
  add('remote baseline approved source SHA-256', expectedExists && /^[a-f0-9]{64}$/i.test(expectedSha) && actualExpectedSha === expectedSha, expectedExists ? `${actualExpectedSha} expected ${expectedSha}` : 'missing');

  const remote = {
    method: null,
    statusCode: null,
    finalUrl: null,
    bytes: null,
    sha256: null,
    error: null,
    downloaded: false,
    downloadTempDir: null,
  };
  let status = 'not-checked';
  let approvedForBaselineUrl = false;
  let safeForDirectUse = false;
  let validationMode = 'not-run';

  if (httpsZipUrl(candidate.url, pkg?.version || '')) {
    const head = await headWithFallback(candidate.url);
    remote.method = head.method;
    remote.statusCode = head.statusCode;
    remote.finalUrl = head.finalUrl;
    remote.bytes = contentLengthFromHeaders(head.headers);
    remote.error = head.error || null;
    add('remote baseline candidate reachable', head.ok, head.ok ? `${head.method} HTTP ${head.statusCode}` : (head.error || `HTTP ${head.statusCode}`));
    add('remote baseline candidate byte size observed', remote.bytes != null, remote.bytes == null ? 'missing content length' : String(remote.bytes));

    const mustDownload = head.ok && (forceDownload || strict) && (remote.bytes == null || remote.bytes === expectedBytes);
    if (head.ok && remote.bytes != null && remote.bytes !== expectedBytes) {
      status = 'remote-size-mismatch';
      validationMode = 'head-content-length';
      add('remote baseline rejected before SHA by byte size', true, `${remote.bytes} remote, ${expectedBytes} expected`);
    } else if (mustDownload) {
      const download = await downloadAndHash(candidate.url);
      remote.downloaded = true;
      remote.downloadTempDir = os.tmpdir();
      remote.bytes = download.bytes || remote.bytes;
      remote.sha256 = download.sha256;
      remote.error = download.error || remote.error;
      validationMode = 'download-sha256';
      add('remote baseline candidate downloaded for SHA-256', download.ok, download.ok ? `${download.bytes} bytes` : download.error || 'download failed');
      add('remote baseline downloaded bytes match', download.ok && download.bytes === expectedBytes, `${download.bytes} expected ${expectedBytes}`);
      add('remote baseline downloaded SHA-256 match', download.ok && download.sha256 === expectedSha, `${download.sha256 || 'missing'} expected ${expectedSha}`);
      if (download.ok && download.bytes === expectedBytes && download.sha256 === expectedSha) {
        status = 'approved-for-baseline-url';
        approvedForBaselineUrl = true;
        safeForDirectUse = true;
      } else {
        status = download.ok ? 'remote-sha-mismatch' : 'remote-download-failed';
      }
    } else if (head.ok && remote.bytes === expectedBytes) {
      status = 'remote-size-match-sha-unverified';
      validationMode = 'head-content-length';
      add('remote baseline same-size candidate requires SHA-256', false, 'rerun with --strict or --download before use');
    } else if (!head.ok) {
      status = 'remote-unreachable';
    } else {
      status = 'remote-size-unknown';
      add('remote baseline unknown-size candidate requires SHA-256', false, 'content length unavailable; rerun with --strict or --download before use');
    }
  }

  add('remote baseline never approved without SHA-256', !approvedForBaselineUrl || remote.sha256 === expectedSha, `approved=${approvedForBaselineUrl}, sha=${remote.sha256 || 'missing'}`);
  add('remote baseline safe-use flag matches approval', safeForDirectUse === approvedForBaselineUrl, `safeForDirectUse=${safeForDirectUse}, approved=${approvedForBaselineUrl}`);
  add('remote baseline report secret scan', !hasSecretMaterial(JSON.stringify({ candidate, remote, expectedPath })), 'no private key, certificate body, GitHub token, or API key literal patterns');

  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    status,
    approvedForBaselineUrl,
    safeForDirectUse,
    validationMode,
    product: {
      name: pkg?.build?.productName || pkg?.name || 'Connect AI',
      version: pkg?.version || null,
      appId: pkg?.build?.appId || null,
      releaseTag: pkg?.version ? `desktop-v${pkg.version}` : null,
    },
    candidate: {
      url: candidate.url,
      asset: candidate.asset,
      sourceUrls: candidate.unique,
      sourcesConsistent: candidate.consistent,
    },
    expected: {
      path: expectedPath || null,
      absolutePath: expectedAbsolutePath || null,
      bytes: expectedBytes || null,
      sha256: expectedSha || null,
      actualBytes: actualExpectedBytes,
      actualSha256: actualExpectedSha,
    },
    remote,
    sourceReports: [
      sourceSummary('baseline export', 'release/baseline-export-report.json'),
      sourceSummary('baseline export verification', 'release/baseline-export-report-verification.strict.json'),
      sourceSummary('release env bootstrap', 'release/release-env-bootstrap.json'),
      sourceSummary('credential handoff', 'release/release-credential-handoff.json'),
      sourceSummary('release setup plan', 'release/release-setup-plan.json'),
    ],
    summary: {
      blockers,
      warnings,
    },
    checks,
  };

  writeReport(report);
}

main().catch((error) => {
  add('remote baseline verification exception', false, error.stack || error.message || String(error));
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  writeReport({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    status: 'failed',
    approvedForBaselineUrl: false,
    safeForDirectUse: false,
    validationMode: 'failed',
    product: {},
    candidate: {},
    expected: {},
    remote: {},
    sourceReports: [],
    summary: { blockers, warnings },
    checks,
  });
});
