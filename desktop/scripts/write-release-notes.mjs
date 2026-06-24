import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appAsarContentOk } from './app-asar-policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const manifestPath = path.join(releaseDir, 'release-manifest.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha(file, algorithm, encoding = 'hex') {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
}

function artifactRows(paths) {
  return paths
    .filter((relativePath) => fs.existsSync(path.join(desktopDir, relativePath)))
    .map((relativePath) => {
      const file = path.join(desktopDir, relativePath);
      return {
        path: relativePath,
        bytes: fs.statSync(file).size,
        sha256: sha(file, 'sha256'),
        sha512: sha(file, 'sha512'),
      };
    });
}

function status(ok) {
  return ok ? 'PASS' : 'FAIL';
}

function releaseEnvReportPath() {
  const localPath = path.join(releaseDir, 'release-env-report.json');
  const processPath = path.join(releaseDir, 'release-env-report.process.json');
  if (fs.existsSync(processPath)) {
    const processReport = readJson(processPath);
    if (processReport.strict === true && processReport.processEnv === true && processReport.summary?.blockers === 0) {
      return processPath;
    }
  }
  return localPath;
}

function writeChecksum(fileName, rows, field) {
  const out = rows.map((row) => `${row[field]}  ${row.path.replace(/^release\//, '')}`).join('\n');
  fs.writeFileSync(path.join(releaseDir, fileName), `${out}\n`);
}

function releaseStatus(manifest) {
  const security = manifest.security || {};
  const expectedAsarSha = manifest.baseline?.appAsar?.expectedSha256;
  const releaseAsar = (manifest.release?.artifacts || []).find((artifact) => artifact.path?.endsWith('/app.asar'));
  const appContentOk = appAsarContentOk({
    expectedSha256: expectedAsarSha,
    candidateSha256: releaseAsar?.sha256,
    policy: manifest.release?.appAsarPolicy,
  });
  const sbomOk = fs.existsSync(path.join(releaseDir, 'sbom.cdx.json')) && fs.existsSync(path.join(releaseDir, 'sbom.spdx.json'));
  const macosSecurityPath = path.join(releaseDir, 'macos-security-contract.json');
  const macosSecurityOk = fs.existsSync(macosSecurityPath) && readJson(macosSecurityPath).ok === true;
  const ipcSecurityPath = path.join(releaseDir, 'ipc-security-report.json');
  const ipcSecurityOk = fs.existsSync(ipcSecurityPath) && readJson(ipcSecurityPath).ok === true && readJson(ipcSecurityPath).summary?.blockers === 0;
  const releaseEnvContractPath = path.join(releaseDir, 'release-env-contract-report.json');
  const releaseEnvContract = fs.existsSync(releaseEnvContractPath) ? readJson(releaseEnvContractPath) : null;
  const releaseEnvContractOk = releaseEnvContract?.schemaVersion === 1 && releaseEnvContract.summary?.blockers === 0 && releaseEnvContract.summary?.warnings === 0;
  const releaseEnvPath = releaseEnvReportPath();
  const releaseEnv = fs.existsSync(releaseEnvPath) ? readJson(releaseEnvPath) : null;
  const releaseEnvOk = releaseEnv?.schemaVersion === 1 && releaseEnv.summary?.blockers === 0;
  const secretHygienePath = path.join(releaseDir, 'secret-hygiene-report.json');
  const secretHygiene = fs.existsSync(secretHygienePath) ? readJson(secretHygienePath) : null;
  const secretHygieneOk = secretHygiene?.schemaVersion === 1 && secretHygiene.summary?.blockers === 0;
  const securityAuditPath = path.join(releaseDir, 'security-audit-report.json');
  const securityAudit = fs.existsSync(securityAuditPath) ? readJson(securityAuditPath) : null;
  const securityAuditOk = securityAudit?.ok === true && securityAudit.summary?.blockers === 0;
  const launchSmokePath = path.join(releaseDir, 'release-launch-smoke.json');
  const launchSmokeOk = fs.existsSync(launchSmokePath) && readJson(launchSmokePath).ok === true;
  const dmgInstallPath = path.join(releaseDir, 'dmg-install-experience.json');
  const dmgInstallOk = fs.existsSync(dmgInstallPath) && readJson(dmgInstallPath).ok === true;
  const dmgLaunchSmokePath = path.join(releaseDir, 'release-dmg-launch-smoke.json');
  const dmgLaunchSmokeOk = fs.existsSync(dmgLaunchSmokePath) && readJson(dmgLaunchSmokePath).ok === true;
  const signingReadinessPath = path.join(releaseDir, 'signing-readiness.json');
  const signingReadiness = fs.existsSync(signingReadinessPath) ? readJson(signingReadinessPath) : null;
  const signingReadinessOk = signingReadiness?.schemaVersion === 1;
  const operatorReadinessPath = path.join(releaseDir, 'operator-readiness.json');
  const operatorReadiness = fs.existsSync(operatorReadinessPath) ? readJson(operatorReadinessPath) : null;
  const operatorReadinessOk = operatorReadiness?.schemaVersion === 1 && operatorReadiness.summary?.blockers === 0;
  const githubOperatorReadinessPath = path.join(releaseDir, 'operator-readiness.github.json');
  const githubOperatorReadiness = fs.existsSync(githubOperatorReadinessPath) ? readJson(githubOperatorReadinessPath) : null;
  const githubOperatorRequired = process.env.CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS === '1' || Boolean(githubOperatorReadiness);
  const githubOperatorReadinessOk = !githubOperatorRequired || (
    githubOperatorReadiness?.schemaVersion === 1 &&
    githubOperatorReadiness.github === true &&
    githubOperatorReadiness.strict === true &&
    githubOperatorReadiness.summary?.blockers === 0 &&
    githubOperatorReadiness.summary?.warnings === 0
  );
  const updateChannelPath = path.join(releaseDir, 'update-channel-report.json');
  const updateChannelOk = fs.existsSync(updateChannelPath) && readJson(updateChannelPath).ok === true;
  const releaseTagPath = path.join(releaseDir, 'release-tag-report.json');
  const releaseTagOk = fs.existsSync(releaseTagPath) && readJson(releaseTagPath).ok === true;
  const installedAppParityPath = path.join(releaseDir, 'installed-app-parity-report.json');
  const installedAppParityOk = fs.existsSync(installedAppParityPath) && readJson(installedAppParityPath).ok === true;
  const uiParityPath = path.join(releaseDir, 'ui-parity-report.json');
  const uiParityOk = fs.existsSync(uiParityPath) && readJson(uiParityPath).ok === true;
  const performanceParityPath = path.join(releaseDir, 'performance-parity-report.json');
  const performanceParityOk = fs.existsSync(performanceParityPath) && readJson(performanceParityPath).ok === true;
  const ok = Boolean(
      appContentOk &&
      releaseTagOk &&
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
      signingReadiness.summary?.blockers === 0 &&
      operatorReadinessOk &&
      githubOperatorReadinessOk &&
      updateChannelOk &&
      sbomOk &&
      security.productionAudit?.ok &&
      security.codeSignature?.developerId === true &&
      security.codesignVerify?.ok &&
      security.gatekeeper?.ok &&
      security.stapler?.ok &&
      security.dmgGatekeeper?.ok &&
      security.dmgStapler?.ok
  );
  return ok ? 'signed-and-notarized' : 'local-evidence-only';
}

