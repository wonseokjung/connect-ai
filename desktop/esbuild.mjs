// Connect AI Desktop v0.4.8 parity build.
//
// The baseline app was bundled against its production node_modules layout.
// Keep esbuild outside that layout via npx so module resolution for app code
// follows ./node_modules exactly.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';

const esbuild = [
  '--yes',
  '--package',
  'esbuild@0.24.2',
  'esbuild',
];

function bundle(args) {
  execFileSync('npx', esbuild.concat(args), {
    stdio: 'inherit',
    env: process.env,
  });
}

const common = ['--bundle', '--sourcemap', '--log-level=info', '--target=es2020'];

bundle([
  'src/main.ts',
  ...common,
  '--platform=node',
  '--external:electron',
  '--outfile=out/main.js',
]);

bundle([
  'src/preload.ts',
  ...common,
  '--platform=node',
  '--external:electron',
  '--outfile=out/preload.js',
]);

bundle([
  'src/renderer/renderer.ts',
  ...common,
  '--platform=browser',
  '--format=iife',
  '--outfile=out/renderer.js',
]);

// v0.4.8 includes sim bundles with no source maps.
// Preserve the baseline bundle snapshots for byte-level app parity.
mkdirSync('out', { recursive: true });
copyFileSync('src/sim.installed.js', 'out/sim.js');
copyFileSync('src/sim-mem.installed.js', 'out/sim-mem.js');
copyFileSync('src/sim-memory.installed.js', 'out/sim-memory.js');
copyFileSync('src/simmem.installed.js', 'out/simmem.js');

console.log('Connect AI Desktop bundle complete');
