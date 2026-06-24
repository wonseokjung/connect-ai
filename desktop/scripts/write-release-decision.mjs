import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');

const externalSigningBlockers = new Set([
  'Developer ID Application identity',
  'certificate import inputs',
  'certificate import source',
  'certificate password',
  'keychain password',
  'notarization inputs',
  'Developer ID signing identity',
  'notarization credentials',
  'certificate import input',
  'APPLE_API_KEY file',
  'APPLE_API_KEY_BASE64 shape',
]);

function readJson(relativePath, required = true) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`missing ${relativePath}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readText(relativePath, required = true) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`missing ${relativePath}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function releaseNotesStatus(text) {
  const match = text.match(/^Status:\s*(.+)$/m);
  return match ? match[1].trim() : 'missing';
}

function failedChecks(report) {
  return (report?.checks || []).filter((check) => check.ok !== true);
}

function summary(report) {
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
}

function securityOk(manifest) {
  const security = manifest?.security || {};
  const fields = ['productionAudit', 'codesignVerify', 'gatekeeper', 'stapler', 'dmgGatekeeper', 'dmgStapler'];
  return fields.every((name) => security[name]?.ok === true) && security.codeSignature?.developerId === true;
}

function hasPass(report, name) {
  return (report?.checks || []).some((check) => check.name === name && check.ok === true);
}

function classifyOperatorBlockers(operatorReport) {
  const blockers = failedChecks(operatorReport).filter((check) => check.level === 'blocker');
  const external = blockers.filter((check) => externalSigningBlockers.has(check.name));
  const internal = blockers.filter((check) => !externalSigningBlockers.has(check.name));
  return { blockers, external, internal };
}

function githubOperatorStatus(report, requireReport) {
  if (!report) {
    return {
      present: false,
      clean: !requireReport,
      summary: null,
      detail: requireReport
        ? ['missing release/operator-readiness.github.json; run npm run release:operator-checklist:github:strict']
        : [],
    };
  }

  const reportSummary = summary(report);
  const modeOk = report.github === true && report.strict === true;
  const clean = modeOk && reportSummary.blockers === 0 && reportSummary.warnings === 0;
  return {
    present: true,
    clean,
    summary: reportSummary,
    detail: [
      !modeOk ? `mode: github=${Boolean(report.github)} strict=${Boolean(report.strict)}` : null,
      ...failedChecks(report).map((check) => `${check.name}: ${check.detail}`),
    ].filter(Boolean),
  };
}