function renderNotes(manifest, rows) {
  const product = manifest.product || {};
  const baseline = manifest.baseline?.appAsar || {};
  const security = manifest.security || {};
  const app = manifest.release?.app || {};
  const releaseAsar = (manifest.release?.artifacts || []).find((artifact) => artifact.path?.endsWith('/app.asar'));
  const appAsarPolicy = manifest.release?.appAsarPolicy || null;
  const appContentOk = appAsarContentOk({
    expectedSha256: baseline.expectedSha256,
    candidateSha256: releaseAsar?.sha256,
    policy: appAsarPolicy,
  });
  const sbomOk = fs.existsSync(path.join(releaseDir, 'sbom.cdx.json')) && fs.existsSync(path.join(releaseDir, 'sbom.spdx.json'));
  const macosSecurityPath = path.join(releaseDir, 'macos-security-contract.json');
  const macosSecurity = fs.existsSync(macosSecurityPath) ? readJson(macosSecurityPath) : null;
  const macosSecurityOk = macosSecurity?.ok === true;
  const ipcSecurityPath = path.join(releaseDir, 'ipc-security-report.json');
  const ipcSecurity = fs.existsSync(ipcSecurityPath) ? readJson(ipcSecurityPath) : null;
  const ipcSecurityOk = ipcSecurity?.ok === true && ipcSecurity.summary?.blockers === 0;
  const releaseEnvContractPath = path.join(releaseDir, 'release-env-contract-report.json');
  const releaseEnvContract = fs.existsSync(releaseEnvContractPath) ? readJson(releaseEnvContractPath) : null;
  const releaseEnvContractOk = releaseEnvContract?.schemaVersion === 1 && releaseEnvContract.summary?.blockers === 0 && releaseEnvContract.summary?.warnings === 0;
  const releaseEnvPath = releaseEnvReportPath();
  const releaseEnv = fs.existsSync(releaseEnvPath) ? readJson(releaseEnvPath) : null;
  const releaseEnvOk = releaseEnv?.schemaVersion === 1 && releaseEnv.summary?.blockers === 0;
  const secretHygienePath = path.join(releaseDir, 'secret-hygiene-report.json');
  const secretHygiene = fs.existsSync(secretHygienePath) ? readJson(secretHygienePath) : null;
  const secretHygieneOk = secretHygiene?.schemaVersion === 1 && secretHygiene.summary?.blockers === 0;
  const securityAuditPath = path.join(releaseDir, 'security-audit-report.json');
  const securityAudit = fs.existsSync(securityAuditPath) ? readJson(securityAuditPath) : null;
  const securityAuditOk = securityAudit?.ok === true && securityAudit.summary?.blockers === 0;
  const launchSmokePath = path.join(releaseDir, 'release-launch-smoke.json');
  const launchSmoke = fs.existsSync(launchSmokePath) ? readJson(launchSmokePath) : null;
  const launchSmokeOk = launchSmoke?.ok === true;
  const dmgInstallPath = path.join(releaseDir, 'dmg-install-experience.json');
  const dmgInstall = fs.existsSync(dmgInstallPath) ? readJson(dmgInstallPath) : null;
  const dmgInstallOk = dmgInstall?.ok === true;
  const dmgLaunchSmokePath = path.join(releaseDir, 'release-dmg-launch-smoke.json');
  const dmgLaunchSmoke = fs.existsSync(dmgLaunchSmokePath) ? readJson(dmgLaunchSmokePath) : null;
  const dmgLaunchSmokeOk = dmgLaunchSmoke?.ok === true;
  const signingReadinessPath = path.join(releaseDir, 'signing-readiness.json');
  const signingReadiness = fs.existsSync(signingReadinessPath) ? readJson(signingReadinessPath) : null;
  const signingReadinessOk = signingReadiness?.schemaVersion === 1;
  const operatorReadinessPath = path.join(releaseDir, 'operator-readiness.json');
  const operatorReadiness = fs.existsSync(operatorReadinessPath) ? readJson(operatorReadinessPath) : null;
  const operatorReadinessOk = operatorReadiness?.schemaVersion === 1;
  const githubOperatorReadinessPath = path.join(releaseDir, 'operator-readiness.github.json');
  const githubOperatorReadiness = fs.existsSync(githubOperatorReadinessPath) ? readJson(githubOperatorReadinessPath) : null;
  const githubOperatorRequired = process.env.CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS === '1' || Boolean(githubOperatorReadiness);
  const githubOperatorReadinessOk = !githubOperatorRequired || (
    githubOperatorReadiness?.schemaVersion === 1 &&
    githubOperatorReadiness.github === true &&
    githubOperatorReadiness.strict === true &&
    githubOperatorReadiness.summary?.blockers === 0 &&
    githubOperatorReadiness.summary?.warnings === 0
  );
  const updateChannelPath = path.join(releaseDir, 'update-channel-report.json');
  const updateChannel = fs.existsSync(updateChannelPath) ? readJson(updateChannelPath) : null;
  const updateChannelOk = updateChannel?.ok === true;
  const releaseTagPath = path.join(releaseDir, 'release-tag-report.json');
  const releaseTag = fs.existsSync(releaseTagPath) ? readJson(releaseTagPath) : null;
  const releaseTagOk = releaseTag?.ok === true;
  const installedAppParityPath = path.join(releaseDir, 'installed-app-parity-report.json');
  const installedAppParity = fs.existsSync(installedAppParityPath) ? readJson(installedAppParityPath) : null;
  const installedAppParityOk = installedAppParity?.ok === true;
  const uiParityPath = path.join(releaseDir, 'ui-parity-report.json');
  const uiParity = fs.existsSync(uiParityPath) ? readJson(uiParityPath) : null;
  const uiParityOk = uiParity?.ok === true;
  const performanceParityPath = path.join(releaseDir, 'performance-parity-report.json');
  const performanceParity = fs.existsSync(performanceParityPath) ? readJson(performanceParityPath) : null;
  const performanceParityOk = performanceParity?.ok === true;
  const statusLabel = releaseStatus(manifest);
  const artifactTable = rows
    .map((row) => `| ${row.path.replace(/^release\//, '')} | ${row.bytes} | ${row.sha256} |`)
    .join('\n');

  return `# Connect AI ${product.version} Desktop Release

Status: ${statusLabel}
Generated: ${new Date().toISOString()}

## Build

- Product: ${product.name}
- Bundle ID: ${product.appId}
- Electron runtime: ${product.electronVersion}
- Baseline app.asar SHA-256: ${baseline.actualSha256 || 'missing'}
- Release app.asar SHA-256: ${releaseAsar?.sha256 || 'missing'}
- Expected app.asar SHA-256: ${baseline.expectedSha256 || 'missing'}
- Release app.asar policy: ${appAsarPolicy?.reason || 'missing'}
- Release app bundle version: ${app.version || 'missing'}
- Release tag: ${releaseTag?.releaseTag?.resolved || 'missing'}

## Verification

- App content parity: ${status(appContentOk)}
- Release tag/version gate: ${status(releaseTagOk)}
- Installed app parity: ${status(installedAppParityOk)}${installedAppParity?.summary ? ` (${installedAppParity.summary.blockers} blocker(s), approved main-process bundle mismatches ${installedAppParity.summary.approvedMainProcessBundleMismatches ?? 0})` : ''}
- UI and behavior parity: ${status(uiParityOk)}${Number.isFinite(uiParity?.screenshots?.similarity) ? ` (${(uiParity.screenshots.similarity * 100).toFixed(2)}% card, ${Number.isFinite(uiParity?.screenshots?.fullPageSimilarity) ? `${(uiParity.screenshots.fullPageSimilarity * 100).toFixed(2)}% full-page` : 'full-page missing'})` : ''}
- Renderer performance parity: ${status(performanceParityOk)}${Number.isFinite(performanceParity?.measurements?.local?.loadMs) && Number.isFinite(performanceParity?.measurements?.baseline?.loadMs) ? ` (load ${performanceParity.measurements.local.loadMs}ms vs baseline ${performanceParity.measurements.baseline.loadMs}ms)` : ''}
- macOS security contract: ${status(macosSecurityOk)}
- IPC security runtime: ${status(ipcSecurityOk)}${ipcSecurity?.summary ? ` (${ipcSecurity.summary.blockers} blocker(s), ${ipcSecurity.summary.warnings} warning(s))` : ''}
- Release environment contract: ${status(releaseEnvContractOk)}${releaseEnvContract?.summary ? ` (${releaseEnvContract.summary.blockers} blocker(s), ${releaseEnvContract.summary.warnings} warning(s))` : ''}
- Release environment checklist: ${status(releaseEnvOk)}${releaseEnv?.summary ? ` (${releaseEnv.summary.blockers} blocker(s), ${releaseEnv.summary.warnings} warning(s), ${releaseEnv.processEnv ? 'process-env' : 'local-file'})` : ''}
- Secret hygiene scan: ${status(secretHygieneOk)}${secretHygiene?.summary ? ` (${secretHygiene.summary.blockers} blocker(s), ${secretHygiene.summary.warnings} warning(s))` : ''}
- Security audit report: ${status(securityAuditOk)}${securityAudit?.summary ? ` (${securityAudit.summary.blockers} blocker(s), ${securityAudit.summary.warnings} warning(s), production ${securityAudit.audits?.production?.vulnerabilities?.total ?? 'missing'}, full ${securityAudit.audits?.all?.vulnerabilities?.total ?? 'missing'})` : ''}
- DMG install experience: ${status(dmgInstallOk)}
- Packaged app launch smoke: ${status(launchSmokeOk)}${launchSmoke?.durationMs ? ` (${launchSmoke.durationMs}ms)` : ''}
- DMG app launch smoke: ${status(dmgLaunchSmokeOk)}${dmgLaunchSmoke?.durationMs ? ` (${dmgLaunchSmoke.durationMs}ms)` : ''}
- Signing readiness report: ${status(signingReadinessOk)}${signingReadiness?.summary ? ` (${signingReadiness.summary.blockers} blocker(s), ${signingReadiness.summary.warnings} warning(s))` : ''}
- Operator readiness report: ${status(operatorReadinessOk)}${operatorReadiness?.summary ? ` (${operatorReadiness.summary.blockers} blocker(s), ${operatorReadiness.summary.warnings} warning(s))` : ''}
- GitHub automation readiness: ${status(githubOperatorReadinessOk)}${githubOperatorReadiness?.summary ? ` (${githubOperatorReadiness.summary.blockers} blocker(s), ${githubOperatorReadiness.summary.warnings} warning(s))` : githubOperatorRequired ? ' (missing)' : ' (not required for this local evidence run)'}
- Update channel metadata: ${status(updateChannelOk)}
- Production dependency audit: ${status(Boolean(security.productionAudit?.ok))}
- SBOM generated: ${status(sbomOk)}
- Release app Developer ID signature: ${status(security.codeSignature?.developerId === true)}${security.codeSignature?.kind ? ` (${security.codeSignature.kind}${security.codeSignature.teamIdentifier ? `, team ${security.codeSignature.teamIdentifier}` : ''})` : ''}
- Release app code signature: ${status(Boolean(security.codesignVerify?.ok))}
- Release app Gatekeeper assessment: ${status(Boolean(security.gatekeeper?.ok))}
- Release app stapled notarization ticket: ${status(Boolean(security.stapler?.ok))}
- DMG Gatekeeper assessment: ${status(Boolean(security.dmgGatekeeper?.ok))}
- DMG stapled notarization ticket: ${status(Boolean(security.dmgStapler?.ok))}

## Artifacts

| File | Bytes | SHA-256 |
| --- | ---: | --- |
${artifactTable}

## Notes

- Use this release for production only when Status is \`signed-and-notarized\`.
- \`latest-mac.yml\` is included for auto-update metadata.
- \`release-tag-report.json\`, \`installed-app-parity-report.json\`, \`ui-parity-report.json\`, \`performance-parity-report.json\`, \`macos-security-contract.json\`, \`ipc-security-report.json\`, \`release-env-contract-report.json\`, \`security-audit-report.json\`, \`release-env-report*.json\`, \`secret-hygiene-report.json\`, \`dmg-install-experience.json\`, \`release-launch-smoke.json\`, \`release-dmg-launch-smoke.json\`, \`signing-readiness.json\`, \`operator-readiness.json\`, \`operator-readiness.github.json\`, \`update-channel-report.json\`, \`provenance.json\`, \`sbom.cdx.json\`, \`sbom.spdx.json\`, \`SHA256SUMS.txt\`, \`SHA512SUMS.txt\`, and \`release-manifest.json\` are release evidence files.
`;
}

