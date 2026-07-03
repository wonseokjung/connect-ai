import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// vitest.config.ts — src/orders.ts 테스트용 설정.
// orders.ts → paths.ts 가 'vscode' 를 import 하는데, VS Code 런타임 밖(순수 node)이라
// test/vscode-stub.ts 로 alias 대체. stub 의 setBrainDir() 로 각 테스트가 brain 경로 주입.
export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'test/vscode-stub.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globals: true,
    testTimeout: 15000,
  },
});
