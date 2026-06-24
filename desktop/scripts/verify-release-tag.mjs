import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const noExit = process.argv.includes('--no-exit');
const checks = [];

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

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function expectedReleaseTag(pkg) {
  return `desktop-v${pkg.version}`;
}

function resolvedTag(pkg) {
  if (argValue('--tag')) return { value: argValue('--tag'), source: '--tag' };
  if (process.env.CONNECT_AI_RELEASE_TAG) return { value: process.env.CONNECT_AI_RELEASE_TAG, source: 'CONNECT_AI_RELEASE_TAG' };
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) return { value: process.env.GITHUB_REF_NAME, source: 'GITHUB_REF_NAME' };
  return { value: expectedReleaseTag(pkg), source: 'package.json' };
}

function printAndExit(reportFields = {}) {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: blockers === 0,
    summary: {
      blockers,
      warnings,
    },
    ...reportFields,
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  const out = path.join(releaseDir, 'release-tag-report.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  console.log('Connect AI release tag verification');
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, out)}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const pkg = readJson('package.json');
  const expected = expectedReleaseTag(pkg);
  const tag = resolvedTag(pkg);
  const githubRefType = process.env.GITHUB_REF_TYPE || null;
  const githubRefName = process.env.GITHUB_REF_NAME || null;

  add('package version', /^\d+\.\d+\.\d+/.test(pkg.version), pkg.version || 'missing');
  add('expected release tag', /^desktop-v\d+\.\d+\.\d+/.test(expected), expected);
  add('resolved release tag', /^desktop-v\d+\.\d+\.\d+/.test(tag.value), `${tag.value} from ${tag.source}`);
  add('release tag matches package version', tag.value === expected, `${tag.value} expected ${expected}`);
  if (githubRefType === 'tag') {
    add('GitHub tag ref matches package version', githubRefName === expected, `${githubRefName || 'missing'} expected ${expected}`);
  }

  const dmgName = `Connect-AI-${pkg.version}-mac-arm64.dmg`;
  const dmgTemplate = pkg.build?.dmg?.artifactName || '';
  const renderedDmgName = dmgTemplate
    .replace(/\$\{version\}/g, pkg.version)
    .replace(/\$\{arch\}/g, 'arm64')
    .replace(/\$\{ext\}/g, 'dmg');
  add('DMG artifact naming version', renderedDmgName === dmgName, `${dmgTemplate || 'missing'} -> ${renderedDmgName || 'missing'}`);
  add('expected DMG name', /^Connect-AI-\d+\.\d+\.\d+-mac-arm64\.dmg$/.test(dmgName), dmgName);

  printAndExit({
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
    },
    releaseTag: {
      expected,
      resolved: tag.value,
      source: tag.source,
      githubRefType,
      githubRefName,
    },
    artifacts: {
      dmg: `release/${dmgName}`,
      blockmap: `release/${dmgName}.blockmap`,
      latestMac: 'release/latest-mac.yml',
    },
  });
}

main();
