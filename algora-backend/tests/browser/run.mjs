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
  catch (e) { failed++; results.push(`FAIL  ${name}: ${String(e.message ?? e)}`); }
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
// Screenshots are opt-in (E2E_SCREENSHOTS=1) so routine test runs never produce new image files.
const shot = (page, n) => (process.env.E2E_SCREENSHOTS === '1' ? page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }) : Promise.resolve());
const menu = async (scope, page, menuLabel, item) => { await scope.getByRole('button', { name: menuLabel }).first().click(); await page.getByRole('menuitem', { name: item }).click(); };
const signOut = (page) => menu(page, page, 'Account menu', 'Sign out');
const pickOption = async (page, label, query, option) => { const box = page.getByRole('combobox', { name: label }); await box.click(); await box.fill(query); await page.getByRole('option', { name: option }).click(); };
const noOverflow = async (page, what) => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${what} overflows horizontally`);
const MOBILE = { width: 375, height: 812 };

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
    await admin.page.getByRole('heading', { name: 'Overview', level: 1 }).waitFor();
    await admin.page.getByText('Welcome, Ada', { exact: false }).waitFor();
    await admin.page.getByText('Progress updates are off, so progress will not change').waitFor(); // integration issue on the Overview
    assert((await admin.page.title()) === 'Overview · Algora', `title=${await admin.page.title()}`);
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
  await step('Usability: the Super Admin sees the pending approval on the Overview and reaches it in one click', async () => {
    const p = admin.page;
    await p.goto(`${FE}/manage/dashboard`);
    const row = p.getByRole('listitem').filter({ hasText: 'Trainer requests are waiting for approval' });
    await row.waitFor();
    await row.getByRole('link', { name: 'Review' }).click();
    await p.waitForURL('**/manage/trainers');
    await p.getByRole('tab', { name: /Access requests/ }).waitFor();
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
    assert(!(await trainer.page.getByRole('link', { name: 'Audit Logs' }).count()), 'Audit link visible to trainer');
    assert(!(await trainer.page.getByRole('link', { name: 'Integrations' }).count()), 'Integrations link visible to trainer');
    await trainer.page.getByText('Progress updates are off').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
    assert(!(await trainer.page.getByText('System health').count()), 'system health shown to a trainer');
    await trainer.page.goto(`${FE}/manage/audit`);
    await trainer.page.getByText('This page is not available').waitFor();
  });

  await step('Admin builds a course in the UI: chapters, problems (slug preview, duplicate check), reorder, publish', async () => {
    const p = admin.page;
    await p.goto(`${FE}/manage/courses/new`);
    await p.getByLabel('Title').fill('Java & DSA');
    await p.getByRole('button', { name: 'Create course' }).click();
    await p.waitForURL(/\/manage\/courses\/[a-f0-9]{24}$/);
    for (const t of ['Arrays', 'Strings']) {
      await p.getByRole('button', { name: 'Add chapter' }).first().click();
      await p.locator('dialog[open]').getByLabel('Title', { exact: true }).fill(t);
      await confirmDialog(p, 'Save');
      await p.getByText('Chapter saved').first().waitFor();
      await p.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
    }
    const addProblem = async (chapter, url, title, d) => {
      await p.locator('section', { hasText: chapter }).filter({ has: p.getByRole('button', { name: 'Add problems', exact: true }) }).first().getByRole('button', { name: 'Add problems', exact: true }).click();
      await p.locator('dialog[open]').getByRole('tab', { name: 'Enter manually' }).click();
      const dlg = p.locator('dialog[open] form').filter({ has: p.getByLabel('LeetCode URL') }); // the manual-entry form inside the tab
      await dlg.getByLabel('LeetCode URL').fill(url);
      await dlg.getByLabel('Title').fill(title);
      await dlg.getByLabel('Difficulty').selectOption(d);
      return dlg;
    };
    const close = () => p.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).first().click();
    // dlg below is the manual form; Save is its submit button
    let dlg = await addProblem('Arrays', 'https://leetcode.com/problems/Two-Sum/description/', 'Two Sum', 'EASY');
    await dlg.getByText('two-sum', { exact: true }).waitFor(); // canonical slug preview
    await confirmDialog(p, 'Save'); await p.getByText('Problem saved').first().waitFor();
    // the form stays open for the next problem: a duplicate in the same chapter is blocked
    await dlg.getByLabel('LeetCode URL').fill('https://leetcode.com/problems/two-sum/');
    await dlg.getByLabel('Title').fill('Dup');
    await dlg.getByText('This problem is already in this chapter').waitFor();
    assert(await dlg.getByRole('button', { name: 'Save', exact: true }).isDisabled(), 'duplicate not blocked');
    await dlg.getByLabel('LeetCode URL').fill('https://leetcode.com/problems/3sum/');
    await dlg.getByLabel('Title').fill('3Sum'); await dlg.getByLabel('Difficulty').selectOption('MEDIUM');
    await confirmDialog(p, 'Save'); await p.getByText('Problem saved').first().waitFor();
    await close();
    dlg = await addProblem('Strings', 'https://leetcode.com/problems/valid-anagram/', 'Valid Anagram', 'EASY');
    await confirmDialog(p, 'Save'); await p.getByText('Problem saved').first().waitFor();
    await close();
    await p.getByRole('button', { name: 'Move chapter down' }).first().click();
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Move chapter down' }).first().click(); // move back: Arrays first again
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Publish' }).click();
    await p.getByText('Course published').waitFor();
    await shot(p, '03-course-editor');
  });

  await step('Problem Library imports CSV, looks up an exact number, and bulk assigns in order', async () => {
    const p = admin.page;
    const course = p.url();
    await p.getByRole('link', { name: 'Problem Library' }).click();
    await p.getByRole('button', { name: 'Import metadata' }).click();
    const dialog = p.locator('dialog[open]');
    await dialog.getByLabel('Source and access reference').fill('Test fixture');
    await dialog.getByLabel('Choose or drop a CSV or JSON file').setInputFiles({
      name: 'fixture.csv', mimeType: 'text/csv',
      buffer: Buffer.from([
        'problemNumber,title,slug,difficulty,url,topics,isPremium',
        '704,Binary Search,binary-search,Easy,https://leetcode.com/problems/binary-search/,Binary Search,false',
        '20,Valid Parentheses,valid-parentheses,Easy,https://leetcode.com/problems/valid-parentheses/,Stack,false',
        '121,Best Time to Buy and Sell Stock,best-time-to-buy-and-sell-stock,Easy,https://leetcode.com/problems/best-time-to-buy-and-sell-stock/,Array,false',
      ].join('\n')),
    });
    await dialog.getByRole('button', { name: 'Preview import' }).click();
    await dialog.getByText('Preview · 3 insert').waitFor();
    await dialog.getByRole('button', { name: 'Apply import' }).click();
    await dialog.getByText('Import results · 3 insert').waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await p.getByText('3 catalog entries · 3 with problem numbers').waitFor();
    await p.getByText('Course published', { exact: true }).waitFor({ state: 'hidden' });
    await shot(p, '13-problem-library');
    for (const width of [375, 768, 1024, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `catalog spills at ${width}px`);
      if (width === 375) await shot(p, '13-problem-library-mobile');
    }
    await p.setViewportSize({ width: 1360, height: 900 });

    await p.goto(course);
    await p.locator('section', { hasText: 'Strings' }).getByRole('button', { name: 'Add problems', exact: true }).click();
    const search = dialog.getByLabel('Problem number, title, slug or URL');
    await search.fill('704');
    await dialog.getByRole('button', { name: 'Add Binary Search' }).waitFor();
    await shot(p, '14-add-problems');
    await p.setViewportSize({ width: 375, height: 800 });
    await shot(p, '14-add-problems-mobile');
    await p.setViewportSize({ width: 1360, height: 900 });
    const assignment = p.waitForResponse((response) => response.url().includes('/problem-library/chapters/') && response.request().method() === 'POST');
    await search.press('Enter');
    const response = await assignment;
    const outcome = await response.json();
    assert(outcome.added === 1, JSON.stringify(outcome));
    await dialog.getByText('Already added').waitFor();
    await dialog.getByRole('tab', { name: 'Paste list' }).click();
    await dialog.getByLabel('Problem identifiers').fill('121, 20, 121');
    await dialog.getByRole('button', { name: 'Preview matches' }).click();
    await dialog.getByText('duplicate', { exact: true }).waitFor();
    await shot(p, '15-bulk-add');
    await dialog.getByRole('button', { name: 'Add 2 problems to chapter' }).click();
    await p.getByText('2 added · 0 already assigned').waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    const titles = await p.locator('section', { hasText: 'Strings' }).locator('li > a').allTextContents();
    assert(titles.slice(-3).join('|') === 'Binary Search|Best Time to Buy and Sell Stock|Valid Parentheses', 'catalog assignment order changed');
    const strings = p.locator('section').filter({ has: p.getByRole('heading', { name: /Strings/ }) });
    const arrays = p.locator('section').filter({ has: p.getByRole('heading', { name: /Arrays/ }) });
    await strings.getByRole('checkbox', { name: 'Select Binary Search' }).check();
    await strings.getByLabel('Action', { exact: true }).selectOption('copy');
    await strings.getByLabel('Destination chapter').selectOption({ label: 'Arrays' });
    await strings.getByRole('button', { name: 'Apply' }).click();
    await arrays.getByRole('link', { name: 'Binary Search' }).waitFor();

    const exported = p.waitForEvent('download');
    await menu(arrays, p, 'Chapter actions', 'Export problems');
    const file = await exported;
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    assert(Buffer.concat(chunks).toString().includes('Binary Search,EASY,binary-search'), 'chapter export did not include the copied problem');

    await arrays.getByRole('checkbox', { name: 'Select Binary Search' }).check();
    await arrays.getByRole('button', { name: 'Apply' }).click();
    await confirmDialog(p, 'Archive problems');
    await arrays.getByRole('link', { name: 'Binary Search' }).waitFor({ state: 'hidden' });
    assert(await strings.getByRole('link', { name: 'Binary Search' }).isVisible(), 'archiving a copy changed its source');

  });

  await step('Admin creates a batch with zero courses, assigns the course (chapters hidden), unlocks one chapter', async () => {
    const p = admin.page;
    await p.goto(`${FE}/manage/batches/new`);
    await p.getByLabel('Name').fill('JNTU Bootcamp');
    await p.getByLabel('College (optional)').fill('JNTU Hyderabad');
    await p.getByLabel('Status').selectOption('ACTIVE');
    await p.getByRole('button', { name: 'Create batch' }).click();
    await p.waitForURL(/\/manage\/batches\/[a-f0-9]{24}$/);
    await p.getByRole('link', { name: 'Assign a course' }).click();
    await pickOption(p, 'Course to assign', 'Java', /Java & DSA/);
    await p.getByRole('button', { name: 'Assign', exact: true }).click();
    await p.getByText('Course assigned').waitFor();
    await p.getByRole('navigation', { name: 'Batch sections' }).getByRole('link', { name: 'Chapter Access' }).click();
    await p.getByText('0 of 2 visible').waitFor();
    await p.getByRole('switch', { name: 'Arrays visible to students' }).click();
    await p.getByText('“Arrays” is now visible').waitFor();
    await p.getByText('1 of 2 visible').waitFor();
    assert(await p.getByRole('switch', { name: 'Arrays visible to students' }).getAttribute('aria-checked') === 'true', 'switch state');
    await shot(p, '04-visibility');
  });

  await step('Keyboard search finds the admin batch and excludes it from the unassigned trainer', async () => {
    for (const [person, visible] of [[admin, true], [trainer, false]]) {
      const p = person.page;
      await p.keyboard.press('Control+k');
      const dialog = p.getByRole('dialog', { name: 'Search Algora' });
      const field = dialog.getByRole('combobox', { name: 'Search Algora' });
      const batchResults = p.waitForResponse((response) => response.url().includes('/api/v1/batches?q=JNTU+Bootcamp'));
      await field.fill('JNTU Bootcamp');
      const result = await (await batchResults).json();
      assert(result.items.some((item) => item.name === 'JNTU Bootcamp') === visible, 'batch search scope mismatch');
      if (visible) {
        await dialog.getByRole('option', { name: /JNTU Bootcamp/ }).waitFor();
        await field.press('ArrowDown'); // keyboard navigation through results
      } else await dialog.getByText('No results. Try a name, roll number or problem number.').waitFor();
      await field.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }
  });

  await step('Trainer cannot open a batch they are not assigned to (404, no data)', async () => {
    const url = admin.page.url().replace(/\/visibility.*$/, '');
    await trainer.page.goto(url);
    await trainer.page.getByRole('alert').filter({ hasText: 'Batch not found' }).waitFor();
  });

  await step('Enroll an unregistered roll number: pending reservation with one-time claim code', async () => {
    const p = admin.page;
    await p.getByRole('navigation', { name: 'Batch sections' }).getByRole('link', { name: 'Students' }).click();
    await p.getByRole('button', { name: 'Enroll student' }).first().click();
    await p.locator('dialog[open]').getByLabel('Roll number').fill('ab12cd34ef');
    await confirmDialog(p, 'Enroll');
    const code = p.locator('dialog[open] li span.select-all');
    await code.waitFor();
    claimCode = (await code.textContent()).trim();
    assert(claimCode.length >= 10, 'no claim code');
    await shot(p, '05-claim-code');
    await confirmDialog(p, 'Done');
    await confirmDialog(p, 'Close anyway'); // codes cannot be shown again: closing without downloading asks first
    await p.getByText('Reserved enrollments (1)').waitFor();
  });

  const student = await persona(browser, STUDENT);
  await step('Student registration without claim code is refused for the reserved roll number', async () => {
    const p = student.page;
    await p.goto(`${FE}/login`);
    await p.getByRole('button', { name: 'Mock Google sign-in' }).click();
    await p.getByText('Signed in as', { exact: false }).waitFor();
    for (const [l, v] of [['First name', 'Asha'], ['Last name', 'Rao'], ['Roll number', 'AB12CD34EF'], ['College', 'JNTU Hyderabad'], ['Mobile number', '9876543210'], ['LeetCode username', 'asha_rao']]) await p.getByLabel(l, { exact: true }).fill(v);
    await p.getByRole('checkbox', { name: /public accepted submissions/ }).check().catch(() => {});
    await p.getByRole('button', { name: 'Create account' }).click();
    await p.getByText('This roll number is reserved').waitFor();
  });
  await step('Student registers with the claim code and is enrolled automatically', async () => {
    const p = student.page;
    await p.getByRole('button', { name: 'I have a claim code' }).click();
    await p.getByLabel('Claim code').fill(claimCode);
    await p.getByRole('checkbox', { name: /public accepted submissions/ }).check().catch(() => {});
    await p.getByRole('button', { name: 'Create account' }).click();
    await p.waitForURL('**/student/dashboard');
    await p.getByText('Java & DSA · JNTU Bootcamp').first().waitFor();
    await p.getByText('Progress updates are not available yet').waitFor();
    await p.getByText('Progress updates unavailable').first().waitFor(); // header text instead of an update button
    assert(!(await p.getByRole('button', { name: /Update progress/ }).count()), 'update button shown while updates are unavailable');
    assert((await p.title()) === 'Home · Algora', `title=${await p.title()}`);
    await shot(p, '06-student-dashboard');
  });
  await step('Usability: a first-time student finds the course and opens an assigned problem without guidance', async () => {
    const p = student.page;
    // Path 1: Home -> Continue learning
    await p.goto(`${FE}/student/dashboard`);
    await p.getByRole('link', { name: 'Open chapter' }).click();
    await p.getByRole('heading', { name: 'Arrays', level: 1 }).waitFor();
    // Path 2: My Learning -> course -> chapter -> problem
    await p.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'My Learning' }).click();
    await p.getByRole('link', { name: /Java & DSA/ }).first().click();
    await p.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'My Learning' }).waitFor();
    await p.getByRole('link', { name: /Arrays/ }).first().click();
    await p.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Java & DSA' }).waitFor();
    const open = p.getByRole('link', { name: /Two Sum/ });
    assert((await open.getAttribute('target')) === '_blank', 'problem does not open LeetCode');
    // status is text, not colour only
    await p.locator('main li').getByText('Awaiting verification', { exact: true }).first().waitFor();
    assert(!(await p.getByText(/unsolved/i).count()), 'unverified problem labelled unsolved');
  });
  await step('Student sees only the visible chapter; problems open LeetCode in a new tab; hidden chapter URL is refused', async () => {
    const p = student.page;
    await p.goto(`${FE}/student/courses`);
    await p.getByRole('link', { name: /Java & DSA/ }).first().click();
    await p.getByRole('link', { name: /Arrays/ }).first().click();
    await p.getByText('0 of 2 verified').waitFor();
    const a = p.getByRole('link', { name: /Two Sum/ });
    assert((await a.getAttribute('target')) === '_blank' && (await a.getAttribute('rel')).includes('noopener'), 'link target');
    assert((await a.getAttribute('href')) === 'https://leetcode.com/problems/two-sum/', 'canonical href');
    await p.getByLabel('Difficulty').selectOption('MEDIUM');
    await p.waitForURL(/diff=MEDIUM/); // filters live in the URL
    assert(!(await p.getByRole('link', { name: /Two Sum/ }).count()), 'filter failed');
    await p.reload();
    assert(await p.getByLabel('Difficulty').inputValue() === 'MEDIUM', 'filter lost on reload');
    const arraysUrl = new URL(p.url());
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
    // a chapter link without its course context is resolved instead of failing
    await p.goto(`${FE}${arraysUrl.pathname}`);
    await p.waitForURL(/batchCourseId=/);
    await p.getByRole('heading', { name: 'Arrays', level: 1 }).waitFor();
  });
  await step('Profile: roll number immutable and username linked while synchronization is unavailable', async () => {
    const p = student.page;
    await p.goto(`${FE}/student/profile`);
    assert(await p.getByLabel('Roll number').isDisabled(), 'roll editable');
    const accounts = p.locator('#connected-accounts');
    await accounts.getByText('Connected', { exact: true }).waitFor();
    await accounts.getByRole('link', { name: /asha_rao/ }).waitFor();
    for (const raw of ['LEETCODE_', 'SYNC_', 'statusDetail', 'provider']) assert(!(await p.locator('body').innerText()).includes(raw), `technical text "${raw}" on the profile`);
    await shot(p, '08-profile');
  });
  await step('Leaderboard page explains verification is unavailable', async () => {
    await student.page.goto(`${FE}/student/leaderboard`);
    await student.page.getByText('Rankings only include verified problems').waitFor();
    await student.page.getByText('Your position').waitFor();
  });
  await step('Mobile student navigation: all destinations visible in a bottom bar, no horizontal overflow', async () => {
    const p = student.page;
    await p.setViewportSize(MOBILE);
    for (const path of ['/student/dashboard', '/student/courses', '/student/progress', '/student/leaderboard', '/student/profile']) {
      await p.goto(`${FE}${path}`);
      await p.getByRole('heading', { level: 1 }).first().waitFor();
      await noOverflow(p, path);
    }
    const bar = p.getByRole('navigation', { name: 'Main' }).last();
    for (const label of ['Home', 'My Learning', 'Progress', 'Leaderboard']) assert(await bar.getByRole('link', { name: label }).isVisible(), `${label} not visible on mobile`);
    await bar.getByRole('link', { name: 'Leaderboard' }).click();
    await p.waitForURL('**/student/leaderboard');
    await p.setViewportSize({ width: 1360, height: 900 });
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
    await p.getByText('LeetCode connection').first().waitFor();
    await p.getByRole('link', { name: 'Asha Rao' }).waitFor();
    await p.getByRole('tab', { name: 'Chapters' }).click();
    await p.waitForURL(/tab=chapters/);
    await p.reload();
    assert(await p.getByRole('tab', { name: 'Chapters' }).getAttribute('aria-selected') === 'true', 'tab lost on reload');
    await p.getByRole('tab', { name: 'Chapters' }).focus();
    await p.keyboard.press('ArrowRight'); // ARIA tabs: arrow keys move between tabs
    await p.waitForURL(/tab=problems/);
    await shot(p, '09-analytics');
    await p.goto(`${FE}/manage/reports`);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('listitem').filter({ hasText: 'Student report' }).getByRole('button', { name: 'Download CSV' }).click()]);
    const path = await dl.path();
    const fs = await import('node:fs');
    const csv = fs.readFileSync(path, 'utf8');
    assert(csv.startsWith('Roll number,Name') && csv.includes('AB12CD34EF'), csv.slice(0, 200));
    await p.goto(`${FE}/manage/integration`);
    await p.getByText('Automatic verification is disabled').waitFor();
    await p.getByText('Activation is configured on the server', { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => {});
    await p.goto(`${FE}/manage/audit`);
    await p.getByText('Trainer request approved').first().waitFor(); // readable action
    await p.getByText('trainer_request.approve').first().waitFor(); // original code still available
  });
  await step('Usability: a trainer locates the batch, enrolls a student and manages chapter access from the batch workspace', async () => {
    const p = admin.page;
    // assign the trainer to the batch (Super Admin, batch settings)
    await p.goto(`${FE}/manage/batches`);
    await p.getByRole('link', { name: 'JNTU Bootcamp' }).click();
    await p.getByRole('navigation', { name: 'Batch sections' }).getByRole('link', { name: 'Settings' }).click();
    await pickOption(p, 'Trainer to assign', 'Rahul', /Rahul Sharma/);
    await p.getByRole('button', { name: 'Assign', exact: true }).click();
    await p.getByText('Trainer assigned').waitFor();
    const t = trainer.page;
    let clicks = 0;
    const click = async (locator) => { clicks++; await locator.click(); };
    await t.goto(`${FE}/manage/dashboard`);
    await click(t.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Batches' }));
    await click(t.getByRole('link', { name: 'JNTU Bootcamp' }));
    await click(t.getByRole('navigation', { name: 'Batch sections' }).getByRole('link', { name: 'Students' }));
    await click(t.getByRole('button', { name: 'Enroll student' }).first());
    await t.locator('dialog[open]').getByLabel('Roll number').fill('zz99yy88xx');
    await click(t.locator('dialog[open]').getByRole('button', { name: 'Enroll', exact: true }));
    await t.locator('dialog[open] li span.select-all').waitFor();
    const dl = t.waitForEvent('download');
    await click(t.locator('dialog[open]').getByRole('button', { name: 'Download CSV' }));
    await dl;
    await click(t.locator('dialog[open]').getByRole('button', { name: 'Done', exact: true }));
    await t.getByText('Reserved enrollments (1)').waitFor();
    await click(t.getByRole('navigation', { name: 'Batch sections' }).getByRole('link', { name: 'Chapter Access' }));
    await click(t.getByRole('switch', { name: 'Strings visible to students' }));
    await t.getByText('2 of 2 visible').waitFor();
    assert(clicks <= 10, `trainer needed ${clicks} clicks`);
    await click(t.getByRole('switch', { name: 'Strings visible to students' })); // restore
    await t.getByText('1 of 2 visible').waitFor();
    await noOverflow(t, 'chapter access');
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
    await signOut(p);
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
    await m.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Batches', exact: true }).click();
    await m.page.waitForURL('**/manage/batches');
    await shot(m.page, '10-mobile');
    for (const path of ['/manage/dashboard', '/manage/batches', '/manage/students', '/manage/analytics', '/manage/integration', '/manage/audit', '/manage/problem-library']) {
      await m.page.goto(`${FE}${path}`);
      await m.page.getByRole('heading', { level: 1 }).first().waitFor();
      await noOverflow(m.page, path);
    }
    const theme = (label) => menu(m.page, m.page, 'Account menu', label);
    const background = () => m.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await background();
    await theme('Dark theme');
    const dark = await background();
    assert(dark !== light, 'dark mode did not change the rendered surface');
    await m.page.reload();
    await m.page.getByRole('heading', { level: 1 }).first().waitFor();
    assert(await m.page.evaluate(() => document.documentElement.dataset.theme) === 'dark' && await background() === dark, 'theme did not persist');
    await shot(m.page, '16-mobile-dark');
    await m.page.emulateMedia({ colorScheme: 'dark' });
    await theme('System theme');
    assert(await background() === dark, 'system mode did not follow dark scheme');
    await theme('Light theme');
    assert(await background() === light, 'explicit light mode did not override the system scheme');

    await m.ctx.close();
  });
} finally {
  await browser.close();
  be.kill(); fe.kill();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
