import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';

const {
  DEFAULT_VERSION,
  DEFAULT_ASAR_SHA256,
  DEFAULT_ZIP_PATH,
  baselineResources,
  resolveBaselineApp,
  sha256,
} = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoDir = path.resolve(desktopDir, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const checks = [];
const NODE_ENGINE_RANGE = '>=22.12.0 <26';
const NODE_VERSION_FILE = '22.12.0';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
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
  checks.push({ name, ok: Boolean(ok), detail, level: ok ? 'pass' : level });
}

function maybeBlocker() {
  return strict ? 'blocker' : 'warn';
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function reportSummary(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = readJson(file);
    if (!parsed.summary) return null;
    return {
      blockers: Number(parsed.summary.blockers || 0),
      warnings: Number(parsed.summary.warnings || 0),
    };
  } catch {
    return null;
  }
}

function reportMeta(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function releaseEnvReportHasOnlyLocalFileAdvisory(file) {
  const report = reportMeta(file);
  if (!report || report.processEnv === true || report.strict === true) return false;
  const summary = report.summary || {};
  if (Number(summary.blockers || 0) !== 0 || Number(summary.warnings || 0) !== 1) return false;
  const failedChecks = Array.isArray(report.checks)
    ? report.checks.filter((check) => !check.ok)
    : [];
  return failedChecks.length === 1 &&
    failedChecks[0]?.name === 'release env local file' &&
    failedChecks[0]?.level === 'warn';
}

function commercialCutoverHasOnlyStatusRefreshSelfCheck(file, summary) {
  if (summary.blockers !== 1 || summary.warnings !== 0) return false;
  const report = reportMeta(file);
  if (!report || report.strict !== true) return false;
  const failedChecks = Array.isArray(report.checks)
    ? report.checks.filter((check) => check.ok !== true)
    : [];
  return failedChecks.length === 1 &&
    failedChecks[0]?.name === 'commercial cutover status refresh verification acceptable';
}

function commandExists(command) {
  const result = run('/usr/bin/which', [command], { cwd: repoDir });
  return result.ok ? result.stdout : '';
}

function parseVersion(value) {
  const match = String(value || '').match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map((part) => Number(part)) : null;
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function nodeRuntimeSatisfiesReleaseContract(version) {
  const current = parseVersion(version);
  const minimum = parseVersion('22.12.0');
  const maximum = parseVersion('26.0.0');
  return Boolean(current && compareVersion(current, minimum) >= 0 && compareVersion(current, maximum) < 0);
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
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(downloadsDir)) return [];
  return fs.readdirSync(downloadsDir)
    .filter((name) => /^Connect[- ]AI.*\.(zip|dmg)$/i.test(name))
    .map((name) => ({
      name,
      version: parseConnectArtifactVersion(name),
    }))
    .filter((candidate) => candidate.version && compareConnectVersion(candidate.version, packageVersion) > 0)
    .sort((left, right) => compareConnectVersion(right.version, left.version) || left.name.localeCompare(right.name));
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

function checkTooling() {
  add('macOS host', process.platform === 'darwin', `${process.platform}${process.arch ? `/${process.arch}` : ''}`);
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  add('Node runtime', major >= 20, nodeVersion);
  add('Node runtime release engine range', nodeRuntimeSatisfiesReleaseContract(nodeVersion), `${nodeVersion} satisfies ${NODE_ENGINE_RANGE}`);
  add('npm command', Boolean(commandExists('npm')), commandExists('npm') || 'missing');
  for (const tool of ['/usr/bin/hdiutil', '/usr/bin/security', '/usr/bin/codesign', '/usr/sbin/spctl', '/usr/bin/xcrun', '/usr/libexec/PlistBuddy']) {
    add(path.basename(tool), fs.existsSync(tool), tool);
  }
}

function checkPackage() {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  const lock = readJson(path.join(desktopDir, 'package-lock.json'));
  const nodeVersionFile = path.join(desktopDir, '.node-version');
  add('package version', pkg.version === DEFAULT_VERSION, `${pkg.version} expected ${DEFAULT_VERSION}`);
  add('package Node engine range', pkg.engines?.node === NODE_ENGINE_RANGE, pkg.engines?.node || 'missing');
  add('package-lock root Node engine range', lock.packages?.['']?.engines?.node === NODE_ENGINE_RANGE, lock.packages?.['']?.engines?.node || 'missing');
  add('.node-version release runtime', fs.existsSync(nodeVersionFile) && fs.readFileSync(nodeVersionFile, 'utf8').trim() === NODE_VERSION_FILE, fs.existsSync(nodeVersionFile) ? fs.readFileSync(nodeVersionFile, 'utf8').trim() : 'missing');
  add('package appId', pkg.build?.appId === 'ai.ezer.connect-desktop', pkg.build?.appId || 'missing');
  add('package Electron runtime', pkg.build?.electronVersion === '42.4.1', pkg.build?.electronVersion || 'missing');
  add('package afterPack restore hook', pkg.build?.afterPack === 'scripts/after-pack-restore-baseline-resources.cjs', pkg.build?.afterPack || 'missing');
  add('package notarize enabled', pkg.build?.mac?.notarize === true, String(pkg.build?.mac?.notarize));
  const publish = Array.isArray(pkg.build?.publish) ? pkg.build.publish[0] || {} : {};
  add('package publish provider', publish.provider === 'github', publish.provider || 'missing');
  add('package publish owner', publish.owner === 'wonseokjung', publish.owner || 'missing');
  add('package publish repo', publish.repo === 'connect-ai', publish.repo || 'missing');
  for (const script of ['start', 'build:dev', 'build:parity', 'restore:dev-toolchain', 'typecheck', 'smoke', 'check', 'dist', 'verify:installed', 'verify:ui', 'verify:app', 'verify:release:local', 'verify:release', 'verify:release:env', 'verify:release:macos-security', 'verify:release:ipc-security', 'verify:release:ipc-security:built', 'verify:release:secret-hygiene', 'verify:release:secret-hygiene:env', 'verify:release:dmg-install', 'verify:release:launch', 'verify:release:dmg-launch', 'verify:update-channel', 'verify:release-tag', 'verify:release:ui-parity', 'verify:release:performance-parity', 'signing:doctor', 'signing:doctor:env', 'signing:check', 'signing:check:report', 'signing:check:env', 'signing:check:report:env', 'signing:import', 'signing:import:env', 'signing:notary-profile', 'signing:notary-profile:env', 'signing:notary-profile:report', 'signing:notary-profile:report:env', 'release:env-check', 'release:env-check:strict', 'release:env-check:strict:report', 'release:env-check:process', 'release:env-check:process:strict', 'release:env-check:process:strict:report', 'release:env-bootstrap', 'verify:env-bootstrap', 'verify:env-bootstrap:strict', 'verify:env-bootstrap:strict:report', 'verify:release-env-contract', 'verify:release-env-validation', 'release:preflight', 'release:preflight:strict', 'release:preflight:strict:report', 'release:preflight:env', 'release:preflight:strict:env', 'release:preflight:strict:report:env', 'release:security-audit', 'release:manifest', 'release:baseline-freshness', 'release:baseline-freshness:strict', 'release:baseline-freshness:strict:report', 'release:baseline-export', 'verify:baseline-export', 'verify:baseline-export:strict', 'verify:baseline-export:strict:report', 'release:sbom', 'release:provenance', 'release:notes', 'release:setup-plan', 'verify:setup-plan', 'verify:setup-plan:strict', 'verify:setup-plan:strict:report', 'verify:setup-plan:production', 'release:credential-handoff', 'verify:credential-handoff', 'verify:credential-handoff:strict', 'verify:credential-handoff:strict:report', 'release:unblock-plan', 'verify:unblock-plan', 'verify:unblock-plan:strict', 'verify:unblock-plan:strict:report', 'release:publication-seal', 'release:publication-seal:strict', 'release:publication-seal:strict:report', 'verify:publication-seal-report', 'verify:publication-seal-report:strict', 'verify:publication-seal-report:strict:report', 'verify:publication-seal:production', 'verify:publication-seal:published', 'release:github-setup', 'release:github-setup:strict', 'release:github-setup:strict:report', 'release:github-setup:process', 'release:github-setup:process:strict:report', 'release:github-setup:apply', 'release:operator-runbook', 'release:operator-runbook:strict:report', 'release:operator-runbook:process:report', 'release:operator-runbook:process:strict:report', 'release:operator-runbook:apply', 'release:operator-runbook:process:apply', 'release:operator-runbook:publish', 'release:operator-runbook:process:publish', 'verify:operator-runbook-report', 'verify:operator-runbook-report:strict', 'verify:operator-runbook-report:strict:report', 'release:readiness-summary', 'release:readiness-summary:strict', 'release:readiness-summary:strict:report', 'verify:readiness-summary-report', 'verify:readiness-summary-report:strict', 'verify:readiness-summary-report:strict:report', 'release:engineering-readiness', 'release:commercial-cutover', 'release:commercial-cutover:final', 'verify:commercial-cutover', 'verify:commercial-cutover:strict', 'verify:commercial-cutover:strict:report', 'verify:commercial-cutover:production', 'verify:commercial-cutover:published', 'verify:commercial-release', 'verify:commercial-release:strict', 'verify:commercial-release:strict:report', 'verify:commercial-release:production', 'verify:commercial-release:published', 'release:commercial-finalize', 'release:commercial-finalize:refresh', 'release:commercial-finalize:production', 'release:commercial-finalize:published', 'release:commercial-finalize:commercial', 'verify:commercial-finalization', 'verify:commercial-finalization:strict', 'verify:commercial-finalization:strict:report', 'verify:commercial-finalization:production', 'verify:commercial-finalization:published', 'verify:commercial-finalization:commercial', 'release:cleanup-temp', 'release:cleanup-temp:dry-run', 'release:status-refresh', 'verify:status-refresh-report', 'verify:status-refresh-report:strict', 'verify:status-refresh-report:strict:report', 'release:evidence', 'release:evidence:local', 'release:evidence:strict', 'release:promotion-plan', 'release:asset-manifest', 'release:decision', 'release:decision:strict', 'release:decision:strict:report', 'verify:evidence', 'verify:evidence:strict', 'verify:evidence:strict:report', 'verify:asset-manifest', 'verify:asset-manifest:strict', 'release:publish-assets', 'release:publish-assets:env', 'release:publish-assets:plan', 'release:publish-assets:plan:env', 'verify:github-release-publish-plan', 'verify:github-release-publish-plan:strict', 'verify:github-release-publish-plan:strict:report', 'verify:github-release-publish-plan:production', 'verify:github-release-assets', 'verify:github-release-assets:env', 'verify:github-release-assets:strict', 'verify:github-release-assets:strict:report', 'verify:github-release-assets:strict:env', 'verify:github-release-assets:strict:report:env', 'release:github-release-remediation-plan', 'verify:github-release-remediation-plan', 'verify:github-release-remediation-plan:strict', 'verify:github-release-remediation-plan:strict:report', 'verify:github-release-remediation-plan:published', 'release:github-release-remediation-apply:plan', 'verify:github-release-remediation-apply-plan', 'verify:github-release-remediation-apply-plan:strict', 'verify:github-release-remediation-apply-plan:strict:report', 'verify:github-release-remediation-apply-plan:published', 'release:github-release-remediation-apply', 'release:github-release-remediation-apply:env', 'release:operator-checklist', 'release:operator-checklist:strict', 'release:operator-checklist:strict:report', 'release:operator-checklist:github', 'release:operator-checklist:github:strict', 'release:operator-checklist:github:strict:report', 'release:operator-checklist:env', 'release:operator-checklist:strict:env', 'release:operator-checklist:github:env', 'release:operator-checklist:github:strict:env', 'release:operator-checklist:github:strict:report:env']) {
    add(`npm script ${script}`, Boolean(pkg.scripts?.[script]), pkg.scripts?.[script] || 'missing');
  }
  const evidenceScript = pkg.scripts?.['release:evidence'] || '';
  const envContractStep = evidenceScript.indexOf('verify:release-env-contract');
  const securityAuditStep = evidenceScript.indexOf('release:security-audit');
  const manifestStep = evidenceScript.indexOf('release:manifest');
  const baselineFreshnessStep = evidenceScript.indexOf('release:baseline-freshness');
  const firstSecretScan = evidenceScript.indexOf('verify:release:secret-hygiene');
  const provenanceStep = evidenceScript.indexOf('release:provenance');
  const notesStep = evidenceScript.indexOf('release:notes');
  const finalSecretScan = evidenceScript.lastIndexOf('verify:release:secret-hygiene');
  const localEvidenceScript = pkg.scripts?.['release:evidence:local'] || '';
  const strictEvidenceScript = pkg.scripts?.['release:evidence:strict'] || '';
  add(
    'release evidence env contract chain',
    envContractStep >= 0 && securityAuditStep > envContractStep,
    'release env contract report must exist before release evidence is written',
  );
  add(
    'release evidence security audit chain',
    securityAuditStep >= 0 && manifestStep > securityAuditStep,
    'security audit report must exist before release manifest is written',
  );
  add(
    'release evidence baseline freshness chain',
    baselineFreshnessStep > manifestStep && baselineFreshnessStep < provenanceStep,
    'baseline freshness must be generated after release manifest and before provenance',
  );
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
  for (const [label, scriptText] of [
    ['local', localEvidenceScript],
    ['strict', strictEvidenceScript],
  ]) {
    const promotionStep = scriptText.indexOf('release:promotion-plan');
    const initialManifestStep = scriptText.indexOf('release:asset-manifest');
    const publishPlanStep = scriptText.indexOf('release:publish-assets:plan');
    const readinessSummaryStep = scriptText.indexOf('release:readiness-summary');
    const unblockPlanStep = scriptText.indexOf('release:unblock-plan');
    const verifyUnblockPlanStep = scriptText.indexOf('verify:unblock-plan');
    const publicationSealStep = scriptText.indexOf('release:publication-seal');
    const finalPublicationSealStep = scriptText.lastIndexOf('release:publication-seal');
    const envContractStep = scriptText.indexOf('verify:release-env-contract');
    const releaseEnvCheckStep = scriptText.indexOf(label === 'local' ? 'release:env-check' : 'release:env-check:process:strict');
    const macosSecurityStep = scriptText.indexOf('verify:release:macos-security');
    const ipcSecurityStep = scriptText.indexOf('verify:release:ipc-security');
    const dmgInstallStep = scriptText.indexOf('verify:release:dmg-install');
    const setupPlanStep = scriptText.indexOf('release:setup-plan');
    const credentialHandoffStep = scriptText.indexOf('release:credential-handoff');
    const verifyCredentialHandoffStep = scriptText.indexOf('verify:credential-handoff');
    const finalManifestStep = scriptText.lastIndexOf('release:asset-manifest');
    const verifyManifestStep = scriptText.lastIndexOf('verify:asset-manifest');
    const statusRefreshStep = scriptText.indexOf('release:status-refresh');
    const statusRefreshVerificationStep = scriptText.indexOf('verify:status-refresh-report:strict:report');
    const usesStatusRefresh = statusRefreshStep > scriptText.indexOf(label === 'local' ? 'verify:evidence:strict:report' : 'verify:evidence:strict');
    add(
      `${label} release env contract gate chain`,
      envContractStep >= 0 && releaseEnvCheckStep > envContractStep,
      'release env contract verifier runs before release env readiness checks',
    );
    add(
      `${label} release IPC security gate chain`,
      macosSecurityStep >= 0 && ipcSecurityStep > macosSecurityStep && dmgInstallStep > ipcSecurityStep,
      'macOS security -> IPC security runtime -> DMG install evidence',
    );
    add(
      `${label} release setup plan chain`,
      (usesStatusRefresh && statusRefreshVerificationStep > statusRefreshStep) || (
        promotionStep >= 0 &&
          initialManifestStep > promotionStep &&
          publishPlanStep > initialManifestStep &&
          readinessSummaryStep > publishPlanStep &&
          unblockPlanStep > readinessSummaryStep &&
          verifyUnblockPlanStep > unblockPlanStep &&
          publicationSealStep > verifyUnblockPlanStep &&
          setupPlanStep > publicationSealStep &&
          credentialHandoffStep > setupPlanStep &&
          verifyCredentialHandoffStep > credentialHandoffStep &&
          finalManifestStep > verifyCredentialHandoffStep &&
          finalPublicationSealStep > finalManifestStep &&
          verifyManifestStep > finalPublicationSealStep
      ),
      'release:status-refresh followed by verify:status-refresh-report:strict:report, or promotion -> manifest -> publish plan -> readiness summary -> unblock plan -> publication seal fixed-point refresh',
    );
  }
  const operatorScript = path.join(desktopDir, 'scripts', 'release-operator-checklist.mjs');
  const operatorText = fs.existsSync(operatorScript) ? fs.readFileSync(operatorScript, 'utf8') : '';
  const runbookScript = path.join(desktopDir, 'scripts', 'run-production-release.mjs');
  const runbookText = fs.existsSync(runbookScript) ? fs.readFileSync(runbookScript, 'utf8') : '';
  const statusRefreshScript = path.join(desktopDir, 'scripts', 'refresh-release-status.mjs');
  const statusRefreshText = fs.existsSync(statusRefreshScript) ? fs.readFileSync(statusRefreshScript, 'utf8') : '';
  const setupWriterScript = path.join(desktopDir, 'scripts', 'write-release-setup-plan.mjs');
  const setupWriterText = fs.existsSync(setupWriterScript) ? fs.readFileSync(setupWriterScript, 'utf8') : '';
  const setupVerifierScript = path.join(desktopDir, 'scripts', 'verify-release-setup-plan.mjs');
  const setupVerifierText = fs.existsSync(setupVerifierScript) ? fs.readFileSync(setupVerifierScript, 'utf8') : '';
  const credentialWriterScript = path.join(desktopDir, 'scripts', 'write-release-credential-handoff.mjs');
  const credentialWriterText = fs.existsSync(credentialWriterScript) ? fs.readFileSync(credentialWriterScript, 'utf8') : '';
  const credentialVerifierScript = path.join(desktopDir, 'scripts', 'verify-release-credential-handoff.mjs');
  const credentialVerifierText = fs.existsSync(credentialVerifierScript) ? fs.readFileSync(credentialVerifierScript, 'utf8') : '';
  const unblockWriterScript = path.join(desktopDir, 'scripts', 'write-release-unblock-plan.mjs');
  const unblockWriterText = fs.existsSync(unblockWriterScript) ? fs.readFileSync(unblockWriterScript, 'utf8') : '';
  const unblockVerifierScript = path.join(desktopDir, 'scripts', 'verify-release-unblock-plan.mjs');
  const unblockVerifierText = fs.existsSync(unblockVerifierScript) ? fs.readFileSync(unblockVerifierScript, 'utf8') : '';
  add(
    'GitHub operator checklist report isolation',
    operatorText.includes('operator-readiness.github.json') && operatorText.includes('operator-readiness.json'),
    'GitHub repository variable/secret checks must not overwrite release/operator-readiness.json',
  );
  add(
    'operator checklist production readiness script coverage',
      operatorText.includes('release:readiness-summary') &&
      operatorText.includes('release:readiness-summary:strict') &&
      operatorText.includes('release:readiness-summary:strict:report') &&
      operatorText.includes('release:unblock-plan') &&
      operatorText.includes('verify:unblock-plan') &&
      operatorText.includes('release:credential-handoff') &&
      operatorText.includes('verify:credential-handoff') &&
      operatorText.includes('release:publication-seal') &&
      operatorText.includes('verify:status-refresh-report:strict:report') &&
      operatorText.includes('release:commercial-cutover') &&
      operatorText.includes('verify:commercial-cutover:strict:report') &&
      operatorText.includes('verify:commercial-release:strict:report') &&
      operatorText.includes('verify:commercial-release:production') &&
      operatorText.includes('verify:commercial-release:published') &&
      operatorText.includes('commercial-release-readiness-report.strict.json') &&
      operatorText.includes('release:commercial-finalize') &&
      operatorText.includes('commercial-finalization-report.json') &&
      operatorText.includes('COMMERCIAL_FINALIZATION.md'),
    'operator checklist verifies production readiness, unblock plan, credential handoff, publication seal, status refresh verification, commercial cutover, commercial release readiness, and commercial finalization scripts/artifacts',
  );
  add(
    'production runbook publish readiness gate',
      runbookText.includes('production-readiness-summary.json') &&
      runbookText.includes('release-publication-seal.json') &&
      runbookText.includes('release-env-contract-report.json') &&
      runbookText.includes('release-credential-handoff.json') &&
      runbookText.includes('release-credential-handoff-report.strict.json') &&
      runbookText.includes('release:credential-handoff') &&
      runbookText.includes('verify:release-env-contract') &&
      runbookText.includes('verify:credential-handoff') &&
      runbookText.includes('pre-publish-production-gate') &&
      runbookText.includes('verify:publication-seal:production') &&
      runbookText.includes('post-publish-readiness-summary') &&
      runbookText.includes('post-publish-publication-seal') &&
      runbookText.includes('post-publish-published-gate') &&
      runbookText.includes('verify:publication-seal:published') &&
      runbookText.includes('commercial-finalization') &&
      runbookText.includes('release:commercial-finalize') &&
      runbookText.includes('enabled: !options.noExit') &&
      runbookText.includes('deferred until release:status-refresh converges') &&
      runbookText.includes('noExit: options.noExit') &&
      runbookText.includes('post-publish-commercial-finalization') &&
      runbookText.includes('release:commercial-finalize:commercial') &&
      runbookText.includes('commercial-finalization-report.json') &&
      runbookText.includes('enabled: options.confirmPublish') &&
      runbookText.includes('baseline-freshness-report.json') &&
      runbookText.includes('release:publish-assets rechecks productionReady=true') &&
      runbookText.includes('publishedReleaseReady=true') &&
      runbookText.includes('commercialReady=true'),
    'diagnostic runbook defers commercial finalization until status refresh converges; publish runbook refreshes readiness and credential handoff, checks production before upload, then refreshes and verifies published/commercial readiness after upload',
  );
	  add(
	    'release status refresh script coverage',
	      statusRefreshText.includes('release:cleanup-temp') &&
	      statusRefreshText.includes('temp-cleanup-report.json') &&
	      statusRefreshText.includes('remove stale Connect AI temp extraction artifacts before parity and release graph refresh') &&
	      statusRefreshText.includes('release:decision:strict:report') &&
      statusRefreshText.includes('release:env-check:process:strict:report') &&
      statusRefreshText.includes('signing:check:report') &&
      statusRefreshText.includes('release:operator-checklist:strict:report') &&
      statusRefreshText.includes('release:github-setup:process:strict:report') &&
      statusRefreshText.includes('release:operator-checklist:github:strict:report') &&
      statusRefreshText.includes('signing-readiness.json') &&
      statusRefreshText.includes('operator-readiness.json') &&
      statusRefreshText.includes('github-release-setup-report.json') &&
      statusRefreshText.includes('verify:release:ui-parity') &&
      statusRefreshText.includes('verify:release:performance-parity') &&
      statusRefreshText.includes('ui-parity-report.json') &&
      statusRefreshText.includes('performance-parity-report.json') &&
      statusRefreshText.includes('release:evidence') &&
      statusRefreshText.includes('verify:evidence:strict:report') &&
      statusRefreshText.includes('verify:github-release-assets') &&
      statusRefreshText.includes('verify:github-release-assets:strict:report') &&
      statusRefreshText.includes('release:github-release-remediation-plan') &&
      statusRefreshText.includes('verify:github-release-remediation-plan') &&
      statusRefreshText.includes('verify:github-release-remediation-plan:strict:report') &&
      statusRefreshText.includes('release:github-release-remediation-apply:plan') &&
      statusRefreshText.includes('github-release-remediation-apply-plan.json') &&
      statusRefreshText.includes('verify:github-release-remediation-apply-plan:strict:report') &&
      statusRefreshText.includes('github-release-remediation-apply-plan-report.strict.json') &&
      statusRefreshText.includes('release:publish-assets:plan') &&
      statusRefreshText.includes('verify:github-release-publish-plan:strict:report') &&
      statusRefreshText.includes('release:readiness-summary:strict:report') &&
      statusRefreshText.includes('verify:readiness-summary-report:strict:report') &&
      statusRefreshText.includes('release:publication-seal:strict:report') &&
      statusRefreshText.includes('verify:setup-plan:strict:report') &&
      statusRefreshText.includes('verify:publication-seal-report:strict:report') &&
      statusRefreshText.includes('release:operator-runbook:strict:report') &&
      statusRefreshText.includes('verify:operator-runbook-report:strict:report') &&
      statusRefreshText.includes('release:engineering-readiness') &&
      statusRefreshText.includes('release:commercial-cutover') &&
      statusRefreshText.includes('verify:commercial-cutover:strict:report') &&
      statusRefreshText.includes('commercial-cutover-plan-report.strict.json') &&
      statusRefreshText.includes('verify:commercial-release:strict:report') &&
      statusRefreshText.includes('commercial-release-readiness-report.strict.json') &&
      statusRefreshText.includes('production-readiness-summary-verification.strict.json') &&
      statusRefreshText.includes('release-publication-seal-verification.strict.json') &&
      statusRefreshText.includes('release-setup-plan-report.strict.json') &&
      statusRefreshText.includes('release:preflight:strict:report') &&
      statusRefreshText.includes('github-release-publish-plan-report.strict.json') &&
      statusRefreshText.includes('production-release-runbook-report.json') &&
      statusRefreshText.includes('production-release-runbook-report-verification.strict.json') &&
      statusRefreshText.includes('release:credential-handoff') &&
      statusRefreshText.includes('verify:credential-handoff:strict:report') &&
      statusRefreshText.includes('release:env-bootstrap') &&
      statusRefreshText.includes('verify:env-bootstrap:strict:report') &&
      statusRefreshText.includes('release-env-bootstrap-report.strict.json') &&
      statusRefreshText.includes('refresh production release runbook report against converged evidence') &&
      statusRefreshText.includes('verify GitHub Release publish plan schema, gate projections, manifest assets, and secret hygiene') &&
      statusRefreshText.includes('verify production readiness summary schema, status, gates, source reports, and secret hygiene') &&
      statusRefreshText.includes('verify release setup plan schema, source reports, commands, and secret hygiene') &&
      statusRefreshText.includes('verify release publication seal schema, status, gate summary, source reports, and secret hygiene') &&
      statusRefreshText.includes('verify production release runbook report schema, status, gate snapshot, blockers, and secret hygiene') &&
      statusRefreshText.includes('refresh final credential handoff from converged report graph') &&
      statusRefreshText.includes('verify final credential handoff freshness against converged report graph') &&
      statusRefreshText.includes('verify final setup plan freshness against converged report graph') &&
      statusRefreshText.includes('refresh commercial cutover plan from converged report graph') &&
      statusRefreshText.includes('verify commercial cutover plan schema, commands, source reports, and secret hygiene') &&
      statusRefreshText.includes('refresh commercial release readiness from final manifest and converged report graph') &&
      statusRefreshText.includes('refresh manifest after commercial release readiness report') &&
      statusRefreshText.includes('verify final release/CI-only asset policy after commercial release readiness') &&
      statusRefreshText.includes('refresh dry-run remote remediation apply plan without uploading') &&
      statusRefreshText.includes('verify dry-run remote remediation apply plan without uploading') &&
      statusRefreshText.includes('refresh evidence bundle, provenance, release notes, checksums, and secret hygiene after current diagnostics') &&
      statusRefreshText.includes('refresh UI and behavior parity against the current baseline before evidence hashing') &&
      statusRefreshText.includes('refresh renderer performance parity against the current baseline before evidence hashing') &&
      statusRefreshText.includes('refresh strict evidence after current evidence bundle without blocking status refresh') &&
      statusRefreshText.includes('status-refresh-report.json') &&
      statusRefreshText.includes('pass <= 2'),
	    'status refresh removes stale Connect AI temp extraction artifacts, refreshes process/local operator/signing/GitHub setup/GitHub readiness diagnostics, UI and performance parity, evidence bundle, strict evidence, converges decision/promotion/remote strict asset remediation/publish/readiness/unblock/seal reports, verifies setup plan/publication seal/production runbook/remediation apply plan, refreshes engineering readiness, final credential handoff, env bootstrap, commercial cutover, commercial release readiness, dry-run remediation apply plan, strict preflight report, and writes status-refresh-report.json',
	  );
  add(
    'release unblock commercial finalization contract',
    unblockWriterText.includes('release/commercial-release-readiness-report.strict.json') &&
      unblockWriterText.includes('release/commercial-finalization-report.json') &&
      unblockWriterText.includes('release/commercial-finalization-report-verification.strict.json') &&
      unblockWriterText.includes('release:commercial-finalize:commercial') &&
      unblockWriterText.includes('verify:commercial-finalization:commercial') &&
      unblockWriterText.includes('publishedReleaseReady=true requires commercial readiness to be clean and commercialReady=true') &&
      unblockVerifierText.includes('release unblock commercial finalization source reports') &&
      unblockVerifierText.includes('release unblock publish group commercial finalization source coverage') &&
      unblockVerifierText.includes('release unblock publish group commercial finalization commands') &&
      unblockVerifierText.includes('release unblock commercial finalization reports verified') &&
      unblockVerifierText.includes('commercialReadyRequired') &&
      unblockVerifierText.includes('release:commercial-finalize:commercial') &&
      unblockVerifierText.includes('verify:commercial-finalization:commercial'),
    'unblock plan writer and verifier retain publication-stage commercial finalization source reports, commands, and commercialReady enforcement',
  );
  add(
    'release setup and credential commercial finalization contract',
    setupWriterText.includes('release/commercial-finalization-report-verification.strict.json') &&
      setupWriterText.includes('verify:commercial-finalization:commercial') &&
      setupVerifierText.includes('release/commercial-finalization-report-verification.strict.json') &&
      setupVerifierText.includes('npm run verify:commercial-finalization:commercial') &&
      credentialWriterText.includes('release/commercial-finalization-report-verification.strict.json') &&
      credentialWriterText.includes('verify:commercial-finalization:commercial') &&
      credentialVerifierText.includes('release/commercial-finalization-report-verification.strict.json') &&
      credentialVerifierText.includes('verify:commercial-finalization:commercial'),
    'setup plan and credential handoff writer/verifier retain commercial finalization verification source and explicit final commercial verification command',
  );
}

function checkBaseline() {
  try {
    const pkg = readJson(path.join(desktopDir, 'package.json'));
    const baseline = resolveBaselineApp();
    const resources = baselineResources(baseline);
    add('baseline source', true, baseline.source);
    const explicitBaseline = Boolean(process.env.CONNECT_AI_APP || process.env.CONNECT_AI_ZIP);
    const defaultZipExists = fs.existsSync(DEFAULT_ZIP_PATH);
    add(
      'baseline current download zip priority',
      explicitBaseline || !defaultZipExists || (baseline.fromZip === true && path.resolve(baseline.source) === path.resolve(DEFAULT_ZIP_PATH)),
      defaultZipExists
        ? `default zip=${DEFAULT_ZIP_PATH}, selected=${baseline.source}, reason=${baseline.selectionReason || 'missing'}`
        : `default zip missing; selected=${baseline.source}, reason=${baseline.selectionReason || 'missing'}`,
    );
    add('baseline app.asar exists', fs.existsSync(resources.asarPath), resources.asarPath);
    if (fs.existsSync(resources.asarPath)) {
      const actual = sha256(resources.asarPath);
      add('baseline app.asar hash', actual === DEFAULT_ASAR_SHA256, actual);
    }
    add('baseline app.asar.unpacked', fs.existsSync(path.join(resources.resourcesDir, 'app.asar.unpacked')), path.join(resources.resourcesDir, 'app.asar.unpacked'));
    add(
      'baseline llama.cpp resources',
      fs.existsSync(path.join(resources.resourcesDir, 'llamacpp', 'mac-arm64', 'llama-server')) &&
        fs.existsSync(path.join(resources.resourcesDir, 'llamacpp', 'mac-x64', 'llama-server')),
      path.join(resources.resourcesDir, 'llamacpp'),
    );
    const newerDownloads = newerDownloadedConnectArtifacts(pkg.version);
    add(
      'baseline newer downloaded app candidates',
      newerDownloads.length === 0,
      newerDownloads.map((candidate) => `${candidate.name} (${candidate.version})`).join(', ') || 'none',
    );
  } catch (error) {
    add('baseline source', false, error.message);
  }
}

function checkWorkflow() {
  const workflow = path.join(repoDir, '.github', 'workflows', 'build-desktop.yml');
  add('GitHub Actions workflow', fs.existsSync(workflow), path.relative(repoDir, workflow));
  if (fs.existsSync(workflow)) {
    const text = fs.readFileSync(workflow, 'utf8');
    const publishScript = path.join(desktopDir, 'scripts', 'publish-github-release-assets.mjs');
    const publishText = fs.existsSync(publishScript) ? fs.readFileSync(publishScript, 'utf8') : '';
    const stepIndex = (name) => text.indexOf(`- name: ${name}`);
    const stepOrder = (before, after) => {
      const beforeIndex = stepIndex(before);
      const afterIndex = stepIndex(after);
      return beforeIndex >= 0 && afterIndex > beforeIndex;
    };
    add('workflow operator checklist', text.includes('npm run release:operator-checklist:strict'), 'npm run release:operator-checklist:strict');
    add('workflow Node runtime contract', text.includes("node-version: '22.12.0'"), 'setup-node 22.12.0');
    add('workflow signing preflight', text.includes('setup-macos-signing.mjs --import-p12 --restore-api-key --check --strict'), 'setup-macos-signing.mjs strict step');
    add('workflow release tag verification', text.includes('npm run verify:release-tag') && text.includes('release-tag-report.json'), 'verify package version and release tag before signing');
    add(
      'workflow clean CI build-before-release-graph order',
      stepOrder('Typecheck', 'Smoke test') &&
        stepOrder('Smoke test', 'Build signed DMG') &&
        stepOrder('Build signed DMG', 'Strict release verification') &&
        stepOrder('Strict release verification', 'Refresh release status graph') &&
        stepOrder('Refresh release status graph', 'Verify release status graph') &&
        stepOrder('Verify release status graph', 'Commercial cutover plan') &&
        stepOrder('Commercial cutover plan', 'Finalize commercial release status') &&
        stepOrder('Finalize commercial release status', 'Release preflight') &&
        stepOrder('Release preflight', 'Upload build artifacts'),
      'clean checkout must build and strictly verify the DMG before status refresh, commercial finalization, strict preflight, and artifact upload',
    );
    add(
      'workflow no blocking release artifact gate before DMG build',
      stepOrder('Build signed DMG', 'Release preflight') &&
        stepOrder('Build signed DMG', 'Refresh release status graph') &&
        stepOrder('Build signed DMG', 'Commercial cutover plan') &&
        stepOrder('Build signed DMG', 'Finalize commercial release status'),
      'strict preflight/status refresh/commercial gates run only after the release DMG has been produced',
    );
    add('workflow baseline freshness evidence', text.includes('baseline-freshness-report.json') && text.includes('BASELINE_FRESHNESS.md'), 'baseline freshness report is retained as release evidence');
    add('workflow baseline export evidence', text.includes('npm run release:baseline-export') && text.includes('npm run verify:baseline-export:strict:report') && text.includes('baseline-export-report.json') && text.includes('baseline-export-report-verification.strict.json') && text.includes('BASELINE_EXPORT.md'), 'baseline export report is generated from the downloaded baseline ZIP, verified, and retained as CI diagnostic');
    add('workflow installed app parity evidence', text.includes('installed-app-parity-report.json'), 'installed app parity report uploaded as release evidence');
    add('workflow UI parity evidence', text.includes('ui-parity-report.json'), 'UI parity report uploaded as release evidence');
    add('workflow performance parity evidence', text.includes('performance-parity-report.json'), 'performance parity report uploaded as release evidence');
    add('workflow IPC security evidence', text.includes('ipc-security-report.json'), 'IPC security report uploaded as release evidence');
    add('workflow post-signing operator checklist', (text.match(/npm run release:operator-checklist:strict/g) || []).length >= 2, 'operator checklist before and after signing import');
    add('workflow GitHub operator checklist', text.includes('npm run release:operator-checklist:github:strict') && text.includes('operator-readiness.github.json'), 'GitHub repository variable/secret readiness report is generated and uploaded');
    add('workflow release setup plan', text.includes('npm run release:setup-plan') && text.includes('release-setup-plan.json') && text.includes('RELEASE_SETUP_PLAN.md'), 'release setup plan is generated and uploaded as CI diagnostic');
    add('workflow release setup plan verification', text.includes('npm run verify:setup-plan:strict:report') && text.includes('release-setup-plan-report.strict.json'), 'release setup plan is verified and uploaded as CI diagnostic');
    add(
      'workflow release credential handoff',
      text.includes('npm run release:credential-handoff') &&
        text.includes('npm run verify:credential-handoff:strict:report') &&
        text.includes('release-credential-handoff.json') &&
        text.includes('RELEASE_CREDENTIAL_HANDOFF.md') &&
        text.includes('release-credential-handoff-report.strict.json'),
      'release credential handoff is generated, strictly verified, and uploaded as CI diagnostic',
    );
    add('workflow GitHub Release publish plan verification', text.includes('npm run release:publish-assets:plan') && text.includes('npm run verify:github-release-publish-plan:strict:report') && text.includes('github-release-publish-plan.json') && text.includes('github-release-publish-plan-report.strict.json'), 'GitHub Release publish plan is generated, verified, and uploaded as CI diagnostic');
    add('workflow production readiness summary', text.includes('npm run release:readiness-summary:strict:report') && text.includes('production-readiness-summary.json') && text.includes('PRODUCTION_READINESS_SUMMARY.md'), 'production readiness summary is generated and uploaded as CI diagnostic');
    add('workflow production readiness summary verification', text.includes('npm run verify:readiness-summary-report:strict:report') && text.includes('production-readiness-summary-verification.strict.json'), 'production readiness summary is verified and uploaded as CI diagnostic');
    add('workflow engineering readiness summary', text.includes('npm run release:engineering-readiness') && text.includes('engineering-readiness-report.json') && text.includes('ENGINEERING_READINESS.md'), 'engineering readiness report is generated and uploaded as CI diagnostic');
    add('workflow commercial cutover plan', text.includes('npm run release:commercial-cutover:final') && text.includes('npm run verify:status-refresh-report:strict:report') && text.includes('npm run verify:commercial-cutover:strict:report') && text.includes('commercial-cutover-plan.json') && text.includes('COMMERCIAL_CUTOVER_PLAN.md') && text.includes('commercial-cutover-plan-report.strict.json'), 'commercial cutover plan is generated after status refresh verification, verified, and uploaded as CI diagnostic');
    add('workflow commercial release readiness', text.includes('npm run verify:commercial-release:strict:report') && text.includes('commercial-release-readiness-report.strict.json'), 'commercial release readiness is verified and uploaded as CI diagnostic');
    add('workflow commercial finalization', text.includes('npm run release:commercial-finalize') && text.includes('commercial-finalization-report.json') && text.includes('COMMERCIAL_FINALIZATION.md') && text.includes('commercial-finalization-report-verification.strict.json'), 'commercial finalization reruns status verification, commercial cutover verification, commercial readiness, asset manifest, and finalization verification after commercial readiness is refreshed');
    add(
      'workflow release unblock plan',
      text.includes('npm run release:unblock-plan') &&
        text.includes('npm run verify:unblock-plan:strict:report') &&
        text.includes('release-unblock-plan.json') &&
        text.includes('RELEASE_UNBLOCK_PLAN.md') &&
        text.includes('release-unblock-plan-report.strict.json'),
      'release unblock plan is generated, strictly verified, and uploaded as CI diagnostic',
    );
    add('workflow release publication seal', text.includes('npm run release:publication-seal:strict:report') && text.includes('release-publication-seal.json') && text.includes('RELEASE_PUBLICATION_SEAL.md'), 'release publication seal is generated and uploaded as CI diagnostic');
    add('workflow release publication seal verification', text.includes('npm run verify:publication-seal-report:strict:report') && text.includes('release-publication-seal-verification.strict.json'), 'release publication seal is verified and uploaded as CI diagnostic');
    add('workflow production runbook report verification', text.includes('npm run verify:operator-runbook-report:strict:report') && text.includes('production-release-runbook-report-verification.strict.json'), 'production runbook report is verified and uploaded as CI diagnostic');
    add('workflow release status refresh', text.includes('npm run release:status-refresh') && text.includes('temp-cleanup-report.json') && text.includes('status-refresh-report.json'), 'release status graph removes stale temp extraction artifacts, refreshes, and is retained as CI diagnostic');
    add('workflow release status refresh verification', text.includes('npm run verify:status-refresh-report:strict:report') && text.includes('status-refresh-report-verification.strict.json'), 'release status graph is verified and retained as CI diagnostic');
    add('workflow strict preflight diagnostic report', text.includes('npm run release:preflight:strict:report') && text.includes('preflight-report.strict.json'), 'strict preflight report is refreshed before the blocking strict preflight gate');
    add('workflow GitHub Release remediation plan', text.includes('npm run release:github-release-remediation-plan') && text.includes('npm run release:asset-manifest') && text.includes('npm run verify:github-release-remediation-plan') && text.includes('npm run release:github-release-remediation-apply:plan') && text.includes('npm run verify:github-release-remediation-apply-plan:strict:report') && text.includes('github-release-remediation-plan.json') && text.includes('GITHUB_RELEASE_REMEDIATION_PLAN.md') && text.includes('github-release-remediation-plan-report.json') && text.includes('github-release-remediation-apply-plan.json') && text.includes('github-release-remediation-apply-plan-report.strict.json'), 'GitHub Release remediation plan is generated, manifest-refreshed, verified, dry-run apply planned, dry-run apply verified, and uploaded as CI diagnostic');
    add('workflow GitHub audit token', text.includes('CONNECT_AI_RELEASE_AUDIT_TOKEN') && text.includes('GH_TOKEN'), 'GitHub readiness can use a fine-grained audit token');
    add('workflow GitHub readiness required', text.includes('CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS') && text.includes("'1'"), 'publish and decision gates require GitHub readiness in CI');
    add('workflow strict release verification', text.includes('npm run verify:release'), 'npm run verify:release');
    add('workflow release env contract verifier', text.includes('npm run verify:release-env-contract') && text.includes('release-env-contract-report.json'), 'release env contract is verified and retained');
    add('workflow release env bootstrap', text.includes('npm run release:env-bootstrap') && text.includes('npm run verify:env-bootstrap:strict:report') && text.includes('release-env-bootstrap.json') && text.includes('RELEASE_ENV_BOOTSTRAP.md') && text.includes('release-env.local.template'), 'release env bootstrap is generated, verified, and retained');
    add(
      'workflow release env diagnostics always uploaded',
      text.includes('Upload release environment diagnostics') &&
        text.includes('if: always()') &&
        text.includes('release-env-contract-report.json') &&
        text.includes('release-env-report.process.json') &&
        text.includes('release-setup-plan-report.strict.json') &&
        text.includes('release-unblock-plan-report.strict.json') &&
        text.includes('release-credential-handoff-report.strict.json') &&
        text.includes('release-env-bootstrap.json') &&
        text.includes('release-env-bootstrap-report.strict.json') &&
        text.includes('github-release-setup-report.json'),
      'release env contract, env report, setup/unblock/credential strict reports, env bootstrap, and GitHub setup reports are retained when env readiness fails',
    );
    add('workflow preflight diagnostics always uploaded', text.includes('Upload preflight diagnostics') && text.includes('if: always()') && text.includes('temp-cleanup-report.json') && text.includes('preflight-report.strict.json') && text.includes('release-env-contract-report.json') && text.includes('release-env-bootstrap.json') && text.includes('release-env-bootstrap-report.strict.json') && text.includes('status-refresh-report.json') && text.includes('status-refresh-report-verification.strict.json') && text.includes('github-release-assets-report.strict.json') && text.includes('github-release-publish-plan.json') && text.includes('github-release-publish-plan-report.strict.json') && text.includes('github-release-remediation-plan.json') && text.includes('github-release-remediation-plan-report.json') && text.includes('github-release-remediation-apply-plan.json') && text.includes('github-release-remediation-apply-plan-report.strict.json') && text.includes('operator-readiness.json') && text.includes('operator-readiness.github.json') && text.includes('signing-readiness.json') && text.includes('github-release-setup-report.json') && text.includes('production-release-runbook-report.json') && text.includes('production-release-runbook-report-verification.strict.json') && text.includes('production-readiness-summary.json') && text.includes('production-readiness-summary-verification.strict.json') && text.includes('engineering-readiness-report.json') && text.includes('ENGINEERING_READINESS.md') && text.includes('commercial-cutover-plan.json') && text.includes('COMMERCIAL_CUTOVER_PLAN.md') && text.includes('commercial-cutover-plan-report.strict.json') && text.includes('commercial-release-readiness-report.strict.json') && text.includes('commercial-finalization-report.json') && text.includes('COMMERCIAL_FINALIZATION.md') && text.includes('commercial-finalization-report-verification.strict.json') && text.includes('release-setup-plan.json') && text.includes('release-setup-plan-report.strict.json') && text.includes('release-credential-handoff.json') && text.includes('release-credential-handoff-report.strict.json') && text.includes('release-unblock-plan.json') && text.includes('release-unblock-plan-report.json') && text.includes('release-unblock-plan-report.strict.json') && text.includes('release-publication-seal.json') && text.includes('release-publication-seal-verification.strict.json') && text.includes('baseline-export-report.json') && text.includes('baseline-export-report-verification.strict.json') && text.includes('BASELINE_EXPORT.md'), 'preflight, temp cleanup, release env contract/bootstrap, status refresh, status refresh verification, strict GitHub asset drift, GitHub publish plan, GitHub publish plan verification, GitHub release remediation, GitHub release remediation apply plan, GitHub release remediation apply plan verification, GitHub setup, local/GitHub operator readiness, signing readiness, production runbook, production runbook verification, production readiness, engineering readiness, commercial cutover, commercial release readiness, commercial finalization and verification, production readiness verification, setup plan, setup plan verification, credential handoff, credential handoff verification, unblock plan, unblock verification, publication seal, publication seal verification, baseline export verification, and GitHub readiness reports are retained when preflight fails');
    add('workflow release artifact upload', text.includes('temp-cleanup-report.json') && text.includes('preflight-report.strict.json') && text.includes('release-manifest.json') && text.includes('release-tag-report.json') && text.includes('baseline-freshness-report.json') && text.includes('BASELINE_FRESHNESS.md') && text.includes('baseline-export-report.json') && text.includes('baseline-export-report-verification.strict.json') && text.includes('BASELINE_EXPORT.md') && text.includes('installed-app-parity-report.json') && text.includes('ui-parity-report.json') && text.includes('performance-parity-report.json') && text.includes('macos-security-contract.json') && text.includes('ipc-security-report.json') && text.includes('security-audit-report.json') && text.includes('release-env-contract-report.json') && text.includes('release-env-bootstrap.json') && text.includes('release-env-bootstrap-report.strict.json') && text.includes('status-refresh-report.json') && text.includes('status-refresh-report-verification.strict.json') && text.includes('github-release-assets-report.strict.json') && text.includes('github-release-publish-plan.json') && text.includes('github-release-publish-plan-report.strict.json') && text.includes('github-release-remediation-plan.json') && text.includes('github-release-remediation-plan-report.json') && text.includes('github-release-remediation-apply-plan.json') && text.includes('github-release-remediation-apply-plan-report.strict.json') && text.includes('release-env-report.process.json') && text.includes('secret-hygiene-report.json') && text.includes('dmg-install-experience.json') && text.includes('release-launch-smoke.json') && text.includes('release-dmg-launch-smoke.json') && text.includes('release-decision.strict.json') && text.includes('operator-readiness.json') && text.includes('operator-readiness.github.json') && text.includes('signing-readiness.json') && text.includes('production-release-runbook-report.json') && text.includes('production-release-runbook-report-verification.strict.json') && text.includes('production-readiness-summary.json') && text.includes('PRODUCTION_READINESS_SUMMARY.md') && text.includes('production-readiness-summary-verification.strict.json') && text.includes('engineering-readiness-report.json') && text.includes('ENGINEERING_READINESS.md') && text.includes('commercial-cutover-plan.json') && text.includes('COMMERCIAL_CUTOVER_PLAN.md') && text.includes('commercial-cutover-plan-report.strict.json') && text.includes('commercial-release-readiness-report.strict.json') && text.includes('commercial-finalization-report.json') && text.includes('COMMERCIAL_FINALIZATION.md') && text.includes('commercial-finalization-report-verification.strict.json') && text.includes('release-setup-plan.json') && text.includes('RELEASE_SETUP_PLAN.md') && text.includes('release-setup-plan-report.strict.json') && text.includes('release-credential-handoff.json') && text.includes('RELEASE_CREDENTIAL_HANDOFF.md') && text.includes('release-credential-handoff-report.strict.json') && text.includes('release-unblock-plan.json') && text.includes('RELEASE_UNBLOCK_PLAN.md') && text.includes('release-unblock-plan-report.strict.json') && text.includes('release-publication-seal.json') && text.includes('RELEASE_PUBLICATION_SEAL.md') && text.includes('release-publication-seal-verification.strict.json') && text.includes('release-promotion-plan.json') && text.includes('RELEASE_PROMOTION_PLAN.md') && text.includes('release-asset-manifest.json') && text.includes('asset-manifest-report.strict.json') && text.includes('provenance.json') && text.includes('RELEASE_NOTES.md') && text.includes('SHA256SUMS.txt') && text.includes('update-channel-report.json') && text.includes('sbom.cdx.json') && text.includes('evidence-report.strict.json') && text.includes('Connect-AI-0.4.8-mac-arm64.dmg'), 'DMG/blockmap/latest-mac/temp cleanup/preflight/manifest/tag/baseline freshness/baseline export/baseline export verification/installed app parity/UI parity/performance parity/macOS security/IPC security/security audit/env contract/env bootstrap/status refresh/status refresh verification/GitHub strict asset drift/GitHub publish plan/publish plan verification/GitHub remediation/GitHub remediation apply plan/GitHub remediation apply plan verification/env/secret hygiene/DMG install/app launch/DMG launch/decision/local operator readiness/GitHub readiness/signing readiness/production runbook/runbook verification/readiness/readiness verification/engineering readiness/commercial cutover/commercial release readiness/commercial finalization/finalization verification/setup/setup verification/credential handoff/unblock/publication seal/seal verification/promotion/asset manifest/provenance/notes/checksums/update channel/SBOM/evidence report');
    add('workflow manifest-driven release publish', text.includes('npm run release:publish-assets -- --tag "${TAG}"'), 'npm run release:publish-assets -- --tag "${TAG}"');
    add(
      'publish production readiness summary gate',
      publishText.includes('productionReadinessStatus') &&
        publishText.includes('publicationSealStatus') &&
        publishText.includes('releaseManifestSecurityStatus') &&
        publishText.includes('baselineFreshnessStatus') &&
        publishText.includes('baselineExportVerificationStatus') &&
        publishText.includes('current production readiness summary production-ready') &&
        publishText.includes('current release publication seal production-ready') &&
        publishText.includes('current release manifest signed and notarized') &&
        publishText.includes('current baseline freshness clean') &&
        publishText.includes('current baseline export verification clean') &&
        publishText.includes('production readiness strict decision freshness') &&
        publishText.includes('production readiness promotion freshness') &&
        publishText.includes('production readiness baseline freshness') &&
        publishText.includes('production readiness baseline export verification') &&
        publishText.includes('publication seal baseline freshness') &&
        publishText.includes('publication seal baseline export verification'),
      'publish plan requires fresh production-readiness-summary.json, release-publication-seal.json, release-manifest.json, baseline-freshness-report.json, and baseline-export verification before upload',
    );
    add(
      'workflow published release asset verification',
      text.includes('npm run verify:github-release-assets:strict') &&
        text.includes('npm run release:readiness-summary:strict:report') &&
        text.includes('npm run verify:readiness-summary-report:strict:report') &&
        text.includes('npm run release:publication-seal:strict:report') &&
        text.includes('npm run verify:publication-seal:published') &&
        text.includes('npm run release:commercial-finalize:commercial') &&
        text.includes('github-release-assets-report.strict.json') &&
        text.includes('github-release-publish-plan.json') &&
        text.includes('github-release-publish-plan-report.strict.json') &&
        text.includes('github-release-remediation-plan.json') &&
        text.includes('github-release-remediation-plan-report.strict.json') &&
        text.includes('baseline-freshness-report.json') &&
        text.includes('BASELINE_FRESHNESS.md') &&
        text.includes('baseline-export-report.json') &&
        text.includes('baseline-export-report-verification.strict.json') &&
        text.includes('BASELINE_EXPORT.md') &&
        text.includes('production-readiness-summary.json') &&
        text.includes('PRODUCTION_READINESS_SUMMARY.md') &&
        text.includes('production-readiness-summary-verification.strict.json') &&
        text.includes('commercial-finalization-report.json') &&
        text.includes('COMMERCIAL_FINALIZATION.md') &&
        text.includes('commercial-finalization-report-verification.strict.json') &&
        text.includes('release-publication-seal.json') &&
        text.includes('RELEASE_PUBLICATION_SEAL.md'),
      'verify uploaded GitHub Release assets, refresh readiness/publication seal, require published-ready, require commercial-ready finalization, verify finalization, and retain baseline/readiness reports',
    );
  }
}

function checkAppAsarPolicy() {
  const policyModule = path.join(desktopDir, 'scripts', 'app-asar-policy.mjs');
  const afterPack = path.join(desktopDir, 'scripts', 'after-pack-restore-baseline-resources.cjs');
  const electronBuilderRunner = path.join(desktopDir, 'scripts', 'run-electron-builder.mjs');
  const manifestWriter = path.join(desktopDir, 'scripts', 'write-release-manifest.mjs');
  const decisionWriter = path.join(desktopDir, 'scripts', 'write-release-decision.mjs');
  const publishAssets = path.join(desktopDir, 'scripts', 'publish-github-release-assets.mjs');
  const publishPlanVerifier = path.join(desktopDir, 'scripts', 'verify-github-release-publish-plan.mjs');
  const commercialVerifier = path.join(desktopDir, 'scripts', 'verify-commercial-release-readiness.mjs');
  const publicationSealWriter = path.join(desktopDir, 'scripts', 'write-release-publication-seal.mjs');
  const baselineFreshnessWriter = path.join(desktopDir, 'scripts', 'write-baseline-freshness-report.mjs');
  const dmgInstallVerifier = path.join(desktopDir, 'scripts', 'verify-dmg-install-experience.mjs');
  const evidenceVerifier = path.join(desktopDir, 'scripts', 'verify-release-evidence.mjs');
  const readinessVerifier = path.join(desktopDir, 'scripts', 'verify-release-readiness.mjs');
  const provenanceWriter = path.join(desktopDir, 'scripts', 'write-release-provenance.mjs');
  const notesWriter = path.join(desktopDir, 'scripts', 'write-release-notes.mjs');

  const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const policyText = read(policyModule);
  const afterPackText = read(afterPack);
  const electronBuilderRunnerText = read(electronBuilderRunner);
  const manifestText = read(manifestWriter);
  const decisionText = read(decisionWriter);
  const publishAssetsText = read(publishAssets);
  const publishPlanVerifierText = read(publishPlanVerifier);
  const commercialVerifierText = read(commercialVerifier);
  const publicationSealText = read(publicationSealWriter);
  const baselineFreshnessText = read(baselineFreshnessWriter);
  const dmgInstallText = read(dmgInstallVerifier);
  const evidenceText = read(evidenceVerifier);
  const readinessText = read(readinessVerifier);
  const provenanceText = read(provenanceWriter);
  const notesText = read(notesWriter);

  add('app.asar policy module', fs.existsSync(policyModule), path.relative(desktopDir, policyModule));
  add(
    'app.asar approved hardening policy exports',
    policyText.includes('APPROVED_MAIN_DELTA_ID') &&
      policyText.includes('APPROVED_MAIN_DELTA_SOURCE') &&
      policyText.includes('APPROVED_MAIN_DELTA_MARKERS') &&
      policyText.includes('approveMainProcessSecurityDeltaFromAsar') &&
      policyText.includes('appAsarContentOk') &&
      policyText.includes('appAsarPolicyDetail'),
    'shared policy exports approved source, marker coverage, asar comparison, and content gate helpers',
  );
  add(
    'afterPack preserves built app.asar',
    afterPackText.includes('Built app.asar missing before afterPack hardening') &&
      afterPackText.includes('Preserved built app.asar') &&
      !afterPackText.includes('fs.copyFileSync(baselineRes.asarPath') &&
      !afterPackText.includes('fs.cpSync(baselineRes.asarPath') &&
      !afterPackText.includes('fs.copyFileSync(baselineRes.asarPath'),
    'afterPack must not overwrite built app.asar with the baseline archive',
  );
  add(
    'afterPack restores baseline unpacked resources',
    afterPackText.includes('sourceUnpacked') &&
      afterPackText.includes('app.asar.unpacked') &&
      afterPackText.includes('fs.cpSync(sourceUnpacked, destUnpacked'),
    'baseline app.asar.unpacked resources are restored while app.asar stays built',
  );
  add(
    'afterPack restores baseline llama.cpp resources',
    afterPackText.includes('sourceLlamacpp') &&
      afterPackText.includes("path.join(baselineRes.resourcesDir, 'llamacpp')") &&
      afterPackText.includes('Baseline llama.cpp resources missing') &&
      afterPackText.includes('fs.cpSync(sourceLlamacpp, destLlamacpp'),
    'baseline top-level Resources/llamacpp is restored for packaged local llama-server parity',
  );
  add(
    'electron builder local ad-hoc signing guard',
    electronBuilderRunnerText.includes('CONNECT_AI_ADHOC_SIGN_APP') &&
      electronBuilderRunnerText.includes('hasDeveloperIdIdentity') &&
      electronBuilderRunnerText.includes('hasProductionSigningMaterial') &&
      electronBuilderRunnerText.includes("env.CONNECT_AI_ADHOC_SIGN_APP = '1'"),
    'local packaging enables ad-hoc app signing only when Developer ID production signing material is absent',
  );
  add(
    'afterPack ad-hoc signs local app bundle',
    afterPackText.includes('CONNECT_AI_ADHOC_SIGN_APP') &&
      afterPackText.includes("'--options', 'runtime'") &&
      afterPackText.includes("'--entitlements', entitlements") &&
      afterPackText.includes("'--sign', '-'") &&
      afterPackText.includes('Applied ad-hoc hardened-runtime signature'),
    'local unsigned builds are ad-hoc signed after resource hardening so codesign resource seal and entitlements are verifiable',
  );
  add(
    'release manifest app.asar policy evidence',
    manifestText.includes('approveMainProcessSecurityDeltaFromAsar') &&
      manifestText.includes('summarizeAppAsarPolicy') &&
      manifestText.includes('appAsarPolicy') &&
      manifestText.includes('appAsarContentOk'),
    'release/release-manifest.json records appAsarPolicy and content gate status',
  );
  add(
    'production Developer ID signature gate',
    manifestText.includes('codeSignatureSummary') &&
      manifestText.includes('Developer ID Application:') &&
      decisionText.includes('codeSignature?.developerId === true') &&
      notesText.includes('Release app Developer ID signature') &&
      evidenceText.includes('manifest Developer ID signature') &&
      publishAssetsText.includes('Developer ID signature') &&
      publishPlanVerifierText.includes('codeSignature?.developerId === true') &&
      commercialVerifierText.includes('codeSignature?.developerId === true') &&
      publicationSealText.includes('codeSignature?.developerId === true'),
    'manifest, notes, evidence, publish, commercial, and publication seal gates distinguish Developer ID signing from local ad-hoc signing',
  );
  add(
    'baseline freshness app.asar policy gate',
    baselineFreshnessText.includes('release app.asar baseline or approved hardening') &&
      baselineFreshnessText.includes('releaseAppAsarPolicy') &&
      baselineFreshnessText.includes('releaseAppAsarApprovedDelta'),
    'baseline freshness accepts exact baseline app.asar or approved hardening delta',
  );
  add(
    'baseline freshness newer download gate',
    baselineFreshnessText.includes('newer download candidates require package upgrade') &&
      baselineFreshnessText.includes('newerThanPackageCount'),
    'baseline freshness blocks when Downloads contains a newer Connect AI zip or dmg than package.json',
  );
  add(
    'DMG install app.asar policy evidence',
    dmgInstallText.includes('appAsarPolicy') &&
      dmgInstallText.includes('inspectedAppAsars') &&
      dmgInstallText.includes('approveMainProcessSecurityDeltaFromAsar'),
    'DMG install report records mounted/copied app.asar policy evidence',
  );
  add(
    'DMG install code signature evidence',
    dmgInstallText.includes('inspectCodeSignature') &&
      dmgInstallText.includes('code signature resource seal') &&
      dmgInstallText.includes('signed entitlement allowlist') &&
      evidenceText.includes('DMG install mounted app code signature seal') &&
      evidenceText.includes('DMG install copied app signed entitlement allowlist'),
    'DMG install and release evidence require mounted/copied app codesign seal and entitlement allowlist checks',
  );
  add(
    'release readiness app.asar policy gate',
    readinessText.includes('approveMainProcessSecurityDeltaFromAsar') &&
      readinessText.includes('release app.asar parity') &&
      readinessText.includes('DMG app.asar hash') &&
      readinessText.includes('appAsarContentOk'),
    'local/strict release readiness accepts only baseline or approved app.asar hardening policy',
  );
  add(
    'release readiness llama.cpp resource gate',
    readinessText.includes('baseline llama.cpp resources') &&
      readinessText.includes('checkLlamacppResourceParity') &&
      readinessText.includes('release llama.cpp resources parity') &&
      readinessText.includes('DMG llama.cpp resources parity') &&
      readinessText.includes('releaseAbsoluteLinks') &&
      readinessText.includes('releaseBrokenLinks'),
    'local/strict release readiness verifies packaged top-level Resources/llamacpp file set, symlinks, and launcher parity',
  );
  add(
    'release evidence app.asar policy gate',
    evidenceText.includes('manifestAppAsarOk') &&
      evidenceText.includes('manifest.release?.appAsarPolicy') &&
      evidenceText.includes('DMG install app.asar hash') &&
      evidenceText.includes('provenance release app.asar'),
    'release evidence verifies manifest, baseline freshness, DMG install, and provenance against appAsarPolicy',
  );
  add(
    'release notes/provenance app.asar policy evidence',
    notesText.includes('Release app.asar policy') &&
      notesText.includes('appAsarContentOk') &&
      provenanceText.includes('appAsarPolicy') &&
      provenanceText.includes('appAsarContentOk'),
    'release notes and provenance retain app.asar policy context',
  );
}

function hasStaleSecretHygieneReleaseAssetText(text) {
  const secretReportName = 'secret-hygiene-report.json';
  const githubReleaseAssetLabel = ['GitHub Release', 'asset'].join(' ');
  return (
    /secret-hygiene-report\.json.*GitHub Release asset/i.test(text) ||
    /GitHub Release asset.*secret-hygiene-report\.json/i.test(text) ||
    /secret-hygiene-report\.json.*Release asset manifest/i.test(text) ||
    /Release asset manifest.*secret-hygiene-report\.json/i.test(text) ||
    text.includes(`${secretReportName}\`도 bytes`) ||
    text.includes(`${secretReportName}\`에는 release용 env 파일`) && text.includes(`${githubReleaseAssetLabel}으로`)
  );
}

function checkDocs() {
  const distribution = path.join(desktopDir, 'DISTRIBUTION.md');
  const operatorChecklist = path.join(desktopDir, 'RELEASE_OPERATOR_CHECKLIST.md');
  const docs = [
    ['distribution guide', distribution],
    ['operator checklist', operatorChecklist],
  ];
  for (const [label, file] of docs) {
    const exists = fs.existsSync(file);
    add(`${label} exists`, exists, path.relative(desktopDir, file));
    if (!exists) continue;
    const text = fs.readFileSync(file, 'utf8');
    add(
      `${label} secret hygiene CI-only policy`,
      text.includes('release/secret-hygiene-report.json') &&
        text.includes('CI-only diagnostic') &&
        !hasStaleSecretHygieneReleaseAssetText(text),
      'secret hygiene report is documented as CI-only, not a GitHub Release asset',
    );
    add(
      `${label} preflight diagnostic policy`,
      text.includes('release/preflight-report.strict.json') &&
        text.includes('release/release-env-contract-report.json') &&
        text.includes('release/release-env-bootstrap.json') &&
        text.includes('release/release-env-bootstrap-report.strict.json') &&
        text.includes('release/github-release-remediation-plan.json') &&
        text.includes('release/GITHUB_RELEASE_REMEDIATION_PLAN.md') &&
        text.includes('release/github-release-remediation-plan-report.json') &&
        text.includes('release/github-release-remediation-apply-plan.json') &&
        text.includes('release/github-release-remediation-apply-plan-report.strict.json') &&
        text.includes('release/release-setup-plan.json') &&
        text.includes('release/RELEASE_SETUP_PLAN.md') &&
        text.includes('release/release-setup-plan-report.strict.json') &&
        text.includes('release/release-unblock-plan.json') &&
        text.includes('release/RELEASE_UNBLOCK_PLAN.md') &&
        text.includes('release/release-unblock-plan-report.json') &&
        text.includes('release/release-credential-handoff.json') &&
        text.includes('release/RELEASE_CREDENTIAL_HANDOFF.md') &&
        text.includes('release/release-credential-handoff-report.json') &&
        text.includes('release/release-publication-seal.json') &&
        text.includes('release/RELEASE_PUBLICATION_SEAL.md') &&
        text.includes('release/baseline-freshness-report.json') &&
        text.includes('release/BASELINE_FRESHNESS.md') &&
        text.includes('release/baseline-export-report.json') &&
        text.includes('release/baseline-export-report-verification.strict.json') &&
        text.includes('release/BASELINE_EXPORT.md') &&
        text.includes('CI-only diagnostic'),
      'strict preflight, release env bootstrap, GitHub release remediation plan, remediation apply plan, setup plan, unblock plan, unblock verification, publication seal, baseline export verification, and baseline freshness reports are documented as CI-only diagnostic',
    );
    add(
      `${label} release env contract verifier`,
      text.includes('verify:release-env-contract') &&
        text.includes('release/release-env-contract-report.json'),
      'release env contract verifier command and report are documented',
    );
    add(
      `${label} release env bootstrap command`,
      text.includes('release:env-bootstrap') &&
        text.includes('verify:env-bootstrap:strict:report') &&
        text.includes('release/release-env-bootstrap.json') &&
        text.includes('release/release-env.local.template'),
      'release env bootstrap command, verifier, report, and template are documented',
    );
    add(
      `${label} baseline export command`,
      text.includes('release:baseline-export') &&
        text.includes('verify:baseline-export:strict:report') &&
        text.includes('release/baseline-export-report.json') &&
        text.includes('release/baseline-export-report-verification.strict.json') &&
        text.includes('CONNECT_AI_BASELINE_SHA256'),
      'baseline export command, verifier, and SHA handoff are documented',
    );
    add(
      `${label} notary profile command`,
      text.includes('signing:notary-profile') &&
        text.includes('signing:notary-profile:report') &&
        text.includes('APPLE_KEYCHAIN_PROFILE'),
      'notarytool profile setup and report mode are documented',
    );
    add(
      `${label} release status refresh command`,
      text.includes('release:status-refresh') &&
        text.includes('release/status-refresh-report.json'),
      'release status refresh command and report are documented',
    );
    add(
      `${label} GitHub Release remediation plan command`,
      text.includes('release:github-release-remediation-plan') &&
        text.includes('verify:github-release-remediation-plan') &&
        text.includes('release/github-release-remediation-plan.json') &&
        text.includes('release/GITHUB_RELEASE_REMEDIATION_PLAN.md'),
      'GitHub Release remediation plan command, verification, and reports are documented',
    );
    add(
      `${label} GitHub Release remediation apply plan command`,
      text.includes('release:github-release-remediation-apply:plan') &&
        text.includes('verify:github-release-remediation-apply-plan:strict:report') &&
        text.includes('release:github-release-remediation-apply') &&
        text.includes('release/github-release-remediation-apply-plan.json') &&
        text.includes('release/github-release-remediation-apply-plan-report.strict.json'),
      'GitHub Release remediation apply dry-run, dry-run verification, and guarded apply commands are documented',
    );
    add(
      `${label} production readiness publish gate`,
      text.includes('production-readiness-summary.json') &&
        text.includes('release-publication-seal.json') &&
        text.includes('productionReady') &&
        text.includes('publish'),
      'production readiness summary and publication seal are documented as publish gates',
    );
    add(
      `${label} IPC security release evidence`,
      text.includes('release/ipc-security-report.json') &&
        text.includes('IPC security'),
      'IPC security runtime report is documented as checksum-pinned release evidence',
    );
    add(
      `${label} app.asar hardening policy`,
      text.includes('release.appAsarPolicy') &&
        text.includes('app.asar') &&
        text.includes('app.asar.unpacked') &&
        text.includes('main-process'),
      'built app.asar with approved main-process hardening and baseline unpacked resources policy is documented',
    );
  }

  const combined = docs
    .filter(([, file]) => fs.existsSync(file))
    .map(([, file]) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  add(
    'docs always-upload diagnostic policy',
      combined.includes('connect-ai-desktop-release-env') &&
      combined.includes('connect-ai-desktop-preflight') &&
      combined.includes('release/temp-cleanup-report.json') &&
      combined.includes('release/release-env-contract-report.json') &&
      combined.includes('release/release-env-bootstrap.json') &&
      combined.includes('release/release-env-bootstrap-report.strict.json') &&
      combined.includes('release/status-refresh-report.json') &&
      combined.includes('release/status-refresh-report-verification.strict.json') &&
      combined.includes('release/github-release-publish-plan.json') &&
      combined.includes('release/github-release-publish-plan-report.strict.json') &&
      combined.includes('release/github-release-remediation-plan.json') &&
      combined.includes('release/GITHUB_RELEASE_REMEDIATION_PLAN.md') &&
      combined.includes('release/github-release-remediation-plan-report.json') &&
      combined.includes('release/github-release-remediation-apply-plan.json') &&
      combined.includes('release/github-release-remediation-apply-plan-report.strict.json') &&
      combined.includes('release/github-release-setup-report.json') &&
      combined.includes('release/production-release-runbook-report.json') &&
      combined.includes('release/production-release-runbook-report-verification.strict.json') &&
      combined.includes('release/production-readiness-summary.json') &&
      combined.includes('release/PRODUCTION_READINESS_SUMMARY.md') &&
      combined.includes('release/production-readiness-summary-verification.strict.json') &&
      combined.includes('release/engineering-readiness-report.json') &&
      combined.includes('release/ENGINEERING_READINESS.md') &&
      combined.includes('release/commercial-cutover-plan.json') &&
      combined.includes('release/COMMERCIAL_CUTOVER_PLAN.md') &&
      combined.includes('release/commercial-cutover-plan-report.json') &&
      combined.includes('release/commercial-cutover-plan-report.strict.json') &&
      combined.includes('release/commercial-release-readiness-report.strict.json') &&
      combined.includes('release/commercial-finalization-report.json') &&
      combined.includes('release/COMMERCIAL_FINALIZATION.md') &&
      combined.includes('release/commercial-finalization-report-verification.strict.json') &&
      combined.includes('deferred until release:status-refresh converges') &&
      combined.includes('no-exit commercial finalization deferral') &&
      combined.includes('release/release-setup-plan.json') &&
      combined.includes('release/RELEASE_SETUP_PLAN.md') &&
      combined.includes('release/release-setup-plan-report.strict.json') &&
      combined.includes('release/release-unblock-plan.json') &&
      combined.includes('release/RELEASE_UNBLOCK_PLAN.md') &&
      combined.includes('release/release-unblock-plan-report.json') &&
      combined.includes('release/release-credential-handoff.json') &&
      combined.includes('release/RELEASE_CREDENTIAL_HANDOFF.md') &&
      combined.includes('release/release-credential-handoff-report.json') &&
      combined.includes('release/release-publication-seal.json') &&
      combined.includes('release/RELEASE_PUBLICATION_SEAL.md') &&
      combined.includes('release/baseline-freshness-report.json') &&
      combined.includes('release/BASELINE_FRESHNESS.md') &&
      combined.includes('release/baseline-export-report.json') &&
      combined.includes('release/baseline-export-report-verification.strict.json') &&
      combined.includes('release/BASELINE_EXPORT.md') &&
      combined.includes('always()'),
    'release env, release env bootstrap, status refresh, status refresh verification, preflight, GitHub publish plan, GitHub publish plan verification, GitHub remediation apply plan, GitHub setup, production runbook, production readiness, engineering readiness, commercial cutover, commercial release readiness, commercial finalization, no-exit finalization deferral, setup plan, setup plan verification, unblock plan, unblock verification, publication seal, baseline freshness, and baseline export verification failure diagnostics are documented as always-uploaded CI artifacts',
  );
}

function checkSigningInputs() {
  const identityArgs = ['find-identity', '-v', '-p', 'codesigning'];
  if (process.env.CSC_KEYCHAIN && fs.existsSync(process.env.CSC_KEYCHAIN)) identityArgs.push(process.env.CSC_KEYCHAIN);
  const identities = run('/usr/bin/security', identityArgs);
  const text = `${identities.stdout}\n${identities.stderr}`;
  const hasDeveloperId = /Developer ID Application/.test(text);
  add('Developer ID Application identity', hasDeveloperId, hasDeveloperId ? 'available' : firstLine(text), maybeBlocker());
  add('notarization credentials', hasNotarizationCredentials(), 'APPLE_KEYCHAIN_PROFILE or Apple ID/API key env set', maybeBlocker());
  const hasP12Input = Boolean(process.env.BUILD_CERTIFICATE_BASE64 || process.env.BUILD_CERTIFICATE_PATH || process.env.CONNECT_AI_CERTIFICATE_BASE64 || process.env.CONNECT_AI_CERTIFICATE_PATH);
  add('certificate import input', hasP12Input || hasDeveloperId, hasP12Input ? 'p12 input configured' : 'no p12 input; existing keychain identity required', maybeBlocker());
}

function checkReleaseArtifacts() {
  const releaseDir = path.join(desktopDir, 'release');
  const dmg = path.join(releaseDir, `Connect-AI-${DEFAULT_VERSION}-mac-arm64.dmg`);
  const latestMac = path.join(releaseDir, 'latest-mac.yml');
  const manifest = path.join(releaseDir, 'release-manifest.json');
  const releaseTag = path.join(releaseDir, 'release-tag-report.json');
  const baselineFreshness = path.join(releaseDir, 'baseline-freshness-report.json');
  const baselineFreshnessMd = path.join(releaseDir, 'BASELINE_FRESHNESS.md');
  const baselineExport = path.join(releaseDir, 'baseline-export-report.json');
  const baselineExportVerification = path.join(releaseDir, 'baseline-export-report-verification.strict.json');
  const baselineExportMd = path.join(releaseDir, 'BASELINE_EXPORT.md');
  const installedAppParity = path.join(releaseDir, 'installed-app-parity-report.json');
  const uiParity = path.join(releaseDir, 'ui-parity-report.json');
  const performanceParity = path.join(releaseDir, 'performance-parity-report.json');
  const macosSecurity = path.join(releaseDir, 'macos-security-contract.json');
  const ipcSecurity = path.join(releaseDir, 'ipc-security-report.json');
  const securityAudit = path.join(releaseDir, 'security-audit-report.json');
  const secretHygiene = path.join(releaseDir, 'secret-hygiene-report.json');
  const dmgInstall = path.join(releaseDir, 'dmg-install-experience.json');
  const launchSmoke = path.join(releaseDir, 'release-launch-smoke.json');
  const dmgLaunchSmoke = path.join(releaseDir, 'release-dmg-launch-smoke.json');
  const updateChannel = path.join(releaseDir, 'update-channel-report.json');
  const decision = path.join(releaseDir, 'release-decision.json');
  const signingReadiness = path.join(releaseDir, 'signing-readiness.json');
  const operatorReadiness = path.join(releaseDir, 'operator-readiness.json');
  const setupPlan = path.join(releaseDir, 'release-setup-plan.json');
  const setupPlanMd = path.join(releaseDir, 'RELEASE_SETUP_PLAN.md');
  const setupPlanVerification = path.join(releaseDir, 'release-setup-plan-report.strict.json');
  const unblockPlan = path.join(releaseDir, 'release-unblock-plan.json');
  const unblockPlanMd = path.join(releaseDir, 'RELEASE_UNBLOCK_PLAN.md');
  const unblockPlanReport = path.join(releaseDir, 'release-unblock-plan-report.json');
  const unblockPlanReportStrict = path.join(releaseDir, 'release-unblock-plan-report.strict.json');
  const publicationSeal = path.join(releaseDir, 'release-publication-seal.json');
  const publicationSealMd = path.join(releaseDir, 'RELEASE_PUBLICATION_SEAL.md');
  const publicationSealVerification = path.join(releaseDir, 'release-publication-seal-verification.strict.json');
  const promotionPlan = path.join(releaseDir, 'release-promotion-plan.json');
  const promotionPlanMd = path.join(releaseDir, 'RELEASE_PROMOTION_PLAN.md');
  const assetManifest = path.join(releaseDir, 'release-asset-manifest.json');
  const assetManifestReport = path.join(releaseDir, 'asset-manifest-report.json');
  const releaseEnvContractReport = path.join(releaseDir, 'release-env-contract-report.json');
  const releaseEnvBootstrap = path.join(releaseDir, 'release-env-bootstrap.json');
  const releaseEnvBootstrapMd = path.join(releaseDir, 'RELEASE_ENV_BOOTSTRAP.md');
  const releaseEnvBootstrapTemplate = path.join(releaseDir, 'release-env.local.template');
  const releaseEnvBootstrapVerification = path.join(releaseDir, 'release-env-bootstrap-report.strict.json');
	  const statusRefreshReport = path.join(releaseDir, 'status-refresh-report.json');
	  const statusRefreshVerification = path.join(releaseDir, 'status-refresh-report-verification.strict.json');
	  const tempCleanupReport = path.join(releaseDir, 'temp-cleanup-report.json');
	  const githubReleaseRemediationPlan = path.join(releaseDir, 'github-release-remediation-plan.json');
  const githubReleaseRemediationPlanMd = path.join(releaseDir, 'GITHUB_RELEASE_REMEDIATION_PLAN.md');
  const githubReleaseRemediationReport = path.join(releaseDir, 'github-release-remediation-plan-report.json');
  const githubReleaseRemediationReportStrict = path.join(releaseDir, 'github-release-remediation-plan-report.strict.json');
  const githubReleaseRemediationApplyPlan = path.join(releaseDir, 'github-release-remediation-apply-plan.json');
  const githubReleaseRemediationApplyPlanReport = path.join(releaseDir, 'github-release-remediation-apply-plan-report.json');
  const githubReleaseRemediationApplyPlanReportStrict = path.join(releaseDir, 'github-release-remediation-apply-plan-report.strict.json');
  const releaseEnvReport = path.join(releaseDir, 'release-env-report.json');
  const releaseEnvProcessReport = path.join(releaseDir, 'release-env-report.process.json');
  const githubOperatorReadiness = path.join(releaseDir, 'operator-readiness.github.json');
  const githubReleasePublishPlan = path.join(releaseDir, 'github-release-publish-plan.json');
  const githubReleasePublishPlanVerification = path.join(releaseDir, 'github-release-publish-plan-report.strict.json');
  const githubReleaseAssetsReport = path.join(releaseDir, 'github-release-assets-report.json');
  const githubReleaseSetupReport = path.join(releaseDir, 'github-release-setup-report.json');
  const productionRunbookReport = path.join(releaseDir, 'production-release-runbook-report.json');
  const productionRunbookVerificationReport = path.join(releaseDir, 'production-release-runbook-report-verification.strict.json');
  const productionReadinessSummary = path.join(releaseDir, 'production-readiness-summary.json');
  const productionReadinessSummaryMd = path.join(releaseDir, 'PRODUCTION_READINESS_SUMMARY.md');
  const productionReadinessSummaryVerification = path.join(releaseDir, 'production-readiness-summary-verification.strict.json');
  const engineeringReadiness = path.join(releaseDir, 'engineering-readiness-report.json');
  const engineeringReadinessMd = path.join(releaseDir, 'ENGINEERING_READINESS.md');
  const commercialCutover = path.join(releaseDir, 'commercial-cutover-plan.json');
  const commercialCutoverMd = path.join(releaseDir, 'COMMERCIAL_CUTOVER_PLAN.md');
  const commercialCutoverReport = path.join(releaseDir, 'commercial-cutover-plan-report.json');
  const commercialCutoverReportStrict = path.join(releaseDir, 'commercial-cutover-plan-report.strict.json');
  const commercialReleaseReadinessReport = path.join(releaseDir, 'commercial-release-readiness-report.strict.json');
  const commercialFinalizationReport = path.join(releaseDir, 'commercial-finalization-report.json');
  const commercialFinalizationMd = path.join(releaseDir, 'COMMERCIAL_FINALIZATION.md');
  const commercialFinalizationVerification = path.join(releaseDir, 'commercial-finalization-report-verification.strict.json');
  const credentialHandoff = path.join(releaseDir, 'release-credential-handoff.json');
  const credentialHandoffMd = path.join(releaseDir, 'RELEASE_CREDENTIAL_HANDOFF.md');
  add('existing DMG artifact', fs.existsSync(dmg), fs.existsSync(dmg) ? `${fs.statSync(dmg).size} bytes` : 'missing', 'warn');
  add('existing latest-mac.yml', fs.existsSync(latestMac), fs.existsSync(latestMac) ? `${fs.statSync(latestMac).size} bytes` : 'missing', 'warn');
  add('existing release manifest', fs.existsSync(manifest), fs.existsSync(manifest) ? `${fs.statSync(manifest).size} bytes` : 'missing', 'warn');
  add('existing release tag report', fs.existsSync(releaseTag), fs.existsSync(releaseTag) ? `${fs.statSync(releaseTag).size} bytes` : 'missing', 'warn');
  add('existing baseline freshness report', fs.existsSync(baselineFreshness), fs.existsSync(baselineFreshness) ? `${fs.statSync(baselineFreshness).size} bytes` : 'not generated until release:baseline-freshness runs', 'warn');
  add('existing baseline freshness notes', fs.existsSync(baselineFreshnessMd), fs.existsSync(baselineFreshnessMd) ? `${fs.statSync(baselineFreshnessMd).size} bytes` : 'not generated until release:baseline-freshness runs', 'warn');
  add('existing baseline export report', fs.existsSync(baselineExport), fs.existsSync(baselineExport) ? `${fs.statSync(baselineExport).size} bytes` : 'not generated until release:baseline-export runs', 'warn');
  add('existing baseline export verification report', fs.existsSync(baselineExportVerification), fs.existsSync(baselineExportVerification) ? `${fs.statSync(baselineExportVerification).size} bytes` : 'not generated until verify:baseline-export:strict:report runs', 'warn');
  add('existing baseline export notes', fs.existsSync(baselineExportMd), fs.existsSync(baselineExportMd) ? `${fs.statSync(baselineExportMd).size} bytes` : 'not generated until release:baseline-export runs', 'warn');
  add('existing installed app parity report', fs.existsSync(installedAppParity), fs.existsSync(installedAppParity) ? `${fs.statSync(installedAppParity).size} bytes` : 'not generated until verify:installed runs', 'warn');
  add('existing UI parity report', fs.existsSync(uiParity), fs.existsSync(uiParity) ? `${fs.statSync(uiParity).size} bytes` : 'missing', 'warn');
  add('existing performance parity report', fs.existsSync(performanceParity), fs.existsSync(performanceParity) ? `${fs.statSync(performanceParity).size} bytes` : 'missing', 'warn');
  add('existing macOS security contract report', fs.existsSync(macosSecurity), fs.existsSync(macosSecurity) ? `${fs.statSync(macosSecurity).size} bytes` : 'missing', 'warn');
  add('existing IPC security report', fs.existsSync(ipcSecurity), fs.existsSync(ipcSecurity) ? `${fs.statSync(ipcSecurity).size} bytes` : 'missing', 'warn');
  add('existing security audit report', fs.existsSync(securityAudit), fs.existsSync(securityAudit) ? `${fs.statSync(securityAudit).size} bytes` : 'missing', 'warn');
  add('existing secret hygiene report', fs.existsSync(secretHygiene), fs.existsSync(secretHygiene) ? `${fs.statSync(secretHygiene).size} bytes` : 'missing', 'warn');
  add('existing DMG install experience', fs.existsSync(dmgInstall), fs.existsSync(dmgInstall) ? `${fs.statSync(dmgInstall).size} bytes` : 'missing', 'warn');
  add('existing release launch smoke', fs.existsSync(launchSmoke), fs.existsSync(launchSmoke) ? `${fs.statSync(launchSmoke).size} bytes` : 'missing', 'warn');
  add('existing release DMG launch smoke', fs.existsSync(dmgLaunchSmoke), fs.existsSync(dmgLaunchSmoke) ? `${fs.statSync(dmgLaunchSmoke).size} bytes` : 'missing', 'warn');
  add('existing update channel report', fs.existsSync(updateChannel), fs.existsSync(updateChannel) ? `${fs.statSync(updateChannel).size} bytes` : 'missing', 'warn');
  add('existing release decision', fs.existsSync(decision), fs.existsSync(decision) ? `${fs.statSync(decision).size} bytes` : 'missing', 'warn');
  add('existing signing readiness', fs.existsSync(signingReadiness), fs.existsSync(signingReadiness) ? `${fs.statSync(signingReadiness).size} bytes` : 'missing', 'warn');
  add('existing local operator readiness', fs.existsSync(operatorReadiness), fs.existsSync(operatorReadiness) ? `${fs.statSync(operatorReadiness).size} bytes` : 'missing', 'warn');
  add('existing release promotion plan', fs.existsSync(promotionPlan), fs.existsSync(promotionPlan) ? `${fs.statSync(promotionPlan).size} bytes` : 'missing', 'warn');
  add('existing release promotion plan notes', fs.existsSync(promotionPlanMd), fs.existsSync(promotionPlanMd) ? `${fs.statSync(promotionPlanMd).size} bytes` : 'missing', 'warn');
  add('existing release asset manifest', fs.existsSync(assetManifest), fs.existsSync(assetManifest) ? `${fs.statSync(assetManifest).size} bytes` : 'missing', 'warn');
  add('existing asset manifest report', fs.existsSync(assetManifestReport), fs.existsSync(assetManifestReport) ? `${fs.statSync(assetManifestReport).size} bytes` : 'missing', 'warn');
  add('existing release env contract report', fs.existsSync(releaseEnvContractReport), fs.existsSync(releaseEnvContractReport) ? `${fs.statSync(releaseEnvContractReport).size} bytes` : 'not generated until verify:release-env-contract runs', 'warn');
  add('existing release env bootstrap', fs.existsSync(releaseEnvBootstrap), fs.existsSync(releaseEnvBootstrap) ? `${fs.statSync(releaseEnvBootstrap).size} bytes` : 'not generated until release:env-bootstrap runs', 'warn');
  add('existing release env bootstrap notes', fs.existsSync(releaseEnvBootstrapMd), fs.existsSync(releaseEnvBootstrapMd) ? `${fs.statSync(releaseEnvBootstrapMd).size} bytes` : 'not generated until release:env-bootstrap runs', 'warn');
  add('existing release env bootstrap template', fs.existsSync(releaseEnvBootstrapTemplate), fs.existsSync(releaseEnvBootstrapTemplate) ? `${fs.statSync(releaseEnvBootstrapTemplate).size} bytes` : 'not generated until release:env-bootstrap runs', 'warn');
	  add('existing release env bootstrap verification report', fs.existsSync(releaseEnvBootstrapVerification), fs.existsSync(releaseEnvBootstrapVerification) ? `${fs.statSync(releaseEnvBootstrapVerification).size} bytes` : 'not generated until verify:env-bootstrap:strict:report runs', 'warn');
	  add('existing temp cleanup report', fs.existsSync(tempCleanupReport), fs.existsSync(tempCleanupReport) ? `${fs.statSync(tempCleanupReport).size} bytes` : 'not generated until release:cleanup-temp runs', 'warn');
	  add('existing release status refresh report', fs.existsSync(statusRefreshReport), fs.existsSync(statusRefreshReport) ? `${fs.statSync(statusRefreshReport).size} bytes` : 'not generated until release:status-refresh runs', 'warn');
  add('existing release status refresh verification report', fs.existsSync(statusRefreshVerification), fs.existsSync(statusRefreshVerification) ? `${fs.statSync(statusRefreshVerification).size} bytes` : 'not generated until verify:status-refresh-report:strict:report runs', 'warn');
  add('existing GitHub Release remediation plan', fs.existsSync(githubReleaseRemediationPlan), fs.existsSync(githubReleaseRemediationPlan) ? `${fs.statSync(githubReleaseRemediationPlan).size} bytes` : 'not generated until release:github-release-remediation-plan runs', 'warn');
  add('existing GitHub Release remediation plan notes', fs.existsSync(githubReleaseRemediationPlanMd), fs.existsSync(githubReleaseRemediationPlanMd) ? `${fs.statSync(githubReleaseRemediationPlanMd).size} bytes` : 'not generated until release:github-release-remediation-plan runs', 'warn');
  add('existing GitHub Release remediation plan report', fs.existsSync(githubReleaseRemediationReport), fs.existsSync(githubReleaseRemediationReport) ? `${fs.statSync(githubReleaseRemediationReport).size} bytes` : 'not generated until verify:github-release-remediation-plan runs', 'warn');
  add('existing strict GitHub Release remediation plan report', fs.existsSync(githubReleaseRemediationReportStrict), fs.existsSync(githubReleaseRemediationReportStrict) ? `${fs.statSync(githubReleaseRemediationReportStrict).size} bytes` : 'not generated until verify:github-release-remediation-plan:strict:report runs', 'warn');
  add('existing GitHub Release remediation apply plan', fs.existsSync(githubReleaseRemediationApplyPlan), fs.existsSync(githubReleaseRemediationApplyPlan) ? `${fs.statSync(githubReleaseRemediationApplyPlan).size} bytes` : 'not generated until release:github-release-remediation-apply:plan runs', 'warn');
  add(
    'existing GitHub Release remediation apply plan report',
    fs.existsSync(githubReleaseRemediationApplyPlanReport) || fs.existsSync(githubReleaseRemediationApplyPlanReportStrict),
    fs.existsSync(githubReleaseRemediationApplyPlanReport)
      ? `${fs.statSync(githubReleaseRemediationApplyPlanReport).size} bytes`
      : fs.existsSync(githubReleaseRemediationApplyPlanReportStrict)
        ? `strict report present (${fs.statSync(githubReleaseRemediationApplyPlanReportStrict).size} bytes)`
        : 'not generated until verify:github-release-remediation-apply-plan runs',
    'warn',
  );
  add('existing strict GitHub Release remediation apply plan report', fs.existsSync(githubReleaseRemediationApplyPlanReportStrict), fs.existsSync(githubReleaseRemediationApplyPlanReportStrict) ? `${fs.statSync(githubReleaseRemediationApplyPlanReportStrict).size} bytes` : 'not generated until verify:github-release-remediation-apply-plan:strict:report runs', 'warn');
  add('existing release env report', fs.existsSync(releaseEnvReport), fs.existsSync(releaseEnvReport) ? `${fs.statSync(releaseEnvReport).size} bytes` : 'not generated until release:env-check runs', 'warn');
  add('existing release process env report', fs.existsSync(releaseEnvProcessReport), fs.existsSync(releaseEnvProcessReport) ? `${fs.statSync(releaseEnvProcessReport).size} bytes` : 'not generated until release:env-check:process:strict runs', 'warn');
  add('existing GitHub operator readiness report', fs.existsSync(githubOperatorReadiness), fs.existsSync(githubOperatorReadiness) ? `${fs.statSync(githubOperatorReadiness).size} bytes` : 'not generated until release:operator-checklist:github runs', 'warn');
  add('existing GitHub Release publish plan', fs.existsSync(githubReleasePublishPlan), fs.existsSync(githubReleasePublishPlan) ? `${fs.statSync(githubReleasePublishPlan).size} bytes` : 'not generated until release:publish-assets:plan runs', 'warn');
  add('existing GitHub Release publish plan verification report', fs.existsSync(githubReleasePublishPlanVerification), fs.existsSync(githubReleasePublishPlanVerification) ? `${fs.statSync(githubReleasePublishPlanVerification).size} bytes` : 'not generated until verify:github-release-publish-plan:strict:report runs', 'warn');
  add('existing GitHub Release asset report', fs.existsSync(githubReleaseAssetsReport), fs.existsSync(githubReleaseAssetsReport) ? `${fs.statSync(githubReleaseAssetsReport).size} bytes` : 'not generated until remote publish verification runs', 'warn');
  add('existing GitHub Release setup report', fs.existsSync(githubReleaseSetupReport), fs.existsSync(githubReleaseSetupReport) ? `${fs.statSync(githubReleaseSetupReport).size} bytes` : 'not generated until release:github-setup runs', 'warn');
  add('existing production release runbook report', fs.existsSync(productionRunbookReport), fs.existsSync(productionRunbookReport) ? `${fs.statSync(productionRunbookReport).size} bytes` : 'not generated until release:operator-runbook runs', 'warn');
  add('existing production release runbook verification report', fs.existsSync(productionRunbookVerificationReport), fs.existsSync(productionRunbookVerificationReport) ? `${fs.statSync(productionRunbookVerificationReport).size} bytes` : 'not generated until verify:operator-runbook-report:strict:report runs', 'warn');
  add('existing production readiness summary', fs.existsSync(productionReadinessSummary), fs.existsSync(productionReadinessSummary) ? `${fs.statSync(productionReadinessSummary).size} bytes` : 'not generated until release:readiness-summary runs', 'warn');
  add('existing production readiness summary notes', fs.existsSync(productionReadinessSummaryMd), fs.existsSync(productionReadinessSummaryMd) ? `${fs.statSync(productionReadinessSummaryMd).size} bytes` : 'not generated until release:readiness-summary runs', 'warn');
  add('existing production readiness summary verification report', fs.existsSync(productionReadinessSummaryVerification), fs.existsSync(productionReadinessSummaryVerification) ? `${fs.statSync(productionReadinessSummaryVerification).size} bytes` : 'not generated until verify:readiness-summary-report:strict:report runs', 'warn');
  add('existing engineering readiness report', fs.existsSync(engineeringReadiness), fs.existsSync(engineeringReadiness) ? `${fs.statSync(engineeringReadiness).size} bytes` : 'not generated until release:engineering-readiness runs', 'warn');
  add('existing engineering readiness notes', fs.existsSync(engineeringReadinessMd), fs.existsSync(engineeringReadinessMd) ? `${fs.statSync(engineeringReadinessMd).size} bytes` : 'not generated until release:engineering-readiness runs', 'warn');
  add('existing commercial cutover plan', fs.existsSync(commercialCutover), fs.existsSync(commercialCutover) ? `${fs.statSync(commercialCutover).size} bytes` : 'not generated until release:commercial-cutover runs', 'warn');
  add('existing commercial cutover notes', fs.existsSync(commercialCutoverMd), fs.existsSync(commercialCutoverMd) ? `${fs.statSync(commercialCutoverMd).size} bytes` : 'not generated until release:commercial-cutover runs', 'warn');
  add('existing strict commercial cutover report', fs.existsSync(commercialCutoverReportStrict), fs.existsSync(commercialCutoverReportStrict) ? `${fs.statSync(commercialCutoverReportStrict).size} bytes` : 'not generated until verify:commercial-cutover:strict:report runs', 'warn');
  add('existing commercial release readiness report', fs.existsSync(commercialReleaseReadinessReport), fs.existsSync(commercialReleaseReadinessReport) ? `${fs.statSync(commercialReleaseReadinessReport).size} bytes` : 'not generated until verify:commercial-release:strict:report runs', 'warn');
  add('existing commercial finalization report', fs.existsSync(commercialFinalizationReport), fs.existsSync(commercialFinalizationReport) ? `${fs.statSync(commercialFinalizationReport).size} bytes` : 'not generated until release:commercial-finalize runs', 'warn');
  add('existing commercial finalization notes', fs.existsSync(commercialFinalizationMd), fs.existsSync(commercialFinalizationMd) ? `${fs.statSync(commercialFinalizationMd).size} bytes` : 'not generated until release:commercial-finalize runs', 'warn');
  add('existing commercial finalization verification report', fs.existsSync(commercialFinalizationVerification), fs.existsSync(commercialFinalizationVerification) ? `${fs.statSync(commercialFinalizationVerification).size} bytes` : 'not generated until release:commercial-finalize runs', 'warn');
  add('existing release credential handoff', fs.existsSync(credentialHandoff), fs.existsSync(credentialHandoff) ? `${fs.statSync(credentialHandoff).size} bytes` : 'not generated until release:credential-handoff runs', 'warn');
  add('existing release credential handoff notes', fs.existsSync(credentialHandoffMd), fs.existsSync(credentialHandoffMd) ? `${fs.statSync(credentialHandoffMd).size} bytes` : 'not generated until release:credential-handoff runs', 'warn');
  add('existing release setup plan', fs.existsSync(setupPlan), fs.existsSync(setupPlan) ? `${fs.statSync(setupPlan).size} bytes` : 'not generated until release:setup-plan runs', 'warn');
  add('existing release setup plan notes', fs.existsSync(setupPlanMd), fs.existsSync(setupPlanMd) ? `${fs.statSync(setupPlanMd).size} bytes` : 'not generated until release:setup-plan runs', 'warn');
  add('existing release setup plan verification report', fs.existsSync(setupPlanVerification), fs.existsSync(setupPlanVerification) ? `${fs.statSync(setupPlanVerification).size} bytes` : 'not generated until verify:setup-plan:strict:report runs', 'warn');
  add('existing release unblock plan', fs.existsSync(unblockPlan), fs.existsSync(unblockPlan) ? `${fs.statSync(unblockPlan).size} bytes` : 'not generated until release:unblock-plan runs', 'warn');
  add('existing release unblock plan notes', fs.existsSync(unblockPlanMd), fs.existsSync(unblockPlanMd) ? `${fs.statSync(unblockPlanMd).size} bytes` : 'not generated until release:unblock-plan runs', 'warn');
  add('existing release unblock plan report', fs.existsSync(unblockPlanReport), fs.existsSync(unblockPlanReport) ? `${fs.statSync(unblockPlanReport).size} bytes` : 'not generated until verify:unblock-plan runs', 'warn');
  add('existing strict release unblock plan report', fs.existsSync(unblockPlanReportStrict), fs.existsSync(unblockPlanReportStrict) ? `${fs.statSync(unblockPlanReportStrict).size} bytes` : 'not generated until verify:unblock-plan:strict runs', 'warn');
  add('existing release publication seal', fs.existsSync(publicationSeal), fs.existsSync(publicationSeal) ? `${fs.statSync(publicationSeal).size} bytes` : 'not generated until release:publication-seal runs', 'warn');
  add('existing release publication seal notes', fs.existsSync(publicationSealMd), fs.existsSync(publicationSealMd) ? `${fs.statSync(publicationSealMd).size} bytes` : 'not generated until release:publication-seal runs', 'warn');
  add('existing release publication seal verification report', fs.existsSync(publicationSealVerification), fs.existsSync(publicationSealVerification) ? `${fs.statSync(publicationSealVerification).size} bytes` : 'not generated until verify:publication-seal-report:strict:report runs', 'warn');

  const assetReport = reportSummary(githubReleaseAssetsReport);
  if (assetReport) {
    add(
      'existing GitHub Release asset report clean',
      assetReport.blockers === 0 && assetReport.warnings === 0,
      `${assetReport.blockers} blocker(s), ${assetReport.warnings} warning(s)`,
      'warn',
    );
    const assetMeta = reportMeta(githubReleaseAssetsReport);
    const remediation = assetMeta?.remediation?.summary;
    add(
      'existing GitHub Release asset remediation plan',
      Boolean(assetMeta?.remediation?.status && Array.isArray(assetMeta?.remediation?.actions) && remediation),
      remediation ? `status=${assetMeta.remediation.status}, required=${remediation.required}, advisory=${remediation.advisory}` : 'missing remediation status/actions',
      'warn',
    );
  }
  const publishPlanVerificationMeta = reportMeta(githubReleasePublishPlanVerification);
  if (publishPlanVerificationMeta) {
    add(
      'existing GitHub Release publish plan verification clean',
      Number(publishPlanVerificationMeta.summary?.blockers || 0) === 0 &&
        Number(publishPlanVerificationMeta.summary?.warnings || 0) === 0,
      `${publishPlanVerificationMeta.summary?.blockers ?? 'missing'} blocker(s), ${publishPlanVerificationMeta.summary?.warnings ?? 'missing'} warning(s)`,
      'warn',
    );
  }
  const remediationPlanMeta = reportMeta(githubReleaseRemediationPlan);
  if (remediationPlanMeta) {
    add(
      'existing GitHub Release remediation plan coverage',
      remediationPlanMeta.schemaVersion === 1 &&
        Array.isArray(remediationPlanMeta.requiredActions) &&
        Number(remediationPlanMeta.summary?.requiredActions || 0) === remediationPlanMeta.requiredActions.length &&
        Array.isArray(remediationPlanMeta.advisoryReviews) &&
        Number(remediationPlanMeta.summary?.advisoryReviews || 0) === remediationPlanMeta.advisoryReviews.length,
      `status=${remediationPlanMeta.status || 'missing'}, required=${remediationPlanMeta.summary?.requiredActions ?? 'missing'}, advisory=${remediationPlanMeta.summary?.advisoryReviews ?? 'missing'}`,
      'warn',
    );
    const baselineGuard = remediationPlanMeta.baselineUrlGuard || {};
    const guardMirror = baselineGuard.localBaselineMirror || {};
    const guardRemote = baselineGuard.remoteBaselineCandidate || {};
    add(
      'existing GitHub Release remediation baseline URL guard',
      baselineGuard.ok === true &&
        baselineGuard.status === 'approved-source-verified-remote-baseline-rejected' &&
        guardMirror.status === 'verified-match' &&
        guardMirror.matchesExport === true &&
        guardMirror.approvedUploadSource === 'release/Connect-AI-0.4.8-baseline-arm64-mac.zip' &&
        guardRemote.status === 'not-approved-baseline-url' &&
        guardRemote.remoteBytes !== guardRemote.expectedBaselineBytes,
      `status=${baselineGuard.status || 'missing'}, source=${guardMirror.approvedUploadSource || 'missing'}, remote=${guardRemote.remoteBytes ?? 'missing'}, expected=${guardRemote.expectedBaselineBytes ?? 'missing'}`,
      'warn',
    );
    const guardedWorkflows = Array.isArray(remediationPlanMeta.guardedWorkflows) ? remediationPlanMeta.guardedWorkflows : [];
    const localGuarded = guardedWorkflows.find((workflow) => workflow.id === 'local-env-guarded-publish');
    const processGuarded = guardedWorkflows.find((workflow) => workflow.id === 'process-env-guarded-publish');
    const guardedText = guardedWorkflows
      .flatMap((workflow) => workflow.commands || [])
      .join('\n');
    add(
      'existing GitHub Release remediation guarded workflow coverage',
      Boolean(localGuarded) &&
        Boolean(processGuarded) &&
        guardedText.includes('verify:publication-seal:production') &&
        guardedText.includes('verify:asset-manifest') &&
        guardedText.includes('release:publish-assets:env') &&
        guardedText.includes('release:publish-assets') &&
        guardedText.includes('verify:github-release-assets:strict:env') &&
        guardedText.includes('verify:github-release-assets:strict') &&
        guardedText.includes('verify:publication-seal:published'),
      `${guardedWorkflows.length} guarded workflow(s)`,
      'warn',
    );
  }
  const remediationApplyPlanMeta = reportMeta(githubReleaseRemediationApplyPlan);
  if (remediationApplyPlanMeta) {
    add(
      'existing GitHub Release remediation apply plan dry-run coverage',
      remediationApplyPlanMeta.schemaVersion === 1 &&
        remediationApplyPlanMeta.apply === false &&
        remediationApplyPlanMeta.status === 'dry-run-ready' &&
        Number(remediationApplyPlanMeta.summary?.blockers || 0) === 0 &&
        Number(remediationApplyPlanMeta.summary?.actions || 0) === Number(remediationPlanMeta?.summary?.requiredActions || 0),
      `status=${remediationApplyPlanMeta.status || 'missing'}, actions=${remediationApplyPlanMeta.summary?.actions ?? 'missing'}`,
      'warn',
    );
    const applyChecks = Array.isArray(remediationApplyPlanMeta.checks) ? remediationApplyPlanMeta.checks : [];
    const applyCheck = (name) => applyChecks.find((check) => check.name === name);
    add(
      'existing GitHub Release remediation apply plan baseline URL guard',
      applyCheck('remediation baseline URL guard present')?.ok === true &&
        applyCheck('remediation approved baseline upload source verified')?.ok === true &&
        applyCheck('remediation remote same-name baseline URL rejected')?.ok === true,
      `present=${Boolean(applyCheck('remediation baseline URL guard present')?.ok)}, approved=${Boolean(applyCheck('remediation approved baseline upload source verified')?.ok)}, rejected=${Boolean(applyCheck('remediation remote same-name baseline URL rejected')?.ok)}`,
      'warn',
    );
    const applySourceReports = new Set((remediationApplyPlanMeta.sourceReports || []).map((source) => source.path).filter(Boolean));
    add(
      'existing GitHub Release remediation apply plan source coverage',
      applySourceReports.has('release/release-asset-manifest.json') &&
        applySourceReports.has('release/github-release-remediation-plan.json') &&
        applySourceReports.has('release/github-release-remediation-plan-report.strict.json') &&
        applySourceReports.has('release/production-readiness-summary.json') &&
        applySourceReports.has('release/release-publication-seal.json') &&
        applySourceReports.has('release/baseline-freshness-report.json') &&
        applySourceReports.has('release/baseline-export-report-verification.strict.json') &&
        applySourceReports.has(remediationPlanMeta?.sourceReport),
      [...applySourceReports].join(', ') || 'missing source reports',
      'warn',
    );
    const applySafetyRules = (remediationApplyPlanMeta.safetyRules || []).join('\n');
    add(
      'existing GitHub Release remediation apply plan safety rules',
      /Dry-run mode must never upload/.test(applySafetyRules) &&
        /--confirm-remote-remediation/.test(applySafetyRules) &&
        /production readiness/.test(applySafetyRules) &&
        /release\/release-asset-manifest\.json/.test(applySafetyRules) &&
        /CONNECT_AI_BASELINE_URL/.test(applySafetyRules),
      `${remediationApplyPlanMeta.safetyRules?.length || 0} rule(s)`,
      'warn',
    );
    add(
      'existing GitHub Release remediation apply plan production gate snapshot',
      remediationApplyPlanMeta.productionGate &&
        typeof remediationApplyPlanMeta.productionGate.ready === 'boolean' &&
        remediationApplyPlanMeta.productionGate.readiness?.summary &&
        remediationApplyPlanMeta.productionGate.publicationSeal?.summary &&
        remediationApplyPlanMeta.productionGate.baselineFreshness?.summary,
      remediationApplyPlanMeta.productionGate?.detail || 'missing production gate snapshot',
      'warn',
    );
  }
  const secretHygieneMeta = reportMeta(secretHygiene);
  if (secretHygieneMeta) {
    const secretHygieneChecks = new Set((secretHygieneMeta.checks || []).map((check) => check.name).filter(Boolean));
    add(
      'existing secret hygiene repository candidate coverage',
      secretHygieneChecks.has('repository candidate inventory') &&
        secretHygieneChecks.has('repository candidate build artifact exclusion') &&
        secretHygieneChecks.has('repository candidate secret material exclusion') &&
        secretHygieneChecks.has('repository candidate largest files recorded'),
      `${secretHygieneChecks.size} secret hygiene check(s)`,
      'warn',
    );
  }
  const productionRunbookMeta = reportMeta(productionRunbookReport);
  if (productionRunbookMeta) {
    const runbookStageText = (productionRunbookMeta.stages || [])
      .map((stage) => `${stage.id || ''}\n${stage.command || ''}\n${stage.title || ''}\n${stage.enabled}\n${stage.status || ''}\n${stage.skippedReason || ''}\n${(stage.reportPaths || []).join('\n')}`)
      .join('\n');
    add(
      'existing production release runbook status metadata',
      typeof productionRunbookMeta.status === 'string' &&
        typeof productionRunbookMeta.productionReady === 'boolean' &&
        typeof productionRunbookMeta.localCandidateReady === 'boolean' &&
        typeof productionRunbookMeta.publishedReleaseReady === 'boolean' &&
        Boolean(productionRunbookMeta.gateSnapshot) &&
        Boolean(productionRunbookMeta.blockerDetails),
      `status=${productionRunbookMeta.status || 'missing'}, productionReady=${productionRunbookMeta.productionReady}, localCandidateReady=${productionRunbookMeta.localCandidateReady}, publishedReleaseReady=${productionRunbookMeta.publishedReleaseReady}`,
      'warn',
    );
    add(
      'existing production release runbook remote remediation stages',
      runbookStageText.includes('verify:github-release-assets:strict:report') &&
        runbookStageText.includes('release:github-release-remediation-plan') &&
        runbookStageText.includes('verify:github-release-remediation-plan:strict:report') &&
        runbookStageText.includes('release:github-release-remediation-apply:plan') &&
        runbookStageText.includes('verify:github-release-remediation-apply-plan:strict:report') &&
        runbookStageText.includes('release/github-release-remediation-apply-plan.json') &&
        runbookStageText.includes('release/github-release-remediation-apply-plan-report.strict.json'),
      'runbook records strict remote asset drift, remediation plan, verifier, dry-run apply plan, and apply-plan verifier before readiness refresh',
      'warn',
    );
    add(
      'existing production release runbook commercial finalization deferral',
      productionRunbookMeta.mode?.noExit !== true ||
        (runbookStageText.includes('commercial-finalization') &&
          runbookStageText.includes('false') &&
          runbookStageText.includes('skipped') &&
          runbookStageText.includes('deferred until release:status-refresh converges') &&
          runbookStageText.includes('release:commercial-finalize')),
      productionRunbookMeta.mode?.noExit === true
        ? 'no-exit runbook defers commercial finalization until status refresh converges'
        : 'not a no-exit diagnostic runbook',
      'warn',
    );
  }
  const productionRunbookVerificationMeta = reportMeta(productionRunbookVerificationReport);
  if (productionRunbookVerificationMeta) {
    add(
      'existing production release runbook verification clean',
      Number(productionRunbookVerificationMeta.summary?.blockers || 0) === 0 &&
        Number(productionRunbookVerificationMeta.summary?.warnings || 0) === 0,
      `${productionRunbookVerificationMeta.summary?.blockers ?? 'missing'} blocker(s), ${productionRunbookVerificationMeta.summary?.warnings ?? 'missing'} warning(s)`,
      'warn',
    );
  }
  const productionReadinessSummaryVerificationMeta = reportMeta(productionReadinessSummaryVerification);
  if (productionReadinessSummaryVerificationMeta) {
    add(
      'existing production readiness summary verification clean',
      Number(productionReadinessSummaryVerificationMeta.summary?.blockers || 0) === 0 &&
        Number(productionReadinessSummaryVerificationMeta.summary?.warnings || 0) === 0,
      `${productionReadinessSummaryVerificationMeta.summary?.blockers ?? 'missing'} blocker(s), ${productionReadinessSummaryVerificationMeta.summary?.warnings ?? 'missing'} warning(s)`,
      'warn',
    );
  }
  const publicationSealVerificationMeta = reportMeta(publicationSealVerification);
  if (publicationSealVerificationMeta) {
    add(
      'existing release publication seal verification clean',
      Number(publicationSealVerificationMeta.summary?.blockers || 0) === 0 &&
        Number(publicationSealVerificationMeta.summary?.warnings || 0) === 0,
      `${publicationSealVerificationMeta.summary?.blockers ?? 'missing'} blocker(s), ${publicationSealVerificationMeta.summary?.warnings ?? 'missing'} warning(s)`,
      'warn',
    );
  }
  const baselineExportMeta = reportMeta(baselineExport);
  if (baselineExportMeta) {
    const exportPath = baselineExportMeta.export?.path ? path.join(desktopDir, baselineExportMeta.export.path) : null;
    const exportExists = Boolean(exportPath && fs.existsSync(exportPath));
    const actualBytes = exportExists ? fs.statSync(exportPath).size : null;
    const actualSha256 = exportExists ? sha256(exportPath) : null;
    add(
      'existing baseline export source hash',
      baselineExportMeta.source?.appAsarSha256 === DEFAULT_ASAR_SHA256 &&
        baselineExportMeta.source?.appAsarExpectedSha256 === DEFAULT_ASAR_SHA256,
      baselineExportMeta.source?.appAsarSha256 || 'missing',
      'warn',
    );
    add(
      'existing baseline export zip bytes',
      exportExists && actualBytes === Number(baselineExportMeta.export?.bytes || 0),
      exportExists ? `${actualBytes} actual, ${baselineExportMeta.export?.bytes || 'missing'} reported` : 'missing zip',
      'warn',
    );
    add(
      'existing baseline export zip sha256',
      exportExists &&
        actualSha256 === baselineExportMeta.export?.sha256 &&
        /^[a-f0-9]{64}$/.test(String(baselineExportMeta.export?.sha256 || '')),
      exportExists ? `${path.relative(desktopDir, exportPath)} ${actualSha256}` : 'missing zip',
      'warn',
    );
  }
  const baselineExportVerificationMeta = reportMeta(baselineExportVerification);
  if (baselineExportVerificationMeta) {
    add(
      'existing baseline export verification clean',
      baselineExportVerificationMeta.strict === true &&
        Number(baselineExportVerificationMeta.summary?.blockers || 0) === 0 &&
        Number(baselineExportVerificationMeta.summary?.warnings || 0) === 0,
      `strict=${Boolean(baselineExportVerificationMeta.strict)}, ${baselineExportVerificationMeta.summary?.blockers ?? 'missing'} blocker(s), ${baselineExportVerificationMeta.summary?.warnings ?? 'missing'} warning(s)`,
      strict ? 'blocker' : 'warn',
    );
  }
  const releaseEnvBootstrapMeta = reportMeta(releaseEnvBootstrap);
  if (releaseEnvBootstrapMeta) {
    add(
      'existing release env bootstrap schema',
      releaseEnvBootstrapMeta.schemaVersion === 1 &&
        releaseEnvBootstrapMeta.files?.template === 'release/release-env.local.template' &&
        releaseEnvBootstrapMeta.summary?.baselineShaReady === true &&
        Number(releaseEnvBootstrapMeta.summary?.secretKeys || 0) > 0,
      `status=${releaseEnvBootstrapMeta.status || 'missing'}, baselineShaReady=${Boolean(releaseEnvBootstrapMeta.summary?.baselineShaReady)}, template=${releaseEnvBootstrapMeta.files?.template || 'missing'}`,
      'warn',
    );
  }
  const credentialHandoffMeta = reportMeta(credentialHandoff);
  if (credentialHandoffMeta) {
    add(
      'existing release credential handoff schema',
      credentialHandoffMeta.schemaVersion === 1 && Array.isArray(credentialHandoffMeta.credentialGroups),
      `status=${credentialHandoffMeta.status || 'missing'}, blocked=${credentialHandoffMeta.summary?.blockedCredentialGroups ?? 'missing'}`,
      'warn',
    );
    const remote = credentialHandoffMeta.remoteAssetRemediation || {};
    add(
      'existing release credential handoff remediation source',
      remote.sourceReport === 'release/github-release-remediation-plan.json' &&
        Array.isArray(remote.verifierReports) &&
        remote.verifierReports.includes('release/github-release-remediation-plan-report.json') &&
        remote.verifierReports.includes('release/github-release-remediation-plan-report.strict.json') &&
        remote.applyPlanReport === 'release/github-release-remediation-apply-plan.json' &&
        remote.applyPlanVerifierReport === 'release/github-release-remediation-apply-plan-report.strict.json' &&
        remote.applyPlanStatus === remediationApplyPlanMeta?.status &&
        Number(remote.applyPlanActions || 0) === Number(remediationApplyPlanMeta?.summary?.actions || 0) &&
        Number(remote.applyPlanVerifierSummary?.blockers || 0) === Number(reportSummary(githubReleaseRemediationApplyPlanReportStrict)?.blockers || 0) &&
        Number(remote.applyPlanVerifierSummary?.warnings || 0) === Number(reportSummary(githubReleaseRemediationApplyPlanReportStrict)?.warnings || 0) &&
        Number(remote.requiredActions || 0) === Number(remediationPlanMeta?.summary?.requiredActions || 0),
      `source=${remote.sourceReport || 'missing'}, apply=${remote.applyPlanStatus || 'missing'}, verifier=${remote.applyPlanVerifierReport || 'missing'}, required=${remote.requiredActions ?? 'missing'}`,
      'warn',
    );
  }

  const readinessMeta = reportMeta(productionReadinessSummary);
  if (readinessMeta) {
    const readinessSources = new Set((readinessMeta.sourceReports || []).map((item) => item.path).filter(Boolean));
    const readinessGate = (readinessMeta.gates || []).find((gate) => gate.id === 'remote-remediation-plan-verified');
    const readinessBaselineUrlGate = (readinessMeta.gates || []).find((gate) => gate.id === 'remote-remediation-baseline-url-guard-ready');
    const readinessApplyGate = (readinessMeta.gates || []).find((gate) => gate.id === 'remote-remediation-apply-plan-ready');
    const readinessBaselineExportGate = (readinessMeta.gates || []).find((gate) => gate.id === 'baseline-export-clean');
    const readinessBaselineExportVerificationGate = (readinessMeta.gates || []).find((gate) => gate.id === 'baseline-export-verified');
    add(
      'existing production readiness remediation source coverage',
      readinessSources.has('release/github-release-remediation-plan.json') &&
        readinessSources.has('release/github-release-remediation-plan-report.json') &&
        readinessSources.has('release/github-release-remediation-plan-report.strict.json') &&
        readinessSources.has('release/github-release-remediation-apply-plan.json') &&
        readinessSources.has('release/github-release-remediation-apply-plan-report.strict.json') &&
        readinessGate?.ok === true &&
        readinessBaselineUrlGate?.ok === true &&
        readinessApplyGate?.ok === true,
      readinessGate && readinessBaselineUrlGate && readinessApplyGate
        ? `${readinessGate.id}=${Boolean(readinessGate.ok)}, ${readinessBaselineUrlGate.id}=${Boolean(readinessBaselineUrlGate.ok)}, ${readinessApplyGate.id}=${Boolean(readinessApplyGate.ok)}`
        : 'missing remote-remediation-plan-verified, remote-remediation-baseline-url-guard-ready, or remote-remediation-apply-plan-ready gate',
      'warn',
    );
    add(
      'existing production readiness baseline export source coverage',
      readinessSources.has('release/baseline-export-report.json') &&
        readinessSources.has('release/baseline-export-report-verification.strict.json') &&
        readinessBaselineExportGate?.ok === true &&
        readinessBaselineExportVerificationGate?.ok === true,
      readinessBaselineExportGate && readinessBaselineExportVerificationGate
        ? `${readinessBaselineExportGate.id}=${Boolean(readinessBaselineExportGate.ok)}, ${readinessBaselineExportVerificationGate.id}=${Boolean(readinessBaselineExportVerificationGate.ok)}`
        : 'missing baseline-export-clean or baseline-export-verified gate',
      'warn',
    );
  }

  const publicationSealMeta = reportMeta(publicationSeal);
  if (publicationSealMeta) {
    const sealSources = new Set((publicationSealMeta.sourceReports || []).map((item) => item.path).filter(Boolean));
    const sealGate = (publicationSealMeta.gates || []).find((gate) => gate.id === 'remote-remediation-plan-verified');
    const sealApplyGate = (publicationSealMeta.gates || []).find((gate) => gate.id === 'remote-remediation-apply-plan-ready');
    const sealBaselineExportGate = (publicationSealMeta.gates || []).find((gate) => gate.id === 'baseline-export-ready');
    const sealBaselineExportVerificationGate = (publicationSealMeta.gates || []).find((gate) => gate.id === 'baseline-export-verified-ready');
    add(
      'existing publication seal remediation source coverage',
      sealSources.has('release/github-release-remediation-plan.json') &&
        sealSources.has('release/github-release-remediation-plan-report.json') &&
        sealSources.has('release/github-release-remediation-plan-report.strict.json') &&
        sealSources.has('release/github-release-remediation-apply-plan.json') &&
        sealSources.has('release/github-release-remediation-apply-plan-report.strict.json') &&
        sealGate?.ok === true &&
        sealApplyGate?.ok === true,
      sealGate && sealApplyGate
        ? `${sealGate.id}=${Boolean(sealGate.ok)}, ${sealApplyGate.id}=${Boolean(sealApplyGate.ok)}`
        : 'missing remote-remediation-plan-verified or remote-remediation-apply-plan-ready gate',
      'warn',
    );
    add(
      'existing publication seal baseline export source coverage',
      sealSources.has('release/baseline-export-report.json') &&
        sealSources.has('release/baseline-export-report-verification.strict.json') &&
        sealBaselineExportGate?.ok === true &&
        sealBaselineExportVerificationGate?.ok === true,
      sealBaselineExportGate && sealBaselineExportVerificationGate
        ? `${sealBaselineExportGate.id}=${Boolean(sealBaselineExportGate.ok)}, ${sealBaselineExportVerificationGate.id}=${Boolean(sealBaselineExportVerificationGate.ok)}`
        : 'missing baseline-export-ready or baseline-export-verified-ready gate',
      'warn',
    );
  }

  const setupPlanMeta = reportMeta(setupPlan);
  if (setupPlanMeta) {
    const setupSources = new Set((setupPlanMeta.sourceReports || []).map((item) => item.path).filter(Boolean));
    const setupCommandText = Object.values(setupPlanMeta.commands || {})
      .flat()
      .map((item) => `${item.step || ''}\n${item.command || ''}`)
      .join('\n');
    add(
      'existing setup plan commercial finalization source coverage',
      setupSources.has('release/commercial-release-readiness-report.strict.json') &&
        setupSources.has('release/commercial-finalization-report.json') &&
        setupSources.has('release/commercial-finalization-report-verification.strict.json'),
      [...setupSources].filter((item) => item.includes('commercial')).join(', ') || 'missing commercial setup sources',
      'warn',
    );
    add(
      'existing setup plan commercial finalization commands',
      setupCommandText.includes('release:commercial-finalize:commercial') &&
        setupCommandText.includes('verify:commercial-finalization:commercial'),
      setupCommandText || 'missing setup plan commands',
      'warn',
    );
  }

  const credentialHandoffCommercialMeta = reportMeta(credentialHandoff);
  if (credentialHandoffCommercialMeta) {
    const credentialSources = new Set((credentialHandoffCommercialMeta.sourceReports || []).map((item) => item.path).filter(Boolean));
    const credentialOperatorText = (credentialHandoffCommercialMeta.operatorSequence || [])
      .map((item) => `${item.step || ''}\n${item.command || ''}`)
      .join('\n');
    add(
      'existing credential handoff commercial finalization source coverage',
      credentialSources.has('release/commercial-release-readiness-report.strict.json') &&
        credentialSources.has('release/commercial-finalization-report.json') &&
        credentialSources.has('release/commercial-finalization-report-verification.strict.json'),
      [...credentialSources].filter((item) => item.includes('commercial')).join(', ') || 'missing commercial credential sources',
      'warn',
    );
    add(
      'existing credential handoff commercial finalization commands',
      credentialOperatorText.includes('release:commercial-finalize:commercial') &&
        credentialOperatorText.includes('verify:commercial-finalization:commercial'),
      credentialOperatorText || 'missing credential handoff operator sequence',
      'warn',
    );
  }

  const unblockPlanMeta = reportMeta(unblockPlan);
  if (unblockPlanMeta) {
    const unblockSources = new Set((unblockPlanMeta.sourceReports || []).map((item) => item.path).filter(Boolean));
    const publishGroup = (unblockPlanMeta.unblockGroups || []).find((group) => group.id === 'publish-and-remote-asset-verification');
    const publishSources = new Set((publishGroup?.sourceReports || []).filter(Boolean));
    const publishCommandText = [
      ...(publishGroup?.commands || []),
      ...(publishGroup?.verification || []),
    ].map((item) => `${item.step || ''}\n${item.command || ''}`).join('\n');
    add(
      'existing unblock plan remediation source coverage',
      unblockSources.has('release/github-release-remediation-plan.json') &&
        unblockSources.has('release/github-release-remediation-plan-report.json') &&
        unblockSources.has('release/github-release-remediation-plan-report.strict.json') &&
        unblockSources.has('release/github-release-remediation-apply-plan.json') &&
        unblockSources.has('release/github-release-remediation-apply-plan-report.strict.json') &&
        unblockSources.has('release/baseline-export-report.json') &&
        publishSources.has('release/github-release-remediation-plan.json') &&
        publishSources.has('release/github-release-remediation-plan-report.json') &&
        publishSources.has('release/github-release-remediation-plan-report.strict.json') &&
        publishSources.has('release/github-release-remediation-apply-plan.json') &&
        publishSources.has('release/github-release-remediation-apply-plan-report.strict.json'),
      publishGroup ? (publishGroup.sourceReports || []).join(', ') : 'missing publish-and-remote-asset-verification group',
      'warn',
    );
    add(
      'existing unblock plan commercial finalization source coverage',
      unblockSources.has('release/commercial-release-readiness-report.strict.json') &&
        unblockSources.has('release/commercial-finalization-report.json') &&
        unblockSources.has('release/commercial-finalization-report-verification.strict.json') &&
        publishSources.has('release/commercial-release-readiness-report.strict.json') &&
        publishSources.has('release/commercial-finalization-report.json') &&
        publishSources.has('release/commercial-finalization-report-verification.strict.json'),
      publishGroup ? (publishGroup.sourceReports || []).join(', ') : 'missing publish-and-remote-asset-verification group',
      'warn',
    );
    add(
      'existing unblock plan commercial finalization commands',
      publishCommandText.includes('release:commercial-finalize:commercial') &&
        publishCommandText.includes('verify:commercial-finalization:commercial'),
      publishCommandText || 'missing publish-and-remote-asset-verification commands',
      'warn',
    );
  }

  const unblockPlanStrictReportMeta = reportMeta(unblockPlanReportStrict);
  if (unblockPlanStrictReportMeta) {
    const checksByName = new Map((unblockPlanStrictReportMeta.checks || []).map((check) => [check.name, check]));
    add(
      'existing unblock plan commercial finalization verification checks',
      checksByName.get('release unblock commercial finalization source reports')?.ok === true &&
        checksByName.get('release unblock publish group commercial finalization source coverage')?.ok === true &&
        checksByName.get('release unblock publish group commercial finalization commands')?.ok === true &&
        checksByName.get('release unblock commercial finalization reports verified')?.ok === true,
      'strict unblock verifier proves commercial source coverage, commands, and readiness-report semantics',
      'warn',
    );
  }

	  for (const [label, file] of [
	    ['release env report', releaseEnvReport],
	    ['release env contract report', releaseEnvContractReport],
	    ['release env bootstrap verification report', releaseEnvBootstrapVerification],
	    ['temp cleanup report', tempCleanupReport],
	    ['baseline export report', baselineExport],
    ['baseline export verification report', baselineExportVerification],
    ['release status refresh report', statusRefreshReport],
    ['installed app parity report', installedAppParity],
    ['GitHub Release publish plan verification report', githubReleasePublishPlanVerification],
    ['GitHub Release remediation plan', githubReleaseRemediationPlan],
    ['GitHub Release remediation plan report', githubReleaseRemediationReport],
    ['strict GitHub Release remediation plan report', githubReleaseRemediationReportStrict],
    ['strict GitHub Release remediation apply plan report', githubReleaseRemediationApplyPlanReportStrict],
    ['release process env report', releaseEnvProcessReport],
    ['secret hygiene report', secretHygiene],
    ['IPC security report', ipcSecurity],
    ['release unblock plan report', unblockPlanReport],
    ['strict release unblock plan report', unblockPlanReportStrict],
    ['baseline freshness report', baselineFreshness],
    ['production readiness summary', productionReadinessSummary],
    ['production readiness summary verification report', productionReadinessSummaryVerification],
    ['engineering readiness report', engineeringReadiness],
    ['commercial cutover report', commercialCutoverReportStrict],
    ['release setup plan verification report', setupPlanVerification],
    ['release publication seal', publicationSeal],
  ]) {
    const summary = reportSummary(file);
    if (!summary) continue;
    const localEnvAdvisoryOnly = label === 'release env report' && releaseEnvReportHasOnlyLocalFileAdvisory(file);
    const commercialCutoverSelfCheckOnly =
      label === 'commercial cutover report' && commercialCutoverHasOnlyStatusRefreshSelfCheck(file, summary);
    const clean =
      (summary.blockers === 0 && (!strict || summary.warnings === 0 || localEnvAdvisoryOnly)) ||
      commercialCutoverSelfCheckOnly;
    let detail = `${summary.blockers} blocker(s), ${summary.warnings} warning(s)`;
    if (localEnvAdvisoryOnly) {
      detail += '; only .env.release.local advisory, process env report remains authoritative';
    } else if (commercialCutoverSelfCheckOnly) {
      detail += '; accepted bounded status-refresh self-check convergence';
    }
    add(
      `existing ${label} clean`,
      clean,
      detail,
      strict ? 'blocker' : 'warn',
    );
  }

  const requireGitHubOperatorReadiness = process.env.CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS === '1';
  const githubOperatorReport = reportMeta(githubOperatorReadiness);
  if (githubOperatorReport) {
    const githubSummary = {
      blockers: Number(githubOperatorReport.summary?.blockers || 0),
      warnings: Number(githubOperatorReport.summary?.warnings || 0),
    };
    add(
      'existing GitHub operator readiness report mode',
      githubOperatorReport.github === true && githubOperatorReport.strict === true,
      `github=${Boolean(githubOperatorReport.github)} strict=${Boolean(githubOperatorReport.strict)}`,
      strict ? 'blocker' : 'warn',
    );
    add(
      'existing GitHub operator readiness report clean',
      githubSummary.blockers === 0 && githubSummary.warnings === 0,
      `${githubSummary.blockers} blocker(s), ${githubSummary.warnings} warning(s)`,
      strict ? 'blocker' : 'warn',
    );
  } else if (strict && requireGitHubOperatorReadiness) {
    add(
      'existing GitHub operator readiness report',
      false,
      'missing release/operator-readiness.github.json; run npm run release:operator-checklist:github:strict',
    );
  }
}

function printReport() {
  const blockers = checks.filter((item) => !item.ok && item.level === 'blocker').length;
  const warnings = checks.filter((item) => !item.ok && item.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      hostname: os.hostname(),
    },
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  const reportPath = path.join(releaseDir, strict ? 'preflight-report.strict.json' : 'preflight-report.json');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI release preflight (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (strict && blockers > 0 && !noExit) process.exit(1);
}

checkTooling();
checkPackage();
checkBaseline();
checkWorkflow();
checkAppAsarPolicy();
checkDocs();
checkSigningInputs();
checkReleaseArtifacts();
printReport();
