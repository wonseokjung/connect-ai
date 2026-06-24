import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';
import { appAsarContentOk } from './app-asar-policy.mjs';

const { DEFAULT_ASAR_SHA256, DEFAULT_VERSION, baselineResources, resolveBaselineApp, sha256 } = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fileInfo(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return { path: relativePath, exists: false };
  const data = fs.readFileSync(file);
  return {
    path: relativePath,
    exists: true,
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    sha512: crypto.createHash('sha512').update(data).digest('hex'),
  };
}

function npmVersion() {
  const result = run('npm', ['--version']);
  return result.ok ? result.stdout : null;
}

function main() {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  const baseline = resolveBaselineApp();
  const baselineRes = baselineResources(baseline);
  const manifestPath = path.join(releaseDir, 'release-manifest.json');
  const macosSecurityPath = path.join(releaseDir, 'macos-security-contract.json');
  const ipcSecurityPath = path.join(releaseDir, 'ipc-security-report.json');
  const securityAuditPath = path.join(releaseDir, 'security-audit-report.json');
  const releaseEnvContractPath = path.join(releaseDir, 'release-env-contract-report.json');
  const releaseEnvPath = fs.existsSync(path.join(releaseDir, 'release-env-report.process.json'))
    ? path.join(releaseDir, 'release-env-report.process.json')
    : path.join(releaseDir, 'release-env-report.json');
  const secretHygienePath = path.join(releaseDir, 'secret-hygiene-report.json');
  const dmgInstallPath = path.join(releaseDir, 'dmg-install-experience.json');
  const launchSmokePath = path.join(releaseDir, 'release-launch-smoke.json');
  const dmgLaunchSmokePath = path.join(releaseDir, 'release-dmg-launch-smoke.json');
  const signingReadinessPath = path.join(releaseDir, 'signing-readiness.json');
  const operatorReadinessPath = path.join(releaseDir, 'operator-readiness.json');
  const githubOperatorReadinessPath = path.join(releaseDir, 'operator-readiness.github.json');
  const updateChannelPath = path.join(releaseDir, 'update-channel-report.json');
  const releaseTagPath = path.join(releaseDir, 'release-tag-report.json');
  const baselineFreshnessPath = path.join(releaseDir, 'baseline-freshness-report.json');
  const uiParityPath = path.join(releaseDir, 'ui-parity-report.json');
  const performanceParityPath = path.join(releaseDir, 'performance-parity-report.json');
  const releaseDecisionPath = path.join(releaseDir, 'release-decision.strict.json');
  const releasePromotionPath = path.join(releaseDir, 'release-promotion-plan.json');
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  const manifestReleaseAsar = (manifest?.release?.artifacts || []).find((item) => item.path?.endsWith('/app.asar'));
  const macosSecurity = fs.existsSync(macosSecurityPath) ? readJson(macosSecurityPath) : null;
  const ipcSecurity = fs.existsSync(ipcSecurityPath) ? readJson(ipcSecurityPath) : null;
  const securityAudit = fs.existsSync(securityAuditPath) ? readJson(securityAuditPath) : null;
  const releaseEnvContract = fs.existsSync(releaseEnvContractPath) ? readJson(releaseEnvContractPath) : null;
  const releaseEnv = fs.existsSync(releaseEnvPath) ? readJson(releaseEnvPath) : null;
  const secretHygiene = fs.existsSync(secretHygienePath) ? readJson(secretHygienePath) : null;
  const dmgInstall = fs.existsSync(dmgInstallPath) ? readJson(dmgInstallPath) : null;
  const launchSmoke = fs.existsSync(launchSmokePath) ? readJson(launchSmokePath) : null;
  const dmgLaunchSmoke = fs.existsSync(dmgLaunchSmokePath) ? readJson(dmgLaunchSmokePath) : null;
  const signingReadiness = fs.existsSync(signingReadinessPath) ? readJson(signingReadinessPath) : null;
  const operatorReadiness = fs.existsSync(operatorReadinessPath) ? readJson(operatorReadinessPath) : null;
  const githubOperatorReadiness = fs.existsSync(githubOperatorReadinessPath) ? readJson(githubOperatorReadinessPath) : null;
  const updateChannel = fs.existsSync(updateChannelPath) ? readJson(updateChannelPath) : null;
  const releaseTag = fs.existsSync(releaseTagPath) ? readJson(releaseTagPath) : null;
  const baselineFreshness = fs.existsSync(baselineFreshnessPath) ? readJson(baselineFreshnessPath) : null;
  const uiParity = fs.existsSync(uiParityPath) ? readJson(uiParityPath) : null;
  const performanceParity = fs.existsSync(performanceParityPath) ? readJson(performanceParityPath) : null;
  const releaseDecision = fs.existsSync(releaseDecisionPath) ? readJson(releaseDecisionPath) : null;
  const releasePromotion = fs.existsSync(releasePromotionPath) ? readJson(releasePromotionPath) : null;
  const gitHead = run('git', ['rev-parse', 'HEAD'], { cwd: desktopDir });
  const gitStatus = run('git', ['status', '--short'], { cwd: desktopDir });

  const provenance = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: {
      name: pkg.build?.productName || pkg.name,
      packageName: pkg.name,
      version: pkg.version,
      expectedVersion: DEFAULT_VERSION,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
      electronBuilderVersion: pkg.devDependencies?.['electron-builder'] || null,
    },
    source: {
      gitHead: gitHead.ok ? gitHead.stdout : null,
      dirty: gitStatus.ok ? gitStatus.stdout.length > 0 : null,
      status: gitStatus.ok ? gitStatus.stdout.split('\n').filter(Boolean) : [],
    },
    host: {
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      node: process.version,
      npm: npmVersion(),
    },
    ci: {
      provider: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
      repository: process.env.GITHUB_REPOSITORY || null,
      workflow: process.env.GITHUB_WORKFLOW || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      ref: process.env.GITHUB_REF || null,
      sha: process.env.GITHUB_SHA || null,
    },
    baseline: {
      source: baseline.source,
      expectedAppAsarSha256: DEFAULT_ASAR_SHA256,
      actualAppAsarSha256: fs.existsSync(baselineRes.asarPath) ? sha256(baselineRes.asarPath) : null,
    },
    releaseManifest: manifest
      ? {
          generatedAt: manifest.generatedAt,
          appAsarSha256: manifestReleaseAsar?.sha256 || null,
          appAsarPolicy: manifest.release?.appAsarPolicy || null,
          appAsarContentOk: manifest.release?.appAsarContentOk === true ||
            appAsarContentOk({
              expectedSha256: manifest.baseline?.appAsar?.expectedSha256,
              candidateSha256: manifestReleaseAsar?.sha256,
              policy: manifest.release?.appAsarPolicy,
            }),
          productionAuditOk: Boolean(manifest.security?.productionAudit?.ok),
          fullAuditOk: Boolean(manifest.security?.fullAudit?.ok),
          securityAuditReportSha256: manifest.security?.securityAuditReport?.sha256 || null,
          codeSignature: manifest.security?.codeSignature || null,
          developerIdSignatureOk: manifest.security?.codeSignature?.developerId === true,
          codesignOk: Boolean(manifest.security?.codesignVerify?.ok),
          gatekeeperOk: Boolean(manifest.security?.gatekeeper?.ok),
          staplerOk: Boolean(manifest.security?.stapler?.ok),
          dmgGatekeeperOk: Boolean(manifest.security?.dmgGatekeeper?.ok),
          dmgStaplerOk: Boolean(manifest.security?.dmgStapler?.ok),
        }
      : null,
    securityAudit: securityAudit
      ? {
          generatedAt: securityAudit.generatedAt,
          ok: Boolean(securityAudit.ok),
          blockers: securityAudit.summary?.blockers ?? null,
          warnings: securityAudit.summary?.warnings ?? null,
          productionOk: Boolean(securityAudit.audits?.production?.ok),
          fullOk: Boolean(securityAudit.audits?.all?.ok),
          productionVulnerabilities: securityAudit.audits?.production?.vulnerabilities || null,
          fullVulnerabilities: securityAudit.audits?.all?.vulnerabilities || null,
        }
      : null,
    releaseTag: releaseTag
      ? {
          generatedAt: releaseTag.generatedAt,
          ok: Boolean(releaseTag.ok),
          expected: releaseTag.releaseTag?.expected || null,
          resolved: releaseTag.releaseTag?.resolved || null,
          source: releaseTag.releaseTag?.source || null,
        }
      : null,
    baselineFreshness: baselineFreshness
      ? {
          generatedAt: baselineFreshness.generatedAt,
          ok: Boolean(baselineFreshness.ok),
          status: baselineFreshness.status || null,
          blockers: baselineFreshness.summary?.blockers ?? null,
          warnings: baselineFreshness.summary?.warnings ?? null,
          source: baselineFreshness.baseline?.source || null,
          mode: baselineFreshness.baseline?.mode || null,
          baselineVersion: baselineFreshness.baseline?.infoPlist?.version || null,
          baselinePackageVersion: baselineFreshness.baseline?.package?.version || null,
          baselineAppAsarSha256: baselineFreshness.baseline?.appAsar?.actualSha256 || null,
          releaseAppAsarSha256: baselineFreshness.releaseManifest?.releaseAppAsarSha256 || null,
        }
      : null,
    uiParity: uiParity
      ? {
          generatedAt: uiParity.generatedAt,
          ok: Boolean(uiParity.ok),
          blockers: uiParity.summary?.blockers ?? null,
          warnings: uiParity.summary?.warnings ?? null,
          screenshotSimilarity: uiParity.screenshots?.similarity ?? null,
          fullPageSimilarity: uiParity.screenshots?.fullPageSimilarity ?? null,
          threshold: uiParity.screenshots?.threshold ?? null,
          localPreloadMethods: uiParity.surface?.localPreloadMethods ?? null,
          baselinePreloadMethods: uiParity.surface?.baselinePreloadMethods ?? null,
        }
      : null,
    performanceParity: performanceParity
      ? {
          generatedAt: performanceParity.generatedAt,
          ok: Boolean(performanceParity.ok),
          blockers: performanceParity.summary?.blockers ?? null,
          warnings: performanceParity.summary?.warnings ?? null,
          localLoadMs: performanceParity.measurements?.local?.loadMs ?? null,
          baselineLoadMs: performanceParity.measurements?.baseline?.loadMs ?? null,
          interactionCount: performanceParity.measurements?.local?.interactions?.length ?? null,
        }
      : null,
    macosSecurityContract: macosSecurity
      ? {
          generatedAt: macosSecurity.generatedAt,
          ok: Boolean(macosSecurity.ok),
          blockers: macosSecurity.summary?.blockers ?? null,
          warnings: macosSecurity.summary?.warnings ?? null,
          allowedEntitlements: macosSecurity.contract?.allowedEntitlements || [],
        }
      : null,
    ipcSecurity: ipcSecurity
      ? {
          generatedAt: ipcSecurity.generatedAt,
          ok: Boolean(ipcSecurity.ok),
          blockers: ipcSecurity.summary?.blockers ?? null,
          warnings: ipcSecurity.summary?.warnings ?? null,
          externalUrlProtocols: ipcSecurity.policy?.externalUrlProtocols || [],
          workspaceConfinement: Boolean(ipcSecurity.policy?.workspaceConfinement),
          checkedApis: ipcSecurity.policy?.checkedApis || [],
        }
      : null,
    releaseEnvironment: releaseEnv
      ? {
          generatedAt: releaseEnv.generatedAt,
          strict: Boolean(releaseEnv.strict),
          processEnv: Boolean(releaseEnv.processEnv),
          source: releaseEnv.source || null,
          blockers: releaseEnv.summary?.blockers ?? null,
          warnings: releaseEnv.summary?.warnings ?? null,
          keyCount: releaseEnv.keys?.length ?? null,
      }
      : null,
    releaseEnvironmentContract: releaseEnvContract
      ? {
          generatedAt: releaseEnvContract.generatedAt,
          blockers: releaseEnvContract.summary?.blockers ?? null,
          warnings: releaseEnvContract.summary?.warnings ?? null,
          requiredVariables: releaseEnvContract.contract?.requiredVariables || [],
          auditTokenSources: releaseEnvContract.contract?.auditTokenSources || [],
          checks: releaseEnvContract.checks?.length ?? null,
        }
      : null,
    secretHygiene: secretHygiene
      ? {
          generatedAt: secretHygiene.generatedAt,
          blockers: secretHygiene.summary?.blockers ?? null,
          warnings: secretHygiene.summary?.warnings ?? null,
          sensitiveEnvNameCount: secretHygiene.sensitiveEnvNamesPresent?.length ?? null,
          checks: secretHygiene.checks?.length ?? null,
        }
      : null,
    dmgInstallExperience: dmgInstall
      ? {
          generatedAt: dmgInstall.generatedAt,
          ok: Boolean(dmgInstall.ok),
          blockers: dmgInstall.summary?.blockers ?? null,
          warnings: dmgInstall.summary?.warnings ?? null,
          dmgPath: dmgInstall.dmg?.path || null,
          dmgSha256: dmgInstall.dmg?.sha256 || null,
        }
      : null,
    releaseLaunchSmoke: launchSmoke
      ? {
          generatedAt: launchSmoke.generatedAt,
          ok: Boolean(launchSmoke.ok),
          durationMs: launchSmoke.durationMs,
          timeoutMs: launchSmoke.timeoutMs,
          bundleIdentifier: launchSmoke.bundleIdentifier,
          version: launchSmoke.version,
          appPath: launchSmoke.appPath,
        }
      : null,
    releaseDmgLaunchSmoke: dmgLaunchSmoke
      ? {
          generatedAt: dmgLaunchSmoke.generatedAt,
          ok: Boolean(dmgLaunchSmoke.ok),
          durationMs: dmgLaunchSmoke.durationMs,
          timeoutMs: dmgLaunchSmoke.timeoutMs,
          bundleIdentifier: dmgLaunchSmoke.bundleIdentifier,
          version: dmgLaunchSmoke.version,
          dmgPath: dmgLaunchSmoke.dmgPath,
          appPath: dmgLaunchSmoke.appPath,
        }
      : null,
    signingReadiness: signingReadiness
      ? {
          generatedAt: signingReadiness.generatedAt,
          blockers: signingReadiness.summary?.blockers ?? null,
          warnings: signingReadiness.summary?.warnings ?? null,
          total: signingReadiness.summary?.total ?? null,
        }
      : null,
    operatorReadiness: operatorReadiness
      ? {
          generatedAt: operatorReadiness.generatedAt,
          strict: Boolean(operatorReadiness.strict),
          github: Boolean(operatorReadiness.github),
          blockers: operatorReadiness.summary?.blockers ?? null,
          warnings: operatorReadiness.summary?.warnings ?? null,
          total: operatorReadiness.checks?.length ?? null,
        }
      : null,
    githubOperatorReadiness: githubOperatorReadiness
      ? {
          generatedAt: githubOperatorReadiness.generatedAt,
          strict: Boolean(githubOperatorReadiness.strict),
          github: Boolean(githubOperatorReadiness.github),
          blockers: githubOperatorReadiness.summary?.blockers ?? null,
          warnings: githubOperatorReadiness.summary?.warnings ?? null,
          total: githubOperatorReadiness.checks?.length ?? null,
        }
      : null,
    updateChannel: updateChannel
      ? {
          generatedAt: updateChannel.generatedAt,
          ok: Boolean(updateChannel.ok),
          blockers: updateChannel.summary?.blockers ?? null,
          warnings: updateChannel.summary?.warnings ?? null,
          provider: updateChannel.updateChannel?.provider || null,
          owner: updateChannel.updateChannel?.owner || null,
          repo: updateChannel.updateChannel?.repo || null,
        }
      : null,
    releaseDecision: releaseDecision
      ? {
          generatedAt: releaseDecision.generatedAt,
          strict: Boolean(releaseDecision.strict),
          status: releaseDecision.status || null,
          productionReady: Boolean(releaseDecision.productionReady),
          localCandidateReady: Boolean(releaseDecision.localCandidateReady),
          remainingActions: (releaseDecision.remainingActions || []).map((item) => item.id),
        }
      : null,
    releasePromotion: releasePromotion
      ? {
          generatedAt: releasePromotion.generatedAt,
          status: releasePromotion.status || null,
          productionReady: Boolean(releasePromotion.productionReady),
          localCandidateReady: Boolean(releasePromotion.localCandidateReady),
        }
      : null,
    artifacts: [
      fileInfo(`release/Connect-AI-${pkg.version}-mac-arm64.dmg`),
      fileInfo(`release/Connect-AI-${pkg.version}-mac-arm64.dmg.blockmap`),
      fileInfo('release/latest-mac.yml'),
      fileInfo('release/release-manifest.json'),
      fileInfo('release/release-tag-report.json'),
      fileInfo('release/baseline-freshness-report.json'),
      fileInfo('release/BASELINE_FRESHNESS.md'),
      fileInfo('release/installed-app-parity-report.json'),
      fileInfo('release/ui-parity-report.json'),
      fileInfo('release/performance-parity-report.json'),
      fileInfo('release/macos-security-contract.json'),
      fileInfo('release/ipc-security-report.json'),
      fileInfo('release/security-audit-report.json'),
      fileInfo('release/release-env-contract-report.json'),
      fileInfo('release/release-env-report.json'),
      fileInfo('release/release-env-report.process.json'),
      fileInfo('release/secret-hygiene-report.json'),
      fileInfo('release/dmg-install-experience.json'),
      fileInfo('release/release-launch-smoke.json'),
      fileInfo('release/release-dmg-launch-smoke.json'),
      fileInfo('release/signing-readiness.json'),
      fileInfo('release/operator-readiness.json'),
      fileInfo('release/operator-readiness.github.json'),
      fileInfo('release/update-channel-report.json'),
      fileInfo('release/release-decision.strict.json'),
      fileInfo('release/release-promotion-plan.json'),
      fileInfo('release/RELEASE_PROMOTION_PLAN.md'),
      fileInfo('release/release-asset-manifest.json'),
    ],
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  const out = path.join(releaseDir, 'provenance.json');
  fs.writeFileSync(out, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`Wrote ${path.relative(desktopDir, out)}`);
}

main();
