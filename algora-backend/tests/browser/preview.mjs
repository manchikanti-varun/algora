/**
 * Seeded local preview (disposable data). Google is stubbed by tests/e2e-server.ts; LeetCode uses the mock provider.
 * Usage: node tests/browser/preview.mjs   (from algora-backend; requires a built frontend)
 */
import { spawn } from 'node:child_process';

const FE = 'http://localhost:3000';
const BE = 'http://127.0.0.1:5100';
const ORIGIN = 'http://localhost:3000';
const children = [];
function start(cmd, args, cwd, env, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(p);
    let out = '';
    const on = (d) => { out += d; if (out.includes(ready)) resolve(p); };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('exit', (c) => reject(new Error(`${cmd} exited ${c}: ${out.slice(-400)}`)));
  });
}
const stop = () => { for (const p of children) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

const tok = (sub, email, name) => `tok|${sub}|${email}|${name}`;
let cookie = ''; let csrf = '';
async function api(method, path, body, token) {
  const headers = { origin: ORIGIN, 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  const r = await fetch(BE + '/api/v1' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  if (json?.csrfToken) csrf = json.csrfToken;
  return { status: r.status, body: json };
}
async function login(token) {
  cookie = ''; csrf = '';
  const r = await api('POST', '/auth/google', { idToken: token });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
  return r;
}

await start('npx', ['tsx', 'tests/e2e-server.ts'], '.', { E2E_NODE_ENV: 'development', E2E_MOCK: '1', LOG_IN_TESTS: '0' }, 'listening on :5100');
await start('npx', ['next', 'start', '-p', '3000'], '../algora-frontend', {}, 'Ready');

await login(tok('sub-admin', 'admin@example.com', 'Ada Admin'));
const college = (await api('POST', '/colleges', { name: 'Ace Engineering College', code: 'ACEEC', aliases: ['ACE'] })).body;
const course = (await api('POST', '/courses', { title: 'DSA Foundations' })).body;
const chapter = (await api('POST', `/courses/${course._id}/chapters`, { title: 'Arrays' })).body;
await api('POST', `/chapters/${chapter._id}/problems`, { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'EASY' });
await api('POST', `/chapters/${chapter._id}/problems`, { title: 'Container With Most Water', url: 'https://leetcode.com/problems/container-with-most-water/', difficulty: 'MEDIUM' });
await api('PATCH', `/courses/${course._id}`, { status: 'PUBLISHED' });
const batch = (await api('POST', '/batches', { name: 'ACE Batch', status: 'ACTIVE', collegeId: college._id })).body;
await api('POST', `/batches/${batch._id}/courses`, { courseId: course._id });
await api('POST', `/batches/${batch._id}/chapter-access/bulk`, { courseId: course._id, all: true, isVisible: true });

// Trainer access request, approval, and assignment.
await login(tok('sub-trainer', 'rahul@x.com', 'Rahul Sharma'));
const req = await api('POST', '/trainer-requests', { idToken: tok('sub-trainer', 'rahul@x.com', 'Rahul Sharma'), fullName: 'Rahul Sharma' });
await login(tok('sub-admin', 'admin@example.com', 'Ada Admin'));
const pending = (await api('GET', '/trainer-requests?status=PENDING_APPROVAL')).body.items;
if (pending[0]) await api('PATCH', `/trainer-requests/${pending[0]._id}/approve`);
const trainer = (await api('GET', '/trainers')).body.items.find((t) => t.trainerId === 'tr_rahulsharma');
if (trainer) await api('POST', `/batches/${batch._id}/trainers`, { trainerId: trainer._id });

// Student registration with the canonical college selector, then enrollment.
await login(tok('sub-student', 'asha@x.com', 'Asha Rao'));
const reg = await api('POST', '/auth/register/student', {
  idToken: tok('sub-student', 'asha@x.com', 'Asha Rao'), firstName: 'Asha', lastName: 'Rao', rollNumber: 'AB12CD34EF',
  collegeId: college._id, mobile: '9876543210', leetcodeUsername: 'asha_rao', leetcodeConsent: true,
});
if (reg.status !== 201) console.log('Student registration:', reg.status, JSON.stringify(reg.body));
await login(tok('sub-admin', 'admin@example.com', 'Ada Admin'));
await api('POST', `/batches/${batch._id}/enrollments`, { rollNumber: 'AB12CD34EF' });

console.log(`\nAlgora local preview (seeded, disposable data)\n`);
console.log(`  Student      ${FE}/login            Google identity: asha@x.com`);
console.log(`  Trainer      ${FE}/trainer/login    Google identity: rahul@x.com`);
console.log(`  Super Admin  ${FE}/trainer/login    Google identity: admin@example.com`);
console.log(`\n  Click "Mock Google sign-in" (Google verification is stubbed locally).`);
console.log(`  LeetCode uses the local mock provider; no external provider is contacted.`);
console.log(`  Backend ${BE} · frontend ${FE}\n`);
