import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const checks = [];

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

function sha(file, algorithm, encoding = 'hex') {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
}

function unquote(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function readSimpleYaml(file) {
  const out = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line === 'files:') continue;
    const match = line.match(/^(?:-\s*)?([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (match) out[match[1]] = unquote(match[2]);
  }
  return out;
}

function readLatestMacYaml(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  const fileEntry = {};
  let inFiles = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'files:') {
      inFiles = true;
      continue;
    }
    let match = line.match(/^- url:\s*(.+)$/);
    if (match) {
      fileEntry.url = unquote(match[1]);
      continue;
    }
    match = line.match(/^sha512:\s*(.+)$/);
    if (match) {
      if (inFiles && !fileEntry.sha512) fileEntry.sha512 = unquote(match[1]);
      else out.sha512 = unquote(match[1]);
      continue;
    }
    match = line.match(/^size:\s*(\d+)$/);
    if (match) {
      fileEntry.size = Number(match[1]);
      continue;
    }
    match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/);
    if (match) {
      out[match[1]] = unquote(match[2]);
      inFiles = false;
    }
  }
  out.files = Object.keys(fileEntry).length ? [fileEntry] : [];
  return out;
}

function expectedUpdateMetadata() {
  return {
    owner: 'wonseokjung',
    repo: 'connect-ai',
    provider: 'github',
    updaterCacheDirName: 'connect-ai-desktop-updater',
  };
}

function checkUpdateYaml(appPath, label) {
  const file = path.join(appPath, 'Contents', 'Resources', 'app-update.yml');
  add(`${label} app-update.yml`, fs.existsSync(file), fs.existsSync(file) ? path.relative(desktopDir, file) : 'missing');
  if (!fs.existsSync(file)) return null;

  const parsed = readSimpleYaml(file);
  const expected = expectedUpdateMetadata();
  for (const [key, value] of Object.entries(expected)) {
    add(`${label} app-update.yml ${key}`, parsed[key] === value, parsed[key] || 'missing');
  }
  const extra = Object.keys(parsed).filter((key) => !(key in expected));
  add(`${label} app-update.yml exact key set`, extra.length === 0 && Object.keys(expected).every((key) => key in parsed), extra.length ? `extra ${extra.join(', ')}` : Object.keys(parsed).join(', '));
  return parsed;
}

function attachDmg(dmgPath, mountPoint) {
  let last = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const result = run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mountPoint, dmgPath]);
    if (result.ok) return result;
    last = result;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 1000);
  }
  return last;
}

function detachDmg(mountPoint) {
  run('/usr/bin/hdiutil', ['detach', mountPoint], { timeout: 60000 });
}

function mountedAppPath(mountPoint) {
  const direct = path.join(mountPoint, 'Connect AI.app');
  if (fs.existsSync(direct)) return direct;
  const app = fs.readdirSync(mountPoint).find((entry) => entry.endsWith('.app'));
  return app ? path.join(mountPoint, app) : direct;
}

function checkLatestMac(pkg, dmgPath) {
  const file = path.join(releaseDir, 'latest-mac.yml');
  add('latest-mac.yml', fs.existsSync(file), fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'missing');
  if (!fs.existsSync(file)) return null;

  const latest = readLatestMacYaml(file);
  const dmgName = path.basename(dmgPath);
  const fileEntry = latest.files?.[0] || {};
  const dmgExists = fs.existsSync(dmgPath);
  const dmgSize = dmgExists ? fs.statSync(dmgPath).size : null;
  const dmgSha512 = dmgExists ? sha(dmgPath, 'sha512', 'base64') : null;

  add('latest-mac.yml version', latest.version === pkg.version, latest.version || 'missing');
  add('latest-mac.yml path', latest.path === dmgName, latest.path || 'missing');
  add('latest-mac.yml file url', fileEntry.url === dmgName, fileEntry.url || 'missing');
  add('latest-mac.yml size', dmgExists && fileEntry.size === dmgSize, `${fileEntry.size || 'missing'} expected ${dmgSize || 'missing'}`);
  add('latest-mac.yml sha512', dmgExists && latest.sha512 === dmgSha512 && fileEntry.sha512 === dmgSha512, latest.sha512 || 'missing');
  add('latest-mac.yml releaseDate', Boolean(Date.parse(latest.releaseDate || '')), latest.releaseDate || 'missing');
  return latest;
}

function checkPackagePublish(pkg) {
  const publish = Array.isArray(pkg.build?.publish) ? pkg.build.publish[0] || {} : {};
  add('package publish provider', publish.provider === 'github', publish.provider || 'missing');
  add('package publish owner', publish.owner === 'wonseokjung', publish.owner || 'missing');
  add('package publish repo', publish.repo === 'connect-ai', publish.repo || 'missing');
}

function main() {
  const pkg = readJson('package.json');
  const dmgPath = path.join(releaseDir, `Connect-AI-${pkg.version}-mac-arm64.dmg`);
  const releaseAppPath = path.join(releaseDir, 'mac-arm64', 'Connect AI.app');
  const blockmapPath = `${dmgPath}.blockmap`;

  checkPackagePublish(pkg);
  add('release DMG artifact', fs.existsSync(dmgPath), fs.existsSync(dmgPath) ? `${fs.statSync(dmgPath).size} bytes` : 'missing');
  add('release DMG blockmap artifact', fs.existsSync(blockmapPath), fs.existsSync(blockmapPath) ? `${fs.statSync(blockmapPath).size} bytes` : 'missing');
  add('release app bundle', fs.existsSync(releaseAppPath), path.relative(desktopDir, releaseAppPath));
  const releaseUpdate = fs.existsSync(releaseAppPath) ? checkUpdateYaml(releaseAppPath, 'release app') : null;
  const latest = checkLatestMac(pkg, dmgPath);

  let dmgUpdate = null;
  if (process.platform !== 'darwin') {
    add('DMG mounted app update metadata', false, 'requires macOS hdiutil');
  } else if (fs.existsSync(dmgPath)) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-update-channel-'));
    const mountPoint = path.join(tempDir, 'mnt');
    fs.mkdirSync(mountPoint);
    const attached = attachDmg(dmgPath, mountPoint);
    add('DMG mount for update metadata', attached.ok, attached.ok ? mountPoint : (attached.stderr || attached.error || attached.stdout));
    try {
      if (attached.ok) {
        const appPath = mountedAppPath(mountPoint);
        add('DMG mounted app bundle', fs.existsSync(appPath), appPath);
        if (fs.existsSync(appPath)) dmgUpdate = checkUpdateYaml(appPath, 'DMG app');
      }
    } finally {
      if (attached.ok) detachDmg(mountPoint);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (releaseUpdate && dmgUpdate) {
    add('release and DMG app-update.yml parity', JSON.stringify(releaseUpdate) === JSON.stringify(dmgUpdate), 'release app-update.yml equals DMG app-update.yml');
  }

  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: blockers === 0,
    product: {
      name: pkg.build?.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId,
      electronVersion: pkg.build?.electronVersion,
    },
    updateChannel: {
      provider: 'github',
      owner: 'wonseokjung',
      repo: 'connect-ai',
      latestMac: latest || null,
      releaseApp: releaseUpdate || null,
      dmgApp: dmgUpdate || null,
    },
    summary: {
      blockers,
      warnings,
    },
    checks,
  };

  fs.mkdirSync(releaseDir, { recursive: true });
  const out = path.join(releaseDir, 'update-channel-report.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  console.log('Connect AI update channel verification');
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, out)}`);
  if (blockers > 0) process.exit(1);
}

main();