function main() {
  const pkg = readJson('package.json');
  const manifest = readJson('release/release-manifest.json');
  const evidence = readJson('release/evidence-report.json');
  const strictEvidence = readJson('release/evidence-report.strict.json', false);
  const operator = readJson('release/operator-readiness.json');
  const githubOperatorReport = readJson('release/operator-readiness.github.json', false);
  const signingReadiness = readJson('release/signing-readiness.json', false);
  const updateChannel = readJson('release/update-channel-report.json', false);
  const releaseTag = readJson('release/release-tag-report.json', false);
  const uiParity = readJson('release/ui-parity-report.json', false);
  const performanceParity = readJson('release/performance-parity-report.json', false);
  const macosSecurity = readJson('release/macos-security-contract.json');
  const install = readJson('release/dmg-install-experience.json');
  const appLaunch = readJson('release/release-launch-smoke.json');
  const dmgLaunch = readJson('release/release-dmg-launch-smoke.json');
  const notes = readText('release/RELEASE_NOTES.md');

  const notesStatus = releaseNotesStatus(notes);
  const evidenceSummary = summary(evidence);
  const strictEvidenceSummary = summary(strictEvidence);
  const operatorSummary = summary(operator);
  const signingReadinessSummary = signingReadiness ? summary(signingReadiness) : null;
  const updateChannelSummary = updateChannel ? summary(updateChannel) : null;
  const releaseTagSummary = releaseTag ? summary(releaseTag) : null;
  const operatorBlockers = classifyOperatorBlockers(operator);
  const requireGitHubOperatorReadiness = process.env.CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS === '1';
  const githubOperator = githubOperatorStatus(githubOperatorReport, requireGitHubOperatorReadiness);
  const signedNotarized = notesStatus === 'signed-and-notarized' && securityOk(manifest);
  const localCandidateReady = Boolean(
    evidenceSummary.blockers === 0 &&
      releaseTag?.ok === true &&
      uiParity?.ok === true &&
      performanceParity?.ok === true &&
      macosSecurity.ok === true &&
      install.ok === true &&
      appLaunch.ok === true &&
      dmgLaunch.ok === true &&
      hasPass(evidence, 'manifest app.asar parity') &&
      hasPass(evidence, 'UI parity status') &&
      hasPass(evidence, 'UI parity screenshot similarity') &&
      hasPass(evidence, 'performance parity status') &&
      hasPass(evidence, 'performance parity renderer load budget') &&
      hasPass(evidence, 'macOS security status') &&
      hasPass(evidence, 'macOS security release ATS arbitrary loads disabled') &&
      hasPass(evidence, 'DMG install copy simulation') &&
      hasPass(evidence, 'DMG install mounted app ATS arbitrary loads disabled') &&
      hasPass(evidence, 'DMG install copied app ATS arbitrary loads disabled') &&
      hasPass(evidence, 'DMG launch smoke status')
  );
  const productionReady = Boolean(
    localCandidateReady &&
      signedNotarized &&
      strictEvidenceSummary.blockers === 0 &&
      operatorSummary.blockers === 0 &&
      githubOperator.clean &&
      (!signingReadinessSummary || signingReadinessSummary.blockers === 0) &&
      operatorBlockers.internal.length === 0
  );

  const remainingActions = [];
  if (!productionReady) {
    if (!signedNotarized) {
      remainingActions.push({
        id: 'sign_and_notarize',
        owner: 'operator',
        blocking: true,
        detail: 'Developer ID signing, Gatekeeper assessment, and stapled notarization must pass for both app and DMG.',
      });
    }
    if (operatorBlockers.external.length) {
      remainingActions.push({
        id: 'provide_apple_release_credentials',
        owner: 'operator',
        blocking: true,
        detail: operatorBlockers.external.map((check) => `${check.name}: ${check.detail}`),
      });
    }
    if (signingReadinessSummary?.blockers > 0) {
      remainingActions.push({
        id: 'resolve_signing_readiness',
        owner: 'operator',
        blocking: true,
        detail: failedChecks(signingReadiness)
          .filter((check) => check.level === 'blocker')
          .map((check) => `${check.name}: ${check.detail}`),
      });
    }
    if (operatorBlockers.internal.length) {
      remainingActions.push({
        id: 'fix_internal_release_gate',
        owner: 'engineering',
        blocking: true,
        detail: operatorBlockers.internal.map((check) => `${check.name}: ${check.detail}`),
      });
    }
    if (!githubOperator.clean) {
      remainingActions.push({
        id: 'resolve_github_operator_readiness',
        owner: 'operator',
        blocking: true,
        detail: githubOperator.detail,
      });
    }
    if (!localCandidateReady) {
      remainingActions.push({
        id: 'restore_local_candidate_evidence',
        owner: 'engineering',
        blocking: true,
        detail: failedChecks(evidence).map((check) => `${check.name}: ${check.detail}`),
      });
    }
    if (releaseTag && releaseTag.ok !== true) {
      remainingActions.push({
        id: 'fix_release_tag_gate',
        owner: 'engineering',
        blocking: true,
        detail: failedChecks(releaseTag).map((check) => `${check.name}: ${check.detail}`),
      });
    }
    if (uiParity && uiParity.ok !== true) {
      remainingActions.push({
        id: 'fix_ui_parity_gate',
        owner: 'engineering',
        blocking: true,
        detail: failedChecks(uiParity).map((check) => `${check.name}: ${check.detail}`),
      });
    }
    if (performanceParity && performanceParity.ok !== true) {
      remainingActions.push({
        id: 'fix_performance_parity_gate',
        owner: 'engineering',
        blocking: true,
        detail: failedChecks(performanceParity).map((check) => `${check.name}: ${check.detail}`),
      });
    }
  }
  if (operatorSummary.warnings > 0) {
    remainingActions.push({
      id: 'clean_operator_warnings',
      owner: 'operator',
      blocking: false,
      detail: failedChecks(operator)
        .filter((check) => check.level === 'warn')
        .map((check) => `${check.name}: ${check.detail}`),
    });
  }

  const decision = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
    },
    status: productionReady ? 'production-ready' : localCandidateReady ? 'local-candidate-ready' : 'not-ready',
    productionReady,
    localCandidateReady,
    signedNotarized,
    releaseNotesStatus: notesStatus,
    summaries: {
      evidence: evidenceSummary,
      strictEvidence: strictEvidence ? strictEvidenceSummary : null,
      operator: operatorSummary,
      githubOperator: githubOperator.summary,
      signingReadiness: signingReadinessSummary,
      updateChannel: updateChannelSummary,
      releaseTag: releaseTagSummary,
      uiParity: uiParity ? summary(uiParity) : null,
      performanceParity: performanceParity ? summary(performanceParity) : null,
      macosSecurity: macosSecurity.summary || null,
      dmgInstall: install.summary || null,
      appLaunch: {
        ok: Boolean(appLaunch.ok),
        durationMs: appLaunch.durationMs,
      },
      dmgLaunch: {
        ok: Boolean(dmgLaunch.ok),
        durationMs: dmgLaunch.durationMs,
      },
    },
    evidenceFiles: [
      'release/release-manifest.json',
      'release/macos-security-contract.json',
      'release/dmg-install-experience.json',
      'release/release-launch-smoke.json',
      'release/release-dmg-launch-smoke.json',
      'release/evidence-report.json',
      strictEvidence ? 'release/evidence-report.strict.json' : null,
      'release/operator-readiness.json',
      githubOperator.present ? 'release/operator-readiness.github.json' : null,
      signingReadiness ? 'release/signing-readiness.json' : null,
      updateChannel ? 'release/update-channel-report.json' : null,
      releaseTag ? 'release/release-tag-report.json' : null,
      uiParity ? 'release/ui-parity-report.json' : null,
      performanceParity ? 'release/performance-parity-report.json' : null,
      'release/RELEASE_NOTES.md',
      'release/SHA256SUMS.txt',
      'release/SHA512SUMS.txt',
      'release/sbom.cdx.json',
      'release/sbom.spdx.json',
    ].filter(Boolean),
    remainingActions,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  const out = path.join(releaseDir, strict ? 'release-decision.strict.json' : 'release-decision.json');
  fs.writeFileSync(out, `${JSON.stringify(decision, null, 2)}\n`);
  console.log(`Connect AI release decision: ${decision.status}`);
  console.log(`productionReady=${decision.productionReady} localCandidateReady=${decision.localCandidateReady}`);
  if (remainingActions.length) {
    console.log(`remainingActions=${remainingActions.map((item) => item.id).join(', ')}`);
  }
  console.log(`Wrote ${path.relative(desktopDir, out)}`);

  if (strict && !productionReady && !noExit) process.exit(1);
  if (!localCandidateReady && !noExit) process.exit(1);
}

main();
