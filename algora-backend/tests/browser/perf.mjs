/**
 * Production-build performance probe. Real Next.js build + real Express app + disposable MongoDB.
 * Google is stubbed by tests/e2e-server.ts; no request reaches Google or LeetCode.
 * Rate limiters stay enabled in development mode, unlike the functional browser suites.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const FE = 'http://localhost:3000';
const BE = 'http://127.0.0.1:5100';
const ORIGIN = 'http://localhost:3000';
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };

function start(cmd, args, cwd, env, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const on = (d) => { out += d; if (out.includes(ready)) resolve(p); };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('exit', (c) => reject(new Error(`exit ${c}: ${out.slice(-500)}`)));
    setTimeout(() => reject(new Error(`timeout starting ${cmd}: ${out.slice(-500)}`)), 120_000);
  });
}
async function persona(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript((t) => {
    window.__t = t;
    window.google = { accounts: { id: {
      initialize: (o) => { window.__cb = o.callback; },
      renderButton: (el) => { const b = document.createElement('button'); b.textContent = 'Mock Google sign-in'; b.onclick = () => window.__cb({ credential: window.__t }); el.appendChild(b); },
    } } };
  }, token);
  const page = await ctx.newPage(); page.setDefaultTimeout(20_000);
  return { ctx, page };
}
const apiAs = (page, method, path, body) => page.evaluate(async ([method, path, body]) => {
  const me = await (await fetch('/api/v1/auth/me')).json();
  const r = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [method, path, body]);
const pick = async (page, label, query, option) => {
  const box = page.getByRole('combobox', { name: label }); await box.click(); await box.fill(query);
  await page.getByRole('option', { name: option }).first().click();
};

const be = await start('npx', ['tsx', 'tests/e2e-server.ts'], '.', { E2E_NODE_ENV: 'development', LOG_IN_TESTS: '0' }, 'listening on :5100');
const fe = await start('npx', ['next', 'start', '-p', '3000'], '../algora-frontend', {}, 'Ready');
const browser = await chromium.launch();
try {
  const admin = await persona(browser, 'tok|sub-admin|admin@example.com|Ada Admin');
  await admin.page.goto(`${FE}/trainer/login`);
  await admin.page.getByRole('button', { name: 'Mock Google sign-in' }).click();
  await admin.page.waitForURL('**/manage/dashboard');

  const college = (await apiAs(admin.page, 'POST', '/colleges', { name: 'Ace Engineering College', code: 'ACEEC', aliases: ['ACE'] })).body;
  const course = (await apiAs(admin.page, 'POST', '/courses', { title: 'DSA Foundations' })).body;
  const chapter = (await apiAs(admin.page, 'POST', `/courses/${course._id}/chapters`, { title: 'Arrays' })).body;
  await apiAs(admin.page, 'POST', `/chapters/${chapter._id}/problems`, { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'EASY' });
  await apiAs(admin.page, 'PATCH', `/courses/${course._id}`, { status: 'PUBLISHED' });
  const batch = (await apiAs(admin.page, 'POST', '/batches', { name: 'ACE Batch', status: 'ACTIVE', collegeId: college._id })).body;
  await apiAs(admin.page, 'POST', `/batches/${batch._id}/courses`, { courseId: course._id });
  await apiAs(admin.page, 'POST', `/batches/${batch._id}/chapter-access/bulk`, { courseId: course._id, all: true, isVisible: true });

  // Authentication latency, measured against the real API with limiters active.
  const authMs = [];
  for (let i = 0; i < 10; i++) {
    const t = performance.now();
    const r = await fetch(`${BE}/api/v1/auth/google`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ idToken: 'tok|sub-admin|admin@example.com|Ada Admin' }) });
    assert(r.status === 200, `auth status ${r.status}`);
    authMs.push(performance.now() - t);
  }

  const student = await persona(browser, 'tok|sub-student|asha@x.com|Asha Rao');
  const p = student.page;
  await p.goto(`${FE}/login`);
  const signIn = p.getByRole('button', { name: 'Mock Google sign-in' });
  await signIn.waitFor();
  const tSignIn = Date.now();
  await signIn.click();
  await p.getByRole('heading', { name: 'Create your account' }).waitFor();
  const registrationFormMs = Date.now() - tSignIn;
  for (const [label, value] of [['First name', 'Asha'], ['Last name', 'Rao'], ['Roll number', 'AB12CD34EF'], ['Mobile number', '9876543210'], ['LeetCode username', 'asha_rao']]) await p.getByLabel(label, { exact: true }).fill(value);
  await pick(p, 'College', 'ACE', /Ace Engineering College/);
  await p.getByRole('checkbox', { name: /public accepted submissions/ }).check();

  const requests = []; const statuses = [];
  const onRequest = (r) => { if (r.url().includes('/api/v1/')) requests.push(new URL(r.url()).pathname); };
  const onResponse = (r) => { if (r.url().includes('/api/v1/')) statuses.push(r.status()); };
  p.on('request', onRequest); p.on('response', onResponse);
  const tSubmit = Date.now();
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.waitForURL('**/student/dashboard');
  await p.getByRole('heading', { level: 1 }).waitFor();
  const registrationSubmitMs = Date.now() - tSubmit;
  p.off('request', onRequest); p.off('response', onResponse);

  await apiAs(admin.page, 'POST', `/batches/${batch._id}/enrollments`, { rollNumber: 'AB12CD34EF' });

  async function measure(name, path, ready) {
    const paths = []; const codes = [];
    const req = (r) => { if (r.url().includes('/api/v1/')) paths.push(new URL(r.url()).pathname); };
    const res = (r) => { if (r.url().includes('/api/v1/')) codes.push(r.status()); };
    p.on('request', req); p.on('response', res);
    const t = Date.now();
    await p.goto(`${FE}${path}`);
    await ready();
    const ms = Date.now() - t;
    await p.waitForTimeout(500);
    p.off('request', req); p.off('response', res);
    const duplicates = paths.length - new Set(paths).size;
    results.push({ page: name, ms, requests: paths.length, duplicates, counts: Object.fromEntries([...new Set(paths)].map((x) => [x, paths.filter((y) => y === x).length])), errors: codes.filter((c) => c >= 400) });
    assert(codes.every((c) => c < 400), `${name} returned ${codes.filter((c) => c >= 400)}`);
    assert(paths.length <= 10, `${name} requested ${paths.length} APIs`);
    assert(duplicates === 0, `${name} repeated ${duplicates} requests`);
  }

  await measure('Home', '/student/dashboard', () => p.getByText('Batch rank').waitFor());
  await measure('My Learning', '/student/courses', () => p.getByText('DSA Foundations').first().waitFor());
  await measure('Progress', '/student/progress', () => p.getByRole('heading', { level: 1 }).waitFor());
  await measure('Leaderboard', '/student/leaderboard', () => p.getByText(/Your position/).first().waitFor());
  await measure('Profile', '/student/profile', () => p.getByText('Personal information', { exact: true }).waitFor());

  // Client navigation from Home to My Learning.
  await p.goto(`${FE}/student/dashboard`); await p.getByText('Batch rank').waitFor();
  const navPaths = [];
  const navReq = (r) => { if (r.url().includes('/api/v1/')) navPaths.push(new URL(r.url()).pathname); };
  p.on('request', navReq);
  const tNav = Date.now();
  await p.getByRole('link', { name: 'My Learning' }).first().click();
  await p.waitForURL('**/student/courses');
  await p.getByText('DSA Foundations').first().waitFor();
  const navMs = Date.now() - tNav;
  await p.waitForTimeout(300);
  p.off('request', navReq);

  // Idle polling: from a loaded dashboard, wait past the 60 s idle interval.
  await p.goto(`${FE}/student/dashboard`); await p.getByText('Batch rank').waitFor();
  const idleReads = [];
  const idleReq = (r) => { if (r.url().includes('/api/v1/leetcode/sync-status')) idleReads.push(Date.now()); };
  p.on('request', idleReq);
  await p.waitForTimeout(65_000);
  p.off('request', idleReq);

  results.push({ page: 'Client nav Home→My Learning', ms: navMs, requests: navPaths.length, duplicates: navPaths.length - new Set(navPaths).size });
  results.push({ page: 'Registration form ready', ms: registrationFormMs });
  results.push({ page: 'Registration submit → dashboard', ms: registrationSubmitMs });
  results.push({ page: 'Idle sync-status reads in 65 s', ms: null, requests: idleReads.length });
  const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))]; };
  results.push({ page: 'Authentication POST /auth/google', ms: Math.round(pct(authMs, 50) * 10) / 10, p95: Math.round(pct(authMs, 95) * 10) / 10, requests: authMs.length });

  console.log(JSON.stringify(results, null, 2));
  assert(idleReads.length <= 2, `idle polling ran ${idleReads.length} times in 65 s`);
  console.log('PERF OK');
} finally {
  await browser.close(); be.kill(); fe.kill();
}
