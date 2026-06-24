import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const outPath = path.join(releaseDir, 'security-audit-report.json');
const noExit = process.argv.includes('--no-exit');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function runAudit(scope, args) {
  const result = spawnSync('npm', args, {
    cwd: desktopDir,
    encoding: 'utf8',
    env: process.env,
  });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  let parsed = null;
  let parseError = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      parseError = error.message;
    }
  }

  const vulnerabilities = parsed?.metadata?.vulnerabilities || {};
  const total = Number(vulnerabilities.total || 0);
  const findings = parsed?.vulnerabilities && typeof parsed.vulnerabilities === 'object'
    ? Object.entries(parsed.vulnerabilities).map(([name, finding]) => ({
        name,
        severity: finding.severity || null,
        isDirect: Boolean(finding.isDirect),
        range: finding.range || null,
        nodes: Array.isArray(finding.nodes) ? finding.nodes.slice(0, 20) : [],
        effects: Array.isArray(finding.effects) ? finding.effects.slice(0, 20) : [],
        via: Array.isArray(finding.via)
          ? finding.via.slice(0, 20).map((entry) => {
              if (typeof entry === 'string') return { name: entry };
              return {
                source: entry.source || null,
                name: entry.name || null,
                severity: entry.severity || null,
                title: entry.title || null,
                url: entry.url || null,
              };
            })
          : [],
        fixAvailable: finding.fixAvailable ?? null,
      }))
    : [];

  return {
    scope,
    command: `npm ${args.join(' ')}`,
    ok: Boolean(parsed && !parseError && total === 0 && result.status === 0),
    exitCode: result.status ?? 1,
    auditReportVersion: parsed?.auditReportVersion || null,
    vulnerabilities: {
      info: Number(vulnerabilities.info || 0),
      low: Number(vulnerabilities.low || 0),
      moderate: Number(vulnerabilities.moderate || 0),
      high: Number(vulnerabilities.high || 0),
      critical: Number(vulnerabilities.critical || 0),
      total,
    },
    dependencyCount: parsed?.metadata?.dependencies || null,
    findingCount: findings.length,
    findings,
    error: parseError || (!stdout ? stderr || 'npm audit produced no JSON output' : null),
  };
}

function add(checks, name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
  });
}

function main() {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  const production = runAudit('production', ['audit', '--omit=dev', '--json']);
  const all = runAudit('all', ['audit', '--json']);
  const checks = [];

  add(
    checks,
    'production dependency audit',
    production.ok,
    production.error || `${production.vulnerabilities.total} vulnerability(s)`,
  );
  add(
    checks,
    'full dependency audit',
    all.ok,
    all.error || `${all.vulnerabilities.total} vulnerability(s)`,
  );

  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: {
      name: pkg.build?.productName || pkg.name,
      packageName: pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
    },
    policy: {
      productionDependencyAudit: 'blocker',
      fullDependencyAudit: 'blocker',
      note: 'Release evidence requires zero production and build-toolchain npm audit vulnerabilities.',
    },
    audits: {
      production,
      all,
    },
    checks,
    summary: {
      blockers,
      warnings,
    },
    ok: blockers === 0,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(desktopDir, outPath)}`);
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  if (blockers > 0 && !noExit) process.exit(1);
}

main();
