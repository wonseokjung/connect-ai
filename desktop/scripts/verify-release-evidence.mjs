import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_MAIN_DELTA_SOURCE,
  APPROVED_SECURITY_DEPENDENCY_DELTA_PACKAGES,
  APPROVED_SECURITY_DEPENDENCY_DELTA_PREFIXES,
  appAsarContentOk,
  appAsarPolicyDetail,
} from './app-asar-policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const checks = [];
const testedSourcePaths = [
  'out/main.js',
  'out/preload.js',
  'out/renderer.js',
  'out/sim.js',
  'out/sim-mem.js',
  'out/sim-memory.js',
  'out/simmem.js',
  'src/renderer/index.html',
  'src/renderer/extension-ui.css',
  'src/renderer/supplement.css',
  'src/renderer/force-graph.min.js',
  'assets/plaza-bg.png',
];

function isApprovedChangedSource(source) {
  return source === APPROVED_MAIN_DELTA_SOURCE ||
    APPROVED_SECURITY_DEPENDENCY_DELTA_PREFIXES.some((prefix) => source.startsWith(prefix));
}

function approvedSecurityDependencyVersionsOk(entries = [], options = {}) {
  const { requirePackaged = false } = options;
  const byName = new Map(entries.map((entry) => [entry.packageName, entry]));
  for (const [packageName, expectedVersion] of APPROVED_SECURITY_DEPENDENCY_DELTA_PACKAGES.entries()) {
    const entry = byName.get(packageName);
    if (!entry) return false;
    if (requirePackaged && entry.asarPackagePresent !== true) return false;
    if (entry.expectedVersion !== expectedVersion) return false;
    if (entry.ok !== true) return false;
    if (requirePackaged && entry.actualVersion !== expectedVersion) return false;
  }
  return true;
}

function packageMetadataPolicyDetail(policy) {
  if (!policy) return 'missing';
  const security = (policy.approvedSecurityDependencySpecs || [])
    .map((entry) => `${entry.packageName} candidate=${entry.candidateSpec || 'missing'} local=${entry.localSpec || 'missing'} ok=${entry.ok}`)
    .join(', ');
  const relocated = (policy.approvedTypeOnlyDependencyRelocations || [])
    .map((entry) => `${entry.packageName} dependency=${entry.candidateDependencySpec || 'missing'} dev=${entry.localDevDependencySpec || 'missing'} ok=${entry.ok}`)
    .join(', ');
  return `${policy.reason || 'no reason'}; security=[${security || 'none'}]; typeOnly=[${relocated || 'none'}]`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha(file, algorithm, encoding = 'hex') {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
  });
}

function artifactPath(name) {
  return path.join(releaseDir, name);
}

function currentTestedSourceFiles() {
  return testedSourcePaths.map((relativePath) => {
    const file = path.join(desktopDir, relativePath);
    const present = fs.existsSync(file);
    return {
      path: relativePath,
      present,
      bytes: present ? fs.statSync(file).size : null,
      sha256: present ? sha(file, 'sha256') : null,
    };
  });
}

function verifyTestedSourceFingerprint(report, label) {
  const reported = Array.isArray(report.testedSource?.files) ? report.testedSource.files : [];
  const actual = currentTestedSourceFiles();
  const reportedByPath = new Map(reported.map((item) => [item.path, item]));
  const mismatches = [];
  for (const item of actual) {
    const match = reportedByPath.get(item.path);
    if (!match) {
      mismatches.push(`${item.path}: missing from report`);
      continue;
    }
    if (match.present !== item.present || match.bytes !== item.bytes || match.sha256 !== item.sha256) {
      mismatches.push(`${item.path}: report=${match.bytes || 'missing'}/${match.sha256 || 'missing'} current=${item.bytes || 'missing'}/${item.sha256 || 'missing'}`);
    }
  }
  const extras = reported.filter((item) => item?.path && !testedSourcePaths.includes(item.path));
  add(
    `${label} tested source fingerprint`,
    reported.length === testedSourcePaths.length && extras.length === 0 && mismatches.length === 0,
    mismatches.length ? mismatches.slice(0, 6).join('; ') : `${reported.length} source file(s) match current build`,
  );
  add(
    `${label} tested source coverage`,
    actual.every((item) => item.present === true),
    actual.filter((item) => !item.present).map((item) => item.path).join(', ') || `${actual.length} source file(s) present`,
  );
}

function releaseAsarArtifact(manifest) {
  return (manifest.release?.artifacts || []).find((artifact) => artifact.path?.endsWith('/app.asar'));
}

function manifestAppAsarOk(manifest) {
  const expectedAsarSha = manifest.baseline?.appAsar?.expectedSha256;
  const releaseAsar = releaseAsarArtifact(manifest);
  return appAsarContentOk({
    expectedSha256: expectedAsarSha,
    candidateSha256: releaseAsar?.sha256,
    policy: manifest.release?.appAsarPolicy,
  });
}

function manifestAppAsarDetail(manifest) {
  const expectedAsarSha = manifest.baseline?.appAsar?.expectedSha256;
  const releaseAsar = releaseAsarArtifact(manifest);
  return appAsarPolicyDetail({
    expectedSha256: expectedAsarSha,
    candidateSha256: releaseAsar?.sha256,
    policy: manifest.release?.appAsarPolicy,
  });
}

function githubOperatorRequired() {
  return process.env.CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS === '1' ||
    fs.existsSync(artifactPath('operator-readiness.github.json'));
}

function readChecksumFile(fileName) {
  const file = artifactPath(fileName);
  if (!fs.existsSync(file)) return null;
  const entries = new Map();
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([A-Fa-f0-9]+)\s{2}(.+)$/);
    if (!match) {
      entries.set(`__invalid_${entries.size}`, line);
      continue;
    }
    entries.set(match[2], match[1].toLowerCase());
  }
  return entries;
}

