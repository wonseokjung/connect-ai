import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const reportPath = path.join(releaseDir, 'production-release-runbook-report.json');

function usage() {
  console.log(`Usage: node scripts/run-production-release.mjs [options]

Options:
  --file <path>          Release env file to load (default: .env.release.local)
  --process-env          Use the current process environment instead of a release env file
  --strict               Treat failed required stages as a failed command
  --no-exit              Write the report without returning a failed status
  --apply-github         Apply GitHub repository variables/secrets from env
  --import-signing       Import Developer ID certificate and restore API key material
  --build                Build the signed/notarized DMG
  --verify               Run strict release verification after build
  --no-publish-plan      Skip the dry-run GitHub Release publish plan
  --publish              Publish manifest-listed GitHub Release assets
  --confirm-publish      Required together with --publish
  --all                  Equivalent to --apply-github --import-signing --build --verify
`);
}

function parseArgs(argv) {
  const options = {
    envFile: '.env.release.local',
    processEnv: false,
    strict: false,
    noExit: false,
    applyGithub: false,
    importSigning: false,
    build: false,
    verify: false,
    publishPlan: true,
    publish: false,
    confirmPublish: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') {
      options.envFile = argv[i + 1] || options.envFile;
      i += 1;
    } else if (arg === '--process-env') {
      options.processEnv = true;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--no-exit') {
      options.noExit = true;
    } else if (arg === '--apply-github') {
      options.applyGithub = true;
    } else if (arg === '--import-signing') {
      options.importSigning = true;
    } else if (arg === '--build') {
      options.build = true;
    } else if (arg === '--verify') {
      options.verify = true;
    } else if (arg === '--no-publish-plan') {
      options.publishPlan = false;
    } else if (arg === '--publish') {
      options.publish = true;
    } else if (arg === '--confirm-publish') {
      options.confirmPublish = true;
    } else if (arg === '--all') {
      options.applyGithub = true;
      options.importSigning = true;
      options.build = true;
      options.verify = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function pathWithAsdf() {
  const currentPath = process.env.PATH || '';
  const asdfShims = path.join(os.homedir(), '.asdf', 'shims');
  if (!fs.existsSync(asdfShims)) return currentPath;
  return currentPath.split(path.delimiter).includes(asdfShims)
    ? currentPath
    : `${asdfShims}${path.delimiter}${currentPath}`;
}

function displayCommand(command, args) {
  return [command, ...args]
    .map((part) => {
      const text = String(part);
      if (/^[A-Za-z0-9_./:=@%+-]+$/.test(text)) return text;
      return JSON.stringify(text);
    })
    .join(' ');
}

function commandFromArgs(args) {
  return {
    command: args[0],
    args: args.slice(1),
    display: displayCommand(args[0], args.slice(1)),
  };
}

function envCommand(options, args) {
  if (options.processEnv) return commandFromArgs(args);
  return {
    command: process.execPath,
    args: ['scripts/run-with-release-env.mjs', '--file', options.envFile, '--', ...args],
    display: displayCommand('node', ['scripts/run-with-release-env.mjs', '--file', options.envFile, '--', ...args]),
  };
}

function npmCommand(script, args = []) {
  return {
    command: 'npm',
    args: ['run', script, ...args],
    display: displayCommand('npm', ['run', script, ...args]),
  };
}

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function releaseTag() {
  const pkg = readJson('package.json');
  return `desktop-v${pkg?.version || 'unknown'}`;
}

function productionReady() {
  const decision = readJson('release/release-decision.strict.json');
  const promotion = readJson('release/release-promotion-plan.json');
  const readiness = readJson('release/production-readiness-summary.json');
  const publicationSeal = readJson('release/release-publication-seal.json');
  const baselineFreshness = readJson('release/baseline-freshness-report.json');
  return Boolean(
    decision?.productionReady &&
      promotion?.productionReady &&
      readiness?.productionReady &&
      publicationSeal?.productionReady &&
      baselineFreshness?.ok === true &&
      Number(baselineFreshness?.summary?.blockers || 0) === 0
  );
}

function reportSnapshot(relativePath) {
  const report = readJson(relativePath);
  if (!report) return null;
  const commercialBlockerCoverage = report.commercialBlockerCoverage
    ? {
        total: Number(report.commercialBlockerCoverage.total || 0),
        covered: Number(report.commercialBlockerCoverage.covered || 0),
        uncovered: Number(report.commercialBlockerCoverage.uncovered || 0),
        items: Array.isArray(report.commercialBlockerCoverage.items)
          ? report.commercialBlockerCoverage.items.slice(0, 40).map((item) => ({
              blocker: {
                name: item.blocker?.name || null,
                detail: item.blocker?.detail || null,
              },
              classified: item.classified === true,
              covered: item.covered === true,
              reason: item.reason || null,
              missingNextExternalActions: item.missingNextExternalActions || [],
              missingUnblockGroups: item.missingUnblockGroups || [],
              missingCredentialGroups: item.missingCredentialGroups || [],
              remoteApplyActionsCovered: item.remoteApplyActionsCovered === true,
            }))
          : [],
      }
    : null;
  return {
    path: relativePath,
    generatedAt: report.generatedAt || null,
    status: report.status || null,
    ok: report.ok ?? null,
    productionReady: report.productionReady ?? null,
    localCandidateReady: report.localCandidateReady ?? null,
    publishedReleaseReady: report.publishedReleaseReady ?? null,
    commercialReady: report.commercialReady ?? null,
    summary: report.summary || null,
    gateSummary: report.gateSummary || null,
    commercialBlockerCoverage,
    failedChecks: Array.isArray(report.checks)
      ? report.checks
          .filter((check) => check?.ok !== true)
          .slice(0, 20)
          .map((check) => ({
            name: check.name || null,
            detail: check.detail || null,
            level: check.level || null,
          }))
      : [],
    nextActions: Array.isArray(report.nextActions)
      ? report.nextActions.slice(0, 30).map((action) => ({
          id: action.id || null,
          owner: action.owner || null,
          phase: action.phase || null,
          blocking: action.blocking ?? null,
          detail: Array.isArray(action.detail)
            ? action.detail.slice(0, 12)
            : [action.detail].filter(Boolean),
        }))
      : [],
  };
}

function releaseGateSnapshot() {
  const readiness = readJson('release/production-readiness-summary.json');
  const publicationSeal = readJson('release/release-publication-seal.json');
  const baselineFreshness = readJson('release/baseline-freshness-report.json');
  const baselineFresh = baselineFreshness?.ok === true && Number(baselineFreshness?.summary?.blockers || 0) === 0;
  return {
    productionReady: productionReady(),
    localCandidateReady: Boolean(readiness?.localCandidateReady || publicationSeal?.localCandidateReady),
    publishedReleaseReady: Boolean(readiness?.publishedReleaseReady && publicationSeal?.publishedReleaseReady),
    baselineFresh,
    strictDecision: reportSnapshot('release/release-decision.strict.json'),
    promotion: reportSnapshot('release/release-promotion-plan.json'),
    readiness: reportSnapshot('release/production-readiness-summary.json'),
    publicationSeal: reportSnapshot('release/release-publication-seal.json'),
    baselineFreshness: reportSnapshot('release/baseline-freshness-report.json'),
    credentialHandoff: reportSnapshot('release/release-credential-handoff-report.strict.json'),
    commercialReadiness: reportSnapshot('release/commercial-release-readiness-report.strict.json'),
    commercialFinalization: reportSnapshot('release/commercial-finalization-report.json'),
    assetManifestStrict: reportSnapshot('release/asset-manifest-report.strict.json'),
    assetManifestLocal: reportSnapshot('release/asset-manifest-report.json'),
  };
}

function runbookStatus(summary, gates) {
  if (summary.blockers > 0) {
    return gates.localCandidateReady ? 'local-candidate-awaiting-external-setup' : 'blocked';
  }
  if (gates.commercialFinalization?.commercialReady === true) return 'commercial-ready';
  if (gates.publishedReleaseReady) return 'published-release-ready';
  if (gates.productionReady) return 'production-ready';
  if (gates.localCandidateReady) return 'local-candidate-ready';
  return 'diagnostic-complete';
}

function stage(id, title, commandSpec, options = {}) {
  return {
    id,
    title,
    command: commandSpec.command,
    args: commandSpec.args,
    displayCommand: commandSpec.display || displayCommand(commandSpec.command, commandSpec.args),
    enabled: options.enabled !== false,
    requiresEnv: Boolean(options.requiresEnv),
    required: options.required !== false,
    mutates: Boolean(options.mutates),
    skippedReason: options.skippedReason || '',
    reportPaths: options.reportPaths || [],
  };
}

function buildStages(options, envExists) {
  const env = (args) => envCommand(options, args);
  const stages = [
    stage(
      'release-env-contract',
      'Verify release env variable contract across scripts, workflow, and docs',
      npmCommand('verify:release-env-contract'),
      { requiresEnv: false, reportPaths: ['release/release-env-contract-report.json'] },
    ),
    stage(
      'release-env-check',
      'Validate release env keys from the selected env file',
      env(['npm', 'run', options.strict ? 'release:env-check:process:strict' : 'release:env-check:process']),
      { requiresEnv: true, reportPaths: ['release/release-env-report.process.json'] },
    ),
    stage(
      'github-setup-dry-run',
      'Dry-run GitHub repository variable and secret setup',
      env(['npm', 'run', 'release:github-setup:process']),
      { requiresEnv: true, reportPaths: ['release/github-release-setup-report.json'] },
    ),
    stage(
      'github-setup-apply',
      'Apply GitHub repository variables and secrets',
      env([process.execPath, 'scripts/apply-github-release-setup.mjs', '--process-env', '--apply', '--strict']),
      {
        enabled: options.applyGithub,
        requiresEnv: true,
        mutates: true,
        reportPaths: ['release/github-release-setup-report.json'],
      },
    ),
    stage(
      'github-operator-readiness',
      'Record strict GitHub repository readiness without failing the runbook report',
      env(['npm', 'run', 'release:operator-checklist:github:strict:report']),
      { requiresEnv: true, reportPaths: ['release/operator-readiness.github.json'] },
    ),
    stage(
      'signing-readiness',
      'Record local signing and notarization readiness',
      env(['npm', 'run', 'signing:doctor']),
      { requiresEnv: true, reportPaths: ['release/signing-readiness.json'] },
    ),
    stage(
      'signing-import',
      'Import Developer ID certificate and restore notarization key material',
      env(['npm', 'run', 'signing:import']),
      {
        enabled: options.importSigning,
        requiresEnv: true,
        mutates: true,
        reportPaths: ['release/signing-readiness.json'],
      },
    ),
    stage(
      'signing-strict-check',
      'Check signing and notarization readiness in strict mode',
      env(['npm', 'run', 'signing:check']),
      {
        enabled: options.strict || options.importSigning || options.build || options.verify || options.publish,
        requiresEnv: true,
        reportPaths: ['release/signing-readiness.json'],
      },
    ),
    stage(
      'release-preflight',
      'Run release preflight with the selected env file',
      env(['npm', 'run', options.strict ? 'release:preflight:strict' : 'release:preflight']),
      { requiresEnv: true, reportPaths: [options.strict ? 'release/preflight-report.strict.json' : 'release/preflight-report.json'] },
    ),
    stage(
      'build-signed-dmg',
      'Build signed and notarized DMG',
      env(['npm', 'run', 'dist']),
      {
        enabled: options.build,
        requiresEnv: true,
        mutates: true,
        reportPaths: ['release/Connect-AI-0.4.8-mac-arm64.dmg', 'release/latest-mac.yml'],
      },
    ),
    stage(
      'verify-release',
      'Run strict app parity, release evidence, and production decision gates',
      env(['npm', 'run', 'verify:release']),
      {
        enabled: options.verify,
        requiresEnv: true,
        reportPaths: ['release/release-decision.strict.json', 'release/evidence-report.strict.json'],
      },
    ),
    stage(
      'promotion-plan',
      'Refresh release promotion plan from the current evidence',
      npmCommand('release:promotion-plan'),
      { requiresEnv: false, reportPaths: ['release/release-promotion-plan.json', 'release/RELEASE_PROMOTION_PLAN.md'] },
    ),
    stage(
      'asset-manifest',
      'Refresh release asset manifest before publish planning',
      npmCommand('release:asset-manifest'),
      { requiresEnv: false, reportPaths: ['release/release-asset-manifest.json'] },
    ),
    stage(
      'baseline-freshness',
      'Refresh baseline freshness evidence before publish planning',
      npmCommand(options.strict ? 'release:baseline-freshness:strict:report' : 'release:baseline-freshness'),
      { requiresEnv: false, reportPaths: ['release/baseline-freshness-report.json', 'release/BASELINE_FRESHNESS.md'] },
    ),
    stage(
      'publish-plan',
      'Generate manifest-driven GitHub Release publish plan without uploading',
      env(['npm', 'run', 'release:publish-assets:plan']),
      {
        enabled: options.publishPlan,
        requiresEnv: true,
        required: false,
        reportPaths: ['release/github-release-publish-plan.json'],
      },
    ),
    stage(
      'verify-publish-plan',
      'Verify GitHub Release publish plan consistency',
      npmCommand(options.strict ? 'verify:github-release-publish-plan:strict:report' : 'verify:github-release-publish-plan'),
      {
        enabled: options.publishPlan,
        requiresEnv: false,
        required: false,
        reportPaths: [options.strict ? 'release/github-release-publish-plan-report.strict.json' : 'release/github-release-publish-plan-report.json'],
      },
    ),
    stage(
      'verify-remote-assets',
      'Record strict GitHub Release asset drift without failing the runbook report',
      npmCommand('verify:github-release-assets:strict:report'),
      {
        requiresEnv: false,
        required: false,
        reportPaths: ['release/github-release-assets-report.strict.json'],
      },
    ),
    stage(
      'remote-remediation-plan',
      'Refresh GitHub Release remote asset remediation plan',
      npmCommand('release:github-release-remediation-plan'),
      {
        requiresEnv: false,
        reportPaths: ['release/github-release-remediation-plan.json', 'release/GITHUB_RELEASE_REMEDIATION_PLAN.md'],
      },
    ),
    stage(
      'verify-remote-remediation-plan',
      'Verify GitHub Release remote asset remediation plan coverage',
      npmCommand('verify:github-release-remediation-plan:strict:report'),
      {
        requiresEnv: false,
        reportPaths: ['release/github-release-remediation-plan-report.strict.json'],
      },
    ),
    stage(
      'remote-remediation-apply-plan',
      'Dry-run remote remediation apply against the local manifest',
      npmCommand('release:github-release-remediation-apply:plan'),
      {
        requiresEnv: false,
        reportPaths: ['release/github-release-remediation-apply-plan.json'],
      },
    ),
    stage(
      'verify-remote-remediation-apply-plan',
      'Verify dry-run remote remediation apply plan coverage',
      npmCommand('verify:github-release-remediation-apply-plan:strict:report'),
      {
        requiresEnv: false,
        reportPaths: ['release/github-release-remediation-apply-plan-report.strict.json'],
      },
    ),
    stage(
      'readiness-summary',
      'Refresh production readiness summary',
      npmCommand(options.strict ? 'release:readiness-summary:strict:report' : 'release:readiness-summary'),
      { requiresEnv: false, reportPaths: ['release/production-readiness-summary.json', 'release/PRODUCTION_READINESS_SUMMARY.md'] },
    ),
    stage(
      'unblock-plan',
      'Refresh release unblock plan',
      npmCommand('release:unblock-plan'),
      { requiresEnv: false, reportPaths: ['release/release-unblock-plan.json', 'release/RELEASE_UNBLOCK_PLAN.md'] },
    ),
    stage(
      'verify-unblock-plan',
      'Verify release unblock plan consistency',
      npmCommand(options.strict ? 'verify:unblock-plan:strict' : 'verify:unblock-plan'),
      { requiresEnv: false, reportPaths: [options.strict ? 'release/release-unblock-plan-report.strict.json' : 'release/release-unblock-plan-report.json'] },
    ),
    stage(
      'publication-seal',
      'Refresh release publication seal',
      npmCommand(options.strict ? 'release:publication-seal:strict:report' : 'release:publication-seal'),
      { requiresEnv: false, reportPaths: ['release/release-publication-seal.json', 'release/RELEASE_PUBLICATION_SEAL.md'] },
    ),
    stage(
      'setup-plan',
      'Refresh release setup plan',
      npmCommand('release:setup-plan'),
      { requiresEnv: false, reportPaths: ['release/release-setup-plan.json', 'release/RELEASE_SETUP_PLAN.md'] },
    ),
    stage(
      'credential-handoff',
      'Refresh release credential handoff from the current evidence',
      npmCommand('release:credential-handoff'),
      { requiresEnv: false, reportPaths: ['release/release-credential-handoff.json', 'release/RELEASE_CREDENTIAL_HANDOFF.md'] },
    ),
    stage(
      'verify-credential-handoff',
      'Verify release credential handoff consistency and secret hygiene',
      npmCommand(options.strict ? 'verify:credential-handoff:strict' : 'verify:credential-handoff'),
      {
        requiresEnv: false,
        required: options.strict,
        reportPaths: [options.strict ? 'release/release-credential-handoff-report.strict.json' : 'release/release-credential-handoff-report.json'],
      },
    ),
    stage(
      'asset-manifest-final',
      'Refresh release asset manifest and CI-only diagnostic list',
      npmCommand('release:asset-manifest'),
      { requiresEnv: false, reportPaths: ['release/release-asset-manifest.json'] },
    ),
    stage(
      'publication-seal-final',
      'Refresh release publication seal after the final asset manifest',
      npmCommand(options.strict ? 'release:publication-seal:strict:report' : 'release:publication-seal'),
      { requiresEnv: false, reportPaths: ['release/release-publication-seal.json', 'release/RELEASE_PUBLICATION_SEAL.md'] },
    ),
    stage(
      'verify-asset-manifest',
      'Verify release asset manifest policy',
      npmCommand(options.strict ? 'verify:asset-manifest:strict' : 'verify:asset-manifest'),
      {
        requiresEnv: false,
        required: options.strict,
        reportPaths: [options.strict ? 'release/asset-manifest-report.strict.json' : 'release/asset-manifest-report.json'],
      },
    ),
    stage(
      'commercial-finalization',
      'Finalize commercial readiness after the runbook evidence graph',
      npmCommand('release:commercial-finalize'),
      {
        enabled: !options.noExit,
        requiresEnv: false,
        skippedReason: options.noExit
          ? 'deferred until release:status-refresh converges; run npm run release:commercial-finalize after the refreshed graph is verified'
          : '',
        reportPaths: [
          'release/commercial-finalization-report.json',
          'release/COMMERCIAL_FINALIZATION.md',
          'release/commercial-finalization-report-verification.strict.json',
        ],
      },
    ),
  ];

  if (options.publish) {
    const tag = releaseTag();
    stages.push(
      stage(
        'pre-publish-production-gate',
        'Require production publication seal immediately before upload',
        npmCommand('verify:publication-seal:production'),
        {
          enabled: options.confirmPublish,
          requiresEnv: false,
          reportPaths: ['release/release-publication-seal.json', 'release/RELEASE_PUBLICATION_SEAL.md'],
        },
      ),
      stage(
        'publish-assets',
        `Publish manifest-listed GitHub Release assets to ${tag}`,
        env(['npm', 'run', 'release:publish-assets', '--', '--tag', tag]),
        {
          enabled: options.confirmPublish,
          requiresEnv: true,
          mutates: true,
          skippedReason: !options.confirmPublish
            ? 'missing --confirm-publish'
            : '',
          reportPaths: ['release/github-release-publish-plan.json'],
        },
      ),
      stage(
        'verify-published-assets',
        'Verify published GitHub Release assets against the manifest',
        env(['npm', 'run', 'verify:github-release-assets:strict']),
        {
          enabled: options.confirmPublish,
          requiresEnv: true,
          reportPaths: ['release/github-release-assets-report.strict.json'],
        },
      ),
      stage(
        'post-publish-readiness-summary',
        'Refresh production readiness after published asset verification',
        npmCommand('release:readiness-summary:strict:report'),
        {
          enabled: options.confirmPublish,
          requiresEnv: false,
          reportPaths: ['release/production-readiness-summary.json', 'release/PRODUCTION_READINESS_SUMMARY.md'],
        },
      ),
      stage(
        'post-publish-publication-seal',
        'Refresh publication seal after published asset verification',
        npmCommand('release:publication-seal:strict:report'),
        {
          enabled: options.confirmPublish,
          requiresEnv: false,
          reportPaths: ['release/release-publication-seal.json', 'release/RELEASE_PUBLICATION_SEAL.md'],
        },
      ),
      stage(
        'post-publish-published-gate',
        'Require published release readiness after upload verification',
        npmCommand('verify:publication-seal:published'),
        {
          enabled: options.confirmPublish,
          requiresEnv: false,
          reportPaths: ['release/release-publication-seal.json', 'release/RELEASE_PUBLICATION_SEAL.md'],
        },
      ),
      stage(
        'post-publish-commercial-finalization',
        'Require commercial readiness after published asset verification',
        npmCommand('release:commercial-finalize:commercial'),
        {
          enabled: options.confirmPublish,
          requiresEnv: false,
          reportPaths: [
            'release/commercial-finalization-report.json',
            'release/COMMERCIAL_FINALIZATION.md',
            'release/commercial-finalization-report-verification.strict.json',
          ],
        },
      ),
    );
  }

  const envAvailable = options.processEnv || envExists;
  for (const item of stages) {
    if (item.enabled && item.requiresEnv && !envAvailable) {
      item.enabled = false;
      item.skippedReason = `missing ${options.envFile}`;
    }
  }

  return stages;
}

function runStage(item, childEnv) {
  if (!item.enabled) {
    console.log(`SKIP    ${item.id} - ${item.skippedReason || 'not requested'}`);
    return { ...item, status: 'skipped', ok: true };
  }

  console.log(`RUN     ${item.id} - ${item.title}`);
  console.log(`        ${item.displayCommand}`);
  const startedAt = Date.now();
  const result = spawnSync(item.command, item.args, {
    cwd: desktopDir,
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - startedAt;
  const status = result.status ?? 1;
  const ok = !result.error && status === 0;
  const detail = result.error ? result.error.message : ok ? `completed in ${durationMs}ms` : `exit ${status}`;
  console.log(`${ok ? 'PASS' : item.required ? 'BLOCKER' : 'WARN'}  ${item.id} - ${detail}`);
  return {
    ...item,
    status: ok ? 'passed' : 'failed',
    ok,
    exitCode: status,
    durationMs,
    error: result.error ? result.error.message : '',
    detail,
  };
}

function guardChecks(options, envExists) {
  const envPath = path.resolve(desktopDir, options.envFile);
  const checks = [
    {
      name: options.processEnv ? 'release env source' : 'release env file',
      ok: options.processEnv || envExists,
      level: 'blocker',
      detail: options.processEnv
        ? 'process env'
        : envExists
          ? path.relative(desktopDir, envPath)
          : `missing ${path.relative(desktopDir, envPath)}`,
    },
  ];

  if (options.publish && !options.confirmPublish) {
    checks.push({
      name: 'publish confirmation',
      ok: false,
      level: 'blocker',
      detail: 'add --confirm-publish to publish GitHub Release assets',
    });
  }

  return checks;
}

function summarize(guardResults, stageResults) {
  const guardBlockers = guardResults.filter((check) => !check.ok && check.level === 'blocker').length;
  const guardWarnings = guardResults.filter((check) => !check.ok && check.level === 'warn').length;
  const failedRequired = stageResults.filter((item) => item.enabled && item.required && item.ok !== true).length;
  const failedOptional = stageResults.filter((item) => item.enabled && !item.required && item.ok !== true).length;
  return {
    blockers: guardBlockers + failedRequired,
    warnings: guardWarnings + failedOptional,
    passed: stageResults.filter((item) => item.status === 'passed').length,
    skipped: stageResults.filter((item) => item.status === 'skipped').length,
    failed: stageResults.filter((item) => item.status === 'failed').length,
  };
}

function blockerDetails(guardResults, stageResults) {
  return {
    guardBlockers: guardResults
      .filter((check) => !check.ok && check.level === 'blocker')
      .map((check) => ({ name: check.name, detail: check.detail })),
    failedRequiredStages: stageResults
      .filter((item) => item.enabled && item.required && item.ok !== true)
      .map((item) => ({
        id: item.id,
        detail: item.detail || '',
        reportPaths: item.reportPaths || [],
      })),
    skippedRequiredStages: stageResults
      .filter((item) => !item.enabled && item.required)
      .map((item) => ({
        id: item.id,
        skippedReason: item.skippedReason || 'not requested',
        reportPaths: item.reportPaths || [],
      })),
  };
}

function externalBlockerCoverage(gates) {
  const finalization = gates.commercialFinalization || {};
  const coverage = finalization.commercialBlockerCoverage || {};
  const summary = finalization.summary || {};
  const readinessSummary = gates.commercialReadiness?.summary || {};
  return {
    commercialReadinessBlockers: Number(readinessSummary.blockers || summary.commercialReadinessBlockersTotal || 0),
    commercialReadinessBlockersCovered: Number(summary.commercialReadinessBlockersCovered || coverage.covered || 0),
    commercialReadinessBlockersUncovered: Number(summary.commercialReadinessBlockersUncovered || coverage.uncovered || 0),
    externalBlockers: Number(summary.externalBlockers || readinessSummary.externalBlockers || 0),
    remoteRequiredActions: Number(summary.remoteRequiredActions || readinessSummary.remoteRequiredActions || 0),
    remoteApplyActions: Number(summary.remoteApplyActions || readinessSummary.remoteApplyActions || 0),
    remoteUploadPermissionReady: Boolean(summary.remoteUploadPermissionReady || readinessSummary.remoteUploadPermissionReady),
    blockedCredentialGroups: Number(summary.blockedCredentialGroups || readinessSummary.blockedCredentialGroups || 0),
    blockedUnblockGroups: Number(summary.blockedUnblockGroups || readinessSummary.blockedUnblockGroups || 0),
    installedBundleCommercialBlockingDeltas: Number(summary.installedBundleCommercialBlockingDeltas || 0),
  };
}

function writeReport(options, guardResults, stageResults, summary) {
  fs.mkdirSync(releaseDir, { recursive: true });
  const gates = releaseGateSnapshot();
  const status = runbookStatus(summary, gates);
  const blockerDetailsReport = blockerDetails(guardResults, stageResults);
  blockerDetailsReport.externalBlockerCoverage = externalBlockerCoverage(gates);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    productionReady: Boolean(gates.productionReady && summary.blockers === 0),
    localCandidateReady: gates.localCandidateReady,
    publishedReleaseReady: Boolean(gates.publishedReleaseReady && summary.blockers === 0),
    commercialReady: Boolean(gates.commercialFinalization?.commercialReady === true && summary.blockers === 0),
    mode: {
      strict: options.strict,
      noExit: options.noExit,
      processEnv: options.processEnv,
      applyGithub: options.applyGithub,
      importSigning: options.importSigning,
      build: options.build,
      verify: options.verify,
      publishPlan: options.publishPlan,
      publish: options.publish,
      confirmPublish: options.confirmPublish,
    },
    source: options.processEnv ? 'process env' : options.envFile,
    envFile: options.processEnv ? null : options.envFile,
    summary,
    gateSnapshot: gates,
    blockerDetails: blockerDetailsReport,
    guards: guardResults,
    stages: stageResults.map((item) => ({
      id: item.id,
      title: item.title,
      enabled: item.enabled,
      status: item.status,
      ok: item.ok,
      required: item.required,
      mutates: item.mutates,
      skippedReason: item.skippedReason || '',
      exitCode: item.exitCode ?? null,
      durationMs: item.durationMs ?? null,
      detail: item.detail || '',
      command: item.displayCommand,
      reportPaths: item.reportPaths,
    })),
    safetyRules: [
      'Secret values are never written to this report.',
      'Default mode is diagnostic and does not apply GitHub settings, import signing material, build, verify, or publish unless flags request it.',
      'Dry-run publish planning is followed by verify:github-release-publish-plan to validate schema, gate projections, manifest assets, source reports, and secret hygiene.',
      'Remote asset drift is captured in the runbook with verify:github-release-assets:strict:report, release:github-release-remediation-plan, verify:github-release-remediation-plan:strict:report, release:github-release-remediation-apply:plan, and verify:github-release-remediation-apply-plan:strict:report before readiness is refreshed.',
      'Publishing requires --publish --confirm-publish, then verify:publication-seal:production immediately before upload; release:publish-assets rechecks productionReady=true in strict decision, promotion, production readiness, and publication seal reports, plus ok=true in baseline freshness.',
      'After upload, verify:github-release-assets:strict runs, production readiness and publication seal are refreshed, then verify:publication-seal:published and release:commercial-finalize:commercial confirm publishedReleaseReady=true and commercialReady=true.',
      'No-exit diagnostic runbooks defer release:commercial-finalize until the status-refresh graph converges; publish runbooks use release:commercial-finalize:commercial after uploaded assets are verified.',
      'Commercial readiness blockers must stay fully mapped in commercialBlockerCoverage before external setup gaps are treated as actionable release work.',
      'Use release/release-asset-manifest.json as the only upload allowlist for GitHub Release assets.',
    ],
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
}

function writeInitialReport(options, guardResults) {
  fs.mkdirSync(releaseDir, { recursive: true });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'running',
    mode: {
      strict: options.strict,
      noExit: options.noExit,
      processEnv: options.processEnv,
      applyGithub: options.applyGithub,
      importSigning: options.importSigning,
      build: options.build,
      verify: options.verify,
      publishPlan: options.publishPlan,
      publish: options.publish,
      confirmPublish: options.confirmPublish,
    },
    source: options.processEnv ? 'process env' : options.envFile,
    envFile: options.processEnv ? null : options.envFile,
    summary: { blockers: 0, warnings: 0, passed: 0, skipped: 0, failed: 0 },
    guards: guardResults,
    stages: [],
    safetyRules: [
      'This running report is overwritten with final stage results at the end of the runbook.',
      'Secret values are never written to this report.',
      'Remote remediation apply is dry-run only unless an explicit publish/remediation command is run separately with production gates clean.',
      'The final runbook report is followed by commercial finalization evidence without writing secret values.',
    ],
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function refreshCiOnlyManifest(childEnv) {
  const manifestPath = path.join(releaseDir, 'release-asset-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const result = spawnSync(process.execPath, ['scripts/normalize-release-asset-policy.mjs', '--manifest'], {
    cwd: desktopDir,
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status ?? 1,
    error: result.error ? result.error.message : '',
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(2);
  }

  if (options.help) {
    usage();
    return;
  }

  const envPath = path.resolve(desktopDir, options.envFile);
  const envExists = fs.existsSync(envPath);
  const childEnv = {
    ...process.env,
    PATH: pathWithAsdf(),
  };

  const guards = guardChecks(options, envExists);
  const stages = buildStages(options, envExists);
  const stageResults = [];

  console.log('Connect AI production release runbook');
  for (const check of guards) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  writeInitialReport(options, guards);

  for (const item of stages) {
    const result = runStage(item, childEnv);
    stageResults.push(result);
    if (!result.ok && result.required && options.strict && !options.noExit) break;
  }

  const summary = summarize(guards, stageResults);
  console.log(`Summary: ${summary.blockers} blocker(s), ${summary.warnings} warning(s), ${summary.passed} passed, ${summary.skipped} skipped, ${summary.failed} failed`);
  writeReport(options, guards, stageResults, summary);
  const refresh = refreshCiOnlyManifest(childEnv);
  if (refresh) {
    console.log(`${refresh.ok ? 'PASS' : 'WARN'}    refresh-ci-only-manifest - ${refresh.ok ? 'updated volatile diagnostic metadata' : refresh.error || `exit ${refresh.status}`}`);
  }

  const hasMutatingMode = options.applyGithub || options.importSigning || options.build || options.verify || options.publish;
  if (!options.noExit && summary.blockers > 0 && (options.strict || hasMutatingMode)) process.exit(1);
}

main();
