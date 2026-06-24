import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import baselineTools from './baseline-app.cjs';
import {
  appAsarContentOk,
  approveMainProcessSecurityDeltaFromAsar,
  summarizeAppAsarPolicy,
} from './app-asar-policy.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const {
  DEFAULT_ASAR_SHA256,
  DEFAULT_APP_PATH,
  DEFAULT_VERSION,
  baselineResources,
  cleanupBaselineApp,
  resolveBaselineApp,
  sha256,
} = baselineTools;

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const outputPath = path.join(releaseDir, 'installed-bundle-delta-report.json');
const installedAppPath = process.env.CONNECT_AI_INSTALLED_APP || process.env.CONNECT_AI_APP || DEFAULT_APP_PATH;
const candidateAppPath = process.env.CONNECT_AI_RELEASE_APP || path.join(releaseDir, 'mac-arm64', 'Connect AI.app');
const checks = [];

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function run(command, args, options = {}) {
  if (options.darwinOnly && process.platform !== 'darwin') {
    return { ok: false, status: null, stdout: '', stderr: 'requires macOS', skipped: true };
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopDir,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : null,
  };
}

function fileInfo(file) {
  if (!fs.existsSync(file)) return { path: file, exists: false };
  const stat = fs.statSync(file);
  return {
    path: file,
    exists: true,
    bytes: stat.size,
    sha256: sha256(file),
    sha512: crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64'),
  };
}

function plistValue(file, key) {
  const result = run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file], { darwinOnly: true });
  return result.ok ? result.stdout : null;
}

function appPlistValue(appPath, key) {
  return plistValue(path.join(appPath, 'Contents', 'Info.plist'), key);
}

function readInfoPlist(appPath) {
  const file = path.join(appPath, 'Contents', 'Info.plist');
  if (!fs.existsSync(file)) return null;
  const result = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { darwinOnly: true });
  if (!result.ok) {
    return { parseError: result.stderr || result.stdout || result.error || 'unable to parse Info.plist' };
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return { parseError: error.message };
  }
}

function electronRuntimeVersion(appPath) {
  const plist = path.join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
    'Info.plist',
  );
  return fs.existsSync(plist) ? plistValue(plist, 'CFBundleVersion') : null;
}

function asarPackageMetadata(asarPath) {
  if (!fs.existsSync(asarPath)) return null;
  try {
    const pkg = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
    return {
      name: pkg.name || null,
      version: pkg.version || null,
      description: pkg.description || null,
      main: pkg.main || null,
      author: pkg.author || null,
      license: pkg.license || null,
      repository: pkg.repository || null,
      dependencies: pkg.dependencies || null,
      devDependencies: pkg.devDependencies || null,
    };
  } catch (error) {
    return { parseError: error.message };
  }
}

