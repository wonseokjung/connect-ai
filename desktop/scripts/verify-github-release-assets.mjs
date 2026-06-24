import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const verifyDownloads = strict || process.argv.includes('--download') || process.env.CONNECT_AI_VERIFY_RELEASE_DOWNLOADS === '1';
const checks = [];
const remediationActions = [];
let remoteReport = null;

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

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function localOnlyLevel() {
  return strict ? 'blocker' : 'warn';
}

function remoteLevel() {
  return strict ? 'blocker' : 'warn';
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandText(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

function upsertAssetRemediation({ tag, kind, asset, remote, reason, severity = 'required' }) {
  const existing = remediationActions.find((action) => action.kind === kind && action.asset === asset.name);
  if (existing) {
    existing.reasons.push(reason);
    return existing;
  }

  const uploadCommand = commandText('gh', ['release', 'upload', tag, asset.path, '--clobber']);
  const action = {
    id: `${kind}:${asset.name}`,
    kind,
    severity,
    asset: asset.name,
    localPath: asset.path,
    expectedBytes: asset.bytes ?? null,
    remoteBytes: Number.isFinite(remote?.size) ? remote.size : null,
    remoteUrl: remote?.url || remote?.downloadUrl || null,
    reasons: [reason],
    commands: [uploadCommand],
  };
  remediationActions.push(action);
  return action;
}

function addExtraAssetReview({ tag, name, remote }) {
  remediationActions.push({
    id: `review-extra:${name}`,
    kind: 'review-extra-asset',
    severity: 'advisory',
    asset: name,
    localPath: null,
    expectedBytes: null,
    remoteBytes: Number.isFinite(remote?.size) ? remote.size : null,
    remoteUrl: remote?.url || remote?.downloadUrl || null,
    reasons: [
      'Remote asset is not part of the current mac-arm64 release manifest. Keep it only if this tag intentionally carries other platform builds.',
    ],
    commands: [
      commandText('gh', ['release', 'delete-asset', tag, name, '--yes']),
    ],
  });
}

function remediationSummary() {
  const uploadOrReplace = remediationActions.filter((action) => action.kind === 'upload-or-replace-asset').length;
  const extraReview = remediationActions.filter((action) => action.kind === 'review-extra-asset').length;
  return {
    total: remediationActions.length,
    uploadOrReplace,
    extraReview,
    required: remediationActions.filter((action) => action.severity === 'required').length,
    advisory: remediationActions.filter((action) => action.severity === 'advisory').length,
  };
}

function remediationStatus(summary) {
  if (summary.required > 0) return 'remote-drift-detected';
  if (summary.advisory > 0) return 'extra-assets-review';
  return 'clean';
}

function hashFile(filePath, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest('hex');
}

function hashDetail(filePath, algorithm, expected) {
  const actual = hashFile(filePath, algorithm);
  return {
    ok: actual === expected,
    detail: `${actual} expected ${expected}`,
  };
}

function localAsset(relativePath) {
  const filePath = path.join(desktopDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return {
      name: assetName(relativePath),
      path: relativePath,
      bytes: null,
      sha256: null,
      sha512: null,
    };
  }

  return {
    name: assetName(relativePath),
    path: relativePath,
    bytes: fs.statSync(filePath).size,
    sha256: hashFile(filePath, 'sha256'),
    sha512: hashFile(filePath, 'sha512'),
  };
}

function expectedAssets(manifest) {
  return [
    ...(manifest.githubReleaseAssets || []).map((asset) => ({
      name: assetName(asset.path),
      path: asset.path,
      bytes: asset.bytes,
      sha256: asset.sha256,
      sha512: asset.sha512,
    })),
    localAsset(manifest.manifestFile),
  ];
}

function parseRelease(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const remediation = remediationSummary();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    noExit,
    verifyDownloads,
    summary: {
      blockers,
      warnings,
    },
    remote: remoteReport,
    expectedAssets: remoteReport?.expectedAssets || [],
    remoteAssets: remoteReport?.remoteAssets || [],
    remediation: {
      status: remediationStatus(remediation),
      summary: remediation,
      actions: remediationActions,
      verifyCommand: 'npm run verify:github-release-assets:strict',
    },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  const reportPath = path.join(releaseDir, strict ? 'github-release-assets-report.strict.json' : 'github-release-assets-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI GitHub Release asset verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  if (remediation.total > 0) {
    console.log(`Remediation: ${remediation.required} required action(s), ${remediation.advisory} advisory action(s)`);
  }
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function verifyDownloadedAssets(tag, expected, actualByName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-release-assets-'));
  try {
    for (const asset of expected) {
      if (!actualByName.has(asset.name)) continue;

      const download = run(
        'gh',
        ['release', 'download', tag, '--pattern', asset.name, '--dir', tempDir, '--clobber'],
        { timeout: 900000 },
      );
      add(
        `download remote asset ${asset.name}`,
        download.ok,
        download.ok ? asset.name : (download.stderr || download.error || download.stdout),
        remoteLevel(),
      );
      if (!download.ok) continue;

      const filePath = path.join(tempDir, asset.name);
      const exists = fs.existsSync(filePath);
      add(
        `downloaded asset ${asset.name}`,
        exists,
        exists ? `${fs.statSync(filePath).size} bytes` : 'missing',
        remoteLevel(),
      );
      if (!exists) continue;

      if (asset.sha256) {
        const check = hashDetail(filePath, 'sha256', asset.sha256);
        add(
          `downloaded asset ${asset.name} sha256`,
          check.ok,
          check.detail,
          remoteLevel(),
        );
        if (!check.ok) {
          upsertAssetRemediation({
            tag,
            kind: 'upload-or-replace-asset',
            asset,
            remote: actualByName.get(asset.name),
            reason: `Downloaded SHA-256 mismatch: ${check.detail}`,
          });
        }
      }
      if (asset.sha512) {
        const check = hashDetail(filePath, 'sha512', asset.sha512);
        add(
          `downloaded asset ${asset.name} sha512`,
          check.ok,
          check.detail,
          remoteLevel(),
        );
        if (!check.ok) {
          upsertAssetRemediation({
            tag,
            kind: 'upload-or-replace-asset',
            asset,
            remote: actualByName.get(asset.name),
            reason: `Downloaded SHA-512 mismatch: ${check.detail}`,
          });
        }
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  const pkg = readJson('package.json');
  const manifestPath = path.join(releaseDir, 'release-asset-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    add('release asset manifest', false, 'missing release/release-asset-manifest.json');
    printAndExit();
    return;
  }

  const manifest = readJson('release/release-asset-manifest.json');
  const tag = releaseTag(pkg);
  const expected = expectedAssets(manifest);
  add('release tag', /^desktop-v\d+\.\d+\.\d+/.test(tag), tag);
  add('release tag matches package version', tag === expectedReleaseTag(pkg), `${tag} expected ${expectedReleaseTag(pkg)}`, remoteLevel());
  add('asset manifest production status', !strict || manifest.status?.strictDecision?.productionReady === true, manifest.status?.strictDecision?.status || 'missing');
  add('expected release asset set', expected.length >= 20, `${expected.length} assets`);

  const ghVersion = run('gh', ['--version']);
  add('gh command', ghVersion.ok, ghVersion.ok ? ghVersion.stdout.split('\n')[0] : (ghVersion.error || ghVersion.stderr || 'missing'), localOnlyLevel());
  if (!ghVersion.ok) {
    printAndExit();
    return;
  }

  const releaseView = run('gh', ['release', 'view', tag, '--json', 'tagName,isDraft,isPrerelease,url,assets']);
  add('GitHub Release view', releaseView.ok, releaseView.ok ? tag : (releaseView.stderr || releaseView.error || releaseView.stdout), localOnlyLevel());
  if (!releaseView.ok) {
    printAndExit();
    return;
  }

  const release = parseRelease(releaseView.stdout);
  add('GitHub Release JSON', Boolean(release), release ? tag : 'failed to parse gh release view output', remoteLevel());
  if (!release) {
    printAndExit();
    return;
  }

  add('GitHub Release tag', release.tagName === tag, release.tagName || 'missing', remoteLevel());
  add('GitHub Release not draft', release.isDraft === false, String(release.isDraft), remoteLevel());
  add('GitHub Release not prerelease', release.isPrerelease === false, String(release.isPrerelease), remoteLevel());

  const actualAssets = Array.isArray(release.assets) ? release.assets : [];
  const actualByName = new Map(actualAssets.map((asset) => [asset.name, asset]));
  const expectedNames = new Set(expected.map((asset) => asset.name));
  remoteReport = {
    tag,
    url: release.url || null,
    isDraft: release.isDraft,
    isPrerelease: release.isPrerelease,
    expectedAssetCount: expected.length,
    remoteAssetCount: actualAssets.length,
    expectedAssets: expected.map((asset) => ({
      name: asset.name,
      path: asset.path,
      bytes: asset.bytes ?? null,
      sha256: asset.sha256 || null,
      sha512: asset.sha512 || null,
    })),
    remoteAssets: actualAssets.map((asset) => ({
      name: asset.name,
      size: Number.isFinite(asset.size) ? asset.size : null,
      url: asset.url || asset.downloadUrl || null,
    })),
  };
  for (const asset of expected) {
    const remote = actualByName.get(asset.name);
    add(`remote asset ${asset.name}`, Boolean(remote), remote ? (remote.url || remote.downloadUrl || asset.name) : 'missing', remoteLevel());
    if (!remote) {
      upsertAssetRemediation({
        tag,
        kind: 'upload-or-replace-asset',
        asset,
        remote,
        reason: 'Remote asset is missing from the GitHub Release.',
      });
    }
    if (remote && Number.isFinite(asset.bytes) && Number.isFinite(remote.size)) {
      add(`remote asset ${asset.name} size`, remote.size === asset.bytes, `${remote.size} expected ${asset.bytes}`, remoteLevel());
      if (remote.size !== asset.bytes) {
        upsertAssetRemediation({
          tag,
          kind: 'upload-or-replace-asset',
          asset,
          remote,
          reason: `Remote size mismatch: ${remote.size} expected ${asset.bytes}.`,
        });
      }
    }
  }

  const extras = actualAssets.map((asset) => asset.name).filter((name) => !expectedNames.has(name));
  add('remote release extra assets', extras.length === 0, extras.length ? `extra ${extras.join(', ')}` : `${actualAssets.length} assets`, 'warn');
  for (const name of extras) {
    addExtraAssetReview({ tag, name, remote: actualByName.get(name) });
  }

  if (verifyDownloads) {
    verifyDownloadedAssets(tag, expected, actualByName);
  } else {
    add('remote asset digest verification', true, 'skipped; use --download or strict mode');
  }

  printAndExit();
}

main();
