/**
 * Load test with failover: N students loop (dashboard, chapter, 50% leaderboard, tab-return sync) with 1-3 s think time.
 * Timeline: [0, 30%) normal; [30%, 60%) Direct provider outage (connection refused); [60%, 100%] Direct restored.
 * Mocked transports only. Reports latency, provider request volume, failover/recovery time, queue, memory, DB ops, consistency.
 */
import { spawn, execSync } from 'node:child_process';
import mongoose from 'mongoose';

const N = Number(process.env.LOAD_STUDENTS ?? 200);
const DURATION = Number(process.env.LOAD_SECONDS ?? 90);
const BASE = 'http://127.0.0.1:5200/api/v1'; const CTRL = 'http://127.0.0.1:5201';
const ORIGIN = 'http://localhost:3000';
const ctrl = (path, body) => fetch(CTRL + path, { method: 'POST', body: JSON.stringify(body ?? {}) }).then((r) => r.json());

const srv = spawn('npx', ['tsx', 'tests/load/server.ts'], { env: { ...process.env, LOAD_STUDENTS: String(N) }, stdio: ['ignore', 'pipe', 'pipe'] });
let uri = '', pid = 0, srvErr = '';
await new Promise((res, rej) => {
  srv.stdout.on('data', (d) => { const m = String(d).match(/LOAD_READY uri=(\S+) pid=(\d+)/); if (m) { uri = m[1]; pid = Number(m[2]); res(); } });
  srv.stderr.on('data', (d) => { srvErr += d; });
  srv.on('exit', (c) => rej(new Error(`server exited ${c}: ${srvErr.slice(-800)}`)));
  setTimeout(() => rej(new Error('server start timeout ' + srvErr.slice(-500))), 300_000);
});
await mongoose.connect(uri);
const db = mongoose.connection.db;
const ops = async () => (await db.admin().command({ serverStatus: 1 })).opcounters;
const rss = () => { try { return Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024; } catch { return NaN; } };

const lat = {}; const codes = {}; const outcomes = {}; const phases = { before: [], outage: [], after: [] }; const phaseOutcomes = { before: {}, outage: {}, after: {} };
const rec = (k, ms, st) => { (lat[k] ??= []).push(ms); codes[`${k} ${st}`] = (codes[`${k} ${st}`] ?? 0) + 1; };
async function call(s, k, method, path, body) {
  const h = { origin: ORIGIN, cookie: s.cookie }; if (body) h['content-type'] = 'application/json'; if (method !== 'GET') h['x-csrf-token'] = s.csrf;
  const t = performance.now(); const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null); rec(k, performance.now() - t, r.status); return { status: r.status, j };
}
const login = async (sub, email) => {
  const t = performance.now();
  const r = await fetch(`${BASE}/auth/google`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ idToken: `tok|${sub}|${email}|X` }) });
  const j = await r.json(); rec('POST /auth/google', performance.now() - t, r.status);
  return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: j.csrfToken };
};
const students = [];
for (let i = 0; i < N; i += 50) students.push(...(await Promise.all(Array.from({ length: Math.min(50, N - i) }, (_, k) => login(`s${i + k}`, `s${i + k}@load.test`)))));
const admin = await login('sub-admin', 'admin@example.com');

