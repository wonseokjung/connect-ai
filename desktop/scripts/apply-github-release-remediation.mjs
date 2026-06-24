import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const reportPath = path.join(releaseDir, 'github-release-remediation-apply-plan.json');
const apply = process.argv.includes('--apply');
const confirm = process.argv.includes('--confirm-remote-remediation');
const noExit = process.argv.includes('--no-exit');
const checks = [];
const actions = [];
let reportContext = {};

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

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

function parseJson(text) {
  try {
    return JSON.parse(String(text || '{}'));
  } catch {
    return null;
  }
}

function publishTarget(pkg) {
  const githubPublish = (pkg?.build?.publish || []).find((item) => item?.provider === 'github') || {};
  return {
    owner: githubPublish.owner || process.env.GITHUB_REPOSITORY_OWNER || '',
    repo: githubPublish.repo || (process.env.GITHUB_REPOSITORY || '').split('/')[1] || '',
  };
}

function githubPermissionDiagnostics(pkg, tag) {
  const target = publishTarget(pkg);
  const repoSlug = target.owner && target.repo ? `${target.owner}/${target.repo}` : '';
  const diagnostics = {
    repo: repoSlug || null,
    viewerPermission: null,
    canReadRelease: false,
    canUploadReleaseAssets: false,
    releaseTag: tag,
    releaseExists: false,
    ghAvailable: false,
    errors: [],
  };
  const ghVersion = run('gh', ['--version'], { timeout: 30000 });
  diagnostics.ghAvailable = ghVersion.ok;
  if (!ghVersion.ok) {
    diagnostics.errors.push(ghVersion.error || ghVersion.stderr || 'gh command unavailable');
    return diagnostics;
  }
  if (!repoSlug) {
    diagnostics.errors.push('missing GitHub owner/repo publish target');
    return diagnostics;
  }

  const repoView = run('gh', ['repo', 'view', repoSlug, '--json', 'nameWithOwner,viewerPermission,url'], { timeout: 60000 });
  if (!repoView.ok) {
    diagnostics.errors.push(repoView.stderr || repoView.error || 'failed to read repository permission');
  } else {
    const repo = parseJson(repoView.stdout);
    diagnostics.repo = repo?.nameWithOwner || repoSlug;
    diagnostics.viewerPermission = repo?.viewerPermission || null;
    diagnostics.canUploadReleaseAssets = ['ADMIN', 'MAINTAIN', 'WRITE'].includes(String(repo?.viewerPermission || '').toUpperCase());
  }

  const releaseView = run('gh', ['release', 'view', tag, '--repo', repoSlug, '--json', 'tagName,isDraft,isPrerelease'], { timeout: 60000 });
  diagnostics.canReadRelease = releaseView.ok;
  if (!releaseView.ok) {
    diagnostics.errors.push(releaseView.stderr || releaseView.error || 'failed to read release');
  } else {
    const release = parseJson(releaseView.stdout);
    diagnostics.releaseExists = release?.tagName === tag;
  }

  return diagnostics;
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

function releaseTag(pkg, plan) {
  return argValue('--tag') ||
    process.env.CONNECT_AI_RELEASE_TAG ||
    plan?.release?.tag ||
    `desktop-v${pkg?.version || 'unknown'}`;
}

function expectedReleaseTag(pkg) {
  return `desktop-v${pkg?.version || 'unknown'}`;
}

function summary(report) {
  return {
    blockers: Number(report?.summary?.blockers || 0),
    warnings: Number(report?.summary?.warnings || 0),
  };
}

function manifestAssetMap(manifest) {
  const entries = [
    ...(manifest?.githubReleaseAssets || []),
    manifest?.manifestFile ? {
      path: manifest.manifestFile,
      bytes: fs.existsSync(path.join(desktopDir, manifest.manifestFile))
        ? fs.statSync(path.join(desktopDir, manifest.manifestFile)).size
        : null,
      sha256: fs.existsSync(path.join(desktopDir, manifest.manifestFile))
        ? sha(path.join(desktopDir, manifest.manifestFile), 'sha256')
        : null,
      sha512: fs.existsSync(path.join(desktopDir, manifest.manifestFile))
        ? sha(path.join(desktopDir, manifest.manifestFile), 'sha512')
        : null,
    } : null,
  ].filter(Boolean);
  return new Map(entries.map((asset) => [path.basename(asset.path), asset]));
}

function productionGateDetail(readiness, seal, baselineFreshness) {
  const readinessSummary = summary(readiness);
  const sealSummary = summary(seal);
  const baselineSummary = summary(baselineFreshness);
  return [
    `readiness=${readiness?.status || 'missing'} productionReady=${Boolean(readiness?.productionReady)} ${readinessSummary.blockers} blocker(s), ${readinessSummary.warnings} warning(s)`,
    `seal=${seal?.status || 'missing'} productionReady=${Boolean(seal?.productionReady)} ${sealSummary.blockers} blocker(s), ${sealSummary.warnings} warning(s)`,
    `baseline=${baselineFreshness?.status || 'missing'} ok=${Boolean(baselineFreshness?.ok)} ${baselineSummary.blockers} blocker(s), ${baselineSummary.warnings} warning(s)`,
  ].join('; ');
}

function sourceSummary(label, relativePath) {
  const report = readJson(relativePath);
  const value = summary(report);
  return {
    label,
    path: relativePath,
    present: Boolean(report),
    parseError: report?.parseError || null,
    generatedAt: report?.generatedAt || null,
    status: report?.status || null,
    strict: report?.strict ?? null,
    productionReady: report?.productionReady ?? null,
    localCandidateReady: report?.localCandidateReady ?? null,
    publishedReleaseReady: report?.publishedReleaseReady ?? null,
    commercialReady: report?.commercialReady ?? null,
    summary: report ? value : null,
  };
}

function uploadCommand(tag, localPath) {
  return ['release', 'upload', tag, localPath, '--clobber'];
}

function reportStatus(blockers) {
  if (blockers > 0) return apply ? 'apply-blocked' : 'plan-invalid';
  if (!apply) return 'dry-run-ready';
  return 'applied';
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    apply,
    confirm,
    status: reportStatus(blockers),
    summary: {
      blockers,
      warnings,
      actions: actions.length,
    },
    ...reportContext,
    checks,
    actions,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI GitHub Release remediation ${apply ? 'apply' : 'dry-run'} plan`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  for (const action of actions) {
    console.log(`${apply ? 'DONE' : 'PLAN'}    ${action.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s), ${actions.length} action(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const pkg = readJson('package.json');
  const manifest = readJson('release/release-asset-manifest.json');
  const plan = readJson('release/github-release-remediation-plan.json');
  const planVerification = readJson('release/github-release-remediation-plan-report.strict.json');
  const readiness = readJson('release/production-readiness-summary.json');
  const seal = readJson('release/release-publication-seal.json');
  const baselineFreshness = readJson('release/baseline-freshness-report.json');
  const tag = releaseTag(pkg, plan);
  const github = githubPermissionDiagnostics(pkg, tag);
  const productionGate = {
    ready: false,
    detail: productionGateDetail(readiness, seal, baselineFreshness),
    readiness: {
      status: readiness?.status || null,
      productionReady: readiness?.productionReady ?? null,
      summary: summary(readiness),
    },
    publicationSeal: {
      status: seal?.status || null,
      productionReady: seal?.productionReady ?? null,
      summary: summary(seal),
    },
    baselineFreshness: {
      status: baselineFreshness?.status || null,
      ok: baselineFreshness?.ok ?? null,
      summary: summary(baselineFreshness),
    },
  };
  reportContext = {
    product: {
      name: pkg?.build?.productName || pkg?.name || 'Connect AI',
      version: pkg?.version || null,
      appId: pkg?.build?.appId || null,
    },
    release: {
      tag,
      expectedTag: expectedReleaseTag(pkg),
    },
    github,
    sourceReports: [
      sourceSummary('release asset manifest', 'release/release-asset-manifest.json'),
      sourceSummary('GitHub Release remediation plan', 'release/github-release-remediation-plan.json'),
      sourceSummary('GitHub Release remediation plan verification', 'release/github-release-remediation-plan-report.strict.json'),
      sourceSummary('production readiness summary', 'release/production-readiness-summary.json'),
      sourceSummary('publication seal', 'release/release-publication-seal.json'),
      sourceSummary('baseline freshness', 'release/baseline-freshness-report.json'),
      sourceSummary('baseline export verification', 'release/baseline-export-report-verification.strict.json'),
      plan?.sourceReport ? sourceSummary('selected remote asset report', plan.sourceReport) : null,
    ].filter(Boolean),
    productionGate,
    safetyRules: [
      'Dry-run mode must never upload or delete remote assets.',
      'Apply mode requires --confirm-remote-remediation.',
      'Apply mode requires production readiness, publication seal, and baseline freshness to be clean.',
      'Apply mode requires a GitHub token with write/maintain/admin repository permission for release asset uploads.',
      'Dry-run mode records GitHub release upload permission diagnostics but does not require upload permission.',
      'Every upload action must resolve to release/release-asset-manifest.json and match local bytes, SHA-256, and SHA-512.',
      'The same-name remote baseline ZIP must not be used as CONNECT_AI_BASELINE_URL unless it matches the exported baseline ZIP SHA-256.',
      'This report must list commands and key names only, never secret values.',
    ],
  };

  add('release asset manifest exists', Boolean(manifest && !manifest.parseError), manifest?.parseError || 'release/release-asset-manifest.json');
  add('GitHub Release remediation plan exists', Boolean(plan && !plan.parseError), plan?.parseError || 'release/github-release-remediation-plan.json');
  add('GitHub Release remediation plan verification clean', planVerification?.summary?.blockers === 0 && planVerification?.summary?.warnings === 0, JSON.stringify(planVerification?.summary || {}));
  if (!manifest || manifest.parseError || !plan || plan.parseError) {
    printAndExit();
    return;
  }

  const manifestAssets = manifestAssetMap(manifest);
  const requiredActions = Array.isArray(plan.requiredActions) ? plan.requiredActions : [];
  const productionReady = readiness?.productionReady === true &&
    seal?.productionReady === true &&
    baselineFreshness?.ok === true &&
    summary(readiness).blockers === 0 &&
    summary(seal).blockers === 0 &&
    summary(baselineFreshness).blockers === 0;
  reportContext.productionGate.ready = productionReady;

  add('release tag shape', /^desktop-v\d+\.\d+\.\d+$/.test(tag), tag);
  add('release tag matches package version', tag === expectedReleaseTag(pkg), `${tag} expected ${expectedReleaseTag(pkg)}`);
  add('remediation plan release tag matches', plan.release?.tag === tag, `${plan.release?.tag || 'missing'} expected ${tag}`);
  add(
    'GitHub Release upload permission diagnostics captured',
    typeof github.canUploadReleaseAssets === 'boolean' &&
      typeof github.canReadRelease === 'boolean' &&
      Boolean(github.repo),
    `repo=${github.repo || 'missing'}, permission=${github.viewerPermission || 'missing'}, canUpload=${github.canUploadReleaseAssets}, canReadRelease=${github.canReadRelease}`,
  );
  add('remediation required action count', plan.summary?.requiredActions === requiredActions.length, `${plan.summary?.requiredActions} expected ${requiredActions.length}`);
  add('remediation actions manifest-covered', requiredActions.every((action) => action.expectedManifestPath && manifestAssets.has(action.asset)), `${requiredActions.length} action(s)`);
  const baselineGuard = plan.baselineUrlGuard || {};
  const guardMirror = baselineGuard.localBaselineMirror || {};
  const guardRemote = baselineGuard.remoteBaselineCandidate || {};
  const approvedUploadSource = guardMirror.approvedUploadSource || '';
  const approvedUploadFile = approvedUploadSource ? path.join(desktopDir, approvedUploadSource) : null;
  const approvedUploadSourceVerified = Boolean(
    approvedUploadFile &&
      fs.existsSync(approvedUploadFile) &&
      fs.statSync(approvedUploadFile).size === Number(guardMirror.expectedBaselineBytes || 0) &&
      sha(approvedUploadFile, 'sha256') === guardMirror.expectedBaselineSha256
  );
  const localMirrorOrApprovedSourceVerified =
    (guardMirror.status === 'verified-match' && guardMirror.matchesExport === true) ||
    approvedUploadSourceVerified;
  add('remediation baseline URL guard present', Boolean(plan.baselineUrlGuard), baselineGuard.status || 'missing');
  add(
    'remediation approved baseline upload source verified',
    baselineGuard.status === 'approved-source-verified-remote-baseline-rejected' &&
      localMirrorOrApprovedSourceVerified &&
      guardMirror.approvedUploadSource === 'release/Connect-AI-0.4.8-baseline-arm64-mac.zip',
    `status=${baselineGuard.status || 'missing'}, source=${guardMirror.approvedUploadSource || 'missing'}, sourceVerified=${approvedUploadSourceVerified}`,
  );
  add(
    'remediation remote same-name baseline URL rejected',
    guardRemote.status === 'not-approved-baseline-url' &&
      guardRemote.remoteBytes !== guardRemote.expectedBaselineBytes &&
      /^[a-f0-9]{64}$/i.test(String(guardRemote.expectedBaselineSha256 || '')),
    `remote=${guardRemote.remoteBytes ?? 'missing'}, expected=${guardRemote.expectedBaselineBytes ?? 'missing'}, status=${guardRemote.status || 'missing'}`,
  );

  for (const action of requiredActions) {
    const manifestAsset = manifestAssets.get(action.asset);
    const localPath = action.localPath || action.expectedManifestPath || manifestAsset?.path;
    const file = localPath ? path.join(desktopDir, localPath) : null;
    add(`remediation action local path ${action.asset}`, Boolean(localPath && manifestAsset?.path === localPath), localPath || 'missing');
    add(`remediation action file exists ${action.asset}`, Boolean(file && fs.existsSync(file)), file || 'missing');
    if (file && fs.existsSync(file) && manifestAsset) {
      add(`remediation action bytes ${action.asset}`, fs.statSync(file).size === manifestAsset.bytes, `${fs.statSync(file).size} expected ${manifestAsset.bytes}`);
      add(`remediation action sha256 ${action.asset}`, sha(file, 'sha256') === manifestAsset.sha256, `${sha(file, 'sha256')} expected ${manifestAsset.sha256}`);
      add(`remediation action sha512 ${action.asset}`, sha(file, 'sha512') === manifestAsset.sha512, `${sha(file, 'sha512')} expected ${manifestAsset.sha512}`);
    }
    actions.push({
      asset: action.asset,
      localPath,
      expectedBytes: manifestAsset?.bytes ?? action.expectedBytes ?? null,
      reasons: action.reasons || [],
      command: ['gh', ...uploadCommand(tag, localPath || '<missing>')].join(' '),
      detail: `${apply ? 'upload' : 'would upload'} ${action.asset} from ${localPath || 'missing'} to ${tag}`,
    });
  }

  if (!apply) {
    add('remediation apply confirmation not required in dry-run', true, '--apply not set');
    add('production gate observed for dry-run', true, productionGateDetail(readiness, seal, baselineFreshness));
    printAndExit();
    return;
  }

  add('remediation apply confirmation', confirm, '--confirm-remote-remediation');
  add('production gate clean before remediation apply', productionReady, productionGateDetail(readiness, seal, baselineFreshness));
  add(
    'GitHub Release upload permission before remediation apply',
    github.ghAvailable === true &&
      github.canReadRelease === true &&
      github.releaseExists === true &&
      github.canUploadReleaseAssets === true,
    `repo=${github.repo || 'missing'}, permission=${github.viewerPermission || 'missing'}, releaseExists=${github.releaseExists}, canUpload=${github.canUploadReleaseAssets}${github.errors.length ? `, errors=${github.errors.join('; ')}` : ''}`,
  );
  const applyBlockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  if (applyBlockers > 0) {
    printAndExit();
    return;
  }

  const ghVersion = run('gh', ['--version']);
  add('gh command', ghVersion.ok, ghVersion.ok ? ghVersion.stdout.split('\n')[0] : (ghVersion.error || ghVersion.stderr || 'missing'));
  if (!ghVersion.ok) {
    printAndExit();
    return;
  }

  for (const action of actions) {
    const upload = run('gh', uploadCommand(tag, action.localPath), { timeout: 900000 });
    add(`GitHub Release remediation upload ${action.asset}`, upload.ok, upload.ok ? action.localPath : (upload.stderr || upload.error || upload.stdout));
    action.result = {
      ok: upload.ok,
      status: upload.status,
      stdout: upload.stdout,
      stderr: upload.stderr,
      error: upload.error,
    };
    if (!upload.ok) break;
  }

  printAndExit();
}

main();
