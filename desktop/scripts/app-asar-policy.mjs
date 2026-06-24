import fs from 'node:fs';
import path from 'node:path';
import { extractFile } from '@electron/asar';
import baselineTools from './baseline-app.cjs';

const { sha256 } = baselineTools;

export const APPROVED_MAIN_DELTA_ID = 'main-process-security-hardening';
export const APPROVED_MAIN_DELTA_SOURCE = '../src/main.ts';
export const APPROVED_MAIN_DELTA_BUNDLE_FILES = ['out/main.js', 'out/main.js.map'];
export const APPROVED_MAIN_DELTA_EXTRACTED_OUT_FILES = new Set(['main.js', 'main.js.map']);
export const APPROVED_SECURITY_DEPENDENCY_DELTA_PACKAGES = new Map([
  ['imapflow', '1.4.1'],
  ['mailparser', '3.9.10'],
  ['nodemailer', '9.0.1'],
]);
export const APPROVED_TYPE_ONLY_DEPENDENCY_RELOCATIONS = new Map([
  ['@types/nodemailer', '^8.0.0'],
]);
export const APPROVED_SECURITY_DEPENDENCY_DELTA_PREFIXES = [...APPROVED_SECURITY_DEPENDENCY_DELTA_PACKAGES.keys()]
  .map((packageName) => `../node_modules/${packageName}/`);