const ops0 = await ops(); const mem = []; const queue = [];
const t0 = Date.now(); const until = t0 + DURATION * 1000;
const tOut = t0 + DURATION * 300, tBack = t0 + DURATION * 600;
let outageAt = 0, restoredAt = 0;
const memT = setInterval(() => mem.push(rss()), 2000);
const timeline = (async () => {
  await new Promise((r) => setTimeout(r, tOut - Date.now())); await ctrl('/outage', { provider: 'direct', on: true }); outageAt = Date.now();
  await new Promise((r) => setTimeout(r, tBack - Date.now())); await ctrl('/outage', { provider: 'direct', on: false }); restoredAt = Date.now();
})();
const sampler = (async () => {
  while (Date.now() < until) {
    const r = await call(admin, 'GET /leetcode/integration (admin)', 'GET', '/leetcode/integration');
    if (r.j) queue.push({ t: Math.round((Date.now() - t0) / 1000), due: r.j.queue.due, syncing: r.j.queue.syncing, direct: r.j.providers.find((p) => p.id === 'direct')?.status, tokens: r.j.upstream.tokensAvailable });
    await new Promise((r2) => setTimeout(r2, 10_000));
  }
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await Promise.all(students.map(async (s) => {
  await sleep(Math.random() * 3000);
  let bc = null, ch = null;
  while (Date.now() < until) {
    const d = await call(s, 'GET /student/dashboard', 'GET', '/student/dashboard');
    bc ??= d.j?.selected?.batchCourseId; ch ??= d.j?.chapters?.[0]?.chapterId;
    if (bc && ch) await call(s, 'GET /student/chapters/:id', 'GET', `/student/chapters/${ch}?batchCourseId=${bc}`);
    if (bc && Math.random() < 0.5) await call(s, 'GET /student/leaderboard', 'GET', `/student/leaderboard?batchCourseId=${bc}`);
    const ts = performance.now();
    const r = await call(s, 'POST /leetcode/request-sync', 'POST', '/leetcode/request-sync', {});
    const o = r.status === 429 ? 'COOLDOWN(429)' : r.j?.outcome?.status ?? `HTTP ${r.status}`;
    outcomes[o] = (outcomes[o] ?? 0) + 1;
    const ph = !outageAt ? 'before' : !restoredAt ? 'outage' : 'after';
    phaseOutcomes[ph][o] = (phaseOutcomes[ph][o] ?? 0) + 1;
    if (r.status === 200 && r.j?.outcome?.status === 'SYNC_SUCCESS') phases[ph].push(performance.now() - ts);
    await sleep(1000 + Math.random() * 2000);
  }
}));
await timeline; await sampler; clearInterval(memT);
const ops1 = await ops();

// ---- analysis ----
const ev = await db.collection('provider_events').find({}).sort({ at: 1 }).toArray();
const firstAfter = (type, t, pred = () => true) => ev.find((e) => e.type === type && e.at.getTime() >= t && pred(e));
const fo = firstAfter('FAILOVER', outageAt);
const closed = firstAfter('CIRCUIT_CLOSED', restoredAt, (e) => e.provider === 'direct');
const opened = firstAfter('CIRCUIT_OPEN', outageAt, (e) => e.provider === 'direct');
const ps = await db.collection('provider_state').find({}).toArray();
const ctl = await ctrl('/status');
const expected = await ctrl('/expected');
const evidence = await db.collection('solve_evidence').aggregate([{ $group: { _id: '$studentId', n: { $sum: 1 } } }]).toArray();
const userByUid = new Map((await db.collection('users').find({ role: 'STUDENT' }, { projection: { leetcodeUsername: 1, 'sync.lastSuccessAt': 1 } }).toArray()).map((u) => [String(u._id), u]));
let mismatch = 0;
for (const e of evidence) { const u = userByUid.get(String(e._id)); if (expected[u.leetcodeUsername] !== e.n) mismatch++; }
const dup = await db.collection('solve_evidence').aggregate([{ $group: { _id: { s: '$studentId', slug: '$slug', l: '$linkId' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
const synced = [...userByUid.values()].filter((u) => u.sync?.lastSuccessAt).length;
const multiProv = await db.collection('solve_evidence').countDocuments({ 'providers.1': { $exists: true } });
const byProv = Object.fromEntries((await db.collection('solve_evidence').aggregate([{ $unwind: '$providers' }, { $group: { _id: '$providers', n: { $sum: 1 } } }]).toArray()).map((x) => [x._id, x.n]));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

console.log(`\n=== ${N} students, ${DURATION} s, real adapters on fake LeetCode (${process.env.LOAD_PROVIDER_LATENCY_MS ?? 250} ms), Direct outage ${Math.round((outageAt - t0) / 1000)}-${Math.round((restoredAt - t0) / 1000)} s ===`);
console.log('endpoint'.padEnd(34), 'n'.padStart(6), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), 'max'.padStart(7));
for (const [k, a] of Object.entries(lat)) console.log(k.padEnd(34), String(a.length).padStart(6), ...[50, 95, 99].map((p) => `${pct(a, p).toFixed(0)}ms`.padStart(7)), `${Math.max(...a).toFixed(0)}ms`.padStart(7));
const total = Object.entries(lat).filter(([k]) => k !== 'POST /auth/google').reduce((a, [, x]) => a + x.length, 0);
console.log(`throughput: ${(total / DURATION).toFixed(1)} req/s; non-2xx except intended 429: ${Object.entries(codes).filter(([k]) => !/ 2\d\d$| 429$/.test(k)).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
console.log('sync outcomes:', JSON.stringify(outcomes));
for (const ph of ['before', 'outage', 'after']) console.log(`  ${ph.padEnd(7)} successful sync latency p50 ${phases[ph].length ? pct(phases[ph], 50).toFixed(0) : '-'} ms, p95 ${phases[ph].length ? pct(phases[ph], 95).toFixed(0) : '-'} ms (n=${phases[ph].length}); outcomes ${JSON.stringify(phaseOutcomes[ph])}`);
console.log('provider requests (transport level):', JSON.stringify(ctl.counts), `= ${Object.values(ctl.counts).reduce((a, b) => a + b, 0)} total, ${(Object.values(ctl.counts).reduce((a, b) => a + b, 0) / DURATION * 60).toFixed(0)}/min`);
console.log('provider health:', ps.filter((p) => p.kind === 'PROVIDER').map((p) => `${p._id.slice(9)} ok=${p.successes ?? 0} fail=${p.failures ?? 0} ewma=${Math.round(p.latencyEwmaMs ?? 0)}ms`).join(' | '));
console.log(`failover: outage→first FAILOVER ${fo ? fo.at.getTime() - outageAt : 'n/a'} ms; outage→circuit OPEN ${opened ? opened.at.getTime() - outageAt : 'n/a'} ms; restore→circuit CLOSED (Direct preferred again) ${closed ? closed.at.getTime() - restoredAt : 'n/a'} ms`);
console.log(`events: ${JSON.stringify(ev.reduce((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {}))}`);
console.log('queue samples (t s: due / syncing / direct status / shared tokens):', queue.map((q) => `${q.t}:${q.due}/${q.syncing}/${q.direct}/${q.tokens}`).join('  '));
console.log(`evidence: students synced ${synced}/${N}; rows ${evidence.reduce((a, e) => a + e.n, 0)}; students with wrong row count ${mismatch}; duplicate keys ${dup.length}; rows confirmed by >1 provider ${multiProv}; rows by provider ${JSON.stringify(byProv)}`);
const d = Object.fromEntries(Object.keys(ops1).map((k) => [k, ops1[k] - ops0[k]]));
console.log('mongo ops:', JSON.stringify(d), `≈ ${((d.query + d.insert + d.update + d.delete + d.getmore + d.command) / DURATION).toFixed(0)} ops/s`);
console.log(`server RSS MB: start ${mem[0]?.toFixed(0)}, max ${Math.max(...mem).toFixed(0)}, end ${mem.at(-1)?.toFixed(0)}`);
await mongoose.disconnect(); srv.kill('SIGTERM'); process.exit(0);
