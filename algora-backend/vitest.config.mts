import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { setupFiles: ['tests/setup-env.ts'], hookTimeout: 120000, testTimeout: 30000, fileParallelism: false },
});
