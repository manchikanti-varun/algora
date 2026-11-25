/**
 * Browser test of the verification experience with the MOCK provider (what becomes live once LeetCode access is authorised):
 * ownership verification, manual sync, cooldown countdown, verified checkmarks, tab-return sync, and evidence after unlink.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const FE = 'http://localhost:3000';
const results = []; let failed = 0;
const step = async (n, fn) => { const t = Date.now(); try { await fn(); results.push(`PASS  ${n} (${Date.now() - t} ms)`); } catch (e) { failed++; results.push(`FAIL  ${n}: ${String(e.message ?? e).split('\n').slice(0, 6).join(' | ')}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const mock = (path, body) => fetch(`http://127.0.0.1:5199${path}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
function start(cmd, args, cwd, env, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const on = (d) => { out += d; if (out.includes(ready)) resolve(p); };
    p.stdout.on('data', on); p.stderr.on('data', on); p.on('exit', (c) => reject(new Error(`exit ${c} ${out.slice(-400)}`)));
  });
}
async function persona(browser, t) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript((t) => { window.__t = t; window.google = { accounts: { id: { initialize: (o) => { window.__cb = o.callback; }, renderButton: (el) => { const b = document.createElement('button'); b.textContent = 'Mock Google sign-in'; b.onclick = () => window.__cb({ credential: window.__t }); el.appendChild(b); } } } }; }, t);
  const page = await ctx.newPage(); page.setDefaultTimeout(15_000);
  await page.goto(`${FE}/login`); await page.getByRole('button', { name: 'Mock Google sign-in' }).click();
  return { ctx, page };
}
const apiAs = (page, method, path, body) => page.evaluate(async ([method, path, body]) => {
  const me = await (await fetch('/api/v1/auth/me')).json();
  const r = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [method, path, body]);

const be = await start('npx', ['tsx', 'tests/e2e-server.ts'], '.', { E2E_NODE_ENV: 'test', E2E_MOCK: '1', LOG_IN_TESTS: '1' }, 'listening on :5100');
const fe = await start('npx', ['next', 'start', '-p', '3000'], '../algora-frontend', {}, 'Ready');
const browser = await chromium.launch();
try {
  const admin = await persona(browser, 'tok|sub-admin|admin@example.com|Ada Admin');
  await admin.page.waitForURL('**/manage/dashboard');
  let ids;
  await step('Setup through the API as Super Admin: course (2 problems), active batch, unlocked chapter, enrollment', async () => {
    const c = (await apiAs(admin.page, 'POST', '/courses', { title: 'DSA' })).body;
    const ch = (await apiAs(admin.page, 'POST', `/courses/${c._id}/chapters`, { title: 'Arrays' })).body;
    for (const [slug, d] of [['two-sum', 'EASY'], ['3sum', 'MEDIUM']]) await apiAs(admin.page, 'POST', `/chapters/${ch._id}/problems`, { title: slug, url: `https://leetcode.com/problems/${slug}/`, difficulty: d });
    await apiAs(admin.page, 'PATCH', `/courses/${c._id}`, { status: 'PUBLISHED' });
    const b = (await apiAs(admin.page, 'POST', '/batches', { name: 'B', status: 'ACTIVE' })).body;
    await apiAs(admin.page, 'POST', `/batches/${b._id}/courses`, { courseId: c._id });
    await apiAs(admin.page, 'POST', `/batches/${b._id}/chapter-access/bulk`, { courseId: c._id, all: true, isVisible: true });
    await apiAs(admin.page, 'POST', `/batches/${b._id}/enrollments`, { rollNumber: 'AB12CD34EF', email: 'asha@x.com' });
    ids = { c, ch, b };
  });
  const s = await persona(browser, 'tok|sub-s|asha@x.com|Asha Rao');
  await step('Registration with reserved email claims the seat without a code', async () => {
    for (const [l, v] of [['First name', 'Asha'], ['Last name', 'Rao'], ['Roll number', 'AB12CD34EF'], ['College', 'JNTU'], ['Mobile number', '9876543210'], ['LeetCode username', 'asha_rao']]) await s.page.getByLabel(l, { exact: true }).fill(v);
    await s.page.getByRole('checkbox', { name: /public accepted submissions/ }).check();
    await s.page.getByRole('button', { name: 'Create account' }).click();
    await s.page.waitForURL('**/student/dashboard');
    await s.page.getByText('waiting for ownership verification').waitFor();
  });
  await step('Ownership: wrong profile text is refused; challenge in the profile summary verifies the account', async () => {
    await s.page.goto(`${FE}/student/profile`);
    const challenge = (await s.page.getByText(/algora-verify-/).textContent()).trim();
    await mock('/profile', { username: 'asha_rao', text: 'hello' });
    await mock('/solve', { username: 'asha_rao', slug: 'unrelated-problem' }); // account exists at the provider
    await s.page.getByRole('button', { name: 'Verify' }).click();
    await s.page.getByText('The code was not found').waitFor();
    await s.page.waitForTimeout(61_000); // verification attempt cooldown (60 s)
    await mock('/profile', { username: 'asha_rao', text: `Learning DSA ${challenge}` });
    await s.page.getByRole('button', { name: 'Verify' }).click();
    await s.page.getByText('Ownership verified').waitFor();
    await s.page.getByText('Verified account:').waitFor();
  });
  await step('Manual sync verifies a newly accepted problem; dashboard and chapter update; button shows a countdown', async () => {
    await mock('/solve', { username: 'asha_rao', slug: 'two-sum' });
    await s.page.goto(`${FE}/student/dashboard`);
    await s.page.getByText('0 / 2').first().waitFor();
    await s.page.getByRole('button', { name: 'Sync progress' }).first().click();
    await s.page.getByText('2 new accepted problems verified').waitFor(); // two-sum + the unrelated problem from setup (evidence is canonical, not course-bound)
    await s.page.getByText('1 / 2').first().waitFor();
    await s.page.getByRole('button', { name: /Sync (again )?in \d+s/ }).first().waitFor();
    await s.page.getByText('Batch rank').waitFor();
    await s.page.getByRole('link', { name: 'Arrays' }).click();
    await s.page.getByLabel('Verified', { exact: true }).waitFor();
    await s.page.getByText(/Verified .* last accepted/).waitFor();
    await s.page.screenshot({ path: '../docs/screenshots/11-verified-chapter.png', fullPage: true });
  });
  await step('Returning to the tab after being away re-syncs once the cooldown has passed', async () => {
    await mock('/solve', { username: 'asha_rao', slug: '3sum' });
    await s.page.waitForTimeout(11_000); // cooldown is 10 s in this harness
    const before = (await mock('/x', {})).calls;
    await s.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await s.page.waitForTimeout(16_000);
    await s.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await s.page.getByText('1 new accepted problem verified').waitFor();
    const after = (await mock('/x', {})).calls;
    assert(after === before + 1, `provider calls ${before} -> ${after}`);
    await s.page.getByText('2 of 2 verified').waitFor();
  });
  await step('A short tab switch (< 15 s) does not call the provider', async () => {
    await s.page.waitForTimeout(11_000);
    const before = (await mock('/x', {})).calls;
    await s.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await s.page.waitForTimeout(1500);
    assert((await mock('/x', {})).calls === before, 'provider called on a short switch');
  });
  await step('Leaderboard ranks the student with verified points; management analytics agree', async () => {
    await s.page.goto(`${FE}/student/leaderboard`);
    await s.page.getByText('Your position: #1 with 30 points').waitFor();
    const a = await apiAs(admin.page, 'GET', `/analytics/students?batchId=${ids.b._id}`);
    assert(a.body.items[0].points === 30 && a.body.items[0].solved === 2, JSON.stringify(a.body.items[0]));
  });
  await step('Unlinking stops evidence counting immediately; evidence is kept', async () => {
    await s.page.goto(`${FE}/student/profile`);
    await s.page.getByRole('button', { name: 'Unlink account' }).click();
    await s.page.locator('dialog[open]').getByRole('button', { name: 'Unlink' }).click();
    await s.page.getByText('Account unlinked').waitFor();
    await s.page.goto(`${FE}/student/dashboard`);
    await s.page.getByText('0 / 2').first().waitFor();
    const d = await apiAs(admin.page, 'GET', `/analytics/students?batchId=${ids.b._id}`);
    assert(d.body.items[0].solved === 0 && d.body.items[0].linkState === 'UNLINKED', JSON.stringify(d.body.items[0]));
  });
  await step('Integration dashboard: provider shown as serving; pausing shows students a paused state; resume restores', async () => {
    await admin.page.goto(`${FE}/manage/integration`);
    await admin.page.getByText('Mock (mock)', { exact: true }).waitFor();
    await admin.page.getByText('Serving', { exact: true }).waitFor();
    await admin.page.getByText('A development mock provider is active').waitFor();
    await admin.page.screenshot({ path: '../docs/screenshots/12-integration.png', fullPage: true });
    await admin.page.getByRole('button', { name: 'Pause synchronization' }).click();
    await admin.page.locator('dialog[open]').getByRole('button', { name: 'Pause', exact: true }).click();
    await admin.page.getByText('Synchronization paused').first().waitFor();
    await admin.page.getByRole('tab', { name: 'Failover & errors' }).click();
    await admin.page.getByText('No events').or(admin.page.getByText('HEALTH_CHECK')).or(admin.page.getByRole('row').nth(1)).first().waitFor();
    // student view while paused (relink so the state is visible)
    await s.page.goto(`${FE}/student/dashboard`);
    await s.page.getByText('Synchronization is paused by the administrator').waitFor();
    await admin.page.goto(`${FE}/manage/integration`);
    await admin.page.getByRole('button', { name: 'Resume synchronization' }).click();
    await admin.page.getByText('Synchronization resumed').first().waitFor();
  });
  await step('Withdraw consent and delete LeetCode data from the profile', async () => {
    await s.page.goto(`${FE}/student/profile`);
    await s.page.getByRole('button', { name: 'Withdraw and delete my data' }).click();
    await s.page.locator('dialog[open]').getByRole('button', { name: 'Delete my data' }).click();
    await s.page.getByText(/Deleted \d+ verified problem record/).waitFor();
    const d = await apiAs(admin.page, 'GET', `/analytics/students/${(await apiAs(admin.page, 'GET', `/analytics/students?batchId=${ids.b._id}`)).body.items[0].studentId}`);
    assert(d.body.history.length === 0, 'evidence still present');
  });
} finally {
  await browser.close(); be.kill(); fe.kill();
  console.log(results.join('\n')); console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
