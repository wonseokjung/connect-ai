import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';
import {
  appAsarContentOk,
  approveMainProcessSecurityDeltaFromAsar,
  summarizeAppAsarPolicy,
} from './app-asar-policy.mjs';

const {
  DEFAULT_VERSION,
  DEFAULT_ASAR_SHA256,
  baselineResources,
  resolveBaselineApp,
  sha256,
} = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
    env: options.env || process.env,
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    status: result.status ?? 1,
    error: result.error ? result.error.message : null,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fileInfo(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return { path: relativePath, exists: false };
  const stat = fs.statSync(file);
  return {
    path: relativePath,
    exists: true,
    bytes: stat.size,
    sha256: sha256(file),
    sha512: crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64'),
  };
}

function plist(appPath, key) {
  const result = run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(appPath, 'Contents', 'Info.plist')]);
  return result.ok ? result.stdout : null;
}

function plistFile(file, key) {
  const result = run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file]);
  return result.ok ? result.stdout : null;
}

function auditSummaryFromReport(scope) {
  const reportPath = path.join(releaseDir, 'security-audit-report.json');
  if (!fs.existsSync(reportPath)) return null;
  try {
    const report = readJson(reportPath);
    const audit = report.audits?.[scope];
    if (!audit) return null;
    return {
      ok: Boolean(audit.ok),
      vulnerabilities: audit.vulnerabilities || null,
      dependencyCount: audit.dependencyCount || null,
      findingCount: audit.findingCount ?? null,
      source: 'release/security-audit-report.json',
    };
  } catch {
    return null;
  }
}

function auditSummary() {
  const reportSummary = auditSummaryFromReport('production');
  if (reportSummary) return reportSummary;
  const audit = run('npm', ['audit', '--omit=dev', '--json']);
  if (!audit.stdout) return { ok: audit.ok, error: audit.stderr || audit.stdout };
  try {
    const parsed = JSON.parse(audit.stdout);
    return {
      ok: audit.ok,
      vulnerabilities: parsed.metadata?.vulnerabilities || null,
      source: 'npm audit --omit=dev --json',
    };
  } catch {
    return { ok: audit.ok, error: audit.stderr || audit.stdout };
  }
}

function fullAuditSummary() {
  return auditSummaryFromReport('all');
}

function codeSignatureSummary(codesignVerify, codesignDetails) {
  const detailText = String(codesignDetails.stderr || codesignDetails.stdout || '');
  const teamIdentifier = detailText.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() || null;
  const authorities = [...detailText.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim());
  const adHoc = /Signature=adhoc/.test(detailText) || /flags=.*\badhoc\b/.test(detailText);
  const developerId = Boolean(
    codesignVerify.ok &&
      teamIdentifier &&
      teamIdentifier !== 'not set' &&
      authorities.some((authority) => authority.startsWith('Developer ID Application:')),
  );
  const hardenedRuntime = /flags=.*\bruntime\b/.test(detailText) || /^Runtime Version=/m.test(detailText);
  const sealedResources = /^Sealed Resources\b.*files=\d+/m.test(detailText);

  return {
    ok: Boolean(codesignVerify.ok),
    kind: developerId ? 'developer-id' : adHoc ? 'ad-hoc' : codesignDetails.ok ? 'non-developer-id' : 'missing',
    developerId,
    adHoc,
    teamIdentifier,
    authorities,
    hardenedRuntime,
    sealedResources,
  };
}