function asarList(asarPath) {
  if (!fs.existsSync(asarPath)) return [];
  const bin = path.join(desktopDir, 'node_modules', '.bin', process.platform === 'win32' ? 'asar.cmd' : 'asar');
  try {
    const stdout = execFileSync(bin, ['list', asarPath], {
      cwd: desktopDir,
      encoding: 'utf8',
      maxBuffer: 24 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function asarGroup(relativePath) {
  const parts = relativePath.replace(/^\//, '').split('/');
  if (parts[0] !== 'node_modules') return parts[0] || '.';
  if (parts[1]?.startsWith('@')) return `node_modules/${parts[1]}/${parts[2] || ''}`;
  return `node_modules/${parts[1] || ''}`;
}

function asarEntryDelta(referenceAsar, candidateAsar) {
  const referenceList = asarList(referenceAsar);
  const candidateList = asarList(candidateAsar);
  const referenceSet = new Set(referenceList);
  const candidateSet = new Set(candidateList);
  const onlyReferenceGroups = new Map();
  const onlyCandidateGroups = new Map();
  let onlyReference = 0;
  let onlyCandidate = 0;

  for (const entry of referenceSet) {
    if (candidateSet.has(entry)) continue;
    onlyReference += 1;
    const group = asarGroup(entry);
    onlyReferenceGroups.set(group, (onlyReferenceGroups.get(group) || 0) + 1);
  }
  for (const entry of candidateSet) {
    if (referenceSet.has(entry)) continue;
    onlyCandidate += 1;
    const group = asarGroup(entry);
    onlyCandidateGroups.set(group, (onlyCandidateGroups.get(group) || 0) + 1);
  }

  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return {
    referenceEntries: referenceList.length,
    candidateEntries: candidateList.length,
    onlyReference,
    onlyCandidate,
    onlyReferenceTopGroups: top(onlyReferenceGroups),
    onlyCandidateTopGroups: top(onlyCandidateGroups),
  };
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function atsHardenedFromReference(referenceAts = {}, candidateAts = {}) {
  const domains = candidateAts.NSExceptionDomains || {};
  const domainNames = Object.keys(domains).sort();
  const localDomains = ['127.0.0.1', 'localhost'];
  const localOnly = domainNames.length === localDomains.length && localDomains.every((domain) => domainNames.includes(domain));
  const localHttpOnly = localDomains.every((domain) => {
    const item = domains[domain] || {};
    return item.NSTemporaryExceptionAllowsInsecureHTTPLoads === true && item.NSIncludesSubdomains === false;
  });
  return Boolean(
    referenceAts.NSAllowsArbitraryLoads === true &&
      candidateAts.NSAllowsArbitraryLoads === false &&
      candidateAts.NSAllowsLocalNetworking === true &&
      localOnly &&
      localHttpOnly
  );
}

function approveMacosMetadataDelta(referenceInfo, candidateInfo, appAsarPolicyOk) {
  if (!referenceInfo || !candidateInfo || referenceInfo.parseError || candidateInfo.parseError) {
    return {
      exactMatch: false,
      approvedByPolicy: false,
      reason: referenceInfo?.parseError || candidateInfo?.parseError || 'missing Info.plist metadata',
      topLevelDeltas: [],
      approvedDeltas: [],
      unexpectedDeltas: ['Info.plist metadata unavailable'],
    };
  }

  const keys = [...new Set([...Object.keys(referenceInfo), ...Object.keys(candidateInfo)])].sort();
  const topLevelDeltas = keys
    .filter((key) => stableJson(referenceInfo[key]) !== stableJson(candidateInfo[key]))
    .map((key) => ({
      key,
      reference: referenceInfo[key] ?? null,
      candidate: candidateInfo[key] ?? null,
    }));
  const approvedDeltas = [];
  const unexpectedDeltas = [];

  for (const delta of topLevelDeltas) {
    if (['DTSDKBuild', 'DTSDKName', 'DTXcode', 'DTXcodeBuild'].includes(delta.key)) {
      approvedDeltas.push({
        key: delta.key,
        id: 'build-toolchain-metadata',
        reason: 'Xcode/SDK build metadata is expected to differ between installed baseline and current local build host',
      });
      continue;
    }
    if (delta.key === 'ElectronAsarIntegrity') {
      const referenceEntry = referenceInfo.ElectronAsarIntegrity?.['Resources/app.asar'] || {};
      const candidateEntry = candidateInfo.ElectronAsarIntegrity?.['Resources/app.asar'] || {};
      if (
        appAsarPolicyOk &&
        referenceEntry.algorithm === 'SHA256' &&
        candidateEntry.algorithm === 'SHA256' &&
        referenceEntry.hash &&
        candidateEntry.hash
      ) {
        approvedDeltas.push({
          key: delta.key,
          id: 'app-asar-integrity-hash',
          reason: 'app.asar integrity hash follows the approved app.asar content policy delta',
        });
        continue;
      }
    }
    if (delta.key === 'NSAppTransportSecurity') {
      if (atsHardenedFromReference(referenceInfo.NSAppTransportSecurity, candidateInfo.NSAppTransportSecurity)) {
        approvedDeltas.push({
          key: delta.key,
          id: 'ats-local-network-hardening',
          reason: 'candidate disables arbitrary loads while retaining localhost and 127.0.0.1 HTTP exceptions',
        });
        continue;
      }
    }
    if (delta.key === 'NSAudioCaptureUsageDescription') {
      if (!referenceInfo.NSAudioCaptureUsageDescription && typeof candidateInfo.NSAudioCaptureUsageDescription === 'string' && candidateInfo.NSAudioCaptureUsageDescription.length > 0) {
        approvedDeltas.push({
          key: delta.key,
          id: 'audio-capture-privacy-string',
          reason: 'candidate declares the audio capture privacy string required by the macOS security contract',
        });
        continue;
      }
    }
    unexpectedDeltas.push(delta.key);
  }

  const exactMatch = topLevelDeltas.length === 0;
  return {
    exactMatch,
    approvedByPolicy: exactMatch || unexpectedDeltas.length === 0,
    reason: exactMatch
      ? 'Info.plist metadata exactly matches the installed reference'
      : unexpectedDeltas.length === 0
        ? 'Info.plist delta is limited to approved build metadata, app.asar integrity, ATS hardening, and privacy-string changes'
        : `unexpected Info.plist delta(s): ${unexpectedDeltas.join(', ')}`,
    topLevelDeltas,
    approvedDeltas,
    unexpectedDeltas,
  };
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
  const notarizationTicketStapled = /Notarization Ticket=stapled/.test(detailText);
  return {
    ok: Boolean(codesignVerify.ok),
    kind: developerId ? 'developer-id' : adHoc ? 'ad-hoc' : codesignDetails.ok ? 'non-developer-id' : 'missing',
    developerId,
    adHoc,
    teamIdentifier,
    authorities,
    hardenedRuntime,
    notarizationTicketStapled,
  };
}

function securitySummary(appPath) {
  const codesignVerify = fs.existsSync(appPath)
    ? run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { darwinOnly: true })
    : { ok: false, stderr: 'app missing' };
  const codesignDetails = fs.existsSync(appPath)
    ? run('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], { darwinOnly: true })
    : { ok: false, stderr: 'app missing' };
  const gatekeeper = fs.existsSync(appPath)
    ? run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], { darwinOnly: true })
    : { ok: false, stderr: 'app missing' };
  const stapler = fs.existsSync(appPath)
    ? run('/usr/bin/xcrun', ['stapler', 'validate', appPath], { darwinOnly: true })
    : { ok: false, stderr: 'app missing' };

  return {
    codeSignature: codeSignatureSummary(codesignVerify, codesignDetails),
    codesignVerify: { ok: codesignVerify.ok, output: codesignVerify.stderr || codesignVerify.stdout },
    gatekeeper: { ok: gatekeeper.ok, output: gatekeeper.stderr || gatekeeper.stdout },
    stapler: { ok: stapler.ok, output: stapler.stderr || stapler.stdout },
  };
}

function appSummary(appPath, source) {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources');
  const asarPath = path.join(resourcesDir, 'app.asar');
  return {
    source,
    path: appPath,
    exists: fs.existsSync(appPath),
    bundleIdentifier: fs.existsSync(appPath) ? appPlistValue(appPath, 'CFBundleIdentifier') : null,
    version: fs.existsSync(appPath) ? appPlistValue(appPath, 'CFBundleShortVersionString') : null,
    displayName: fs.existsSync(appPath) ? appPlistValue(appPath, 'CFBundleDisplayName') : null,
    electronRuntimeVersion: fs.existsSync(appPath) ? electronRuntimeVersion(appPath) : null,
    infoPlist: readInfoPlist(appPath),
    appAsar: fileInfo(asarPath),
    appAsarPackage: asarPackageMetadata(asarPath),
    appAsarEntries: asarList(asarPath).length,
    icon: fileInfo(path.join(resourcesDir, 'icon.icns')),
    appUpdate: fileInfo(path.join(resourcesDir, 'app-update.yml')),
    security: securitySummary(appPath),
  };
}

function resolveReferenceApp() {
  if (process.env.CONNECT_AI_INSTALLED_APP && fs.existsSync(installedAppPath)) {
    return {
      appPath: installedAppPath,
      source: installedAppPath,
      cleanup: null,
      selectionReason: 'explicit installed app path',
    };
  }
  const baseline = resolveBaselineApp();
  return {
    appPath: baseline.appPath,
    source: baseline.source,
    cleanup: baseline,
    selectionReason: process.env.CONNECT_AI_APP || process.env.CONNECT_AI_ZIP
      ? 'explicit current baseline app resolver'
      : 'default current baseline app resolver',
  };
}

function commercialBlockingDeltas(candidate) {
  const blockers = [];
  if (candidate.security.codeSignature.developerId !== true) {
    blockers.push({
      id: 'candidate-developer-id-signature',
      detail: `candidate signature=${candidate.security.codeSignature.kind}, team=${candidate.security.codeSignature.teamIdentifier || 'missing'}`,
    });
  }
  if (candidate.security.gatekeeper.ok !== true) {
    blockers.push({
      id: 'candidate-gatekeeper',
      detail: candidate.security.gatekeeper.output || 'Gatekeeper rejected candidate app',
    });
  }
  if (candidate.security.stapler.ok !== true) {
    blockers.push({
      id: 'candidate-notarization-ticket',
      detail: candidate.security.stapler.output || 'candidate app does not have a stapled notarization ticket',
    });
  }
  return blockers;
}

function main() {
  let reference = null;
  try {
    reference = resolveReferenceApp();
    const referenceApp = appSummary(reference.appPath, reference.source);
    const candidateApp = appSummary(candidateAppPath, candidateAppPath);
    const referenceAsarPath = referenceApp.appAsar.path;
    const candidateAsarPath = candidateApp.appAsar.path;
    const appAsarPolicy = referenceApp.appAsar.exists && candidateApp.appAsar.exists
      ? summarizeAppAsarPolicy(approveMainProcessSecurityDeltaFromAsar({
          baselineAsarPath: referenceAsarPath,
          candidateAsarPath,
          localMainPath: path.join(desktopDir, 'src', 'main.ts'),
        }))
      : null;
    const asarPolicyOk = Boolean(appAsarPolicy && appAsarContentOk({
      expectedSha256: referenceApp.appAsar.sha256 || DEFAULT_ASAR_SHA256,
      candidateSha256: candidateApp.appAsar.sha256,
      policy: appAsarPolicy,
    }));
    const comparison = {
      productMetadataMatch:
        referenceApp.bundleIdentifier === candidateApp.bundleIdentifier &&
        referenceApp.version === candidateApp.version &&
        referenceApp.displayName === candidateApp.displayName,
      electronRuntimeMatch: referenceApp.electronRuntimeVersion === candidateApp.electronRuntimeVersion,
      appAsarExactMatch: referenceApp.appAsar.sha256 === candidateApp.appAsar.sha256,
      appAsarApprovedByPolicy: asarPolicyOk,
      appAsarEntryDelta: asarEntryDelta(referenceAsarPath, candidateAsarPath),
      iconMatch: referenceApp.icon.sha256 === candidateApp.icon.sha256,
      appUpdateMatch: referenceApp.appUpdate.sha256 === candidateApp.appUpdate.sha256,
      referenceCommercialSignature:
        referenceApp.security.codeSignature.developerId === true &&
        referenceApp.security.gatekeeper.ok === true,
      candidateCommercialSignature:
        candidateApp.security.codeSignature.developerId === true &&
        candidateApp.security.gatekeeper.ok === true &&
        candidateApp.security.stapler.ok === true,
      commercialBlockingDeltas: commercialBlockingDeltas(candidateApp),
    };
    comparison.macosInfoPlistDelta = approveMacosMetadataDelta(referenceApp.infoPlist, candidateApp.infoPlist, comparison.appAsarApprovedByPolicy);
    comparison.macosMetadataExactMatch = comparison.macosInfoPlistDelta.exactMatch;
    comparison.macosMetadataApprovedByPolicy = comparison.macosInfoPlistDelta.approvedByPolicy;

    add('reference app exists', referenceApp.exists, referenceApp.path);
    add('candidate app exists', candidateApp.exists, candidateApp.path);
    add('bundle product metadata parity', comparison.productMetadataMatch, `reference=${referenceApp.bundleIdentifier}/${referenceApp.version}/${referenceApp.displayName}, candidate=${candidateApp.bundleIdentifier}/${candidateApp.version}/${candidateApp.displayName}`);
    add('icon parity', comparison.iconMatch, `${referenceApp.icon.sha256 || 'missing'} / ${candidateApp.icon.sha256 || 'missing'}`);
    add('app-update metadata parity', comparison.appUpdateMatch, `${referenceApp.appUpdate.sha256 || 'missing'} / ${candidateApp.appUpdate.sha256 || 'missing'}`);
    add('app.asar approved content policy', comparison.appAsarApprovedByPolicy, appAsarPolicy?.reason || 'missing app.asar policy');
    add('macOS metadata approved policy', comparison.macosMetadataApprovedByPolicy, comparison.macosInfoPlistDelta.reason);
    add('Electron runtime delta captured', true, `reference=${referenceApp.electronRuntimeVersion || 'missing'}, candidate=${candidateApp.electronRuntimeVersion || 'missing'}`);
    add('candidate commercial signature delta captured', true, `${comparison.commercialBlockingDeltas.length} commercial blocker delta(s)`);

    const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
    const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: blockers > 0
        ? 'installed-bundle-delta-blocked'
        : comparison.commercialBlockingDeltas.length
          ? 'installed-bundle-delta-captured-awaiting-commercial-signing'
          : 'installed-bundle-commercial-parity',
      product: {
        name: 'Connect AI',
        version: DEFAULT_VERSION,
        appId: 'ai.ezer.connect-desktop',
      },
      reference: referenceApp,
      candidate: candidateApp,
      comparison,
      appAsarPolicy,
      summary: {
        blockers,
        warnings,
        commercialBlockingDeltas: comparison.commercialBlockingDeltas.length,
        appAsarExactMatch: comparison.appAsarExactMatch,
        appAsarApprovedByPolicy: comparison.appAsarApprovedByPolicy,
        macosMetadataExactMatch: comparison.macosMetadataExactMatch,
        macosMetadataApprovedByPolicy: comparison.macosMetadataApprovedByPolicy,
        electronRuntimeMatch: comparison.electronRuntimeMatch,
        iconMatch: comparison.iconMatch,
        appUpdateMatch: comparison.appUpdateMatch,
        candidateCommercialSignature: comparison.candidateCommercialSignature,
      },
      checks,
    };

    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Connect AI installed bundle delta report: ${report.status}`);
    console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s), ${comparison.commercialBlockingDeltas.length} commercial blocker delta(s)`);
    console.log(`Wrote ${path.relative(desktopDir, outputPath)}`);
    if (blockers > 0) process.exit(1);
  } finally {
    if (reference?.cleanup) cleanupBaselineApp(reference.cleanup);
  }
}

main();
