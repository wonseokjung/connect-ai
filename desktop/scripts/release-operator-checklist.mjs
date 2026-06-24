import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';

const { DEFAULT_VERSION, DEFAULT_ASAR_SHA256, baselineResources, resolveBaselineApp, sha256 } = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoDir = path.resolve(desktopDir, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const checkGitHub = process.argv.includes('--github');
const noExit = process.argv.includes('--no-exit');
const checks = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
    env: process.env,
    timeout: options.timeout || 15000,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
  });
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

function parseConnectArtifactVersion(name) {
  const match = String(name || '').match(/Connect[- ]AI[- ](\d+\.\d+\.\d+)/i);
  return match?.[1] || null;
}

function compareConnectVersion(left, right) {
  const leftParts = String(left || '').split('.').map((part) => Number(part));
  const rightParts = String(right || '').split('.').map((part) => Number(part));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const b = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function newerDownloadedConnectArtifacts(packageVersion) {
  const home = process.env.HOME || '';
  const downloadsDir = home ? path.join(home, 'Downloads') : '';
  if (!downloadsDir || !fs.existsSync(downloadsDir)) return [];
  return fs.readdirSync(downloadsDir)
    .filter((name) => /^Connect[- ]AI.*\.(zip|dmg)$/i.test(name))
    .map((name) => ({
      name,
      version: parseConnectArtifactVersion(name),
    }))
    .filter((candidate) => candidate.version && compareConnectVersion(candidate.version, packageVersion) > 0)
    .sort((left, right) => compareConnectVersion(right.version, left.version) || left.name.localeCompare(right.name));
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

function commandExists(command) {
  const result = run('/usr/bin/which', [command], { cwd: repoDir });
  return result.ok ? result.stdout : '';
}

function firstLine(value) {
  const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[0] || 'no diagnostic output';
}

function developerIdIdentityAvailable() {
  if (process.platform !== 'darwin') return { ok: false, detail: 'requires macOS security command' };
  const identityArgs = ['find-identity', '-v', '-p', 'codesigning'];
  if (process.env.CSC_KEYCHAIN && fs.existsSync(process.env.CSC_KEYCHAIN)) identityArgs.push(process.env.CSC_KEYCHAIN);
  const result = run('/usr/bin/security', identityArgs);
  const text = `${result.stdout}\n${result.stderr}`;
  return {
    ok: /Developer ID Application/.test(text),
    detail: /Developer ID Application/.test(text) ? 'Developer ID Application identity is available' : firstLine(text),
  };
}

function checkHostTooling() {
  add('macOS release host', process.platform === 'darwin', `${process.platform}/${process.arch}`);
  add('npm command', Boolean(commandExists('npm')), commandExists('npm') || 'missing');
  for (const tool of ['/usr/bin/security', '/usr/bin/codesign', '/usr/sbin/spctl', '/usr/bin/xcrun', '/usr/bin/hdiutil']) {
    add(path.basename(tool), fs.existsSync(tool), tool);
  }
}

function checkProjectConfig() {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  add('package version', pkg.version === DEFAULT_VERSION, `${pkg.version} expected ${DEFAULT_VERSION}`);
  add('bundle identifier', pkg.build?.appId === 'ai.ezer.connect-desktop', pkg.build?.appId || 'missing');
  add('Electron runtime pin', pkg.build?.electronVersion === '42.4.1', pkg.build?.electronVersion || 'missing');
  for (const script of ['release:env-check', 'release:env-check:strict', 'release:env-check:strict:report', 'release:env-check:process', 'release:env-check:process:strict', 'release:env-check:process:strict:report', 'release:env-bootstrap', 'verify:env-bootstrap', 'verify:env-bootstrap:strict', 'verify:env-bootstrap:strict:report', 'verify:release-env-contract', 'verify:release-env-validation', 'release:preflight:strict', 'release:preflight:strict:report', 'release:preflight:strict:env', 'release:preflight:strict:report:env', 'release:operator-checklist', 'release:operator-checklist:strict', 'release:operator-checklist:strict:report', 'release:operator-checklist:github', 'release:operator-checklist:github:strict', 'release:operator-checklist:github:strict:report', 'release:operator-checklist:github:strict:env', 'release:operator-checklist:github:strict:report:env', 'signing:check:report', 'signing:check:report:env', 'signing:import', 'signing:import:env', 'signing:notary-profile', 'signing:notary-profile:env', 'signing:notary-profile:report', 'signing:notary-profile:report:env', 'dist', 'verify:release', 'verify:release:env', 'verify:release:macos-security', 'verify:release:ipc-security', 'verify:release:ipc-security:built', 'verify:release:secret-hygiene', 'verify:release:secret-hygiene:env', 'verify:release:dmg-install', 'verify:release:launch', 'verify:release:dmg-launch', 'verify:update-channel', 'verify:release-tag', 'verify:release:ui-parity', 'verify:release:performance-parity', 'release:evidence', 'release:evidence:strict', 'release:security-audit', 'release:baseline-export', 'verify:baseline-export', 'verify:baseline-export:strict', 'verify:baseline-export:strict:report', 'release:setup-plan', 'verify:setup-plan', 'verify:setup-plan:strict', 'verify:setup-plan:strict:report', 'verify:setup-plan:production', 'release:credential-handoff', 'verify:credential-handoff', 'verify:credential-handoff:strict', 'verify:credential-handoff:strict:report', 'release:readiness-summary', 'release:readiness-summary:strict', 'release:readiness-summary:strict:report', 'verify:readiness-summary-report', 'verify:readiness-summary-report:strict', 'verify:readiness-summary-report:strict:report', 'release:unblock-plan', 'verify:unblock-plan', 'verify:unblock-plan:strict', 'verify:unblock-plan:strict:report', 'release:publication-seal', 'release:publication-seal:strict', 'release:publication-seal:strict:report', 'verify:publication-seal-report', 'verify:publication-seal-report:strict', 'verify:publication-seal-report:strict:report', 'verify:publication-seal:production', 'verify:publication-seal:published', 'release:operator-runbook', 'release:operator-runbook:strict:report', 'release:operator-runbook:process:strict:report', 'verify:operator-runbook-report', 'verify:operator-runbook-report:strict', 'verify:operator-runbook-report:strict:report', 'release:status-refresh', 'release:github-setup', 'release:github-setup:strict', 'release:github-setup:strict:report', 'release:github-setup:process', 'release:github-setup:process:strict:report', 'release:github-setup:apply', 'release:promotion-plan', 'release:asset-manifest', 'release:decision', 'release:decision:strict', 'release:decision:strict:report', 'verify:evidence:strict', 'verify:evidence:strict:report', 'verify:asset-manifest:strict', 'release:publish-assets', 'release:publish-assets:env', 'release:publish-assets:plan', 'release:publish-assets:plan:env', 'verify:github-release-publish-plan', 'verify:github-release-publish-plan:strict', 'verify:github-release-publish-plan:strict:report', 'verify:github-release-publish-plan:production', 'verify:github-release-assets:strict', 'verify:github-release-assets:strict:report', 'verify:github-release-assets:strict:env', 'verify:github-release-assets:strict:report:env']) {
    add(`npm script ${script}`, Boolean(pkg.scripts?.[script]), pkg.scripts?.[script] || 'missing');
  }
  for (const script of [
    'verify:status-refresh-report',
    'verify:status-refresh-report:strict',
    'verify:status-refresh-report:strict:report',
    'release:commercial-cutover',
    'release:commercial-cutover:final',
    'verify:commercial-cutover',
    'verify:commercial-cutover:strict',
    'verify:commercial-cutover:strict:report',
    'verify:commercial-cutover:production',
    'verify:commercial-cutover:published',
    'verify:commercial-release',
    'verify:commercial-release:strict',
    'verify:commercial-release:strict:report',
    'verify:commercial-release:production',
    'verify:commercial-release:published',
    'release:commercial-finalize',
    'release:commercial-finalize:refresh',
    'release:commercial-finalize:production',
    'release:commercial-finalize:published',
    'release:commercial-finalize:commercial',
    'verify:commercial-finalization',
    'verify:commercial-finalization:strict',
    'verify:commercial-finalization:strict:report',
    'verify:commercial-finalization:production',
    'verify:commercial-finalization:published',
    'verify:commercial-finalization:commercial',
    'verify:asset-manifest',
  ]) {
    add(`npm script ${script}`, Boolean(pkg.scripts?.[script]), pkg.scripts?.[script] || 'missing');
  }
  const evidenceScript = pkg.scripts?.['release:evidence'] || '';
  const firstSecretScan = evidenceScript.indexOf('verify:release:secret-hygiene');
  const provenanceStep = evidenceScript.indexOf('release:provenance');
  const notesStep = evidenceScript.indexOf('release:notes');
  const finalSecretScan = evidenceScript.lastIndexOf('verify:release:secret-hygiene');
  add(
    'release evidence provenance secret scan',
    firstSecretScan >= 0 && provenanceStep >= 0 && firstSecretScan < provenanceStep,
    'secret hygiene report must exist before provenance is written',
  );
  add(
    'release evidence final secret scan',
    notesStep >= 0 && finalSecretScan > notesStep,
    'secret hygiene must scan release notes and checksum artifacts after release:notes',
  );
}

function checkBaselineAccess() {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  let resolved = null;
  try {
    resolved = resolveBaselineApp();
    const resources = baselineResources(resolved);
    const asarOk = fs.existsSync(resources.asarPath) && sha256(resources.asarPath) === DEFAULT_ASAR_SHA256;
    add('local baseline app', true, resolved.source, 'warn');
    add('baseline app.asar hash', asarOk, fs.existsSync(resources.asarPath) ? sha256(resources.asarPath) : `missing: ${resources.asarPath}`);
  } catch (error) {
    add('local baseline app', false, error.message, envPresent('CONNECT_AI_BASELINE_URL') ? 'warn' : 'blocker');
  }
  add(
    'CI baseline URL',
    envPresent('CONNECT_AI_BASELINE_URL'),
    envPresent('CONNECT_AI_BASELINE_URL') ? 'CONNECT_AI_BASELINE_URL is set' : 'set CONNECT_AI_BASELINE_URL for CI',
    'warn'
  );
  if (envPresent('CONNECT_AI_BASELINE_URL')) {
    add(
      'CI baseline URL shape',
      baselineUrlLooksValid(process.env.CONNECT_AI_BASELINE_URL),
      'https URL ending in .zip',
      'warn'
    );
    add(
      'CI baseline URL version',
      String(process.env.CONNECT_AI_BASELINE_URL || '').includes(DEFAULT_VERSION),
      `URL includes ${DEFAULT_VERSION}`,
      'warn'
    );
  }
  add(
    'CI baseline SHA-256',
    envPresent('CONNECT_AI_BASELINE_SHA256') || envPresent('CONNECT_AI_ZIP_SHA256'),
    'CONNECT_AI_BASELINE_SHA256 or CONNECT_AI_ZIP_SHA256',
    'warn'
  );
  for (const name of ['CONNECT_AI_BASELINE_SHA256', 'CONNECT_AI_ZIP_SHA256']) {
    if (envPresent(name)) add(`CI ${name} shape`, sha256LooksValid(process.env[name]), '64 hex SHA-256', 'warn');
  }
  if (envPresent('CONNECT_AI_BASELINE_SHA256') && envPresent('CONNECT_AI_ZIP_SHA256')) {
    add(
      'CI baseline SHA aliases match',
      process.env.CONNECT_AI_BASELINE_SHA256.trim().toLowerCase() === process.env.CONNECT_AI_ZIP_SHA256.trim().toLowerCase(),
      'CONNECT_AI_BASELINE_SHA256 and CONNECT_AI_ZIP_SHA256 must match when both are set',
      'warn',
    );
  }
  const newerDownloads = newerDownloadedConnectArtifacts(pkg.version);
  add(
    'baseline newer downloaded app candidates',
    newerDownloads.length === 0,
    newerDownloads.map((candidate) => `${candidate.name} (${candidate.version})`).join(', ') || 'none',
  );
}

function checkSigningInputs() {
  const identity = developerIdIdentityAvailable();
  const p12Names = ['P12_PASSWORD', 'KEYCHAIN_PASSWORD'];
  const hasP12Source = envPresent('BUILD_CERTIFICATE_BASE64') || envPresent('BUILD_CERTIFICATE_PATH') || envPresent('CONNECT_AI_CERTIFICATE_BASE64') || envPresent('CONNECT_AI_CERTIFICATE_PATH');
  const certOk = identity.ok || (hasP12Source && groupComplete(p12Names));
  const missingCert = [];
  if (!identity.ok && !hasP12Source) missingCert.push('BUILD_CERTIFICATE_BASE64 or BUILD_CERTIFICATE_PATH');
  if (!identity.ok) missingCert.push(...missing(p12Names));

  add('Developer ID Application identity', identity.ok, identity.detail, certOk ? 'warn' : 'blocker');
  add('certificate import inputs', certOk, certOk ? 'certificate source is configured or already imported' : `missing ${missingCert.join(', ')}`);

  for (const name of ['BUILD_CERTIFICATE_BASE64', 'CONNECT_AI_CERTIFICATE_BASE64']) {
    if (envPresent(name)) add(`${name} base64 shape`, base64LooksValid(name), 'base64 content present without printing value');
  }
  for (const name of ['BUILD_CERTIFICATE_PATH', 'CONNECT_AI_CERTIFICATE_PATH']) {
    if (envPresent(name)) add(`${name} file`, fs.existsSync(process.env[name]), process.env[name]);
  }

  const notaryGroups = [
    ['APPLE_KEYCHAIN_PROFILE'],
    ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
    ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
    ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  ];
  const notaryOk = notaryGroups.some(groupComplete);
  const missingGroups = notaryGroups.map((group) => group.join('+')).join(' or ');
  add('notarization inputs', notaryOk, notaryOk ? 'one notarization credential group is configured' : `missing one full group: ${missingGroups}`);
  if (envPresent('APPLE_API_KEY')) add('APPLE_API_KEY file', fs.existsSync(process.env.APPLE_API_KEY), process.env.APPLE_API_KEY);
  if (envPresent('APPLE_API_KEY_BASE64')) add('APPLE_API_KEY_BASE64 base64 shape', base64LooksValid('APPLE_API_KEY_BASE64'), 'base64 content present without printing value');
}

function parseNameList(jsonText) {
  try {
    const parsed = JSON.parse(jsonText || '[]');
    return new Set(parsed.map((item) => item.name).filter(Boolean));
  } catch {
    return new Set();
  }
}

function requireNames(kind, available, names) {
  const absent = names.filter((name) => !available.has(name));
  add(`GitHub ${kind} ${names.join(', ')}`, absent.length === 0, absent.length ? `missing ${absent.join(', ')}` : 'all names present');
}

function requireAnyGroup(kind, available, groups) {
  const ok = groups.some((group) => group.every((name) => available.has(name)));
  const detail = ok ? 'one credential group is present' : `missing one full group: ${groups.map((group) => group.join('+')).join(' or ')}`;
  add(`GitHub ${kind} notarization group`, ok, detail);
}

function checkGitHubConfiguration() {
  if (!checkGitHub) return;
  const gh = commandExists('gh');
  add('GitHub CLI', Boolean(gh), gh || 'missing gh command');
  if (!gh) return;

  const auth = run('gh', ['auth', 'status'], { cwd: repoDir });
  add('GitHub CLI auth', auth.ok, auth.ok ? 'authenticated' : firstLine(auth.stderr || auth.stdout));
  if (!auth.ok) return;

  const variables = run('gh', ['variable', 'list', '--json', 'name'], { cwd: repoDir });
  const secrets = run('gh', ['secret', 'list', '--json', 'name'], { cwd: repoDir });
  add('GitHub variable list access', variables.ok, variables.ok ? 'variable names loaded' : firstLine(variables.stderr || variables.stdout));
  add('GitHub secret list access', secrets.ok, secrets.ok ? 'secret names loaded' : firstLine(secrets.stderr || secrets.stdout));
  if (!variables.ok || !secrets.ok) return;

  const variableNames = parseNameList(variables.stdout);
  const secretNames = parseNameList(secrets.stdout);
  requireNames('variable', variableNames, ['CONNECT_AI_BASELINE_URL']);
  add(
    'GitHub variable CONNECT_AI_BASELINE_SHA256',
    variableNames.has('CONNECT_AI_BASELINE_SHA256'),
    variableNames.has('CONNECT_AI_BASELINE_SHA256') ? 'present' : 'recommended for baseline integrity',
    'warn'
  );
  requireNames('secret', secretNames, ['CONNECT_AI_RELEASE_AUDIT_TOKEN', 'BUILD_CERTIFICATE_BASE64', 'P12_PASSWORD', 'KEYCHAIN_PASSWORD']);
  requireAnyGroup('secret', secretNames, [
    ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
    ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  ]);
}

function checkReleaseArtifacts() {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  const artifacts = [
    `release/Connect-AI-${pkg.version}-mac-arm64.dmg`,
    `release/Connect-AI-${pkg.version}-mac-arm64.dmg.blockmap`,
    'release/latest-mac.yml',
    'release/release-manifest.json',
    'release/release-tag-report.json',
    'release/installed-app-parity-report.json',
    'release/ui-parity-report.json',
    'release/performance-parity-report.json',
    'release/macos-security-contract.json',
    'release/ipc-security-report.json',
    'release/secret-hygiene-report.json',
    'release/dmg-install-experience.json',
    'release/release-launch-smoke.json',
    'release/release-dmg-launch-smoke.json',
    'release/update-channel-report.json',
    'release/release-env-report.json',
    'release/release-env-report.process.json',
    'release/signing-readiness.json',
    'release/security-audit-report.json',
    'release/github-release-setup-report.json',
    'release/status-refresh-report.json',
    'release/status-refresh-report-verification.strict.json',
    'release/release-setup-plan.json',
    'release/RELEASE_SETUP_PLAN.md',
    'release/release-setup-plan-report.strict.json',
    'release/release-unblock-plan.json',
    'release/release-unblock-plan-report.strict.json',
    'release/release-credential-handoff.json',
    'release/release-credential-handoff-report.strict.json',
    'release/production-readiness-summary.json',
    'release/production-readiness-summary-verification.strict.json',
    'release/release-publication-seal.json',
    'release/release-publication-seal-verification.strict.json',
    'release/engineering-readiness-report.json',
    'release/commercial-cutover-plan.json',
    'release/commercial-cutover-plan-report.strict.json',
    'release/commercial-release-readiness-report.strict.json',
    'release/commercial-finalization-report.json',
    'release/COMMERCIAL_FINALIZATION.md',
    'release/asset-manifest-report.json',
    'release/provenance.json',
    'release/sbom.cdx.json',
    'release/sbom.spdx.json',
    'release/RELEASE_NOTES.md',
    'release/SHA256SUMS.txt',
    'release/SHA512SUMS.txt',
    strict ? 'release/evidence-report.strict.json' : 'release/evidence-report.json',
  ];
  for (const relativePath of artifacts) {
    const file = path.join(desktopDir, relativePath);
    add(`artifact ${relativePath}`, fs.existsSync(file), fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'not generated yet', 'warn');
  }
}

function printReport(reportPath) {
  console.log(`Connect AI release operator checklist (${strict ? 'strict' : 'local'}${checkGitHub ? ', github' : ''})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (strict && blockers > 0 && !noExit) process.exit(1);
}

function main() {
  checkHostTooling();
  checkProjectConfig();
  checkBaselineAccess();
  checkSigningInputs();
  checkGitHubConfiguration();
  checkReleaseArtifacts();

  const pkg = readJson(path.join(desktopDir, 'package.json'));
  const summary = {
    blockers: checks.filter((check) => !check.ok && check.level === 'blocker').length,
    warnings: checks.filter((check) => !check.ok && check.level === 'warn').length,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    github: checkGitHub,
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      expectedAppAsarSha256: DEFAULT_ASAR_SHA256,
    },
    summary,
    checks,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  const reportPath = path.join(releaseDir, checkGitHub ? 'operator-readiness.github.json' : 'operator-readiness.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  printReport(reportPath);
}

main();