function main() {
  const pkg = readJson(path.join(desktopDir, 'package.json'));
  const baseline = resolveBaselineApp();
  const baselineRes = baselineResources(baseline);
  const appPath = path.join(releaseDir, 'mac-arm64', 'Connect AI.app');
  const releaseAsar = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const releaseAsarInfo = fileInfo(path.relative(desktopDir, releaseAsar));
  const appAsarPolicy = fs.existsSync(releaseAsar) && fs.existsSync(baselineRes.asarPath)
    ? summarizeAppAsarPolicy(approveMainProcessSecurityDeltaFromAsar({
        baselineAsarPath: baselineRes.asarPath,
        candidateAsarPath: releaseAsar,
        localMainPath: path.join(desktopDir, 'src', 'main.ts'),
      }))
    : null;
  const electronFrameworkPlist = path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources', 'Info.plist');
  const gitHead = run('git', ['rev-parse', 'HEAD'], { cwd: desktopDir });
  const gitStatus = run('git', ['status', '--short'], { cwd: desktopDir });
  const codesignVerify = fs.existsSync(appPath)
    ? run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
    : { ok: false, stderr: 'release app missing' };
  const codesignDetails = fs.existsSync(appPath)
    ? run('/usr/bin/codesign', ['-dv', '--verbose=2', appPath])
    : { ok: false, stderr: 'release app missing' };
  const gatekeeper = fs.existsSync(appPath)
    ? run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
    : { ok: false, stderr: 'release app missing' };
  const stapler = fs.existsSync(appPath)
    ? run('/usr/bin/xcrun', ['stapler', 'validate', appPath])
    : { ok: false, stderr: 'release app missing' };
  const dmgPath = path.join(releaseDir, `Connect-AI-${pkg.version}-mac-arm64.dmg`);
  const dmgGatekeeper = fs.existsSync(dmgPath)
    ? run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmgPath])
    : { ok: false, stderr: 'release DMG missing' };
  const dmgStapler = fs.existsSync(dmgPath)
    ? run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath])
    : { ok: false, stderr: 'release DMG missing' };

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: {
      name: pkg.build?.productName || pkg.name,
      packageName: pkg.name,
      version: pkg.version,
      expectedVersion: DEFAULT_VERSION,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
    },
    git: {
      head: gitHead.ok ? gitHead.stdout : null,
      dirty: gitStatus.ok ? gitStatus.stdout.length > 0 : null,
      status: gitStatus.ok ? gitStatus.stdout.split('\n').filter(Boolean) : [],
    },
    baseline: {
      source: baseline.source,
      appAsar: {
        path: baselineRes.asarPath,
        expectedSha256: DEFAULT_ASAR_SHA256,
        actualSha256: fs.existsSync(baselineRes.asarPath) ? sha256(baselineRes.asarPath) : null,
      },
    },
    release: {
      app: {
        path: path.relative(desktopDir, appPath),
        exists: fs.existsSync(appPath),
        bundleIdentifier: fs.existsSync(appPath) ? plist(appPath, 'CFBundleIdentifier') : null,
        version: fs.existsSync(appPath) ? plist(appPath, 'CFBundleShortVersionString') : null,
        electronRuntimeVersion: fs.existsSync(electronFrameworkPlist) ? plistFile(electronFrameworkPlist, 'CFBundleVersion') : null,
      },
      artifacts: [
        fileInfo(`release/Connect-AI-${pkg.version}-mac-arm64.dmg`),
        fileInfo(`release/Connect-AI-${pkg.version}-mac-arm64.dmg.blockmap`),
        fileInfo('release/latest-mac.yml'),
        releaseAsarInfo,
      ],
      appAsarPolicy,
      appAsarContentOk: appAsarContentOk({
        expectedSha256: DEFAULT_ASAR_SHA256,
        candidateSha256: releaseAsarInfo.sha256,
        policy: appAsarPolicy,
      }),
    },
    security: {
      securityAuditReport: fileInfo('release/security-audit-report.json'),
      productionAudit: auditSummary(),
      fullAudit: fullAuditSummary(),
      codesignVerify: {
        ok: codesignVerify.ok,
        output: codesignVerify.stderr || codesignVerify.stdout,
      },
      codesignDetails: {
        ok: codesignDetails.ok,
        output: codesignDetails.stderr || codesignDetails.stdout,
      },
      codeSignature: codeSignatureSummary(codesignVerify, codesignDetails),
      gatekeeper: {
        ok: gatekeeper.ok,
        output: gatekeeper.stderr || gatekeeper.stdout,
      },
      stapler: {
        ok: stapler.ok,
        output: stapler.stderr || stapler.stdout,
      },
      dmgGatekeeper: {
        ok: dmgGatekeeper.ok,
        output: dmgGatekeeper.stderr || dmgGatekeeper.stdout,
      },
      dmgStapler: {
        ok: dmgStapler.ok,
        output: dmgStapler.stderr || dmgStapler.stdout,
      },
    },
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  const out = path.join(releaseDir, 'release-manifest.json');
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${path.relative(desktopDir, out)}`);
}

main();
