/**
 * Browser end-to-end test: real Next.js build + real Express app + replica-set MongoDB, driven by Chromium.
 * The ONLY substitution is Google: (1) the GIS script is replaced by a stub button that returns a test ID token, and
 * (2) the backend's OAuth2Client.verifyIdToken is stubbed (tests/e2e-server.ts). Everything else is production code.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const FE = 'http://localhost:3000';
const SHOTS = '../docs/screenshots';
const results = [];
let failed = 0;
const step = async (name, fn) => {
  const t = Date.now();
  try { await fn(); results.push(`PASS  ${name} (${Date.now() - t} ms)`); }
  catch (e) { failed++; results.push(`FAIL  ${name}: ${String(e.message ?? e).split('\n')[0]}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const tok = (sub, email, name) => `tok|${sub}|${email}|${name}`;

function start(cmd, args, cwd, env, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const on = (d) => { out += d; if (out.includes(ready)) resolve(p); };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('exit', (c) => reject(new Error(`${cmd} exited ${c}: ${out.slice(-500)}`)));
    setTimeout(() => reject(new Error(`timeout starting ${cmd}: ${out.slice(-500)}`)), 90_000);
  });
}

async function persona(browser, idToken) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript((t) => {
    window.__idToken = t;
    window.google = { accounts: { id: {
      initialize: (o) => { window.__gisCb = o.callback; },
      renderButton: (el) => { const b = document.createElement('button'); b.textContent = 'Mock Google sign-in'; b.onclick = () => window.__gisCb({ credential: window.__idToken }); el.appendChild(b); },
    } } };
  }, idToken);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  return { ctx, page };
}
const confirmDialog = (page, name) => page.locator('dialog[open]').getByRole('button', { name, exact: true }).click();
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

const be = await start('npx', ['tsx', 'tests/e2e-server.ts'], '.', { E2E_NODE_ENV: 'test', LOG_IN_TESTS: '1' }, 'listening on :5100');
const fe = await start('npx', ['next', 'start', '-p', '3000'], '../algora-frontend', {}, 'Ready');
const browser = await chromium.launch();
let claimCode = '';
try {
  const ADMIN = tok('sub-admin', 'admin@example.com', 'Ada Admin');
  const TRAINER = tok('sub-trainer', 'rahul@x.com', 'Rahul Sharma');
  const STUDENT = tok('sub-student', 'asha@x.com', 'Asha Rao');
  const admin = await persona(browser, ADMIN);

  await step('Super Admin first login lands on management dashboard', async () => {
    await admin.page.goto(`${FE}/trainer/login`);
    await admin.page.getByRole('button', { name: 'Mock Google sign-in' }).click();
    await admin.page.waitForURL('**/manage/dashboard');
    await admin.page.getByText('Welcome, Ada').waitFor();
    await admin.page.getByText('Automatic LeetCode verification is off').waitFor();
    await shot(admin.page, '01-admin-dashboard');
  });
  await step('Session cookie is HttpOnly, SameSite=Lax, not readable by JS', async () => {
    const c = (await admin.ctx.cookies()).find((x) => x.name === 'algora_session');
    assert(c && c.httpOnly && c.sameSite === 'Lax', JSON.stringify(c));
    assert(!(await admin.page.evaluate(() => document.cookie)).includes('algora_session'), 'cookie visible to JS');
  });
  await step('Super Admin subsequent login in a fresh browser', async () => {
    const again = await persona(browser, ADMIN);
    await again.page.goto(`${FE}/trainer/login`);
    await again.page.getByRole('button', { name: 'Mock Google sign-in' }).click();
    await again.page.waitForURL('**/manage/dashboard');
    await again.ctx.close();
  });
  await step('CSRF: same-origin POST without token is rejected (403); with token from /auth/me it works', async () => {
    const r = await admin.page.evaluate(async () => {
      const no = await fetch('/api/v1/colleges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'CSRF Test' }) });
      const me = await (await fetch('/api/v1/auth/me')).json();
      const yes = await fetch('/api/v1/colleges', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken }, body: JSON.stringify({ name: 'CSRF Test' }) });
      return [no.status, yes.status];
    });
    assert(r[0] === 403 && r[1] === 201, JSON.stringify(r));
  });

  const trainer = await persona(browser, TRAINER);
  await step('Unapproved account on management login gets the access-request form; request becomes pending', async () => {
    await trainer.page.goto(`${FE}/trainer/login`);
    await trainer.page.getByRole('button', { name: 'Mock Google sign-in' }).click();
    await trainer.page.getByText('is not an approved trainer yet').waitFor();
    await trainer.page.getByLabel('Note for the Super Admin (optional)').fill('Java bootcamp trainer');
    await trainer.page.getByRole('button', { name: 'Request access' }).click();
    await trainer.page.getByText('Access request pending').waitFor();
    await trainer.page.goto(`${FE}/manage/dashboard`);
    await trainer.page.waitForURL('**/trainer/login**'); // no session, guarded
  });
  await step('Super Admin approves the trainer in the UI', async () => {
    await admin.page.goto(`${FE}/manage/trainers`);
    await admin.page.getByText('Rahul Sharma').waitFor();
    await admin.page.getByRole('row', { name: /Rahul Sharma/ }).getByRole('button', { name: 'Approve' }).click();
    await confirmDialog(admin.page, 'Approve');
    await admin.page.getByText('Rahul Sharma approved').waitFor();
    await admin.page.getByRole('tab', { name: 'Trainers' }).click();
    await admin.page.getByText('tr_rahulsharma').waitFor();
    await shot(admin.page, '02-trainers');
  });
  await step('Approved trainer signs in; admin-only navigation and APIs are hidden/forbidden', async () => {
    await trainer.page.goto(`${FE}/trainer/login`);
    await trainer.page.getByRole('button', { name: 'Mock Google sign-in' }).click();
    await trainer.page.waitForURL('**/manage/dashboard');
    assert(!(await trainer.page.getByRole('link', { name: 'Trainers' }).count()), 'Trainers link visible to trainer');
    assert(!(await trainer.page.getByRole('link', { name: 'Audit log' }).count()), 'Audit link visible to trainer');
    await trainer.page.goto(`${FE}/manage/audit`);
    await trainer.page.getByRole('alert').filter({ hasText: 'Forbidden' }).waitFor();
  });

  await step('Admin builds a course in the UI: chapters, problems (slug preview, duplicate check), reorder, publish', async () => {
    const p = admin.page;
    await p.goto(`${FE}/manage/courses/new`);
    await p.getByLabel('Title').fill('Java & DSA');
    await p.getByRole('button', { name: 'Create course' }).click();
    await p.waitForURL(/\/manage\/courses\/[a-f0-9]{24}$/);
    for (const t of ['Arrays', 'Strings']) {
      await p.getByRole('button', { name: 'Add chapter' }).click();
      await p.locator('dialog[open]').getByLabel('Title').fill(t);
      await confirmDialog(p, 'Save');
      await p.getByText('Chapter saved').first().waitFor();
      await p.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
    }
    const addProblem = async (chapter, url, title, d) => {
      await p.locator('section', { hasText: chapter }).filter({ has: p.getByRole('button', { name: 'Add problem' }) }).first().getByRole('button', { name: 'Add problem' }).click();
      const dlg = p.locator('dialog[open]');
      await dlg.getByLabel('LeetCode URL').fill(url);
      await dlg.getByLabel('Title').fill(title);
      await dlg.getByLabel('Difficulty').selectOption(d);
      return dlg;
    };
    let dlg = await addProblem('Arrays', 'https://leetcode.com/problems/Two-Sum/description/', 'Two Sum', 'EASY');
    await dlg.getByText('two-sum', { exact: true }).waitFor(); // canonical slug preview
    await confirmDialog(p, 'Save'); await p.getByText('Problem saved').first().waitFor();
    dlg = await addProblem('Arrays', 'https://leetcode.com/problems/two-sum/', 'Dup', 'EASY');
    await dlg.getByText('This problem is already in this chapter').waitFor();
    assert(await dlg.getByRole('button', { name: 'Save' }).isDisabled(), 'duplicate not blocked');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    dlg = await addProblem('Arrays', 'https://leetcode.com/problems/3sum/', '3Sum', 'MEDIUM');
    await confirmDialog(p, 'Save'); await p.getByText('Problem saved').first().waitFor();
    dlg = await addProblem('Strings', 'https://leetcode.com/problems/valid-anagram/', 'Valid Anagram', 'EASY');
    await confirmDialog(p, 'Save'); await p.getByText('Problem saved').first().waitFor();
    await p.getByRole('button', { name: 'Move chapter down' }).first().click();
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Move chapter down' }).first().click(); // move back: Arrays first again
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Publish' }).click();
    await p.getByText('Course published').waitFor();
    await shot(p, '03-course-editor');
  });

  await step('Admin creates a batch with zero courses, assigns the course (chapters hidden), unlocks one chapter', async () => {
    const p = admin.page;
    await p.goto(`${FE}/manage/batches/new`);
    await p.getByLabel('Name').fill('JNTU Bootcamp');
    await p.getByLabel('College (optional)').fill('JNTU Hyderabad');
    await p.getByLabel('Status').selectOption('ACTIVE');
    await p.getByRole('button', { name: 'Create batch' }).click();
    await p.waitForURL(/\/manage\/batches\/[a-f0-9]{24}$/);
    await p.getByText('No courses assigned yet').waitFor();
    await p.getByRole('link', { name: 'Courses', exact: true }).last().click();
    await p.getByLabel('Course to assign').selectOption({ label: 'Java & DSA (2 chapters)' });
    await p.getByRole('button', { name: 'Assign', exact: true }).click();
    await p.getByText('Course assigned').waitFor();
    await p.getByRole('link', { name: 'Chapter visibility' }).click();
    await p.getByText('0 of 2 unlocked').waitFor();
    await p.locator('li', { hasText: 'Arrays' }).locator('label').click();
    await p.getByText('“Arrays” unlocked').waitFor();
    await p.getByText('1 of 2 unlocked').waitFor();
    await shot(p, '04-visibility');
  });

  await step('Trainer cannot open a batch they are not assigned to (404, no data)', async () => {
    const url = admin.page.url().replace('/visibility', '');
    await trainer.page.goto(url);
    await trainer.page.getByRole('alert').filter({ hasText: 'Batch not found' }).waitFor();
  });

  await step('Enroll an unregistered roll number: pending reservation with one-time claim code', async () => {
    const p = admin.page;
    await p.getByRole('link', { name: 'Students', exact: true }).last().click();
    await p.getByLabel('Roll number').fill('ab12cd34ef');
    await p.getByRole('button', { name: 'Enroll', exact: true }).click();
    const code = p.locator('dialog[open] li span.select-all');
    await code.waitFor();
    claimCode = (await code.textContent()).trim();
    assert(claimCode.length >= 10, 'no claim code');
    await shot(p, '05-claim-code');
    await confirmDialog(p, 'Done');
    await p.getByText('Pending enrollments (1)').waitFor();
  });

  const student = await persona(browser, STUDENT);
  await step('Student registration without claim code is refused for the reserved roll number', async () => {
    const p = student.page;
    await p.goto(`${FE}/login`);
    await p.getByRole('button', { name: 'Mock Google sign-in' }).click();
    await p.getByText('Complete your registration').waitFor();
    for (const [l, v] of [['First name', 'Asha'], ['Last name', 'Rao'], ['Roll number', 'AB12CD34EF'], ['College', 'JNTU Hyderabad'], ['Mobile number', '9876543210'], ['LeetCode username', 'asha_rao']]) await p.getByLabel(l, { exact: true }).fill(v);
    await p.getByRole('checkbox', { name: /public accepted submissions/ }).check().catch(() => {});
    await p.getByRole('button', { name: 'Create account' }).click();
    await p.getByText('This roll number is reserved').waitFor();
  });
  await step('Student registers with the claim code and is enrolled automatically', async () => {
    const p = student.page;
    await p.getByLabel('Claim code (optional)').fill(claimCode);
    await p.getByRole('checkbox', { name: /public accepted submissions/ }).check().catch(() => {});
    await p.getByRole('button', { name: 'Create account' }).click();
    await p.waitForURL('**/student/dashboard');
    await p.getByText('Java & DSA · JNTU Bootcamp').waitFor();
    await p.getByText('Automatic LeetCode verification is not available yet').waitFor();
    await p.getByText('Verification unavailable').first().waitFor(); // header badge instead of a sync button
    await p.getByText('waiting for ownership verification').waitFor();
    await shot(p, '06-student-dashboard');
  });
  await step('Student sees only the unlocked chapter; problems open LeetCode in a new tab; hidden chapter URL is refused', async () => {
    const p = student.page;
    await p.getByRole('link', { name: 'Arrays' }).click();
    await p.getByText('0 of 2 verified').waitFor();
    const a = p.getByRole('link', { name: /Two Sum/ });
    assert((await a.getAttribute('target')) === '_blank' && (await a.getAttribute('rel')).includes('noopener'), 'link target');
    assert((await a.getAttribute('href')) === 'https://leetcode.com/problems/two-sum/', 'canonical href');
    await p.getByLabel('Difficulty').selectOption('MEDIUM');
    assert(!(await p.getByRole('link', { name: /Two Sum/ }).count()), 'filter failed');
    await shot(p, '07-chapter');
    const bc = new URL(p.url()).searchParams.get('batchCourseId');
    const hidden = await p.evaluate(async (bc) => {
      const c = await (await fetch('/api/v1/student/courses')).json();
      return { listed: c.items[0].chapters.map((x) => x.title) };
    }, bc);
    assert(JSON.stringify(hidden.listed) === '["Arrays"]', JSON.stringify(hidden));
    const ids = await admin.page.evaluate(async () => (await (await fetch('/api/v1/courses?pageSize=5')).json()).items[0]._id);
    const strings = await admin.page.evaluate(async (id) => (await (await fetch(`/api/v1/courses/${id}`)).json()).chapters.find((c) => c.title === 'Strings')._id, ids);
    await p.goto(`${FE}/student/chapters/${strings}?batchCourseId=${bc}`);
    await p.getByText('This chapter is not available to you.').waitFor();
  });
  await step('Profile: roll number immutable; LeetCode link pending with challenge; Verify disabled while unavailable', async () => {
    const p = student.page;
    await p.goto(`${FE}/student/profile`);
    assert(await p.getByLabel('Roll number').isDisabled(), 'roll editable');
    await p.getByText(/algora-verify-/).waitFor();
    assert(await p.getByRole('button', { name: 'Verify' }).isDisabled(), 'verify enabled');
    await shot(p, '08-profile');
  });
  await step('Leaderboard page explains verification is unavailable', async () => {
    await student.page.goto(`${FE}/student/leaderboard`);
    await student.page.getByText('rankings do not reflect LeetCode activity').waitFor();
    await student.page.getByText('Your position').waitFor();
  });
  await step('Role-based routing: student opening /manage is sent to the student portal', async () => {
    await student.page.goto(`${FE}/manage/dashboard`);
    await student.page.waitForURL('**/student/dashboard');
  });
  await step('Duplicate roll number is rejected for a second Google account', async () => {
    const other = await persona(browser, tok('sub-other', 'other@x.com', 'Other Person'));
    const p = other.page;
    await p.goto(`${FE}/login`);
    await p.getByRole('button', { name: 'Mock Google sign-in' }).click();
    for (const [l, v] of [['First name', 'Other'], ['Last name', 'Person'], ['Roll number', 'AB12CD34EF'], ['College', 'OU'], ['Mobile number', '9876543211'], ['LeetCode username', 'other_lc']]) await p.getByLabel(l, { exact: true }).fill(v);
    await p.getByRole('checkbox', { name: /public accepted submissions/ }).check().catch(() => {});
    await p.getByRole('button', { name: 'Create account' }).click();
    await p.getByText('Roll number already registered').waitFor();
    await other.ctx.close();
  });
  await step('Analytics, reports and leaderboards render for the admin; CSV download works', async () => {
    const p = admin.page;
    await p.goto(`${FE}/manage/analytics`);
    await p.getByText('Students in scope').waitFor();
    await p.getByRole('link', { name: 'Asha Rao' }).waitFor();
    await shot(p, '09-analytics');
    await p.goto(`${FE}/manage/reports`);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('section', { hasText: 'Student report' }).getByRole('button', { name: 'Download CSV' }).click()]);
    const path = await dl.path();
    const fs = await import('node:fs');
    const csv = fs.readFileSync(path, 'utf8');
    assert(csv.startsWith('Roll number,Name') && csv.includes('AB12CD34EF'), csv.slice(0, 200));
    await p.goto(`${FE}/manage/integration`);
    await p.getByText('Automatic verification is disabled').waitFor();
    await p.goto(`${FE}/manage/audit`);
    await p.getByText('trainer_request.approve').first().waitFor();
  });
  await step('Suspending the trainer invalidates their session: next navigation signs them out', async () => {
    const p = admin.page;
    await p.goto(`${FE}/manage/trainers`);
    await p.getByRole('tab', { name: 'Trainers' }).click();
    await p.getByRole('row', { name: /Rahul Sharma/ }).getByRole('button', { name: 'Suspend' }).click();
    await confirmDialog(p, 'Suspend');
    await p.getByText('Trainer suspended').waitFor();
    await trainer.page.goto(`${FE}/manage/batches`);
    await trainer.page.waitForURL('**/trainer/login**');
    const r = await trainer.page.evaluate(async () => (await fetch('/api/v1/auth/me')).status);
    assert(r === 401, `me=${r}`);
  });
  await step('Tampered session cookie is treated as expired', async () => {
    const c = (await student.ctx.cookies()).find((x) => x.name === 'algora_session');
    await student.ctx.addCookies([{ ...c, value: c.value.slice(0, -3) + 'AAA' }]);
    await student.page.goto(`${FE}/student/dashboard`);
    await student.page.waitForURL('**/login**');
  });
  await step('Logout clears the session', async () => {
    const p = admin.page;
    await p.goto(`${FE}/manage/dashboard`);
    await p.getByRole('button', { name: 'Sign out' }).click();
    await p.waitForURL('**/trainer/login');
    assert((await p.evaluate(async () => (await fetch('/api/v1/auth/me')).status)) === 401, 'still signed in');
  });
  await step('Mobile layout: management sidebar collapses behind a menu button', async () => {
    const m = await persona(browser, ADMIN);
    await m.page.setViewportSize({ width: 390, height: 844 });
    await m.page.goto(`${FE}/trainer/login`);
    await m.page.getByRole('button', { name: 'Mock Google sign-in' }).click();
    await m.page.waitForURL('**/manage/dashboard');
    await m.page.getByRole('button', { name: 'Open navigation' }).click();
    await m.page.getByRole('link', { name: 'Batches' }).last().click();
    await m.page.waitForURL('**/manage/batches');
    await shot(m.page, '10-mobile');
    await m.ctx.close();
  });
} finally {
  await browser.close();
  be.kill(); fe.kill();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
