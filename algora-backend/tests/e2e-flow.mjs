// Drives the running stack through the Next.js proxy (http://localhost:3000). Google verification is stubbed by tests/e2e-server.ts.
const BASE = 'http://localhost:3000/api/v1';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); };

class Client {
  cookie = ''; csrf = ''; rawSetCookie = '';
  async call(method, path, body, { origin = 'http://localhost:3000', csrf = true } = {}) {
    const h = { 'content-type': 'application/json', origin };
    if (this.cookie) h.cookie = this.cookie;
    if (csrf && this.csrf) h['x-csrf-token'] = this.csrf;
    const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie');
    if (sc) { this.rawSetCookie = sc; this.cookie = sc.split(';')[0]; }
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    if (json?.csrfToken) this.csrf = json.csrfToken;
    return { status: r.status, body: json };
  }
}
const tok = (sub, email, name) => `tok|${sub}|${email}|${name}`;

const admin = new Client();
let r = await admin.call('POST', '/auth/google', { idToken: tok('sa', 'ADMIN@example.com', 'Admin') });
check('super admin login via proxy', r.status === 200 && r.body.user.role === 'SUPER_ADMIN');
check('session cookie is HttpOnly + SameSite=Lax', /HttpOnly/i.test(admin.rawSetCookie) && /SameSite=Lax/i.test(admin.rawSetCookie), admin.rawSetCookie);
check('googleSub not leaked', !JSON.stringify(r.body).includes('"sa"'));
check('GET /auth/me works with cookie', (await admin.call('GET', '/auth/me')).status === 200);
check('unsafe request without CSRF token -> 403', (await admin.call('PATCH', '/trainers/507f1f77bcf86cd799439011/suspend', {}, { csrf: false })).status === 403);
check('unsafe request from foreign origin -> 403', (await admin.call('PATCH', '/trainers/507f1f77bcf86cd799439011/suspend', {}, { origin: 'http://evil.com' })).status === 403);

const trainer = new Client();
const T = tok('st', 'rahul@x.com', 'Rahul Sharma');
r = await trainer.call('POST', '/auth/google', { idToken: T });
check('unknown identity -> REGISTRATION_REQUIRED, no cookie', r.body.status === 'REGISTRATION_REQUIRED' && !trainer.cookie);
r = await trainer.call('POST', '/trainer-requests', { idToken: T, fullName: 'Rahul Sharma' });
check('trainer access request created', r.status === 201);
check('login now reports PENDING_APPROVAL', (await trainer.call('POST', '/auth/google', { idToken: T })).body.status === 'PENDING_APPROVAL');
const pending = (await admin.call('GET', '/trainer-requests?status=PENDING_APPROVAL')).body.items;
check('admin sees pending request', pending.length === 1);
r = await admin.call('PATCH', `/trainer-requests/${pending[0]._id}/approve`);
check('approve -> tr_rahulsharma', r.status === 200 && r.body.trainerId === 'tr_rahulsharma', JSON.stringify(r.body));
r = await trainer.call('POST', '/auth/google', { idToken: T });
check('approved trainer logs in', r.body.user?.role === 'TRAINER');
check('trainer blocked from /trainers (403)', (await trainer.call('GET', '/trainers')).status === 403);
check('trainer cannot approve (403)', (await trainer.call('PATCH', `/trainer-requests/${pending[0]._id}/approve`)).status === 403);

const college = await admin.call('POST', '/colleges', { name: 'JNTU Hyderabad', code: 'JNTH' });
check('admin creates a canonical college', college.status === 201 && college.body.code === 'JNTH', JSON.stringify(college.body));
const collegeId = college.body._id;

const student = new Client();
r = await student.call('POST', '/auth/register/student', { idToken: tok('ss', 'asha@x.com', 'Asha'), firstName: 'Asha', lastName: 'Rao', rollNumber: 'ab12cd34ef', collegeId, mobile: '9876543210', leetcodeUsername: 'asha_rao', leetcodeConsent: true, role: 'SUPER_ADMIN' });
check('student registers, roll uppercased, role ignored', r.status === 201 && r.body.user.role === 'STUDENT' && r.body.user.rollNumber === 'AB12CD34EF', JSON.stringify(r.body));
check('student blocked from /courses (403)', (await student.call('GET', '/courses')).status === 403);
check('student blocked from /batches (403)', (await student.call('GET', '/batches')).status === 403);
check('student /student/courses ok', (await student.call('GET', '/student/courses')).status === 200);

const dup = new Client();
r = await dup.call('POST', '/auth/register/student', { idToken: tok('s2', 'bravo@x.com', 'Bravo Student'), firstName: 'B', lastName: 'B', rollNumber: 'AB12CD34EF', collegeId, mobile: '9876543211', leetcodeUsername: 'bb', leetcodeConsent: true });
check('duplicate roll number -> 409', r.status === 409 && r.body.error.code === 'ROLL_NUMBER_TAKEN');

const tid = (await admin.call('GET', '/trainers')).body.items[0]._id;
check('admin suspends trainer', (await admin.call('PATCH', `/trainers/${tid}/suspend`)).status === 200);
check('suspended trainer session dies immediately (401)', (await trainer.call('GET', '/auth/me')).status === 401);
check('suspended trainer cannot log in (403)', (await new Client().call('POST', '/auth/google', { idToken: T })).status === 403);

const out = new Client(); out.cookie = student.cookie; out.csrf = student.csrf;
await out.call('POST', '/auth/logout', {});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