function expectedReleaseStatus(manifest) {
  const security = manifest.security || {};
  const appContentOk = manifestAppAsarOk(manifest);
  const sbomOk = fs.existsSync(artifactPath('sbom.cdx.json')) && fs.existsSync(artifactPath('sbom.spdx.json'));
  const macosSecurityFile = artifactPath('macos-security-contract.json');
  const macosSecurityOk = fs.existsSync(macosSecurityFile) && readJson(macosSecurityFile).ok === true;
  const ipcSecurityFile = artifactPath('ipc-security-report.json');
  const ipcSecurityOk = fs.existsSync(ipcSecurityFile) && readJson(ipcSecurityFile).ok === true && readJson(ipcSecurityFile).summary?.blockers === 0;
  const releaseEnvContractFile = artifactPath('release-env-contract-report.json');
  const releaseEnvContract = fs.existsSync(releaseEnvContractFile) ? readJson(releaseEnvContractFile) : null;
  const releaseEnvContractOk = releaseEnvContract?.schemaVersion === 1 && releaseEnvContract.summary?.blockers === 0 && releaseEnvContract.summary?.warnings === 0;
  const releaseEnvFile = fs.existsSync(artifactPath('release-env-report.process.json'))
    ? artifactPath('release-env-report.process.json')
    : artifactPath('release-env-report.json');
  const releaseEnv = fs.existsSync(releaseEnvFile) ? readJson(releaseEnvFile) : null;
  const releaseEnvOk = releaseEnv?.schemaVersion === 1 && releaseEnv.summary?.blockers === 0;
  const secretHygieneFile = artifactPath('secret-hygiene-report.json');
  const secretHygiene = fs.existsSync(secretHygieneFile) ? readJson(secretHygieneFile) : null;
  const secretHygieneOk = secretHygiene?.schemaVersion === 1 && secretHygiene.summary?.blockers === 0;
  const securityAuditFile = artifactPath('security-audit-report.json');
  const securityAudit = fs.existsSync(securityAuditFile) ? readJson(securityAuditFile) : null;
  const securityAuditOk = securityAudit?.ok === true && securityAudit.summary?.blockers === 0;
  const launchSmokeFile = artifactPath('release-launch-smoke.json');
  const launchSmokeOk = fs.existsSync(launchSmokeFile) && readJson(launchSmokeFile).ok === true;
  const dmgLaunchSmokeFile = artifactPath('release-dmg-launch-smoke.json');
  const dmgLaunchSmokeOk = fs.existsSync(dmgLaunchSmokeFile) && readJson(dmgLaunchSmokeFile).ok === true;
  const dmgInstallFile = artifactPath('dmg-install-experience.json');
  const dmgInstallOk = fs.existsSync(dmgInstallFile) && readJson(dmgInstallFile).ok === true;
  const signingReadinessFile = artifactPath('signing-readiness.json');
  const signingReadiness = fs.existsSync(signingReadinessFile) ? readJson(signingReadinessFile) : null;
  const signingReadinessOk = signingReadiness?.schemaVersion === 1 && signingReadiness.summary?.blockers === 0;
  const updateChannelFile = artifactPath('update-channel-report.json');
  const updateChannelOk = fs.existsSync(updateChannelFile) && readJson(updateChannelFile).ok === true;
  const installedAppParityFile = artifactPath('installed-app-parity-report.json');
  const installedAppParityOk = fs.existsSync(installedAppParityFile) && readJson(installedAppParityFile).ok === true;
  const uiParityFile = artifactPath('ui-parity-report.json');
  const uiParityOk = fs.existsSync(uiParityFile) && readJson(uiParityFile).ok === true;
  const performanceParityFile = artifactPath('performance-parity-report.json');
  const performanceParityOk = fs.existsSync(performanceParityFile) && readJson(performanceParityFile).ok === true;
  const ok = Boolean(
    appContentOk &&
      installedAppParityOk &&
      uiParityOk &&
      performanceParityOk &&
      macosSecurityOk &&
      ipcSecurityOk &&
      releaseEnvContractOk &&
      releaseEnvOk &&
      secretHygieneOk &&
      securityAuditOk &&
      dmgInstallOk &&
      launchSmokeOk &&
      dmgLaunchSmokeOk &&
      signingReadinessOk &&
      updateChannelOk &&
      sbomOk &&
      security.productionAudit?.ok &&
      security.codesignVerify?.ok &&
      security.gatekeeper?.ok &&
      security.stapler?.ok &&
      security.dmgGatekeeper?.ok &&
      security.dmgStapler?.ok
  );
  return ok ? 'signed-and-notarized' : 'local-evidence-only';
}

function assertArtifactFiles(manifest) {
  const version = manifest.product?.version;
  const envReportName = strict ? 'release-env-report.process.json' : 'release-env-report.json';
  const required = [
    `Connect-AI-${version}-mac-arm64.dmg`,
    `Connect-AI-${version}-mac-arm64.dmg.blockmap`,
    'latest-mac.yml',
    'release-manifest.json',
    'release-tag-report.json',
    'installed-app-parity-report.json',
    'ui-parity-report.json',
    'performance-parity-report.json',
    'macos-security-contract.json',
    'ipc-security-report.json',
    'release-env-contract-report.json',
    'security-audit-report.json',
    'secret-hygiene-report.json',
    'dmg-install-experience.json',
    'release-launch-smoke.json',
    'release-dmg-launch-smoke.json',
    'signing-readiness.json',
    'operator-readiness.json',
    githubOperatorRequired() ? 'operator-readiness.github.json' : null,
    'update-channel-report.json',
    envReportName,
    'provenance.json',
    'RELEASE_NOTES.md',
    'SHA256SUMS.txt',
    'SHA512SUMS.txt',
    'sbom.cdx.json',
    'sbom.spdx.json',
  ].filter(Boolean);
  for (const name of ['operator-readiness.json', 'operator-readiness.github.json']) {
    if (fs.existsSync(artifactPath(name)) && !required.includes(name)) required.push(name);
  }
  const uniqueRequired = [...new Set(required)];
  for (const name of uniqueRequired) {
    const file = artifactPath(name);
    add(`artifact ${name}`, fs.existsSync(file), fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'missing');
  }
  return uniqueRequired;
}

function verifyChecksums(names) {
  const sha256Entries = readChecksumFile('SHA256SUMS.txt');
  const sha512Entries = readChecksumFile('SHA512SUMS.txt');
  add('SHA256SUMS format', Boolean(sha256Entries) && ![...sha256Entries.keys()].some((name) => name.startsWith('__invalid_')), 'hex checksum double-space filename');
  add('SHA512SUMS format', Boolean(sha512Entries) && ![...sha512Entries.keys()].some((name) => name.startsWith('__invalid_')), 'hex checksum double-space filename');
  if (!sha256Entries || !sha512Entries) return;

  const checksumExcluded = new Set([
    'RELEASE_NOTES.md',
    'SHA256SUMS.txt',
    'SHA512SUMS.txt',
    'release-env-report.json',
    'release-env-report.process.json',
    'secret-hygiene-report.json',
  ]);
  const checksumTargets = names.filter((name) => !checksumExcluded.has(name));
  for (const name of checksumTargets) {
    const file = artifactPath(name);
    if (!fs.existsSync(file)) continue;
    add(`SHA256 ${name}`, sha256Entries.get(name) === sha(file, 'sha256'), sha256Entries.get(name) || 'missing');
    add(`SHA512 ${name}`, sha512Entries.get(name) === sha(file, 'sha512'), sha512Entries.get(name) || 'missing');
  }

  const extra256 = [...sha256Entries.keys()].filter((name) => !checksumTargets.includes(name));
  const extra512 = [...sha512Entries.keys()].filter((name) => !checksumTargets.includes(name));
  add('SHA256SUMS target set', extra256.length === 0 && checksumTargets.every((name) => sha256Entries.has(name)), extra256.length ? `extra ${extra256.join(', ')}` : `${checksumTargets.length} targets`);
  add('SHA512SUMS target set', extra512.length === 0 && checksumTargets.every((name) => sha512Entries.has(name)), extra512.length ? `extra ${extra512.join(', ')}` : `${checksumTargets.length} targets`);
}

