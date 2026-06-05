// Connect AI Desktop 빌드 — main(Node) / preload(Node) / renderer(browser) 3개 번들.
// ../src/agents.ts, ../src/plaza.ts 를 복붙 없이 그대로 끌어와 번들한다.
import { build } from 'esbuild';

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2020' };

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main.ts'],
    outfile: 'out/main.js',
    platform: 'node',
    // node-llama-cpp 는 ESM·네이티브 → 번들 금지(런타임 동적 import). @node-llama-cpp/* 프리빌드도 외부.
    external: ['electron', 'node-llama-cpp', '@node-llama-cpp/*'],
  }),
  build({
    ...common,
    entryPoints: ['src/preload.ts'],
    outfile: 'out/preload.js',
    platform: 'node',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/renderer/renderer.ts'],
    outfile: 'out/renderer.js',
    platform: 'browser',
    format: 'iife',
  }),
]);

console.log('✅ Connect AI Desktop 번들 완료');