function main() {
  if (!fs.existsSync(manifestPath)) {
    console.error('Missing release/release-manifest.json. Run npm run release:manifest first.');
    process.exit(1);
  }

  const manifest = readJson(manifestPath);
  const version = manifest.product?.version;
  const artifactPaths = [
    `release/Connect-AI-${version}-mac-arm64.dmg`,
    `release/Connect-AI-${version}-mac-arm64.dmg.blockmap`,
    'release/latest-mac.yml',
    'release/release-manifest.json',
    'release/release-tag-report.json',
    'release/installed-app-parity-report.json',
    'release/ui-parity-report.json',
    'release/performance-parity-report.json',
    'release/macos-security-contract.json',
    'release/ipc-security-report.json',
    'release/release-env-contract-report.json',
    'release/security-audit-report.json',
    'release/dmg-install-experience.json',
    'release/release-launch-smoke.json',
    'release/release-dmg-launch-smoke.json',
    'release/signing-readiness.json',
    'release/operator-readiness.json',
    'release/operator-readiness.github.json',
    'release/update-channel-report.json',
    'release/provenance.json',
    'release/sbom.cdx.json',
    'release/sbom.spdx.json',
  ];
  const rows = artifactRows(artifactPaths);
  writeChecksum('SHA256SUMS.txt', rows, 'sha256');
  writeChecksum('SHA512SUMS.txt', rows, 'sha512');

  const notesPath = path.join(releaseDir, 'RELEASE_NOTES.md');
  fs.writeFileSync(notesPath, renderNotes(manifest, rows));
  console.log(`Wrote ${path.relative(desktopDir, notesPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, path.join(releaseDir, 'SHA256SUMS.txt'))}`);
  console.log(`Wrote ${path.relative(desktopDir, path.join(releaseDir, 'SHA512SUMS.txt'))}`);
}

main();