function verifyReleaseNotes(manifest) {
  const file = artifactPath('RELEASE_NOTES.md');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const version = manifest.product?.version;
  const expectedStatus = expectedReleaseStatus(manifest);
  const expectedAsarSha = manifest.baseline?.appAsar?.expectedSha256;
  const releaseAsar = releaseAsarArtifact(manifest);

  add('release notes title', text.includes(`# Connect AI ${version} Desktop Release`), `version ${version}`);
  add('release notes status', text.includes(`Status: ${expectedStatus}`), expectedStatus);
  add('release notes app.asar hash', Boolean(releaseAsar?.sha256) && text.includes(releaseAsar.sha256), releaseAsar?.sha256 || 'missing');
  add('release notes expected app.asar hash', Boolean(expectedAsarSha) && text.includes(expectedAsarSha), expectedAsarSha || 'missing');
  add('release notes tag gate line', text.includes('Release tag/version gate: PASS'), 'Release tag/version gate: PASS');
  add('release notes UI parity line', text.includes('UI and behavior parity: PASS'), 'UI and behavior parity: PASS');
  add('release notes performance parity line', text.includes('Renderer performance parity: PASS'), 'Renderer performance parity: PASS');
  add('release notes macOS security line', text.includes('macOS security contract: PASS'), 'macOS security contract: PASS');
  add('release notes IPC security line', text.includes('IPC security runtime: PASS'), 'IPC security runtime: PASS');
  add('release notes env contract line', text.includes('Release environment contract: PASS'), 'Release environment contract: PASS');
  add('release notes env checklist line', text.includes('Release environment checklist: PASS'), 'Release environment checklist: PASS');
  add('release notes secret hygiene line', text.includes('Secret hygiene scan: PASS'), 'Secret hygiene scan: PASS');
  add('release notes security audit line', text.includes('Security audit report: PASS'), 'Security audit report: PASS');
  add('release notes DMG install line', text.includes('DMG install experience: PASS'), 'DMG install experience: PASS');
  add('release notes launch smoke line', text.includes('Packaged app launch smoke: PASS'), 'Packaged app launch smoke: PASS');
  add('release notes DMG launch smoke line', text.includes('DMG app launch smoke: PASS'), 'DMG app launch smoke: PASS');
  add('release notes Developer ID signature line', text.includes('Release app Developer ID signature:'), 'Release app Developer ID signature');
  add('release notes signing readiness line', text.includes('Signing readiness report: PASS'), 'Signing readiness report: PASS');
  add('release notes operator readiness line', text.includes('Operator readiness report: PASS'), 'Operator readiness report: PASS');
  if (githubOperatorRequired()) {
    add('release notes GitHub automation readiness line', text.includes('GitHub automation readiness:'), 'GitHub automation readiness');
  }
  add('release notes update channel line', text.includes('Update channel metadata: PASS'), 'Update channel metadata: PASS');
  add('release notes SBOM line', text.includes('SBOM generated: PASS'), 'SBOM generated: PASS');
  if (strict) {
    add('release notes production status', expectedStatus === 'signed-and-notarized', expectedStatus);
  }
}

function checkNamedPass(report, name) {
  return (report.checks || []).some((check) => check.name === name && check.ok === true);
}

