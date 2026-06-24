import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const jsonPath = path.join(releaseDir, 'engineering-readiness-report.json');
const markdownPath = path.join(releaseDir, 'ENGINEERING_READINESS.md');
const checks = [];

function readJson(relativePath, required = false) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`missing ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

function add(name, ok, detail, level = 'blocker', source = null) {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
    source,
  });
}

function summary(report) {
  if (!report || report.parseError) return null;
  return {
    blockers: Number(report.summary?.blockers || 0),
    warnings: Number(report.summary?.warnings || 0),
  };
}

function cleanSummary(report, allowWarnings = false) {
  const item = summary(report);
  return Boolean(item && item.blockers === 0 && (allowWarnings || item.warnings === 0));
}

function reportOk(report, allowWarnings = false) {
  if (!report || report.parseError) return false;
  if (report.ok === true) return cleanSummary(report, allowWarnings) || allowWarnings;
  if (report.status === 'passed') return cleanSummary(report, allowWarnings);
  return cleanSummary(report, allowWarnings);
}

function firstFailed(report, limit = 8) {
  const failed = (report?.checks || report?.gates || [])
    .filter((item) => item.ok === false || item.ready === false)
    .map((item) => `${item.name || item.id || item.label}: ${item.detail || item.reason || item.status || 'failed'}`);
  return failed.slice(0, limit);
}

function sourceSummary(report) {
  if (!report || report.parseError) return null;
  return {
    generatedAt: report.generatedAt || null,
    status: report.status || null,
    ok: report.ok ?? null,
    productionReady: report.productionReady ?? null,
    localCandidateReady: report.localCandidateReady ?? null,
    publishedReleaseReady: report.publishedReleaseReady ?? null,
    commercialReady: report.commercialReady ?? null,
    summary: report.summary || null,
  };
}

function commandText(commands) {
  return (Array.isArray(commands) ? commands : [])
    .map((item) => `${item.step || ''}\n${item.command || ''}`)
    .join('\n');
}

function remoteBaselineGuardEvidence(setupPlan, credentialHandoff, setupVerification, credentialVerification) {
  const setupCandidate = setupPlan?.remoteBaselineCandidate || null;
  const handoffCandidate = credentialHandoff?.remoteBaselineCandidate || null;
  const candidate = setupCandidate || handoffCandidate || {};
  const status = candidate.status || 'missing';
  const expectedSha = candidate.expectedBaselineSha256 || '';
  const packageVersion = setupPlan?.product?.version || credentialHandoff?.product?.version || '0.4.8';
  const expectedBaselineZipPath = `release/Connect-AI-${packageVersion}-baseline-arm64-mac.zip`;
  const validation = `${commandText(setupCandidate?.validationCommands)}\n${commandText(handoffCandidate?.validationCommands)}`;
  const safetyRules = (setupPlan?.safetyRules || []).join('\n');
  const setupVerified = cleanSummary(setupVerification, true);
  const handoffVerified = cleanSummary(credentialVerification, true);
  const validationDocumented = validation.includes('gh release download') && validation.includes('shasum -a 256');
  const safetyRuleDocumented = safetyRules.includes('same-name Connect AI zip') &&
    safetyRules.includes(`SHA-256 matches ${expectedBaselineZipPath}`);
  const ok = Boolean(
    setupCandidate &&
      handoffCandidate &&
      ['missing', 'not-approved-baseline-url', 'size-match-sha-unverified'].includes(status) &&
      setupCandidate.status === handoffCandidate.status &&
      setupCandidate.asset === handoffCandidate.asset &&
      (status !== 'not-approved-baseline-url' ||
        (candidate.remoteBytes !== candidate.expectedBaselineBytes && /^[a-f0-9]{64}$/i.test(expectedSha))) &&
      validationDocumented &&
      safetyRuleDocumented &&
      setupVerified &&
      handoffVerified
  );
  return {
    ok,
    detail: [
      `status=${status}`,
      `asset=${candidate.asset || 'missing'}`,
      `remoteBytes=${candidate.remoteBytes ?? 'missing'}`,
      `expectedBaselineBytes=${candidate.expectedBaselineBytes ?? 'missing'}`,
      `expectedBaselineSha256=${expectedSha || 'missing'}`,
      `setupVerified=${setupVerified}`,
      `credentialHandoffVerified=${handoffVerified}`,
      `validationDocumented=${validationDocumented}`,
      `safetyRuleDocumented=${safetyRuleDocumented}`,
    ],
  };
}

function renderMarkdown(report) {
  const checkLines = report.checks.map((check) => {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    return `- ${label}: ${check.name} - ${Array.isArray(check.detail) ? check.detail.join('; ') : check.detail}`;
  }).join('\n');
  const externalLines = report.externalBlockers.length
    ? report.externalBlockers.map((item) => `- ${item.id}: ${Array.isArray(item.detail) ? item.detail.join('; ') : item.detail}`).join('\n')
    : '- none';

  return `# Connect AI Engineering Readiness

