import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');

function usage() {
  console.error('Usage: node scripts/run-with-release-env.mjs [--file .env.release.local] -- <command> [args...]');
}

function parseLine(line, lineNumber, file) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const source = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
  const index = source.indexOf('=');
  if (index <= 0) throw new Error(`${file}:${lineNumber}: expected KEY=value`);
  const key = source.slice(0, index).trim();
  let value = source.slice(index + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`${file}:${lineNumber}: invalid env key ${key}`);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function loadEnvFile(file) {
  const envFile = path.resolve(desktopDir, file);
  if (!fs.existsSync(envFile)) {
    throw new Error(`missing release env file: ${path.relative(desktopDir, envFile)}`);
  }
  const out = {};
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const entry = parseLine(lines[i], i + 1, path.relative(desktopDir, envFile));
    if (!entry) continue;
    const [key, value] = entry;
    out[key] = value;
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  let envFile = '.env.release.local';
  const commandIndex = args.indexOf('--');
  if (commandIndex < 0) {
    usage();
    process.exit(2);
  }

  const options = args.slice(0, commandIndex);
  for (let i = 0; i < options.length; i += 1) {
    const option = options[i];
    if (option === '--file') {
      envFile = options[i + 1];
      i += 1;
    } else {
      console.error(`Unknown option: ${option}`);
      usage();
      process.exit(2);
    }
  }

  const command = args[commandIndex + 1];
  const commandArgs = args.slice(commandIndex + 2);
  if (!command) {
    usage();
    process.exit(2);
  }

  let loaded;
  try {
    loaded = loadEnvFile(envFile);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const keys = Object.keys(loaded).sort();
  console.log(`Loaded ${keys.length} release env key(s) from ${envFile}. Values are not printed.`);
  const childEnv = { ...process.env, ...loaded };
  if (loaded.CONNECT_AI_RELEASE_AUDIT_TOKEN && !loaded.GH_TOKEN) {
    childEnv.GH_TOKEN = loaded.CONNECT_AI_RELEASE_AUDIT_TOKEN;
    console.log('Mapped CONNECT_AI_RELEASE_AUDIT_TOKEN to GH_TOKEN for GitHub CLI commands.');
  }
  const result = spawnSync(command, commandArgs, {
    cwd: desktopDir,
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

main();
