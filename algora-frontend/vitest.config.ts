import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    env: { NEXT_PUBLIC_API_BASE_URL: 'http://localhost:5000/api/v1' },
  },
});
