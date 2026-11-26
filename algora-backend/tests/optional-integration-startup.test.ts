import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, expect, it } from 'vitest';

let mongo: MongoMemoryServer;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); });
afterAll(async () => { await mongo?.stop(); });

async function boot(settings: Record<string, string>, check: (output: string) => void) {
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  const { port } = address;
  await new Promise<void>((resolve) => listener.close(() => resolve()));

  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LEETCODE_')));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: {
      ...inherited,
      NODE_ENV: 'production', ALLOW_LOCAL_MONGODB: 'true', MONGODB_URI: mongo.getUri(),
      GOOGLE_CLIENT_ID: 'test-client', SUPER_ADMIN_EMAIL: 'admin@example.com',
      SESSION_SECRET: 'G2sH46aD0rDneV05vXD1sEH0JfyBzry3FQ7l6Z', FRONTEND_URL: 'https://algora.example.com',
      PORT: String(port), LOG_LEVEL: 'info', ...settings,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exit = once(child, 'exit');
  child.stdout.on('data', (data) => { output += data.toString(); });
  child.stderr.on('data', (data) => { output += data.toString(); });
  try {
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 15_000;
    while (!output.includes('startup complete') && child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(output).toContain('startup complete');
    expect((await fetch(origin + '/ready')).status).toBe(200);
    expect((await fetch(origin + '/api/v1/courses')).status).toBe(401);
    check(output);
  } finally {
    child.kill();
    await exit;
  }
}

it('production starts without any LeetCode environment variables', async () => {
  await boot({}, (output) => expect(output).toContain('LEETCODE_SYNC_ENABLED=false'));
});

it.each([
  [{}, 'LEETCODE_ACCESS_BASIS is NONE'],
  [{ LEETCODE_ACCESS_BASIS: 'NONE', LEETCODE_PERMISSION_REF: 'old-reference', LEETCODE_ACCESS_REF: 'ignored' }, 'LEETCODE_ACCESS_BASIS is NONE'],
  [{ LEETCODE_ACCESS_BASIS: 'OWN_RISK' }, 'internal risk acceptance is not upstream authorization'],
  [{ LEETCODE_ACCESS_BASIS: 'REPLACE_WITH_BASIS' }, 'LEETCODE_ACCESS_BASIS'],
  [{ LEETCODE_ACCESS_BASIS: 'bogus' }, 'must be one of NONE'],
  [{ LEETCODE_ACCESS_BASIS: 'WRITTEN_PERMISSION' }, 'MongoDB transactions are unavailable'],
] as const)('production starts with an inactive external provider (%j)', async (settings, reason) => {
  await boot({ LEETCODE_SYNC_ENABLED: 'true', ...settings }, (output) => {
    expect(output).toContain(reason);
    expect(output).toContain('no provider can be activated');
    expect(output).not.toContain('startup failed');
  });
});

it('invalid provider options and mock switches never prevent production readiness', async () => {
  await boot({
    LEETCODE_SYNC_ENABLED: 'true', LEETCODE_ALFA_BASE_URL: 'not-a-url',
    LEETCODE_PROVIDER_PRIORITY: 'mock,alfa', LEETCODE_PROVIDER_TIMEOUT_MS: 'NaN',
  }, (output) => {
    expect(output).toContain('LEETCODE_ALFA_BASE_URL');
    expect(output).toContain('LEETCODE_PROVIDER_TIMEOUT_MS');
    expect(output).toContain('fixture provider ignored in production');
    expect(output).toContain('no provider can be activated');
  });
});
