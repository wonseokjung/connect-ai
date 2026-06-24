import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const dryRun = process.argv.includes('--dry-run');
const noExit = process.argv.includes('--no-exit');
const checks = [];
const actions = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 120000,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(desktopDir, relativePath), 'utf8'));
}

function readJsonIfExists(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function releaseTag(pkg) {
  return argValue('--tag') ||
    process.env.CONNECT_AI_RELEASE_TAG ||
    (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '') ||
    `desktop-v${pkg.version}`;
}

function expectedReleaseTag(pkg) {
  return `desktop-v${pkg.version}`;
}

function assetName(relativePath) {
  return path.basename(relativePath);
}

function manifestFileAsset(manifest) {
  const relativePath = manifest.manifestFile;
  const file = path.join(desktopDir, relativePath);
  return {
    path: relativePath,
    exists: fs.existsSync(file),
    bytes: fs.existsSync(file) ? fs.statSync(file).size : null,
  };
}

function expectedAssets(manifest) {
  return [
    ...(manifest.githubReleaseAssets || []),
    manifestFileAsset(manifest),
  ];
}

function releaseNotesStatus() {
  const file = path.join(releaseDir, 'RELEASE_NOTES.md');
  if (!fs.existsSync(file)) return 'missing';
  const text = fs.readFileSync(file, 'utf8');
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

function githubOperatorStatus(report, requireReport) {
  if (!report) {
    return {
      clean: !requireReport,
      detail: requireReport
        ? 'missing release/operator-readiness.github.json; run npm run release:operator-checklist:github:strict'
        : 'not generated; set CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS=1 to require this gate locally',
    };
  }

  const reportSummary = summary(report);
  const modeOk = report.github === true && report.strict === true;
  const clean = modeOk && reportSummary.blockers === 0 && reportSummary.warnings === 0;
  const failed = failedChecks(report)
    .map((check) => `${check.name}: ${check.detail}`)
    .join('; ');
  return {
    clean,
    detail: clean
      ? 'GitHub repository variables/secrets are readable and complete'
      : `${reportSummary.blockers} blocker(s), ${reportSummary.warnings} warning(s)${modeOk ? '' : `, github=${Boolean(report.github)} strict=${Boolean(report.strict)}`}${failed ? `; ${failed}` : ''}`,
  };
}

function readinessSourceState(report, relativePath) {
  return (report?.sourceReports || []).find((item) => item.path === relativePath) || null;
}

function productionReadinessStatus(report) {
  if (!report) {
    return {
      clean: false,
      detail: 'missing release/production-readiness-summary.json; run npm run release:readiness-summary:strict:report',
    };
  }

  const reportSummary = summary(report);
  const clean = report.productionReady === true && report.localCandidateReady === true;
  return {
    clean,
    detail: clean
      ? `status=${report.status || 'ready'}, ${reportSummary.blockers} blocker(s), ${reportSummary.warnings} warning(s)`
      : `status=${report.status || 'missing'}, productionReady=${Boolean(report.productionReady)}, localCandidateReady=${Boolean(report.localCandidateReady)}, ${reportSummary.blockers} blocker(s), ${reportSummary.warnings} warning(s)`,
  };
}

function publicationSealStatus(report) {
  if (!report) {
    return {
      clean: false,
      detail: 'missing release/release-publication-seal.json; run npm run release:publication-seal:strict:report',
    };
  }

  const reportSummary = summary(report);
  const clean = report.productionReady === true && report.localCandidateReady === true && reportSummary.blockers === 0;
  return {
    clean,
    detail: clean
      ? `status=${report.status || 'ready'}, ${reportSummary.blockers} consistency blocker(s), ${report.gateSummary?.productionBlockers || 0} production blocker(s)`
      : `status=${report.status || 'missing'}, productionReady=${Boolean(report.productionReady)}, localCandidateReady=${Boolean(report.localCandidateReady)}, ${reportSummary.blockers} consistency blocker(s), ${report.gateSummary?.productionBlockers ?? 'unknown'} production blocker(s)`,
  };
}

function baselineFreshnessStatus(report) {
  if (!report) {
    return {
      clean: false,
      detail: 'missing release/baseline-freshness-report.json; run npm run release:baseline-freshness:strict:report',
    };
  }

  const reportSummary = summary(report);
  const clean = report.ok === true && report.status === 'fresh' && reportSummary.blockers === 0;
  return {
    clean,
    detail: clean
      ? `status=${report.status}, ${reportSummary.blockers} blocker(s), ${reportSummary.warnings} warning(s)`
      : `status=${report.status || 'missing'}, ok=${Boolean(report.ok)}, ${reportSummary.blockers} blocker(s), ${reportSummary.warnings} warning(s)`,
  };
}

function baselineExportVerificationStatus(report) {
  if (!report) {
    return {
      clean: false,
      detail: 'missing release/baseline-export-report-verification.strict.json; run npm run verify:baseline-export:strict:report',
    };
  }

  const reportSummary = summary(report);
  const clean = report.strict === true && reportSummary.blockers === 0 && reportSummary.warnings === 0;
  return {
    clean,
    detail: clean
      ? `strict=true, ${reportSummary.blockers} blocker(s), ${reportSummary.warnings} warning(s)`
      : `strict=${Boolean(report.strict)}, ${reportSummary.blockers} blocker(s), ${reportSummary.warnings} warning(s)`,
  };
}

const releaseManifestSecurityFields = [
  'codesignVerify',
  'gatekeeper',
  'stapler',
  'dmgGatekeeper',
  'dmgStapler',
];

function releaseManifestSecurityStatus(report) {
  if (!report) {
    return {
      clean: false,
      detail: 'missing release/release-manifest.json; run npm run release:manifest',
    };
  }
  const failed = [
    report.security?.codeSignature?.developerId === true
      ? null
      : `Developer ID signature: ${report.security?.codeSignature?.kind || 'missing'}${report.security?.codeSignature?.teamIdentifier ? ` team=${report.security.codeSignature.teamIdentifier}` : ''}`,
    ...releaseManifestSecurityFields
    .filter((field) => report.security?.[field]?.ok !== true)
    .map((field) => {
      const output = String(report.security?.[field]?.output || 'not ok')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)[0] || 'not ok';
      return `${field}: ${output}`;
    }),
  ].filter(Boolean);
  return {
    clean: failed.length === 0,
    detail: failed.length ? failed.join('; ') : 'Developer ID codesign, Gatekeeper, stapler, DMG Gatekeeper, and DMG stapler pass',
  };
}

function requireProductionReady(manifest) {
  add(
    'strict release decision production-ready',
    manifest.status?.strictDecision?.productionReady === true,
    manifest.status?.strictDecision?.status || 'missing',
  );
  add(
    'release promotion production-ready',
    manifest.status?.promotion?.productionReady === true,
    manifest.status?.promotion?.status || 'missing',
  );
  const status = releaseNotesStatus();
  add('release notes signed status', status === 'signed-and-notarized', status);
}

function requireCurrentProductionReady(manifest) {
  const strictDecision = readJsonIfExists('release/release-decision.strict.json');
  const promotion = readJsonIfExists('release/release-promotion-plan.json');
  const readiness = readJsonIfExists('release/production-readiness-summary.json');
  const publicationSeal = readJsonIfExists('release/release-publication-seal.json');
  const releaseManifest = readJsonIfExists('release/release-manifest.json');
  const baselineFreshness = readJsonIfExists('release/baseline-freshness-report.json');
  const baselineExportVerification = readJsonIfExists('release/baseline-export-report-verification.strict.json');
  const readinessStatus = productionReadinessStatus(readiness);
  const sealStatus = publicationSealStatus(publicationSeal);
  const manifestSecurityStatus = releaseManifestSecurityStatus(releaseManifest);
  const baselineStatus = baselineFreshnessStatus(baselineFreshness);
  const baselineVerificationStatus = baselineExportVerificationStatus(baselineExportVerification);
  const readinessStrictDecision = readinessSourceState(readiness, 'release/release-decision.strict.json');
  const readinessPromotion = readinessSourceState(readiness, 'release/release-promotion-plan.json');
  const readinessBaselineFreshness = readinessSourceState(readiness, 'release/baseline-freshness-report.json');
  const readinessBaselineExportVerification = readinessSourceState(readiness, 'release/baseline-export-report-verification.strict.json');
  const sealStrictDecision = readinessSourceState(publicationSeal, 'release/release-decision.strict.json');
  const sealPromotion = readinessSourceState(publicationSeal, 'release/release-promotion-plan.json');
  const sealReadiness = readinessSourceState(publicationSeal, 'release/production-readiness-summary.json');
  const sealReleaseManifest = readinessSourceState(publicationSeal, 'release/release-manifest.json');
  const sealBaselineFreshness = readinessSourceState(publicationSeal, 'release/baseline-freshness-report.json');
  const sealBaselineExportVerification = readinessSourceState(publicationSeal, 'release/baseline-export-report-verification.strict.json');
  add(
    'current strict release decision production-ready',
    strictDecision?.productionReady === true,
    strictDecision?.status || 'missing',
  );
  add(
    'current release promotion production-ready',
    promotion?.productionReady === true,
    promotion?.status || 'missing',
  );
  add(
    'manifest strict decision freshness',
    Boolean(strictDecision) &&
      manifest.status?.strictDecision?.status === strictDecision.status &&
      manifest.status?.strictDecision?.productionReady === Boolean(strictDecision.productionReady) &&
      manifest.status?.strictDecision?.localCandidateReady === Boolean(strictDecision.localCandidateReady),
    `manifest=${JSON.stringify(manifest.status?.strictDecision || {})}, current=${strictDecision?.status || 'missing'}`,
  );
  add(
    'manifest promotion freshness',
    Boolean(promotion) &&
      manifest.status?.promotion?.status === promotion.status &&
      manifest.status?.promotion?.productionReady === Boolean(promotion.productionReady) &&
      manifest.status?.promotion?.localCandidateReady === Boolean(promotion.localCandidateReady),
    `manifest=${JSON.stringify(manifest.status?.promotion || {})}, current=${promotion?.status || 'missing'}`,
  );
  add(
    'current production readiness summary production-ready',
    readinessStatus.clean,
    readinessStatus.detail,
  );
  add(
    'current release publication seal production-ready',
    sealStatus.clean,
    sealStatus.detail,
  );
  add(
    'current release manifest signed and notarized',
    manifestSecurityStatus.clean,
    manifestSecurityStatus.detail,
  );
  add(
    'current baseline freshness clean',
    baselineStatus.clean,
    baselineStatus.detail,
  );
  add(
    'current baseline export verification clean',
    baselineVerificationStatus.clean,
    baselineVerificationStatus.detail,
  );
  add(
    'production readiness strict decision freshness',
    Boolean(readiness && strictDecision && readinessStrictDecision) &&
      readinessStrictDecision.status === strictDecision.status &&
      readinessStrictDecision.productionReady === Boolean(strictDecision.productionReady) &&
      readinessStrictDecision.localCandidateReady === Boolean(strictDecision.localCandidateReady),
    `readiness=${JSON.stringify(readinessStrictDecision || {})}, current=${strictDecision?.status || 'missing'}`,
  );
  add(
    'production readiness promotion freshness',
    Boolean(readiness && promotion && readinessPromotion) &&
      readinessPromotion.status === promotion.status &&
      readinessPromotion.productionReady === Boolean(promotion.productionReady) &&
      readinessPromotion.localCandidateReady === Boolean(promotion.localCandidateReady),
    `readiness=${JSON.stringify(readinessPromotion || {})}, current=${promotion?.status || 'missing'}`,
  );
  add(
    'production readiness baseline freshness',
    Boolean(readiness && baselineFreshness && readinessBaselineFreshness) &&
      readinessBaselineFreshness.status === baselineFreshness.status &&
      readinessBaselineFreshness.summary?.blockers === summary(baselineFreshness).blockers &&
      readinessBaselineFreshness.summary?.warnings === summary(baselineFreshness).warnings,
    `readiness=${JSON.stringify(readinessBaselineFreshness || {})}, current=${baselineFreshness?.status || 'missing'}`,
  );
  add(
    'production readiness baseline export verification',
    Boolean(readiness && baselineExportVerification && readinessBaselineExportVerification) &&
      readinessBaselineExportVerification.generatedAt === baselineExportVerification.generatedAt &&
      readinessBaselineExportVerification.strict === true &&
      readinessBaselineExportVerification.summary?.blockers === summary(baselineExportVerification).blockers &&
      readinessBaselineExportVerification.summary?.warnings === summary(baselineExportVerification).warnings,
    `readiness=${JSON.stringify(readinessBaselineExportVerification || {})}, current=${baselineExportVerification?.generatedAt || 'missing'}`,
  );
  add(
    'publication seal strict decision freshness',
    Boolean(publicationSeal && strictDecision && sealStrictDecision) &&
      sealStrictDecision.status === strictDecision.status &&
      sealStrictDecision.productionReady === Boolean(strictDecision.productionReady) &&
      sealStrictDecision.localCandidateReady === Boolean(strictDecision.localCandidateReady),
    `seal=${JSON.stringify(sealStrictDecision || {})}, current=${strictDecision?.status || 'missing'}`,
  );
  add(
    'publication seal promotion freshness',
    Boolean(publicationSeal && promotion && sealPromotion) &&
      sealPromotion.status === promotion.status &&
      sealPromotion.productionReady === Boolean(promotion.productionReady) &&
      sealPromotion.localCandidateReady === Boolean(promotion.localCandidateReady),
    `seal=${JSON.stringify(sealPromotion || {})}, current=${promotion?.status || 'missing'}`,
  );
  add(
    'publication seal readiness freshness',
    Boolean(publicationSeal && readiness && sealReadiness) &&
      sealReadiness.status === readiness.status &&
      sealReadiness.productionReady === Boolean(readiness.productionReady) &&
      sealReadiness.localCandidateReady === Boolean(readiness.localCandidateReady),
    `seal=${JSON.stringify(sealReadiness || {})}, current=${readiness?.status || 'missing'}`,
  );
  add(
    'publication seal release manifest freshness',
    Boolean(publicationSeal && releaseManifest && sealReleaseManifest) &&
      sealReleaseManifest.generatedAt === releaseManifest.generatedAt &&
      sealReleaseManifest.present === true,
    `seal=${JSON.stringify(sealReleaseManifest || {})}, current=${releaseManifest?.generatedAt || 'missing'}`,
  );
  add(
    'publication seal baseline freshness',
    Boolean(publicationSeal && baselineFreshness && sealBaselineFreshness) &&
      sealBaselineFreshness.status === baselineFreshness.status &&
      sealBaselineFreshness.summary?.blockers === summary(baselineFreshness).blockers &&
      sealBaselineFreshness.summary?.warnings === summary(baselineFreshness).warnings,
    `seal=${JSON.stringify(sealBaselineFreshness || {})}, current=${baselineFreshness?.status || 'missing'}`,
  );
  add(
    'publication seal baseline export verification',
    Boolean(publicationSeal && baselineExportVerification && sealBaselineExportVerification) &&
      sealBaselineExportVerification.generatedAt === baselineExportVerification.generatedAt &&
      sealBaselineExportVerification.strict === true &&
      sealBaselineExportVerification.summary?.blockers === summary(baselineExportVerification).blockers &&
      sealBaselineExportVerification.summary?.warnings === summary(baselineExportVerification).warnings,
    `seal=${JSON.stringify(sealBaselineExportVerification || {})}, current=${baselineExportVerification?.generatedAt || 'missing'}`,
  );
}

function validateAssets(assets) {
  const names = new Set();
  for (const asset of assets) {
    const file = path.join(desktopDir, asset.path);
    const name = assetName(asset.path);
    add(`publish asset ${asset.path}`, fs.existsSync(file), fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'missing');
    if (fs.existsSync(file) && Number.isFinite(asset.bytes)) {
      add(`publish asset ${asset.path} bytes`, fs.statSync(file).size === asset.bytes, `${fs.statSync(file).size} expected ${asset.bytes}`);
    }
    if (fs.existsSync(file) && asset.sha256) {
      const actual = sha(file, 'sha256');
      add(`publish asset ${asset.path} sha256`, actual === asset.sha256, `${actual} expected ${asset.sha256}`);
    }
    if (fs.existsSync(file) && asset.sha512) {
      const actual = sha(file, 'sha512');
      add(`publish asset ${asset.path} sha512`, actual === asset.sha512, `${actual} expected ${asset.sha512}`);
    }
    add(`publish asset name ${name}`, !names.has(name), names.has(name) ? 'duplicate basename' : name);
    names.add(name);
  }
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dryRun,
    summary: {
      blockers,
      warnings,
    },
    checks,
    actions,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  const reportPath = path.join(releaseDir, 'github-release-publish-plan.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI GitHub Release publish ${dryRun ? 'plan' : 'run'}`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  for (const action of actions) {
    console.log(`${dryRun ? 'PLAN' : 'DONE'}    ${action}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const pkg = readJson('package.json');
  const manifestPath = path.join(releaseDir, 'release-asset-manifest.json');
  add('release asset manifest', fs.existsSync(manifestPath), 'release/release-asset-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    printAndExit();
    return;
  }

  const manifest = readJson('release/release-asset-manifest.json');
  const tag = releaseTag(pkg);
  const assets = expectedAssets(manifest);
  const requireGitHubOperatorReadiness = process.env.CONNECT_AI_REQUIRE_GITHUB_OPERATOR_READINESS === '1';
  const githubOperator = githubOperatorStatus(
    readJsonIfExists('release/operator-readiness.github.json'),
    requireGitHubOperatorReadiness,
  );
  add('release tag', /^desktop-v\d+\.\d+\.\d+/.test(tag), tag);
  add('release tag matches package version', tag === expectedReleaseTag(pkg), `${tag} expected ${expectedReleaseTag(pkg)}`);
  add('manifest product version', manifest.product?.version === pkg.version, `${manifest.product?.version || 'missing'} expected ${pkg.version}`);
  add('manifest-driven publish asset set', assets.length >= 20, `${assets.length} assets`);
  requireProductionReady(manifest);
  requireCurrentProductionReady(manifest);
  add('GitHub operator readiness report clean', githubOperator.clean, githubOperator.detail);
  validateAssets(assets);

  const blockersBeforePublish = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  if (blockersBeforePublish > 0) {
    actions.push('publish skipped because release gates are not satisfied');
    printAndExit();
    return;
  }

  const notesFile = path.join('release', 'RELEASE_NOTES.md');
  if (dryRun) {
    actions.push(`would create or edit GitHub Release ${tag}`);
    actions.push(`would upload ${assets.length} manifest-listed assets with --clobber`);
    printAndExit();
    return;
  }

  const ghVersion = run('gh', ['--version']);
  add('gh command', ghVersion.ok, ghVersion.ok ? ghVersion.stdout.split('\n')[0] : (ghVersion.error || ghVersion.stderr || 'missing'));
  if (!ghVersion.ok) {
    printAndExit();
    return;
  }

  const releaseView = run('gh', ['release', 'view', tag], { timeout: 120000 });
  if (releaseView.ok) {
    const edit = run('gh', ['release', 'edit', tag, '--notes-file', notesFile], { timeout: 120000 });
    add('GitHub Release notes update', edit.ok, edit.ok ? tag : (edit.stderr || edit.error || edit.stdout));
    actions.push(`updated GitHub Release ${tag}`);
  } else {
    const create = run('gh', ['release', 'create', tag, '--title', `Connect AI ${tag.replace(/^desktop-v/, '')}`, '--notes-file', notesFile], { timeout: 120000 });
    add('GitHub Release create', create.ok, create.ok ? tag : (create.stderr || create.error || create.stdout));
    if (create.ok) actions.push(`created GitHub Release ${tag}`);
  }

  const blockersAfterRelease = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  if (blockersAfterRelease > 0) {
    printAndExit();
    return;
  }

  const uploadArgs = ['release', 'upload', tag, ...assets.map((asset) => asset.path), '--clobber'];
  const upload = run('gh', uploadArgs, { timeout: 900000 });
  add('GitHub Release asset upload', upload.ok, upload.ok ? `${assets.length} assets` : (upload.stderr || upload.error || upload.stdout));
  if (upload.ok) actions.push(`uploaded ${assets.length} assets to ${tag}`);
  printAndExit();
}

main();
