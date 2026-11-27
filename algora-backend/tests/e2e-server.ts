// TEST HARNESS ONLY: real app + real google.ts, but OAuth2Client.verifyIdToken is stubbed (no Google network).
// Token format: "tok|sub|email|name". Never imported by src/.
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

(OAuth2Client.prototype as any).verifyIdToken = async ({ idToken }: { idToken: string }) => {
  const [p, sub, email, name] = idToken.split('|');
  if (p !== 'tok') throw new Error('bad');
  return { getPayload: () => ({ sub, email, email_verified: true, name }) };
};

(async () => {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, {
    NODE_ENV: process.env.E2E_NODE_ENV ?? 'development', PORT: '5100', MONGODB_URI: mongod.getUri(), GOOGLE_CLIENT_ID: 'e2e',
    SUPER_ADMIN_EMAIL: 'admin@example.com', SESSION_SECRET: randomBytes(32).toString('hex'), FRONTEND_URL: process.env.E2E_FRONTEND_URL ?? 'http://localhost:3000',
    ALLOW_LOCAL_MONGODB: 'true',
  });
  if (process.env.E2E_MOCK === '1') {
    // TEST ONLY: mock LeetCode provider controlled through a separate local port (never part of the app).
    Object.assign(process.env, { LEETCODE_SYNC_ENABLED: 'true', LEETCODE_MOCK_ENABLED: 'true', LEETCODE_PROVIDER_PRIORITY: 'mock', LEETCODE_STUDENT_COOLDOWN_SEC: '10', LEETCODE_SCHEDULER_ENABLED: 'false' });
    const { MockProvider } = await import('../src/modules/leetcode/providers/mock.provider.js');
    const { setProviderForTests } = await import('../src/modules/leetcode/providers/provider.registry.js');
    const mock = new MockProvider(); mock.latencyMs = 150;
    setProviderForTests(mock);
    const http = await import('node:http');
    http.createServer((req, res) => {
      let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
        const j = b ? JSON.parse(b) : {};
        if (req.url === '/solve') mock.solve(j.username, j.slug, new Date());
        res.end(JSON.stringify({ calls: mock.calls }));
      });
    }).listen(5199, '127.0.0.1');
  }
  await import('../src/server.js');
  if (process.env.E2E_MOCK === '1') {
    // TEST ONLY: drain the persistent sync queue in-process. The automatic scheduler stays off so mock call counts are deterministic.
    const { workerStep } = await import('../src/modules/leetcode/sync-queue.js');
    const inFlight = new Set<Promise<unknown>>();
    let busy = false;
    setInterval(async () => { if (busy) return; busy = true; try { await workerStep(inFlight); } catch { /* next tick */ } finally { busy = false; } }, 500);
  }
})();
