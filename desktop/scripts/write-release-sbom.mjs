import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');

function runSbom(format) {
  const result = spawnSync('npm', ['sbom', '--package-lock-only', '--omit=dev', '--sbom-format', format, '--sbom-type', 'application', '--json'], {
    cwd: desktopDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || 'npm sbom failed').trim();
    throw new Error(detail);
  }
  const parsed = JSON.parse(result.stdout);
  if (format === 'cyclonedx' && parsed.bomFormat !== 'CycloneDX') {
    throw new Error(`Unexpected CycloneDX SBOM format: ${parsed.bomFormat || 'missing'}`);
  }
  if (format === 'spdx' && !parsed.spdxVersion) {
    throw new Error('Unexpected SPDX SBOM format: missing spdxVersion');
  }
  return parsed;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Wrote ${path.relative(desktopDir, file)}`);
}

function main() {
  fs.mkdirSync(releaseDir, { recursive: true });
  writeJson(path.join(releaseDir, 'sbom.cdx.json'), runSbom('cyclonedx'));
  writeJson(path.join(releaseDir, 'sbom.spdx.json'), runSbom('spdx'));
}

main();