export const APPROVED_MAIN_DELTA_MARKERS = [
  'function safeExternalUrl(raw: string): string | null',
  'function openExternalSafe(raw: string): boolean',
  'function resolveWorkspacePath(input?: string)',
  'setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: \'deny\' }; })',
  'ipcMain.handle(\'open:external\', (_e, url: string) => openExternalSafe(url))',
  'const resolved = resolveWorkspacePath(rel)',
  'const resolved = resolveWorkspacePath(p)',
  'const resolved = resolveWorkspacePath(ws || loadConfig().workspace || defaultWorkspace())',
  'server.listen(5814, \'127.0.0.1\', () => openUrlFront(authUrl))',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonMaybe(file) {
  try {
    return readJson(file);
  } catch (error) {
    return { __error: error?.message || String(error) };
  }
}

function sameStringArray(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

function isApprovedSecurityDependencySource(source) {
  return APPROVED_SECURITY_DEPENDENCY_DELTA_PREFIXES.some((prefix) => source.startsWith(prefix));
}

function mapSourceIndexes(sources) {
  return new Map((sources || []).map((source, index) => [source, index]));
}

function securityDependencyPackageFromSource(source) {
  const prefix = '../node_modules/';
  if (!source.startsWith(prefix)) return '';
  const relative = source.slice(prefix.length);
  if (relative.startsWith('@')) return relative.split('/').slice(0, 2).join('/');
  return relative.split('/')[0] || '';
}

function sourceContentFor(map, source) {
  const index = mapSourceIndexes(map.sources).get(source);
  if (index === undefined) return undefined;
  return map.sourcesContent?.[index];
}

function dependencyPackageVersionFromMap(map, packageName) {
  const packageJson = sourceContentFor(map, `../node_modules/${packageName}/package.json`);
  if (typeof packageJson !== 'string') return '';
  try {
    return JSON.parse(packageJson).version || '';
  } catch {
    return '';
  }
}

function expectedSecurityDependencyPackageEntries() {
  return [...APPROVED_SECURITY_DEPENDENCY_DELTA_PACKAGES.entries()].map(([packageName, expectedVersion]) => ({
    packageName,
    expectedVersion,
  }));
}

function expectedTypeOnlyDependencyRelocationEntries() {
  return [...APPROVED_TYPE_ONLY_DEPENDENCY_RELOCATIONS.entries()].map(([packageName, expectedSpec]) => ({
    packageName,
    expectedSpec,
  }));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
}

function stable(value) {
  return JSON.stringify(sortDeep(value), null, 2);
}

function pickProductionPackage(pkg) {
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: pkg.main,
    author: pkg.author,
    license: pkg.license,
    repository: pkg.repository,
    dependencies: pkg.dependencies || {},
  };
}

function dependencySpecAllowsExpectedVersion(spec, expectedVersion) {
  return spec === expectedVersion || spec === `^${expectedVersion}` || spec === `~${expectedVersion}`;
}

function dependencySpecAllowsExpectedSpec(spec, expectedSpec) {
  return spec === expectedSpec;
}

export function approveProductionPackageMetadataDelta({ baselinePackage, candidatePackage, localPackage = candidatePackage }) {
  const result = {
    ok: false,
    reason: '',
    approvedSecurityDependencySpecs: expectedSecurityDependencyPackageEntries().map((entry) => ({
      ...entry,
      candidateSpec: candidatePackage?.dependencies?.[entry.packageName] || '',
      localSpec: localPackage?.dependencies?.[entry.packageName] || '',
      ok: false,
    })),
    approvedTypeOnlyDependencyRelocations: expectedTypeOnlyDependencyRelocationEntries().map((entry) => ({
      ...entry,
      baselineSpec: baselinePackage?.dependencies?.[entry.packageName] || '',
      candidateDependencySpec: candidatePackage?.dependencies?.[entry.packageName] || '',
      localDependencySpec: localPackage?.dependencies?.[entry.packageName] || '',
      localDevDependencySpec: localPackage?.devDependencies?.[entry.packageName] || '',
      ok: false,
    })),
  };

  if (!baselinePackage || !candidatePackage || !localPackage) {
    result.reason = 'production package metadata missing';
    return result;
  }

  const baselineComparable = pickProductionPackage(baselinePackage);
  const candidateComparable = pickProductionPackage(candidatePackage);
  const localComparable = pickProductionPackage(localPackage);
  const normalizedBaseline = cloneJson(baselineComparable);
  const normalizedCandidate = cloneJson(candidateComparable);
  const normalizedLocal = cloneJson(localComparable);

  for (const entry of result.approvedSecurityDependencySpecs) {
    const candidateSpec = candidateComparable.dependencies?.[entry.packageName];
    const localSpec = localComparable.dependencies?.[entry.packageName];
    entry.candidateSpec = candidateSpec || '';
    entry.localSpec = localSpec || '';
    entry.ok = dependencySpecAllowsExpectedVersion(candidateSpec, entry.expectedVersion) &&
      dependencySpecAllowsExpectedVersion(localSpec, entry.expectedVersion);
    if (!entry.ok) {
      result.reason = `approved security dependency spec invalid: ${entry.packageName} candidate=${candidateSpec || 'missing'} local=${localSpec || 'missing'} expected ${entry.expectedVersion}`;
      return result;
    }
    normalizedBaseline.dependencies[entry.packageName] = `approved-security-update:${entry.expectedVersion}`;
    normalizedCandidate.dependencies[entry.packageName] = `approved-security-update:${entry.expectedVersion}`;
    normalizedLocal.dependencies[entry.packageName] = `approved-security-update:${entry.expectedVersion}`;
  }

  for (const entry of result.approvedTypeOnlyDependencyRelocations) {
    const baselineSpec = baselineComparable.dependencies?.[entry.packageName];
    const candidateDependencySpec = candidateComparable.dependencies?.[entry.packageName];
    const localDependencySpec = localComparable.dependencies?.[entry.packageName];
    const localDevDependencySpec = localPackage.devDependencies?.[entry.packageName];
    entry.baselineSpec = baselineSpec || '';
    entry.candidateDependencySpec = candidateDependencySpec || '';
    entry.localDependencySpec = localDependencySpec || '';
    entry.localDevDependencySpec = localDevDependencySpec || '';
    entry.ok = dependencySpecAllowsExpectedSpec(baselineSpec, entry.expectedSpec) &&
      !candidateDependencySpec &&
      !localDependencySpec &&
      dependencySpecAllowsExpectedSpec(localDevDependencySpec, entry.expectedSpec);
    if (!entry.ok) {
      result.reason = `approved type-only dependency relocation invalid: ${entry.packageName} baseline=${baselineSpec || 'missing'} candidateDependency=${candidateDependencySpec || 'missing'} localDependency=${localDependencySpec || 'missing'} localDevDependency=${localDevDependencySpec || 'missing'} expected ${entry.expectedSpec}`;
      return result;
    }
    delete normalizedBaseline.dependencies[entry.packageName];
    delete normalizedCandidate.dependencies[entry.packageName];
    delete normalizedLocal.dependencies[entry.packageName];
  }

  if (stable(normalizedBaseline) !== stable(normalizedCandidate)) {
    result.reason = 'candidate production package metadata differs from baseline outside approved deltas';
    return result;
  }
  if (stable(normalizedCandidate) !== stable(normalizedLocal)) {
    result.reason = 'candidate production package metadata differs from local package outside approved deltas';
    return result;
  }

  result.ok = true;
  result.reason = 'production package metadata delta is limited to approved mail dependency security updates and type-only dependency relocation';
  return result;
}

export function readAsarText(asarPath, entryPath, options = {}) {
  try {
    const data = extractFile(asarPath, entryPath);
    return Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  } catch (error) {
    if (options.optional) return null;
    throw new Error(`unable to read ${entryPath} from ${asarPath}: ${error?.message || String(error)}`);
  }
}

export function readAsarJson(asarPath, entryPath) {
  return JSON.parse(readAsarText(asarPath, entryPath));
}

function basePolicy(extra = {}) {
  return {
    id: APPROVED_MAIN_DELTA_ID,
    ok: false,
    exactMatch: false,
    approvedDelta: false,
    reason: '',
    source: APPROVED_MAIN_DELTA_SOURCE,
    changedSources: [],
    addedSources: [],
    removedSources: [],
    allowedBundleMismatches: [],
    approvedBundleFiles: APPROVED_MAIN_DELTA_BUNDLE_FILES,
    approvedSecurityDependencyPackages: expectedSecurityDependencyPackageEntries().map((entry) => ({
      ...entry,
      actualVersion: '',
      ok: false,
      sourceMapPresent: false,
      asarPackagePresent: false,
    })),
    packageMetadata: null,
    requiredMarkers: APPROVED_MAIN_DELTA_MARKERS.map((marker) => ({ marker, ok: false })),
    ...extra,
  };
}

export function approveMainProcessSecurityDelta({ baselineMap, candidateMap, localMainSource, baselineSha256 = null, candidateSha256 = null }) {
  const result = basePolicy({
    baselineSha256,
    candidateSha256,
    candidateMatchesBaseline: Boolean(baselineSha256 && candidateSha256 && baselineSha256 === candidateSha256),
  });

  if (baselineMap.__error || candidateMap.__error) {
    result.reason = `unable to parse main sourcemaps: ${baselineMap.__error || candidateMap.__error}`;
    return result;
  }

  if (!Array.isArray(candidateMap.sources) || !Array.isArray(baselineMap.sources)) {
    result.reason = 'main sourcemap source list is missing';
    return result;
  }

  const baselineSourceIndex = mapSourceIndexes(baselineMap.sources);
  const candidateSourceIndex = mapSourceIndexes(candidateMap.sources);
  result.addedSources = candidateMap.sources.filter((source) => !baselineSourceIndex.has(source));
  result.removedSources = baselineMap.sources.filter((source) => !candidateSourceIndex.has(source));

  if (result.removedSources.length) {
    result.reason = `main sourcemap removed sources are not approved: ${result.removedSources.join(', ')}`;
    return result;
  }

  const disallowedAddedSources = result.addedSources.filter((source) => !isApprovedSecurityDependencySource(source));
  if (disallowedAddedSources.length) {
    result.reason = `main sourcemap added sources are not approved: ${disallowedAddedSources.join(', ')}`;
    return result;
  }

  for (const source of candidateMap.sources) {
    const baselineIndex = baselineSourceIndex.get(source);
    if (baselineIndex === undefined) continue;
    const candidateIndex = candidateSourceIndex.get(source);
    if (candidateMap.sourcesContent?.[candidateIndex] !== baselineMap.sourcesContent?.[baselineIndex]) {
      result.changedSources.push(source);
    }
  }
  const changedSourceSet = new Set(result.changedSources);
  const disallowedChangedSources = result.changedSources.filter((source) => (
    source !== APPROVED_MAIN_DELTA_SOURCE && !isApprovedSecurityDependencySource(source)
  ));
  if (disallowedChangedSources.length) {
    result.reason = `main sourcemap changed sources are not approved: ${disallowedChangedSources.join(', ')}`;
    return result;
  }

  const mainSourceIndex = candidateMap.sources.indexOf(APPROVED_MAIN_DELTA_SOURCE);
  if (mainSourceIndex < 0) {
    result.reason = `approved main-process security delta source missing: ${APPROVED_MAIN_DELTA_SOURCE}`;
    return result;
  }
  const bundledMainSource = candidateMap.sourcesContent?.[mainSourceIndex] || '';
  if (bundledMainSource !== localMainSource) {
    result.reason = 'bundled main.ts sourcemap content does not match local src/main.ts';
    return result;
  }

  result.requiredMarkers = result.requiredMarkers.map((entry) => ({
    ...entry,
    ok: bundledMainSource.includes(entry.marker),
  }));
  const missing = result.requiredMarkers.filter((entry) => !entry.ok);
  if (missing.length) {
    result.reason = `approved main-process security delta marker missing: ${missing.map((entry) => entry.marker).join(', ')}`;
    return result;
  }

  const securityDependencyPackagesInMap = new Set([
    ...result.addedSources,
    ...result.changedSources.filter(isApprovedSecurityDependencySource),
  ].map(securityDependencyPackageFromSource));
  result.approvedSecurityDependencyPackages = expectedSecurityDependencyPackageEntries().map((entry) => {
    const actualVersion = dependencyPackageVersionFromMap(candidateMap, entry.packageName);
    const changedInSourceMap = securityDependencyPackagesInMap.has(entry.packageName);
    const versionMatches = actualVersion === entry.expectedVersion;
    return {
      ...entry,
      actualVersion,
      ok: !changedInSourceMap || versionMatches,
      versionMatches,
      sourceMapPresent: actualVersion !== '',
      asarPackagePresent: false,
      changedInSourceMap,
    };
  });
  const invalidSecurityDependencies = result.approvedSecurityDependencyPackages
    .filter((entry) => entry.changedInSourceMap && !entry.ok);
  if (invalidSecurityDependencies.length) {
    result.reason = `approved security dependency source versions are invalid: ${invalidSecurityDependencies.map((entry) => `${entry.packageName}@${entry.actualVersion || 'missing'} expected ${entry.expectedVersion}`).join(', ')}`;
    return result;
  }

  result.ok = true;
  result.approvedDelta = true;
  result.allowedBundleMismatches = [];
  result.reason = 'main-process bundle delta is limited to approved external URL/workspace path hardening and approved mail dependency security updates';
  return result;
}

export function approveMainProcessSecurityDeltaFromFiles({ baselineMapPath, candidateMapPath, localMainPath }) {
  return approveMainProcessSecurityDelta({
    baselineMap: readJsonMaybe(baselineMapPath),
    candidateMap: readJsonMaybe(candidateMapPath),
    localMainSource: fs.readFileSync(localMainPath, 'utf8'),
  });
}

export function approveMainProcessSecurityDeltaFromAsar({ baselineAsarPath, candidateAsarPath, localMainPath }) {
  const baselineSha256 = fs.existsSync(baselineAsarPath) ? sha256(baselineAsarPath) : null;
  const candidateSha256 = fs.existsSync(candidateAsarPath) ? sha256(candidateAsarPath) : null;

  if (baselineSha256 && candidateSha256 && baselineSha256 === candidateSha256) {
    return basePolicy({
      ok: true,
      exactMatch: true,
      reason: 'candidate app.asar matches baseline exactly',
      baselineSha256,
      candidateSha256,
      candidateMatchesBaseline: true,
    });
  }

  let result;
  try {
    result = approveMainProcessSecurityDelta({
      baselineMap: readAsarJson(baselineAsarPath, 'out/main.js.map'),
      candidateMap: readAsarJson(candidateAsarPath, 'out/main.js.map'),
      localMainSource: fs.readFileSync(localMainPath, 'utf8'),
      baselineSha256,
      candidateSha256,
    });
  } catch (error) {
    return basePolicy({
      reason: error?.message || String(error),
      baselineSha256,
      candidateSha256,
      candidateMatchesBaseline: false,
    });
  }

  if (!result.ok) return result;

  const packagedMainSource = readAsarText(candidateAsarPath, 'src/main.ts', { optional: true });
  result.packagedSource = {
    path: 'src/main.ts',
    present: packagedMainSource !== null,
    matchesLocal: packagedMainSource === null ? null : packagedMainSource === fs.readFileSync(localMainPath, 'utf8'),
  };
  if (result.packagedSource.present && !result.packagedSource.matchesLocal) {
    result.ok = false;
    result.approvedDelta = false;
    result.reason = 'packaged src/main.ts does not match local src/main.ts';
    return result;
  }
  if (result.packagedSource.present) {
    result.approvedBundleFiles = [...APPROVED_MAIN_DELTA_BUNDLE_FILES, result.packagedSource.path];
  }

  const dependencyPackageResults = expectedSecurityDependencyPackageEntries().map((entry) => {
    let actualVersion = '';
    let present = false;
    try {
      const pkg = readAsarJson(candidateAsarPath, `node_modules/${entry.packageName}/package.json`);
      actualVersion = pkg.version || '';
      present = true;
    } catch {
      present = false;
    }

    const sourceMapEntry = result.approvedSecurityDependencyPackages
      .find((candidate) => candidate.packageName === entry.packageName);

    return {
      ...entry,
      actualVersion,
      ok: actualVersion === entry.expectedVersion,
      versionMatches: actualVersion === entry.expectedVersion,
      sourceMapPresent: Boolean(sourceMapEntry?.sourceMapPresent),
      asarPackagePresent: present,
      changedInSourceMap: Boolean(sourceMapEntry?.changedInSourceMap),
    };
  });
  result.approvedSecurityDependencyPackages = dependencyPackageResults;
  const invalidPackagedSecurityDependencies = dependencyPackageResults.filter((entry) => !entry.ok);
  if (invalidPackagedSecurityDependencies.length) {
    result.ok = false;
    result.approvedDelta = false;
    result.reason = `packaged approved security dependency versions are invalid: ${invalidPackagedSecurityDependencies.map((entry) => `${entry.packageName}@${entry.actualVersion || 'missing'} expected ${entry.expectedVersion}`).join(', ')}`;
    return result;
  }

  const localPackagePath = path.resolve(path.dirname(localMainPath), '..', 'package.json');
  result.packageMetadata = approveProductionPackageMetadataDelta({
    baselinePackage: readAsarJson(baselineAsarPath, 'package.json'),
    candidatePackage: readAsarJson(candidateAsarPath, 'package.json'),
    localPackage: fs.existsSync(localPackagePath) ? readJson(localPackagePath) : readAsarJson(candidateAsarPath, 'package.json'),
  });
  if (!result.packageMetadata.ok) {
    result.ok = false;
    result.approvedDelta = false;
    result.reason = result.packageMetadata.reason;
    return result;
  }

  return result;
}

export function summarizeAppAsarPolicy(policy) {
  if (!policy) return null;
  return {
    id: policy.id || APPROVED_MAIN_DELTA_ID,
    ok: Boolean(policy.ok),
    exactMatch: Boolean(policy.exactMatch),
    approvedDelta: Boolean(policy.approvedDelta),
    reason: policy.reason || '',
    source: policy.source || APPROVED_MAIN_DELTA_SOURCE,
    changedSources: policy.changedSources || [],
    addedSources: policy.addedSources || [],
    removedSources: policy.removedSources || [],
    allowedBundleMismatches: policy.allowedBundleMismatches || [],
    approvedBundleFiles: policy.approvedBundleFiles || APPROVED_MAIN_DELTA_BUNDLE_FILES,
    approvedSecurityDependencyPackages: policy.approvedSecurityDependencyPackages || [],
    packageMetadata: policy.packageMetadata || null,
    requiredMarkers: policy.requiredMarkers || [],
    baselineSha256: policy.baselineSha256 || null,
    candidateSha256: policy.candidateSha256 || null,
    candidateMatchesBaseline: Boolean(policy.candidateMatchesBaseline || policy.exactMatch),
    packagedSource: policy.packagedSource || null,
  };
}

export function appAsarContentOk({ expectedSha256, candidateSha256, policy }) {
  return Boolean((expectedSha256 && candidateSha256 === expectedSha256) || policy?.ok === true);
}

export function appAsarPolicyDetail({ expectedSha256, candidateSha256, policy }) {
  if (expectedSha256 && candidateSha256 === expectedSha256) return candidateSha256;
  if (policy?.ok) return `${candidateSha256 || 'missing'} (${policy.reason})`;
  return candidateSha256 || policy?.reason || 'missing';
}
