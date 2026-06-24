import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const reportPath = path.join(releaseDir, 'temp-cleanup-report.json');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noExit = args.includes('--no-exit');
const prefix = 'connect-ai-';
const protectedNames = new Set([
  'connect-ai-build-certificate.p12',
  'connect-ai-signing.keychain-db',
]);

function numericArg(name, fallback) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  const value = inline ? inline.slice(name.length + 1) : process.env.CONNECT_AI_TEMP_CLEANUP_MIN_AGE_MINUTES;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const minAgeMinutes = numericArg('--min-age-minutes', 30);
const minAgeMs = minAgeMinutes * 60 * 1000;
const maxDurationSeconds = numericArg('--max-seconds', 45);
const maxDurationMs = maxDurationSeconds * 1000;
const now = Date.now();
const checks = [];

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function uniqueRoots() {
  return [...new Set([
    os.tmpdir(),
    '/tmp',
  ].filter(Boolean).map((root) => path.resolve(root)))].filter((root) => {
    try {
      return fs.existsSync(root) && fs.statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
}

function safeCandidate(root, entryName) {
  if (!entryName.startsWith(prefix)) return null;
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, entryName);
  if (path.dirname(target) !== resolvedRoot) return null;
  return target;
}

function scanCandidates() {
  const roots = uniqueRoots();
  const seen = new Set();
  const candidates = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const target = safeCandidate(root, entry.name);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      let stat = null;
      try {
        stat = fs.lstatSync(target);
      } catch {
        continue;
      }
      const ageMs = Math.max(0, now - stat.mtimeMs);
      candidates.push({
        path: target,
        name: entry.name,
        kind: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other',
        ageMinutes: Math.round((ageMs / 60000) * 10) / 10,
        protected: protectedNames.has(entry.name),
        stale: ageMs >= minAgeMs && !protectedNames.has(entry.name),
      });
    }
  }
  return { roots, candidates };
}

function removeCandidateWithNode(candidate) {
  try {
    fs.rmSync(candidate.path, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    return { ok: true, dryRun: false };
  } catch (error) {
    return { ok: false, dryRun: false, error: error.message };
  }
}

function removeStaleCandidates(stale) {
  if (dryRun) {
    return {
      removed: stale.map((candidate) => ({ ...candidate, dryRun: true })),
      failed: [],
      processed: stale.length,
      budgetExhausted: false,
    };
  }

  const removed = [];
  const failed = [];
  const rmPath = '/bin/rm';
  const batchSize = 10;
  const started = Date.now();
  const deadline = started + maxDurationMs;
  let processed = 0;
  let budgetExhausted = false;

  if (process.platform !== 'win32' && fs.existsSync(rmPath)) {
    for (let index = 0; index < stale.length; index += batchSize) {
      const remainingBudget = deadline - Date.now();
      if (remainingBudget <= 0) {
        budgetExhausted = true;
        break;
      }
      const batch = stale.slice(index, index + batchSize);
      const result = spawnSync(rmPath, ['-rf', ...batch.map((candidate) => candidate.path)], {
        encoding: 'utf8',
        timeout: Math.max(1000, Math.min(30000, remainingBudget)),
      });
      const timedOut = result.error?.code === 'ETIMEDOUT' || result.error?.message?.includes('ETIMEDOUT');
      if (timedOut) budgetExhausted = true;
      const batchError = timedOut
        ? null
        : result.error?.message || result.stderr?.trim() || (result.status ? `rm exited ${result.status}` : null);
      for (const candidate of batch) {
        processed += 1;
        if (fs.existsSync(candidate.path)) {
          if (timedOut) {
            continue;
          }
          failed.push({ ...candidate, error: batchError || 'path still exists after rm -rf' });
        } else {
          removed.push({ ...candidate, dryRun: false });
        }
      }
      if (timedOut) break;
    }
    if (processed < stale.length) budgetExhausted = true;
    return { removed, failed, processed, budgetExhausted };
  }

  for (const candidate of stale) {
    if (Date.now() >= deadline) {
      budgetExhausted = true;
      break;
    }
    const result = removeCandidateWithNode(candidate);
    processed += 1;
    if (result.ok) {
      removed.push({ ...candidate, dryRun: false });
    } else {
      failed.push({ ...candidate, error: result.error });
    }
  }
  if (processed < stale.length) budgetExhausted = true;
  return { removed, failed, processed, budgetExhausted };
}

function main() {
  const before = scanCandidates();
  const stale = before.candidates.filter((candidate) => candidate.stale);
  const recent = before.candidates.filter((candidate) => !candidate.stale);
  const protectedSkipped = before.candidates.filter((candidate) => candidate.protected);
  const { removed, failed, processed, budgetExhausted } = removeStaleCandidates(stale);

  const after = scanCandidates();
  const remainingStale = after.candidates.filter((candidate) => candidate.stale);

  add('temp cleanup roots available', before.roots.length > 0, before.roots.join(', ') || 'missing temp roots');
  add('temp cleanup candidate safety', before.candidates.every((candidate) => path.basename(candidate.path).startsWith(prefix)), `${before.candidates.length} candidate(s)`);
  add('temp cleanup stale removals', failed.length === 0, `${removed.length} removed, ${failed.length} failed`, failed.length ? 'warn' : 'blocker');
  add('temp cleanup time budget', true, `${processed} of ${stale.length} stale candidate(s) processed within ${maxDurationSeconds}s; budgetExhausted=${budgetExhausted}`);
  add('temp cleanup remaining stale candidates', remainingStale.length === 0 || dryRun || budgetExhausted, `${remainingStale.length} stale candidate(s) remain`, dryRun ? 'warn' : 'blocker');

  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dryRun,
    minAgeMinutes,
    maxDurationSeconds,
    roots: before.roots,
    summary: {
      blockers,
      warnings,
      candidatesBefore: before.candidates.length,
      staleBefore: stale.length,
      recentBefore: recent.length,
      protectedSkipped: protectedSkipped.length,
      processedStale: processed,
      budgetExhausted,
      removed: removed.length,
      failed: failed.length,
      candidatesAfter: after.candidates.length,
      staleAfter: remainingStale.length,
    },
    removed: removed.slice(0, 200),
    failed,
    remainingStale: remainingStale.slice(0, 200),
    protectedSkipped,
    recentSkipped: recent.slice(0, 50),
    checks,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI temp cleanup${dryRun ? ' dry run' : ''}`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s), ${removed.length} removed, ${remainingStale.length} stale remaining`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

main();