function verifyReleaseTag(manifest) {
  const file = artifactPath('release-tag-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  const expectedTag = `desktop-v${manifest.product?.version}`;
  add('release tag schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('release tag status', report.ok === true && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('release tag product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('release tag expected', report.releaseTag?.expected === expectedTag, report.releaseTag?.expected || 'missing');
  add('release tag resolved', report.releaseTag?.resolved === expectedTag, report.releaseTag?.resolved || 'missing');
}

function verifyBaselineFreshness(manifest) {
  const file = artifactPath('baseline-freshness-report.json');
  add('baseline freshness artifact', fs.existsSync(file), 'baseline-freshness-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  const expectedAsarSha = manifest.baseline?.appAsar?.expectedSha256;
  const releaseAsar = releaseAsarArtifact(manifest);
  const reportPolicy = report.releaseManifest?.releaseAppAsarPolicy || manifest.release?.appAsarPolicy;
  add('baseline freshness schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('baseline freshness status', report.ok === true && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('baseline freshness product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('baseline freshness expected version', report.product?.expectedVersion === manifest.product?.expectedVersion, report.product?.expectedVersion || 'missing');
  add('baseline freshness product app id', report.product?.appId === manifest.product?.appId, report.product?.appId || 'missing');
  add('baseline freshness baseline hash', report.baseline?.appAsar?.actualSha256 === expectedAsarSha && report.baseline?.appAsar?.expectedSha256 === expectedAsarSha, report.baseline?.appAsar?.actualSha256 || 'missing');
  add('baseline freshness package version', report.baseline?.package?.version === manifest.product?.version, report.baseline?.package?.version || 'missing');
  add('baseline freshness release manifest hash', report.releaseManifest?.baselineActualSha256 === expectedAsarSha && report.releaseManifest?.baselineExpectedSha256 === expectedAsarSha, report.releaseManifest?.baselineActualSha256 || 'missing');
  add(
    'baseline freshness release app.asar hash',
    report.releaseManifest?.releaseAppAsarSha256 === releaseAsar?.sha256 &&
      appAsarContentOk({
        expectedSha256: expectedAsarSha,
        candidateSha256: releaseAsar?.sha256,
        policy: reportPolicy,
      }),
    appAsarPolicyDetail({
      expectedSha256: expectedAsarSha,
      candidateSha256: report.releaseManifest?.releaseAppAsarSha256,
      policy: reportPolicy,
    }),
  );
}

function verifyInstalledAppParity(manifest) {
  const file = artifactPath('installed-app-parity-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  const approvedDelta = (report.approvedDeltas || []).find((delta) => delta.id === 'main-process-security-hardening');
  const allowedBundleMismatches = new Set(approvedDelta?.allowedBundleMismatches || []);
  const changedSources = new Set(approvedDelta?.changedSources || []);
  const requiredMarkers = approvedDelta?.requiredMarkers || [];
  const approvedSecurityDependencies = approvedDelta?.approvedSecurityDependencyPackages || [];
  add('installed app parity schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('installed app parity status', report.ok === true && report.status === 'passed' && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('installed app parity product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('installed app parity product app id', report.product?.appId === manifest.product?.appId, report.product?.appId || 'missing');
  add('installed app parity baseline app.asar', report.baseline?.asarSha256 === manifest.baseline?.appAsar?.expectedSha256, report.baseline?.asarSha256 || 'missing');
  add('installed app parity approved security delta', approvedDelta?.ok === true, approvedDelta?.reason || 'missing');
  add(
    'installed app parity approved source scope',
    changedSources.has(APPROVED_MAIN_DELTA_SOURCE) && [...changedSources].every(isApprovedChangedSource),
    [...changedSources].join(', ') || 'missing',
  );
  add(
    'installed app parity approved bundle scope',
    allowedBundleMismatches.size === 2 &&
      allowedBundleMismatches.has('main.js') &&
      allowedBundleMismatches.has('main.js.map'),
    [...allowedBundleMismatches].join(', ') || 'missing',
  );
  add(
    'installed app parity approved security dependency scope',
    approvedSecurityDependencyVersionsOk(approvedSecurityDependencies),
    approvedSecurityDependencies.map((entry) => `${entry.packageName}@${entry.actualVersion || 'not-bundled'} expected ${entry.expectedVersion} ok=${entry.ok}`).join(', ') || 'missing',
  );
  add(
    'installed app parity package metadata policy',
    approvedDelta?.packageMetadata?.ok === true,
    packageMetadataPolicyDetail(approvedDelta?.packageMetadata),
  );
  add(
    'installed app parity hardening marker coverage',
    requiredMarkers.length >= 8 && requiredMarkers.every((entry) => entry.ok === true),
    `${requiredMarkers.filter((entry) => entry.ok === true).length}/${requiredMarkers.length} marker(s)`,
  );
}

function verifyUiParity(manifest) {
  const file = artifactPath('ui-parity-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  const similarity = Number(report.screenshots?.similarity);
  const fullPageSimilarity = Number(report.screenshots?.fullPageSimilarity);
  add('UI parity schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('UI parity status', report.ok === true && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('UI parity product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('UI parity product app id', report.product?.appId === manifest.product?.appId, report.product?.appId || 'missing');
  add('UI parity baseline app.asar', report.baseline?.appAsarSha256 === report.baseline?.expectedAppAsarSha256 && report.baseline?.expectedAppAsarSha256 === manifest.baseline?.appAsar?.expectedSha256, report.baseline?.appAsarSha256 || 'missing');
  const screenshotScope = report.screenshots?.scope || 'unknown';
  add('UI parity screenshot similarity', Number.isFinite(similarity) && similarity >= 0.99, Number.isFinite(similarity) ? `${(similarity * 100).toFixed(2)}% (${screenshotScope})` : 'missing');
  add('UI parity full-page screenshot similarity', Number.isFinite(fullPageSimilarity) && fullPageSimilarity >= 0.99, Number.isFinite(fullPageSimilarity) ? `${(fullPageSimilarity * 100).toFixed(2)}%` : 'missing');
  add('UI parity preload method count', Number(report.surface?.localPreloadMethods) === Number(report.surface?.baselinePreloadMethods) && Number(report.surface?.localPreloadMethods) > 0, `${report.surface?.localPreloadMethods ?? 'missing'} / ${report.surface?.baselinePreloadMethods ?? 'missing'}`);
  add('UI parity check coverage', Array.isArray(report.checks) && report.checks.length >= 10, `${report.checks?.length || 0} checks`);
  verifyTestedSourceFingerprint(report, 'UI parity');
}

function verifyPerformanceParity(manifest) {
  const file = artifactPath('performance-parity-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  const localLoad = Number(report.measurements?.local?.loadMs);
  const baselineLoad = Number(report.measurements?.baseline?.loadMs);
  const localInteractions = report.measurements?.local?.interactions || [];
  const baselineInteractions = report.measurements?.baseline?.interactions || [];
  add('performance parity schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('performance parity status', report.ok === true && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('performance parity product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('performance parity product app id', report.product?.appId === manifest.product?.appId, report.product?.appId || 'missing');
  add('performance parity baseline app.asar', report.baseline?.appAsarSha256 === report.baseline?.expectedAppAsarSha256 && report.baseline?.expectedAppAsarSha256 === manifest.baseline?.appAsar?.expectedSha256, report.baseline?.appAsarSha256 || 'missing');
  add('performance parity renderer load budget', Number.isFinite(localLoad) && Number.isFinite(baselineLoad) && localLoad <= Math.max(baselineLoad * 1.5, baselineLoad + 750), `local=${localLoad || 'missing'}ms baseline=${baselineLoad || 'missing'}ms`);
  add('performance parity interaction coverage', localInteractions.length >= 6 && baselineInteractions.length === localInteractions.length, `local=${localInteractions.length} baseline=${baselineInteractions.length}`);
  add('performance parity interaction checks', (report.checks || []).filter((check) => /^interaction latency parity:/.test(check.name) && check.ok === true).length >= 6, `${(report.checks || []).filter((check) => /^interaction latency parity:/.test(check.name) && check.ok === true).length} passing interaction checks`);
  add('performance parity resource footprint', (report.checks || []).some((check) => check.name === 'resource footprint parity' && check.ok === true), 'resource footprint parity');
  add('performance parity heap budget', (report.checks || []).some((check) => check.name === 'renderer heap budget parity' && check.ok === true), 'renderer heap budget parity');
  verifyTestedSourceFingerprint(report, 'performance parity');
}

function verifyMacosSecurityContract(manifest) {
  const file = artifactPath('macos-security-contract.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('macOS security schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('macOS security status', report.ok === true && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('macOS security product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('macOS security product app id', report.product?.appId === manifest.product?.appId, report.product?.appId || 'missing');
  add('macOS security hardened runtime', checkNamedPass(report, 'package hardened runtime'), 'package hardened runtime');
  add('macOS security entitlement allowlist', checkNamedPass(report, 'entitlement exact allowlist'), 'entitlement exact allowlist');
  add('macOS security package ATS arbitrary loads disabled', checkNamedPass(report, 'package ATS arbitrary loads disabled'), 'package ATS arbitrary loads disabled');
  add('macOS security release ATS arbitrary loads disabled', checkNamedPass(report, 'release ATS arbitrary loads disabled'), 'release ATS arbitrary loads disabled');
  add('macOS security ATS allowlist', checkNamedPass(report, 'release ATS exception domain allowlist'), 'release ATS exception domain allowlist');
  add('macOS security asar integrity', checkNamedPass(report, 'release Electron asar integrity'), 'release Electron asar integrity');
}

function verifyIpcSecurity(manifest) {
  const file = artifactPath('ipc-security-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  const protocols = report.policy?.externalUrlProtocols || [];
  const protocolSet = new Set(protocols);
  add('IPC security schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('IPC security status', report.ok === true && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('IPC security product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('IPC security product app id', report.product?.appId === manifest.product?.appId, report.product?.appId || 'missing');
  add(
    'IPC security external URL allowlist',
    protocolSet.has('http:') &&
      protocolSet.has('https:') &&
      protocolSet.has('mailto:') &&
      !protocolSet.has('javascript:') &&
      !protocolSet.has('file:'),
    protocols.join(', ') || 'missing',
  );
  add('IPC security workspace confinement policy', report.policy?.workspaceConfinement === true, String(report.policy?.workspaceConfinement));
  add('IPC security API coverage', Array.isArray(report.policy?.checkedApis) && report.policy.checkedApis.length >= 7, `${report.policy?.checkedApis?.length || 0} API(s)`);
  for (const name of [
    'absolute outside fsRead rejected',
    'relative traversal fsRead rejected',
    'absolute outside fsWrite rejected',
    'outside fsTree rejected',
    'outside fsReveal rejected',
    'outside opsOpenArtifact rejected',
    'outside terminal cwd rejected',
    'javascript external URL rejected',
    'file external URL rejected',
    'https external URL accepted',
    'outside file unchanged',
    'external opener accepted only safe URL',
  ]) {
    add(`IPC security ${name}`, checkNamedPass(report, name), name);
  }
  add('IPC security check coverage', Array.isArray(report.checks) && report.checks.length >= 16, `${report.checks?.length || 0} checks`);
}

function verifyReleaseEnv() {
  const name = strict ? 'release-env-report.process.json' : 'release-env-report.json';
  const file = artifactPath(name);
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('release env schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('release env mode', strict ? report.strict === true && report.processEnv === true : report.processEnv === false, `strict=${Boolean(report.strict)} processEnv=${Boolean(report.processEnv)}`);
  add('release env summary', Number.isFinite(report.summary?.blockers) && Number.isFinite(report.summary?.warnings), JSON.stringify(report.summary || {}));
  add('release env blockers', report.summary?.blockers === 0, `${report.summary?.blockers ?? 'unknown'} blocker(s)`);
  if (strict) {
    add('release env warnings', report.summary?.warnings === 0, `${report.summary?.warnings ?? 'unknown'} warning(s)`);
  }
  add('release env key list', Array.isArray(report.keys), `${report.keys?.length || 0} key(s); values redacted`);
  if (Array.isArray(report.keys) && report.keys.length > 0) {
    add('release env redaction check', checkNamedPass(report, 'release env secret values redacted'), 'release env secret values redacted');
  }
}

function verifyReleaseEnvContract() {
  const file = artifactPath('release-env-contract-report.json');
  add('release env contract artifact', fs.existsSync(file), 'release-env-contract-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('release env contract schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('release env contract summary', report.summary?.blockers === 0 && report.summary?.warnings === 0, JSON.stringify(report.summary || {}));
  add('release env contract key list', Array.isArray(report.contract?.requiredVariables) && Array.isArray(report.contract?.auditTokenSources), `${report.contract?.requiredVariables?.length || 0} required variable(s), ${report.contract?.auditTokenSources?.length || 0} audit token source(s)`);
  add('release env contract GitHub token fallback', (report.contract?.auditTokenSources || []).includes('GH_TOKEN'), 'GH_TOKEN fallback documented in contract');
  add('release env contract check coverage', Array.isArray(report.checks) && report.checks.length >= 15, `${report.checks?.length || 0} checks`);
  for (const name of [
    'release env template documents supported aliases',
    'verify-release-env recognizes release env contract',
    'apply-github-release-setup recognizes release env contract',
    'GitHub setup maps GH_TOKEN fallback to audit secret',
    'workflow uploads release env contract report',
    'distribution guide documents release env contract verifier',
    'operator checklist documents release env contract verifier',
  ]) {
    add(`release env contract ${name}`, checkNamedPass(report, name), name);
  }
}

function verifySecretHygiene() {
  const file = artifactPath('secret-hygiene-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('secret hygiene schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('secret hygiene summary', Number.isFinite(report.summary?.blockers) && Number.isFinite(report.summary?.warnings), JSON.stringify(report.summary || {}));
  add('secret hygiene blockers', report.summary?.blockers === 0, `${report.summary?.blockers ?? 'unknown'} blocker(s)`);
  add('secret hygiene warnings', report.summary?.warnings === 0, `${report.summary?.warnings ?? 'unknown'} warning(s)`);
  add('secret hygiene check list', Array.isArray(report.checks) && report.checks.length >= 8, `${report.checks?.length || 0} checks`);
  add('secret hygiene sensitive env names', Array.isArray(report.sensitiveEnvNamesPresent), `${report.sensitiveEnvNamesPresent?.length || 0} sensitive env name(s); values redacted`);
  add('secret hygiene release artifact scan', checkNamedPass(report, 'release text artifact scan'), 'release text artifact scan');
  add('secret hygiene secret value scan', checkNamedPass(report, 'release secret value scan'), 'release secret value scan');
  add('secret hygiene local secret inventory', (report.checks || []).some((check) => /^local secret file/.test(check.name) && check.ok === true), 'local secret inventory');
  add('secret hygiene GitHub token scan', checkNamedPass(report, 'release GitHub token literal scan'), 'release GitHub token literal scan');
  add('secret hygiene private key scan', checkNamedPass(report, 'release private key marker scan'), 'release private key marker scan');
  add('secret hygiene Apple private key scan', checkNamedPass(report, 'release Apple private key marker scan'), 'release Apple private key marker scan');
}

function verifySigningReadiness() {
  const file = artifactPath('signing-readiness.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('signing readiness schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('signing readiness check list', Array.isArray(report.checks) && report.checks.length > 0, `${report.checks?.length || 0} checks`);
  add('signing readiness summary', Number.isFinite(report.summary?.blockers) && Number.isFinite(report.summary?.warnings), JSON.stringify(report.summary || {}));
  if (strict) {
    add('signing readiness production blockers', report.summary?.blockers === 0, `${report.summary?.blockers ?? 'unknown'} blocker(s)`);
  }
}

function verifyOperatorReadiness() {
  const file = artifactPath('operator-readiness.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('operator readiness schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('operator readiness mode', report.github === false, `github=${Boolean(report.github)} strict=${Boolean(report.strict)}`);
  add('operator readiness check list', Array.isArray(report.checks) && report.checks.length > 0, `${report.checks?.length || 0} checks`);
  add('operator readiness summary', Number.isFinite(report.summary?.blockers) && Number.isFinite(report.summary?.warnings), JSON.stringify(report.summary || {}));
  if (strict) {
    add('operator readiness production blockers', report.summary?.blockers === 0, `${report.summary?.blockers ?? 'unknown'} blocker(s)`);
  }
}

function verifyGithubOperatorReadiness() {
  if (!githubOperatorRequired()) return;
  const file = artifactPath('operator-readiness.github.json');
  add('GitHub operator readiness artifact', fs.existsSync(file), 'operator-readiness.github.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('GitHub operator readiness schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('GitHub operator readiness mode', report.github === true && report.strict === true, `github=${Boolean(report.github)} strict=${Boolean(report.strict)}`);
  add('GitHub operator readiness check list', Array.isArray(report.checks) && report.checks.length > 0, `${report.checks?.length || 0} checks`);
  add('GitHub operator readiness summary', Number.isFinite(report.summary?.blockers) && Number.isFinite(report.summary?.warnings), JSON.stringify(report.summary || {}));
  if (strict || process.env.CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS === '1') {
    add('GitHub operator readiness clean', report.summary?.blockers === 0 && report.summary?.warnings === 0, `${report.summary?.blockers ?? 'unknown'} blocker(s), ${report.summary?.warnings ?? 'unknown'} warning(s)`);
  }
}

function verifyUpdateChannel(manifest) {
  const file = artifactPath('update-channel-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('update channel schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('update channel status', report.ok === true && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('update channel product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('update channel provider', report.updateChannel?.provider === 'github', report.updateChannel?.provider || 'missing');
  add('update channel owner repo', report.updateChannel?.owner === 'wonseokjung' && report.updateChannel?.repo === 'connect-ai', `${report.updateChannel?.owner || 'missing'}/${report.updateChannel?.repo || 'missing'}`);
  add('update channel latest mac version', report.updateChannel?.latestMac?.version === manifest.product?.version, report.updateChannel?.latestMac?.version || 'missing');
  add('update channel release app metadata', report.updateChannel?.releaseApp?.provider === 'github' && report.updateChannel?.releaseApp?.repo === 'connect-ai', JSON.stringify(report.updateChannel?.releaseApp || {}));
  add('update channel DMG app metadata', report.updateChannel?.dmgApp?.provider === 'github' && report.updateChannel?.dmgApp?.repo === 'connect-ai', JSON.stringify(report.updateChannel?.dmgApp || {}));
}

function verifyLaunchSmoke(manifest) {
  const file = artifactPath('release-launch-smoke.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('launch smoke schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('launch smoke status', report.ok === true, String(report.ok));
  add('launch smoke duration', Number(report.durationMs) >= 3000, `${report.durationMs || 'missing'}ms`);
  add('launch smoke bundle identifier', report.bundleIdentifier === manifest.product?.appId, report.bundleIdentifier || 'missing');
  add('launch smoke version', report.version === manifest.product?.version, report.version || 'missing');
  add('launch smoke app path', report.appPath === 'release/mac-arm64/Connect AI.app', report.appPath || 'missing');
}

function verifyDmgInstallExperience(manifest) {
  const file = artifactPath('dmg-install-experience.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('DMG install schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('DMG install status', report.ok === true && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('DMG install product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('DMG install product app id', report.product?.appId === manifest.product?.appId, report.product?.appId || 'missing');
  add('DMG install artifact', report.dmg?.path === `release/Connect-AI-${manifest.product?.version}-mac-arm64.dmg`, report.dmg?.path || 'missing');
  add('DMG install checksum', Boolean(report.dmg?.sha256) && report.dmg.sha256 === sha(artifactPath(`Connect-AI-${manifest.product?.version}-mac-arm64.dmg`), 'sha256'), report.dmg?.sha256 || 'missing');
  add(
    'DMG install app.asar hash',
    appAsarContentOk({
      expectedSha256: manifest.baseline?.appAsar?.expectedSha256,
      candidateSha256: report.product?.appAsarSha256,
      policy: report.product?.appAsarPolicy,
    }),
    appAsarPolicyDetail({
      expectedSha256: manifest.baseline?.appAsar?.expectedSha256,
      candidateSha256: report.product?.appAsarSha256,
      policy: report.product?.appAsarPolicy,
    }),
  );
  add(
    'DMG install approved security dependency versions',
    approvedSecurityDependencyVersionsOk(report.product?.appAsarPolicy?.approvedSecurityDependencyPackages, { requirePackaged: true }),
    (report.product?.appAsarPolicy?.approvedSecurityDependencyPackages || []).map((entry) => `${entry.packageName}@${entry.actualVersion || 'missing'} expected ${entry.expectedVersion} packaged=${entry.asarPackagePresent}`).join(', ') || 'missing',
  );
  add(
    'DMG install package metadata policy',
    report.product?.appAsarPolicy?.packageMetadata?.ok === true,
    packageMetadataPolicyDetail(report.product?.appAsarPolicy?.packageMetadata),
  );
  add('DMG install Applications shortcut', checkNamedPass(report, 'DMG Applications shortcut'), 'DMG Applications shortcut');
  add('DMG install copy simulation', checkNamedPass(report, 'drag-install copy simulation'), 'drag-install copy simulation');
  add('DMG install mounted app code signature seal', checkNamedPass(report, 'mounted app code signature resource seal'), 'mounted app code signature resource seal');
  add('DMG install mounted app signed entitlement allowlist', checkNamedPass(report, 'mounted app signed entitlement allowlist'), 'mounted app signed entitlement allowlist');
  add('DMG install mounted app ATS arbitrary loads disabled', checkNamedPass(report, 'mounted app ATS arbitrary loads disabled'), 'mounted app ATS arbitrary loads disabled');
  add('DMG install mounted app ATS allowlist', checkNamedPass(report, 'mounted app ATS exception domain allowlist'), 'mounted app ATS exception domain allowlist');
  add('DMG install copied app code signature seal', checkNamedPass(report, 'copied app code signature resource seal'), 'copied app code signature resource seal');
  add('DMG install copied app signed entitlement allowlist', checkNamedPass(report, 'copied app signed entitlement allowlist'), 'copied app signed entitlement allowlist');
  add('DMG install copied app ATS arbitrary loads disabled', checkNamedPass(report, 'copied app ATS arbitrary loads disabled'), 'copied app ATS arbitrary loads disabled');
  add('DMG install copied app ATS allowlist', checkNamedPass(report, 'copied app ATS exception domain allowlist'), 'copied app ATS exception domain allowlist');
  add('DMG install copied app parity', checkNamedPass(report, 'copied app app.asar'), 'copied app app.asar');
}

function verifyDmgLaunchSmoke(manifest) {
  const file = artifactPath('release-dmg-launch-smoke.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  add('DMG launch smoke schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('DMG launch smoke source', report.source === 'dmg', report.source || 'missing');
  add('DMG launch smoke status', report.ok === true, String(report.ok));
  add('DMG launch smoke duration', Number(report.durationMs) >= 3000, `${report.durationMs || 'missing'}ms`);
  add('DMG launch smoke bundle identifier', report.bundleIdentifier === manifest.product?.appId, report.bundleIdentifier || 'missing');
  add('DMG launch smoke version', report.version === manifest.product?.version, report.version || 'missing');
  add('DMG launch smoke artifact', report.dmgPath === `release/Connect-AI-${manifest.product?.version}-mac-arm64.dmg`, report.dmgPath || 'missing');
}

function verifySecurityAudit(manifest) {
  const file = artifactPath('security-audit-report.json');
  if (!fs.existsSync(file)) return;
  const report = readJson(file);
  const production = report.audits?.production || {};
  const all = report.audits?.all || {};
  add('security audit schema version', report.schemaVersion === 1, String(report.schemaVersion));
  add('security audit product version', report.product?.version === manifest.product?.version, report.product?.version || 'missing');
  add('security audit status', report.ok === true && report.summary?.blockers === 0, JSON.stringify(report.summary || {}));
  add('security audit production dependencies', production.ok === true && production.vulnerabilities?.total === 0, JSON.stringify(production.vulnerabilities || {}));
  add('security audit full dependencies', all.ok === true && all.vulnerabilities?.total === 0, JSON.stringify(all.vulnerabilities || {}));
  add('security audit check coverage', Array.isArray(report.checks) && report.checks.length >= 2, `${report.checks?.length || 0} checks`);
  add('security audit manifest file', manifest.security?.securityAuditReport?.exists === true, JSON.stringify(manifest.security?.securityAuditReport || {}));
  if (manifest.security?.securityAuditReport?.sha256) {
    add('security audit manifest hash', manifest.security.securityAuditReport.sha256 === sha(file, 'sha256'), manifest.security.securityAuditReport.sha256);
  }
}

function verifySbom(manifest) {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  const cdxFile = artifactPath('sbom.cdx.json');
  const spdxFile = artifactPath('sbom.spdx.json');

  if (fs.existsSync(cdxFile)) {
    const cdx = readJson(cdxFile);
    add('CycloneDX SBOM format', cdx.bomFormat === 'CycloneDX', cdx.bomFormat || 'missing');
    add('CycloneDX SBOM spec', /^1\.[45]$/.test(String(cdx.specVersion || '')), cdx.specVersion || 'missing');
    add('CycloneDX package version', cdx.metadata?.component?.version === manifest.product?.version, cdx.metadata?.component?.version || 'missing');
    add('CycloneDX package name', cdx.metadata?.component?.purl === `pkg:npm/${pkg.name}@${pkg.version}`, cdx.metadata?.component?.purl || 'missing');
    add('CycloneDX component list', Array.isArray(cdx.components), `${cdx.components?.length || 0} components`);
  }

  if (fs.existsSync(spdxFile)) {
    const spdx = readJson(spdxFile);
    const rootPackage = (spdx.packages || []).find((item) => item.name === pkg.name);
    add('SPDX SBOM format', spdx.spdxVersion === 'SPDX-2.3', spdx.spdxVersion || 'missing');
    add('SPDX package version', rootPackage?.versionInfo === manifest.product?.version, rootPackage?.versionInfo || 'missing');
    add('SPDX package list', Array.isArray(spdx.packages), `${spdx.packages?.length || 0} packages`);
  }
}

function verifyProvenance(manifest) {
  const file = artifactPath('provenance.json');
  if (!fs.existsSync(file)) return;
  const provenance = readJson(file);
  add('provenance schema version', provenance.schemaVersion === 1, String(provenance.schemaVersion));
  add('provenance product version', provenance.product?.version === manifest.product?.version, provenance.product?.version || 'missing');
  add('provenance Electron runtime', provenance.product?.electronVersion === manifest.product?.electronVersion, provenance.product?.electronVersion || 'missing');
  add('provenance baseline app.asar', provenance.baseline?.actualAppAsarSha256 === provenance.baseline?.expectedAppAsarSha256, provenance.baseline?.actualAppAsarSha256 || 'missing');
  add(
    'provenance release app.asar',
    provenance.releaseManifest?.appAsarContentOk === true ||
      appAsarContentOk({
        expectedSha256: manifest.baseline?.appAsar?.expectedSha256,
        candidateSha256: provenance.releaseManifest?.appAsarSha256,
        policy: provenance.releaseManifest?.appAsarPolicy,
      }),
    appAsarPolicyDetail({
      expectedSha256: manifest.baseline?.appAsar?.expectedSha256,
      candidateSha256: provenance.releaseManifest?.appAsarSha256,
      policy: provenance.releaseManifest?.appAsarPolicy,
    }),
  );
  add(
    'provenance approved security dependency versions',
    approvedSecurityDependencyVersionsOk(provenance.releaseManifest?.appAsarPolicy?.approvedSecurityDependencyPackages, { requirePackaged: true }),
    (provenance.releaseManifest?.appAsarPolicy?.approvedSecurityDependencyPackages || []).map((entry) => `${entry.packageName}@${entry.actualVersion || 'missing'} expected ${entry.expectedVersion} packaged=${entry.asarPackagePresent}`).join(', ') || 'missing',
  );
  add(
    'provenance package metadata policy',
    provenance.releaseManifest?.appAsarPolicy?.packageMetadata?.ok === true,
    packageMetadataPolicyDetail(provenance.releaseManifest?.appAsarPolicy?.packageMetadata),
  );
  add('provenance release tag', provenance.releaseTag?.ok === true && provenance.releaseTag?.resolved === `desktop-v${manifest.product?.version}`, JSON.stringify(provenance.releaseTag || {}));
  add('provenance baseline freshness', provenance.baselineFreshness?.ok === true && provenance.baselineFreshness?.baselineAppAsarSha256 === manifest.baseline?.appAsar?.expectedSha256, JSON.stringify(provenance.baselineFreshness || {}));
  add('provenance UI parity', provenance.uiParity?.ok === true && Number(provenance.uiParity?.screenshotSimilarity) >= 0.99 && Number(provenance.uiParity?.fullPageSimilarity) >= 0.99, JSON.stringify(provenance.uiParity || {}));
  add('provenance performance parity', provenance.performanceParity?.ok === true && Number.isFinite(provenance.performanceParity?.localLoadMs), JSON.stringify(provenance.performanceParity || {}));
  add('provenance macOS security contract', provenance.macosSecurityContract?.ok === true, String(provenance.macosSecurityContract?.ok));
  add('provenance IPC security', provenance.ipcSecurity?.ok === true && provenance.ipcSecurity?.blockers === 0, JSON.stringify(provenance.ipcSecurity || {}));
  add('provenance release env contract', provenance.releaseEnvironmentContract?.blockers === 0 && provenance.releaseEnvironmentContract?.warnings === 0, JSON.stringify(provenance.releaseEnvironmentContract || {}));
  add('provenance security audit', provenance.securityAudit?.ok === true && provenance.securityAudit?.productionOk === true && provenance.securityAudit?.fullOk === true, JSON.stringify(provenance.securityAudit || {}));
  add('provenance Developer ID signature', provenance.releaseManifest?.developerIdSignatureOk === true, JSON.stringify(provenance.releaseManifest?.codeSignature || {}));
  add(
    'provenance release environment',
    strict
      ? provenance.releaseEnvironment?.blockers === 0 && Number.isFinite(provenance.releaseEnvironment?.warnings)
      : Number.isFinite(provenance.releaseEnvironment?.blockers) && Number.isFinite(provenance.releaseEnvironment?.warnings),
    JSON.stringify(provenance.releaseEnvironment || {}),
  );
  if (strict) {
    add('provenance release environment mode', provenance.releaseEnvironment?.strict === true && provenance.releaseEnvironment?.processEnv === true, JSON.stringify(provenance.releaseEnvironment || {}));
  }
  add('provenance secret hygiene', provenance.secretHygiene?.blockers === 0 && Number.isFinite(provenance.secretHygiene?.warnings), JSON.stringify(provenance.secretHygiene || {}));
  add('provenance DMG install experience', provenance.dmgInstallExperience?.ok === true, String(provenance.dmgInstallExperience?.ok));
  add('provenance launch smoke', provenance.releaseLaunchSmoke?.ok === true, String(provenance.releaseLaunchSmoke?.ok));
  add('provenance DMG launch smoke', provenance.releaseDmgLaunchSmoke?.ok === true, String(provenance.releaseDmgLaunchSmoke?.ok));
  add('provenance signing readiness', Number.isFinite(provenance.signingReadiness?.blockers), JSON.stringify(provenance.signingReadiness || {}));
  add('provenance operator readiness', Number.isFinite(provenance.operatorReadiness?.blockers), JSON.stringify(provenance.operatorReadiness || {}));
  if (githubOperatorRequired()) {
    add('provenance GitHub operator readiness', Number.isFinite(provenance.githubOperatorReadiness?.blockers), JSON.stringify(provenance.githubOperatorReadiness || {}));
  }
  add('provenance update channel', provenance.updateChannel?.ok === true, JSON.stringify(provenance.updateChannel || {}));
  add('provenance release decision', provenance.releaseDecision?.status === 'production-ready' || provenance.releaseDecision?.status === 'local-candidate-ready', JSON.stringify(provenance.releaseDecision || {}));
  add('provenance release promotion', Boolean(provenance.releasePromotion?.status), JSON.stringify(provenance.releasePromotion || {}));
  add('provenance production audit', provenance.releaseManifest?.productionAuditOk === true, String(provenance.releaseManifest?.productionAuditOk));
  add('provenance full audit', provenance.releaseManifest?.fullAuditOk === true, String(provenance.releaseManifest?.fullAuditOk));
  add('provenance artifact list', Array.isArray(provenance.artifacts) && provenance.artifacts.length >= 9, `${provenance.artifacts?.length || 0} artifacts`);
}

function verifyManifest(manifest) {
  add('manifest app.asar parity', manifestAppAsarOk(manifest), manifestAppAsarDetail(manifest));
  add(
    'manifest approved security dependency versions',
    approvedSecurityDependencyVersionsOk(manifest.release?.appAsarPolicy?.approvedSecurityDependencyPackages, { requirePackaged: true }),
    (manifest.release?.appAsarPolicy?.approvedSecurityDependencyPackages || []).map((entry) => `${entry.packageName}@${entry.actualVersion || 'missing'} expected ${entry.expectedVersion} packaged=${entry.asarPackagePresent}`).join(', ') || 'missing',
  );
  add(
    'manifest package metadata policy',
    manifest.release?.appAsarPolicy?.packageMetadata?.ok === true,
    packageMetadataPolicyDetail(manifest.release?.appAsarPolicy?.packageMetadata),
  );
  add('manifest security audit report', manifest.security?.securityAuditReport?.exists === true, JSON.stringify(manifest.security?.securityAuditReport || {}));
  add('manifest production audit', Boolean(manifest.security?.productionAudit?.ok), JSON.stringify(manifest.security?.productionAudit || {}));
  add('manifest full audit', Boolean(manifest.security?.fullAudit?.ok), JSON.stringify(manifest.security?.fullAudit || {}));
  add('manifest code signature resource seal', manifest.security?.codeSignature?.ok === true && manifest.security?.codeSignature?.sealedResources === true, JSON.stringify(manifest.security?.codeSignature || {}));
  add('manifest Developer ID signature', manifest.security?.codeSignature?.developerId === true, JSON.stringify(manifest.security?.codeSignature || {}));
}

function printReport() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    summary: {
      blockers,
      warnings,
    },
    checks,
  };
  const reportPath = artifactPath(strict ? 'evidence-report.strict.json' : 'evidence-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI release evidence verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const manifestFile = artifactPath('release-manifest.json');
  if (!fs.existsSync(manifestFile)) {
    add('artifact release-manifest.json', false, 'missing');
    printReport();
    return;
  }

  const manifest = readJson(manifestFile);
  const expected = assertArtifactFiles(manifest);
  verifyManifest(manifest);
  verifyChecksums(expected);
  verifyReleaseNotes(manifest);
  verifyReleaseTag(manifest);
  verifyBaselineFreshness(manifest);
  verifyInstalledAppParity(manifest);
  verifyUiParity(manifest);
  verifyPerformanceParity(manifest);
  verifyMacosSecurityContract(manifest);
  verifyIpcSecurity(manifest);
  verifyReleaseEnvContract();
  verifyReleaseEnv();
  verifySecretHygiene();
  verifyDmgInstallExperience(manifest);
  verifyLaunchSmoke(manifest);
  verifyDmgLaunchSmoke(manifest);
  verifySecurityAudit(manifest);
  verifySigningReadiness();
  verifyOperatorReadiness();
  verifyGithubOperatorReadiness();
  verifyUpdateChannel(manifest);
  verifySbom(manifest);
  verifyProvenance(manifest);
  printReport();
}

main();
