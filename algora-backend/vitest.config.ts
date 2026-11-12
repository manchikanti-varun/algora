import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/algora_test',
      LOG_LEVEL: 'silent',
    },
  },
});