Generated: ${report.generatedAt}
Status: ${report.status}
Engineering ready: ${report.engineeringReady}
Local candidate ready: ${report.localCandidateReady}
Production ready: ${report.productionReady}
Published release ready: ${report.publishedReleaseReady}
Commercial ready: ${report.commercialReady}

## Summary

- Internal blockers: ${report.summary.blockers}
- Warnings: ${report.summary.warnings}
- External blockers: ${report.summary.externalBlockers}
- Checks: ${report.summary.checks}

## Checks

${checkLines}

## External Blockers

${externalLines}
`;
}

function main() {
  const manifest = readJson('release/release-manifest.json');
  const baselineFreshness = readJson('release/baseline-freshness-report.json');
  const installedAppParity = readJson('release/installed-app-parity-report.json');
  const uiParity = readJson('release/ui-parity-report.json');
  const performanceParity = readJson('release/performance-parity-report.json');
  const macosSecurity = readJson('release/macos-security-contract.json');
  const ipcSecurity = readJson('release/ipc-security-report.json');
  const securityAudit = readJson('release/security-audit-report.json');
  const dmgInstall = readJson('release/dmg-install-experience.json');
  const launchSmoke = readJson('release/release-launch-smoke.json');
  const dmgLaunchSmoke = readJson('release/release-dmg-launch-smoke.json');
  const updateChannel = readJson('release/update-channel-report.json');
  const releaseTag = readJson('release/release-tag-report.json');
  const releaseEnvContract = readJson('release/release-env-contract-report.json');
  const secretHygiene = readJson('release/secret-hygiene-report.json');
  const evidence = readJson('release/evidence-report.json');
  const strictEvidence = readJson('release/evidence-report.strict.json');
  const assetManifest = readJson('release/asset-manifest-report.json');
  const releaseDecision = readJson('release/release-decision.strict.json');
  const productionReadiness = readJson('release/production-readiness-summary.json');
  const publicationSeal = readJson('release/release-publication-seal.json');
  const credentialHandoff = readJson('release/release-credential-handoff.json');
  const credentialHandoffVerification = readJson('release/release-credential-handoff-report.strict.json');
  const releaseSetup = readJson('release/release-setup-plan.json');
  const releaseSetupVerification = readJson('release/release-setup-plan-report.strict.json');
  const remoteBaselineGuard = remoteBaselineGuardEvidence(
    releaseSetup,
    credentialHandoff,
    releaseSetupVerification,
    credentialHandoffVerification,
  );

  const releaseAsar = (manifest?.release?.artifacts || []).find((item) => item.path?.endsWith('/app.asar'));
  add(
    'release app.asar policy',
    manifest?.release?.appAsarContentOk === true && manifest?.release?.appAsarPolicy?.ok === true,
    manifest?.release?.appAsarPolicy?.reason || releaseAsar?.sha256 || 'missing appAsarPolicy',
    'blocker',
    'release/release-manifest.json',
  );
  add('baseline freshness', reportOk(baselineFreshness), JSON.stringify(summary(baselineFreshness) || {}), 'blocker', 'release/baseline-freshness-report.json');
  add('installed app parity', reportOk(installedAppParity), JSON.stringify(summary(installedAppParity) || {}), 'blocker', 'release/installed-app-parity-report.json');
  add('UI parity 99%+', uiParity?.ok === true && Number(uiParity?.screenshots?.similarity) >= 0.99 && Number(uiParity?.screenshots?.fullPageSimilarity) >= 0.99, `card=${uiParity?.screenshots?.similarity ?? 'missing'} full=${uiParity?.screenshots?.fullPageSimilarity ?? 'missing'}`, 'blocker', 'release/ui-parity-report.json');
  add('performance parity', reportOk(performanceParity), JSON.stringify(summary(performanceParity) || {}), 'blocker', 'release/performance-parity-report.json');
  add('macOS security contract', macosSecurity?.ok === true && Number(macosSecurity?.summary?.blockers || 0) === 0, JSON.stringify(summary(macosSecurity) || {}), 'blocker', 'release/macos-security-contract.json');
  add('IPC security runtime', reportOk(ipcSecurity), JSON.stringify(summary(ipcSecurity) || {}), 'blocker', 'release/ipc-security-report.json');
  add('security audit', securityAudit?.ok === true && Number(securityAudit?.summary?.blockers || 0) === 0, JSON.stringify(summary(securityAudit) || {}), 'blocker', 'release/security-audit-report.json');
  add('DMG install experience', reportOk(dmgInstall), JSON.stringify(summary(dmgInstall) || {}), 'blocker', 'release/dmg-install-experience.json');
  add('packaged app launch smoke', launchSmoke?.ok === true, `${launchSmoke?.durationMs || 'missing'}ms`, 'blocker', 'release/release-launch-smoke.json');
  add('DMG app launch smoke', dmgLaunchSmoke?.ok === true, `${dmgLaunchSmoke?.durationMs || 'missing'}ms`, 'blocker', 'release/release-dmg-launch-smoke.json');
  add('update channel metadata', reportOk(updateChannel), JSON.stringify(summary(updateChannel) || {}), 'blocker', 'release/update-channel-report.json');
  add('release tag gate', releaseTag?.ok === true && Number(releaseTag?.summary?.blockers || 0) === 0, JSON.stringify(summary(releaseTag) || {}), 'blocker', 'release/release-tag-report.json');
  add('release env contract', cleanSummary(releaseEnvContract), JSON.stringify(summary(releaseEnvContract) || {}), 'blocker', 'release/release-env-contract-report.json');
  add('secret hygiene', cleanSummary(secretHygiene), JSON.stringify(summary(secretHygiene) || {}), 'blocker', 'release/secret-hygiene-report.json');
  add('local evidence', cleanSummary(evidence), JSON.stringify(summary(evidence) || {}), 'blocker', 'release/evidence-report.json');
  add('strict evidence generated', Boolean(strictEvidence && !strictEvidence.parseError), JSON.stringify(summary(strictEvidence) || {}), 'blocker', 'release/evidence-report.strict.json');
  add('asset manifest policy', cleanSummary(assetManifest), JSON.stringify(summary(assetManifest) || {}), 'blocker', 'release/asset-manifest-report.json');
  add(
    'strict release decision local candidate',
    releaseDecision?.localCandidateReady === true,
    `status=${releaseDecision?.status || 'missing'} productionReady=${Boolean(releaseDecision?.productionReady)}`,
    'blocker',
    'release/release-decision.strict.json',
  );
  add(
    'publication seal consistency',
    publicationSeal?.localCandidateReady === true && Number(publicationSeal?.summary?.blockers || 0) === 0,
    `status=${publicationSeal?.status || 'missing'} summary=${JSON.stringify(publicationSeal?.summary || {})}`,
    'blocker',
    'release/release-publication-seal.json',
  );
  add(
    'remote baseline URL guard',
    remoteBaselineGuard.ok,
    remoteBaselineGuard.detail,
    'blocker',
    'release/release-setup-plan.json',
  );

  const failedProductionGates = (productionReadiness?.gates || []).filter((gate) => gate.ok === false);
  const engineeringBlockers = failedProductionGates.filter((gate) => gate.owner === 'engineering');
  const externalBlockers = failedProductionGates.filter((gate) => gate.owner !== 'engineering');
  add(
    'production readiness engineering gates',
    productionReadiness?.localCandidateReady === true && engineeringBlockers.length === 0,
    engineeringBlockers.length
      ? engineeringBlockers.map((gate) => `${gate.id}: ${gate.detail}`)
      : `localCandidateReady=${Boolean(productionReadiness?.localCandidateReady)}`,
    'blocker',
    'release/production-readiness-summary.json',
  );

  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker');
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn');
  const engineeringReady = blockers.length === 0;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: engineeringReady ? 'engineering-ready-awaiting-external-setup' : 'engineering-blocked',
    engineeringReady,
    localCandidateReady: Boolean(releaseDecision?.localCandidateReady && productionReadiness?.localCandidateReady),
    productionReady: Boolean(releaseDecision?.productionReady && productionReadiness?.productionReady),
    publishedReleaseReady: Boolean(productionReadiness?.publishedReleaseReady && publicationSeal?.publishedReleaseReady),
    commercialReady: Boolean(productionReadiness?.commercialReady && publicationSeal?.commercialReady),
    summary: {
      blockers: blockers.length,
      warnings: warnings.length,
      externalBlockers: externalBlockers.length,
      checks: checks.length,
    },
    externalBlockers: externalBlockers.map((gate) => ({
      id: gate.id,
      label: gate.label,
      owner: gate.owner,
      phase: gate.phase,
      detail: gate.detail,
    })),
    failedInternalChecks: blockers.map((check) => ({
      name: check.name,
      detail: check.detail,
      source: check.source,
    })),
    sourceReports: {
      manifest: sourceSummary(manifest),
      baselineFreshness: sourceSummary(baselineFreshness),
      installedAppParity: sourceSummary(installedAppParity),
      uiParity: sourceSummary(uiParity),
      performanceParity: sourceSummary(performanceParity),
      macosSecurity: sourceSummary(macosSecurity),
      ipcSecurity: sourceSummary(ipcSecurity),
      securityAudit: sourceSummary(securityAudit),
      dmgInstall: sourceSummary(dmgInstall),
      localEvidence: sourceSummary(evidence),
      strictEvidence: sourceSummary(strictEvidence),
      releaseDecision: sourceSummary(releaseDecision),
      productionReadiness: sourceSummary(productionReadiness),
      publicationSeal: sourceSummary(publicationSeal),
      credentialHandoff: sourceSummary(credentialHandoff),
      credentialHandoffVerification: sourceSummary(credentialHandoffVerification),
      releaseSetup: sourceSummary(releaseSetup),
      releaseSetupVerification: sourceSummary(releaseSetupVerification),
    },
    diagnostics: {
      strictEvidenceFailures: firstFailed(strictEvidence),
      productionReadinessFailures: failedProductionGates.map((gate) => `${gate.id}: ${gate.detail}`),
    },
    checks,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));

  console.log('Connect AI engineering readiness');
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${Array.isArray(check.detail) ? check.detail.join('; ') : check.detail}`);
  }
  console.log(`Summary: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s), ${report.summary.externalBlockers} external blocker(s)`);
  console.log(`Wrote ${path.relative(desktopDir, jsonPath)}`);
  console.log(`Wrote ${path.relative(desktopDir, markdownPath)}`);
  if (!engineeringReady) process.exit(1);
}

main();
