/**
 * LOAD-TEST HARNESS ONLY. Real Express app + scheduler on a replica-set MongoDB with the REAL Direct / Alfa / LeetCode-Query
 * adapters wired to an in-process fake LeetCode (no network, no LeetCode or third-party traffic). Google is stubbed.
 * Control port 5201: POST /outage {provider, on} toggles a provider-specific outage (connection refused).
 */
import http from 'node:http';
import { OAuth2Client } from 'google-auth-library';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

(OAuth2Client.prototype as any).verifyIdToken = async ({ idToken }: { idToken: string }) => {
  const [, sub, email, name] = idToken.split('|');
  return { getPayload: () => ({ sub, email, email_verified: true, name }) };
};
const N = Number(process.env.LOAD_STUDENTS ?? 200);
const LATENCY = Number(process.env.LOAD_PROVIDER_LATENCY_MS ?? 250);

(async () => {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, {
    // Keep the real rate limiters enabled for sustained runs: LOAD_NODE_ENV=development.
    NODE_ENV: process.env.LOAD_NODE_ENV ?? 'test', PORT: '5200', MONGODB_URI: rs.getUri(), GOOGLE_CLIENT_ID: 'load', SUPER_ADMIN_EMAIL: 'admin@example.com',
    SESSION_SECRET: 'z'.repeat(40), FRONTEND_URL: 'http://localhost:3000', LEETCODE_SYNC_ENABLED: 'true',
    LEETCODE_GLOBAL_RATE_PER_MIN: process.env.LOAD_RATE ?? '600', LEETCODE_ALFA_RATE_PER_MIN: process.env.LOAD_RATE ?? '600',
    LEETCODE_STUDENT_COOLDOWN_SEC: process.env.LOAD_COOLDOWN ?? '20', LEETCODE_CONCURRENCY: '3', LEETCODE_PROVIDER_RECOVERY_INTERVAL_SEC: '20',
    LEETCODE_BOOTCAMP_HOURS: '00:00-23:59', LEETCODE_BOOTCAMP_DAYS: '0,1,2,3,4,5,6',
  });
  const m = await import('../../src/models/index.js');
  const { createApp } = await import('../../src/app.js');
  const { DirectProvider } = await import('../../src/modules/leetcode/providers/direct.provider.js');
  const { AlfaProvider } = await import('../../src/modules/leetcode/providers/alfa.provider.js');
  const { LeetCodeQueryProvider } = await import('../../src/modules/leetcode/providers/leetcode-query.provider.js');
  const { setProvidersForTests } = await import('../../src/modules/leetcode/providers/provider.registry.js');
  const { startLeetcodeSyncJob } = await import('../../src/jobs/leetcode-sync.job.js');
  await mongoose.connect(rs.getUri(), { maxPoolSize: 20 });
  await m.syncAllIndexes();

  // ---- seed ----
  const admin = await m.User.create({ googleSub: 'sub-admin', email: 'admin@example.com', role: 'SUPER_ADMIN', fullName: 'Admin' });
  const course = await m.Course.create({ title: 'DSA', status: 'PUBLISHED', createdBy: admin._id });
  const slugs: string[] = []; const diffs = ['EASY', 'MEDIUM', 'HARD'] as const;
  for (let c = 0; c < 3; c++) {
    const ch = await m.Chapter.create({ courseId: course._id, title: `Chapter ${c + 1}`, order: c });
    await m.Problem.insertMany(Array.from({ length: 10 }, (_, p) => { const slug = `problem-${c}-${p}`; slugs.push(slug); return { chapterId: ch._id, courseId: course._id, title: slug, url: `https://leetcode.com/problems/${slug}/`, slug, difficulty: diffs[p % 3], order: p }; }));
  }
  const batches = [];
  for (let b = 0; b < Math.max(2, Math.ceil(N / 100)); b++) {
    const batch = await m.Batch.create({ name: `Batch ${b + 1}`, status: 'ACTIVE', createdBy: admin._id });
    const bc = await m.BatchCourse.create({ batchId: batch._id, courseId: course._id, assignedBy: admin._id });
    await m.BatchChapterAccess.insertMany((await m.Chapter.find({ courseId: course._id })).map((ch) => ({ batchCourseId: bc._id, chapterId: ch._id, isVisible: true })));
    batches.push(batch);
  }
  // Fake LeetCode data: student i solved k_i = 5 + (i % 20) problems, all accepted, one submission id each.
  const data = new Map<string, { id: string; title: string; titleSlug: string; timestamp: string; statusDisplay: string }[]>();
  const users = []; const links = []; const enr = [];
  for (let i = 0; i < N; i++) {
    const _id = new mongoose.Types.ObjectId();
    users.push({ _id, googleSub: `s${i}`, email: `s${i}@load.test`, role: 'STUDENT', fullName: `Student ${i}`, rollNumber: `L${String(i).padStart(9, '0')}`, leetcodeUsername: `lc${i}` });
    links.push({ studentId: _id, username: `lc${i}`, usernameNorm: `lc${i}`, status: 'VERIFIED', ...m.linkFlags('VERIFIED'), challenge: 'x', verifiedAt: new Date(), consentedAt: new Date() });
    enr.push({ studentId: _id, batchId: batches[i % batches.length]._id });
    const k = 5 + (i % 20);
    data.set(`lc${i}`, Array.from({ length: k }, (_, j) => ({ id: `${i}-${j}`, title: slugs[(i + j) % slugs.length], titleSlug: slugs[(i + j) % slugs.length], timestamp: String(Math.floor(Date.now() / 1000) - j * 60), statusDisplay: 'Accepted' })));
  }
  await m.User.insertMany(users); await m.LeetcodeLink.insertMany(links); await m.Enrollment.insertMany(enr);

  // ---- fake transports ----
  const outage: Record<string, boolean> = {};
  const counts: Record<string, number> = { direct: 0, alfa: 0, 'leetcode-query': 0 };
  const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true }); });
  const refused = () => Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const rows = (u: string, limit: number) => (data.get(u) ?? []).slice(0, limit);
  const direct = { kind: 'mock' as const, send: async (r: any) => {
    counts.direct++; if (outage.direct) throw refused(); await sleep(LATENCY, r.signal);
    const b = JSON.parse(r.body); const u = b.variables.username;
    const body = data.has(u) ? { data: { recentAcSubmissionList: rows(u, b.variables.limit) } } : { errors: [{ message: 'That user does not exist.' }] };
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  } };
  const alfa = { kind: 'mock' as const, send: async (r: any) => {
    counts.alfa++; if (outage.alfa) throw refused(); await sleep(LATENCY, r.signal);
    const u = decodeURIComponent(new URL(r.url).pathname.split('/')[1]); const lim = Number(new URL(r.url).searchParams.get('limit') ?? 20);
    const list = rows(u, lim).map(({ id: _drop, ...x }) => x); // Alfa does not return ids
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ count: list.length, submission: list }) };
  } };
  const lqClient = { graphql: async (q: any) => { counts['leetcode-query']++; if (outage['leetcode-query']) throw refused(); await sleep(LATENCY); return { data: { recentAcSubmissionList: rows(q.variables.username, q.variables.limit) } }; },
    recent_submissions: async () => [], user: async () => ({ matchedUser: { profile: { aboutMe: '' } } }) };
  const ok = () => ({ authorized: true });
  setProvidersForTests([new DirectProvider(direct, ok, 'load'), new AlfaProvider(alfa, 'https://alfa.load', ok, 'load', 0), new LeetCodeQueryProvider(async () => lqClient as any, ok, 'mock', 'accepted')]);

  const server = createApp().listen(5200, () => console.log(`LOAD_READY uri=${rs.getUri()} pid=${process.pid}`));
  const stop = startLeetcodeSyncJob();
  http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      if (req.url === '/outage') { const j = JSON.parse(b); outage[j.provider] = !!j.on; }
      if (req.url === '/expected') return res.end(JSON.stringify(Object.fromEntries([...data].map(([u, r]) => [u, Math.min(20, r.length)]))));
      res.end(JSON.stringify({ counts, outage }));
    });
  }).listen(5201, '127.0.0.1');
  process.on('SIGTERM', async () => { stop(); server.close(); await mongoose.disconnect(); await rs.stop(); process.exit(0); });
})();
