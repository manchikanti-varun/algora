import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Batch, BatchChapterAccess, BatchCourse, Chapter, Enrollment, PendingEnrollment, ProblemProgress, SolveEvidence, User } from '../src/models';
import { app, studentBody, login, resetDb, startDb, stopDb, tok } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const ADMIN = tok('sub-admin', 'admin@example.com', 'Admin');
async function mkTrainer(n: string, extra: object = {}) {
  await User.create({ googleSub: `t-${n}`, email: `${n}@x.com`, role: 'TRAINER', fullName: n, trainerId: `tr_${n}`, ...extra });
  return login(tok(`t-${n}`, `${n}@x.com`, n));
}
async function mkStudent(n: string, roll: string, username = n) {
  const u = await User.create({ googleSub: `s-${n}`, email: `${n}@x.com`, role: 'STUDENT', fullName: n, rollNumber: roll, leetcodeUsername: username });
  return { user: u, api: await login(tok(`s-${n}`, `${n}@x.com`, n)) };
}
type Api = Awaited<ReturnType<typeof login>>;

async function seedCourse(admin: Api, chapters = ['Arrays', 'Strings', 'Hashing']) {
  const c = (await admin.call('post', '/courses', { title: 'Java & DSA' })).body;
  const chs = [];
  for (const t of chapters) chs.push((await admin.call('post', `/courses/${c._id}/chapters`, { title: t })).body);
  await admin.call('post', `/chapters/${chs[0]._id}/problems`, { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'EASY' });
  await admin.call('patch', `/courses/${c._id}`, { status: 'PUBLISHED' });
  return { course: c, chs };
}

describe('Phase 3: courses, chapters, problems', () => {
  it('trainer without permission cannot create; with permission can; student never', async () => {
    const t = await mkTrainer('plain');
    expect((await t.call('post', '/courses', { title: 'X' })).status).toBe(403);
    const t2 = await mkTrainer('perm', { canManageCourses: true });
    expect((await t2.call('post', '/courses', { title: 'X' })).status).toBe(201);
    const { api } = await mkStudent('stu', 'AB12CD34EF');
    expect((await api.call('get', '/courses')).status).toBe(403);
  });

  it('orders chapters, reorders them, and archives', async () => {
    const admin = await login(ADMIN);
    const { course, chs } = await seedCourse(admin);
    expect(chs.map((c) => c.order)).toEqual([0, 1, 2]);
    await admin.call('patch', `/chapters/${chs[2]._id}/reorder`, { position: 0 });
    const got = (await admin.call('get', `/courses/${course._id}`)).body;
    expect(got.chapters.map((c: any) => c.title)).toEqual(['Hashing', 'Arrays', 'Strings']);
    await admin.call('patch', `/chapters/${chs[1]._id}`, { status: 'ARCHIVED' });
    expect((await admin.call('get', `/courses/${course._id}`)).body.chapters).toHaveLength(2);
  });

  it('problems: normalise URL, block same-chapter duplicate, allow reuse across chapters, reorder, archive', async () => {
    const admin = await login(ADMIN);
    const { chs } = await seedCourse(admin);
    const dup = await admin.call('post', `/chapters/${chs[0]._id}/problems`, { title: 'Two Sum again', url: 'https://leetcode.com/problems/Two-Sum/description/', difficulty: 'EASY' });
    expect(dup.status).toBe(409);
    const reuse = await admin.call('post', `/chapters/${chs[1]._id}/problems`, { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'EASY' });
    expect(reuse.status).toBe(201);
    expect((await admin.call('post', `/chapters/${chs[0]._id}/problems`, { title: 'bad', url: 'https://evil.com/problems/x', difficulty: 'EASY' })).status).toBe(400);
    const p2 = (await admin.call('post', `/chapters/${chs[0]._id}/problems`, { title: 'Add', url: 'https://leetcode.com/problems/add-two-numbers/', difficulty: 'MEDIUM' })).body;
    const list = (await admin.call('get', `/courses/${chs[0].courseId}`)).body.chapters[0].problems;
    const rev = list.map((p: any) => p._id).reverse();
    expect((await admin.call('patch', `/chapters/${chs[0]._id}/reorder`, { problemIds: rev })).status).toBe(200);
    expect((await admin.call('patch', `/chapters/${chs[0]._id}/reorder`, { problemIds: [rev[0]] })).status).toBe(400);
    await admin.call('patch', `/problems/${p2._id}`, { status: 'ARCHIVED' });
    expect((await admin.call('get', `/courses/${chs[0].courseId}`)).body.chapters[0].problems).toHaveLength(1);
    // archived slug can be re-added
    expect((await admin.call('post', `/chapters/${chs[0]._id}/problems`, { title: 'Add', url: 'https://leetcode.com/problems/add-two-numbers/', difficulty: 'MEDIUM' })).status).toBe(201);
  });

  it('rejects unknown fields and bad ids', async () => {
    const admin = await login(ADMIN);
    const { course } = await seedCourse(admin);
    expect((await admin.call('patch', `/courses/${course._id}`, { createdBy: 'x' })).status).toBe(400);
    expect((await admin.call('get', '/courses/not-an-id')).status).toBe(400);
  });
});

describe('Phase 4: batches, trainers, enrollment, CSV', () => {
  it('batch is creatable with zero courses; trainer creator is auto-assigned; others cannot see it', async () => {
    const t1 = await mkTrainer('one');
    const t2 = await mkTrainer('two');
    const b = (await t1.call('post', '/batches', { name: 'Batch A', college: 'JNTU' })).body;
    expect(b.status).toBe('DRAFT');
    expect((await t1.call('get', '/batches')).body.total).toBe(1);
    expect((await t2.call('get', '/batches')).body.total).toBe(0);
    expect((await t2.call('get', `/batches/${b._id}`)).status).toBe(404); // IDOR: indistinguishable from missing
    expect((await t2.call('patch', `/batches/${b._id}`, { name: 'hack' })).status).toBe(404);
    expect((await t1.call('get', `/batches/${b._id}`)).body.courseCount).toBe(0);
  });

  it('only Super Admin assigns trainers; assigned trainer gains access; revoked loses it', async () => {
    const admin = await login(ADMIN);
    const t = await mkTrainer('one');
    const tid = String((await User.findOne({ trainerId: 'tr_one' }))!._id);
    const b = (await admin.call('post', '/batches', { name: 'B' })).body;
    expect((await t.call('post', `/batches/${b._id}/trainers`, { trainerId: tid })).status).toBe(403);
    expect((await admin.call('post', `/batches/${b._id}/trainers`, { trainerId: tid })).status).toBe(201);
    expect((await t.call('get', `/batches/${b._id}`)).status).toBe(200);
    expect((await t.call('post', `/batches/${b._id}/trainers`, { trainerId: tid })).status).toBe(403);
    await admin.call('delete', `/batches/${b._id}/trainers/${tid}`);
    expect((await t.call('get', `/batches/${b._id}`)).status).toBe(404);
  });

  it('validates dates', async () => {
    const admin = await login(ADMIN);
    expect((await admin.call('post', '/batches', { name: 'B', startDate: '2025-02-01', endDate: '2025-01-01' })).status).toBe(400);
  });

  it('enrolls registered students idempotently; removal preserves history and re-enroll reactivates', async () => {
    const admin = await login(ADMIN);
    const { user } = await mkStudent('asha', 'AB12CD34EF');
    const b = (await admin.call('post', '/batches', { name: 'B' })).body;
    expect((await admin.call('post', `/batches/${b._id}/enrollments`, { rollNumber: 'ab12cd34ef' })).body.result).toBe('ENROLLED');
    expect((await admin.call('post', `/batches/${b._id}/enrollments`, { rollNumber: 'AB12CD34EF' })).body.result).toBe('ALREADY_ENROLLED');
    expect(await Enrollment.countDocuments()).toBe(1);
    expect((await admin.call('delete', `/batches/${b._id}/enrollments/${user._id}`)).status).toBe(204);
    expect((await Enrollment.findOne())!.status).toBe('REMOVED');
    expect((await admin.call('post', `/batches/${b._id}/enrollments`, { rollNumber: 'AB12CD34EF' })).body.result).toBe('REACTIVATED');
    expect((await admin.call('post', `/batches/${b._id}/enrollments`, { rollNumber: 'bad' })).status).toBe(400);
  });

  it('student in multiple batches', async () => {
    const admin = await login(ADMIN);
    await mkStudent('asha', 'AB12CD34EF');
    const b1 = (await admin.call('post', '/batches', { name: 'B1' })).body;
    const b2 = (await admin.call('post', '/batches', { name: 'B2' })).body;
    await admin.call('post', `/batches/${b1._id}/enrollments`, { rollNumber: 'AB12CD34EF' });
    await admin.call('post', `/batches/${b2._id}/enrollments`, { rollNumber: 'AB12CD34EF' });
    expect(await Enrollment.countDocuments({ status: 'ACTIVE' })).toBe(2);
  });

  it('unregistered roll number -> pending with claim code; code is stored hashed; claim activates at registration', async () => {
    const admin = await login(ADMIN);
    const b = (await admin.call('post', '/batches', { name: 'B' })).body;
    const r = (await admin.call('post', `/batches/${b._id}/enrollments`, { rollNumber: 'ZZ12CD34EF' })).body;
    expect(r.result).toBe('PENDING');
    const stored = await PendingEnrollment.findOne();
    expect(JSON.stringify(stored)).not.toContain(r.claimCode);
    const list = (await admin.call('get', `/batches/${b._id}/enrollments`)).body;
    expect(JSON.stringify(list)).not.toMatch(/claimCodeHash/);
    const { default: request } = await import('supertest');
    const reg = await request(app).post('/api/v1/auth/register/student').set('Origin', 'http://localhost:3000')
      .send({ idToken: tok('s-new', 'new@x.com'), ...studentBody({ rollNumber: 'ZZ12CD34EF', claimCode: r.claimCode }) });
    expect(reg.body.enrolledBatches).toBe(1);
    expect(await Enrollment.countDocuments({ batchId: b._id, status: 'ACTIVE' })).toBe(1);
  });

  it('CSV import: mixed rows, duplicates, invalid, formula-like input, authorization', async () => {
    const admin = await login(ADMIN);
    await mkStudent('asha', 'AB12CD34EF');
    const b = (await admin.call('post', '/batches', { name: 'B' })).body;
    const csv = 'rollNumber,email\nab12cd34ef,\nNEW1234567,n@x.com\nNEW1234567,\nshort,\n=CMD000000,\nQQ12345678,not-an-email\n';
    const r = await admin.call('post', `/batches/${b._id}/enrollments/import`, { csv });
    expect(r.status).toBe(200);
    expect(r.body.summary).toEqual({ ENROLLED: 1, PENDING: 1, DUPLICATE_IN_FILE: 1, INVALID: 3 });
    expect(await PendingEnrollment.countDocuments()).toBe(1);
    const other = await mkTrainer('other');
    expect((await other.call('post', `/batches/${b._id}/enrollments/import`, { csv })).status).toBe(404);
    expect((await admin.call('post', `/batches/${b._id}/enrollments/import`, { csv: 'name\nx' })).status).toBe(400);
  });

  it('archived batch is read-only', async () => {
    const admin = await login(ADMIN);
    const b = (await admin.call('post', '/batches', { name: 'B', status: 'ARCHIVED' })).body;
    expect((await admin.call('post', `/batches/${b._id}/enrollments`, { rollNumber: 'AB12CD34EF' })).status).toBe(403);
  });
});

describe('Phase 5: batch-course assignment (many-to-many)', () => {
  it('assign, multiple courses per batch, same course in multiple batches, reactivation keeps data', async () => {
    const admin = await login(ADMIN);
    const { course } = await seedCourse(admin);
    const c2 = (await admin.call('post', '/courses', { title: 'SQL' })).body;
    await admin.call('patch', `/courses/${c2._id}`, { status: 'PUBLISHED' });
    const b1 = (await admin.call('post', '/batches', { name: 'B1' })).body;
    const b2 = (await admin.call('post', '/batches', { name: 'B2' })).body;
    expect((await admin.call('post', `/batches/${b1._id}/courses`, { courseId: course._id })).status).toBe(201);
    await admin.call('post', `/batches/${b1._id}/courses`, { courseId: c2._id });
    await admin.call('post', `/batches/${b2._id}/courses`, { courseId: course._id });
    await admin.call('post', `/batches/${b2._id}/courses`, { courseId: course._id }); // idempotent
    expect(await BatchCourse.countDocuments()).toBe(3);
    expect((await admin.call('get', `/batches/${b1._id}`)).body.courseCount).toBe(2);
    expect(await BatchChapterAccess.countDocuments()).toBe(0); // hidden by default

    await admin.call('patch', `/batches/${b1._id}/courses/${course._id}`, { status: 'INACTIVE' });
    expect((await BatchCourse.findOne({ batchId: b1._id, courseId: course._id }))!.status).toBe('INACTIVE');
    await admin.call('post', `/batches/${b1._id}/courses`, { courseId: course._id });
    expect(await BatchCourse.countDocuments()).toBe(3);
    expect((await BatchCourse.findOne({ batchId: b1._id, courseId: course._id }))!.status).toBe('ACTIVE');
  });

  it('rejects unpublished courses and unauthorised trainers; course added after enrollment needs no re-enrollment', async () => {
    const admin = await login(ADMIN);
    const draft = (await admin.call('post', '/courses', { title: 'Draft' })).body;
    const b = (await admin.call('post', '/batches', { name: 'B' })).body;
    expect((await admin.call('post', `/batches/${b._id}/courses`, { courseId: draft._id })).status).toBe(400);
    const t = await mkTrainer('t');
    const { course } = await seedCourse(admin);
    expect((await t.call('post', `/batches/${b._id}/courses`, { courseId: course._id })).status).toBe(404);
    await mkStudent('asha', 'AB12CD34EF');
    await admin.call('post', `/batches/${b._id}/enrollments`, { rollNumber: 'AB12CD34EF' });
    await admin.call('post', `/batches/${b._id}/courses`, { courseId: course._id });
    expect(await Enrollment.countDocuments()).toBe(1);
  });
});

describe('Phase 6: chapter visibility', () => {
  async function setup() {
    const admin = await login(ADMIN);
    const { course, chs } = await seedCourse(admin, ['Arrays', 'Strings', 'Hashing']);
    const bA = (await admin.call('post', '/batches', { name: 'A', status: 'ACTIVE' })).body;
    const bB = (await admin.call('post', '/batches', { name: 'B', status: 'ACTIVE' })).body;
    for (const b of [bA, bB]) await admin.call('post', `/batches/${b._id}/courses`, { courseId: course._id });
    const stu = await mkStudent('asha', 'AB12CD34EF');
    await admin.call('post', `/batches/${bA._id}/enrollments`, { rollNumber: 'AB12CD34EF' });
    const bcA = (await BatchCourse.findOne({ batchId: bA._id }))!;
    return { admin, course, chs, bA, bB, stu, bcA };
  }
  const acc = (b: any, c: any, ch: any) => `/batches/${b._id}/courses/${c._id}/chapters/${ch._id}/access`;

  it('hidden by default; students see nothing until unlocked; per-batch independence', async () => {
    const { admin, course, chs, bA, bB, stu, bcA } = await setup();
    let sc = (await stu.api.call('get', '/student/courses')).body.items;
    expect(sc).toHaveLength(1);
    expect(sc[0].chapters).toEqual([]);
    expect((await stu.api.call('get', `/student/chapters/${chs[0]._id}?batchCourseId=${bcA._id}`)).status).toBe(404);

    await admin.call('put', acc(bA, course, chs[0]), { isVisible: true });
    sc = (await stu.api.call('get', '/student/courses')).body.items;
    expect(sc[0].chapters.map((c: any) => c.title)).toEqual(['Arrays']);
    const ch = await stu.api.call('get', `/student/chapters/${chs[0]._id}?batchCourseId=${bcA._id}`);
    expect(ch.status).toBe(200);
    expect(ch.body.problems[0].slug).toBe('two-sum');

    const viewB = (await admin.call('get', `/batches/${bB._id}/chapter-access`)).body.items[0].chapters;
    expect(viewB.every((c: any) => c.isVisible === false)).toBe(true); // B unaffected
    // not-yet-unlocked chapter still 404
    expect((await stu.api.call('get', `/student/chapters/${chs[1]._id}?batchCourseId=${bcA._id}`)).status).toBe(404);
  });

  it('new chapter is hidden everywhere; bulk unlock/hide; hide after progress preserves records', async () => {
    const { admin, course, chs, bA, bcA, stu } = await setup();
    await admin.call('post', `/batches/${bA._id}/chapter-access/bulk`, { courseId: course._id, all: true, isVisible: true });
    expect(await BatchChapterAccess.countDocuments({ isVisible: true })).toBe(3);
    const late = (await admin.call('post', `/courses/${course._id}/chapters`, { title: 'Stacks' })).body;
    const view = (await admin.call('get', `/batches/${bA._id}/chapter-access`)).body.items[0].chapters;
    expect(view.find((c: any) => c.title === 'Stacks').isVisible).toBe(false);
    expect((await stu.api.call('get', `/student/chapters/${late._id}?batchCourseId=${bcA._id}`)).status).toBe(404);

    // progress exists, then chapter hidden: evidence/progress rows are untouched
    const prob = (await mongoose.connection.collection('problems').findOne({ slug: 'two-sum' }))!;
    await SolveEvidence.create({ studentId: stu.user._id, slug: 'two-sum', leetcodeUsername: 'asha', status: 'VERIFIED', source: 'MOCK_DEV' });
    await ProblemProgress.create({ studentId: stu.user._id, batchCourseId: bcA._id, problemId: prob._id, slug: 'two-sum', status: 'VERIFIED' });
    await admin.call('post', `/batches/${bA._id}/chapter-access/bulk`, { courseId: course._id, chapterIds: [chs[0]._id], isVisible: false });
    expect((await stu.api.call('get', `/student/chapters/${chs[0]._id}?batchCourseId=${bcA._id}`)).status).toBe(404);
    expect(await SolveEvidence.countDocuments()).toBe(1);
    expect(await ProblemProgress.countDocuments()).toBe(1);
  });

  it('bulk validation: foreign chapters rejected; exactly one of chapterIds/all', async () => {
    const { admin, course, bA } = await setup();
    const other = (await admin.call('post', '/courses', { title: 'Other' })).body;
    const oc = (await admin.call('post', `/courses/${other._id}/chapters`, { title: 'X' })).body;
    expect((await admin.call('post', `/batches/${bA._id}/chapter-access/bulk`, { courseId: course._id, chapterIds: [oc._id], isVisible: true })).status).toBe(400);
    expect((await admin.call('post', `/batches/${bA._id}/chapter-access/bulk`, { courseId: course._id, isVisible: true })).status).toBe(400);
    expect((await admin.call('put', acc(bA, course, oc), { isVisible: true })).status).toBe(404);
  });

  it('deactivated course revokes student access; reactivation restores previous visibility', async () => {
    const { admin, course, chs, bA, bcA, stu } = await setup();
    await admin.call('put', acc(bA, course, chs[0]), { isVisible: true });
    await admin.call('patch', `/batches/${bA._id}/courses/${course._id}`, { status: 'INACTIVE' });
    expect((await stu.api.call('get', '/student/courses')).body.items).toHaveLength(0);
    expect((await stu.api.call('get', `/student/chapters/${chs[0]._id}?batchCourseId=${bcA._id}`)).status).toBe(404);
    expect((await admin.call('put', acc(bA, course, chs[1]), { isVisible: true })).status).toBe(404); // cannot edit inactive
    await admin.call('post', `/batches/${bA._id}/courses`, { courseId: course._id });
    expect((await stu.api.call('get', '/student/courses')).body.items[0].chapters).toHaveLength(1);
  });

  it('removed student, archived course and other trainers get no access', async () => {
    const { admin, course, chs, bA, bcA, stu } = await setup();
    await admin.call('put', acc(bA, course, chs[0]), { isVisible: true });
    await admin.call('patch', `/courses/${course._id}`, { status: 'ARCHIVED' });
    expect((await stu.api.call('get', '/student/courses')).body.items).toHaveLength(0);
    await admin.call('patch', `/courses/${course._id}`, { status: 'PUBLISHED' });
    await admin.call('delete', `/batches/${bA._id}/enrollments/${stu.user._id}`);
    expect((await stu.api.call('get', '/student/courses')).body.items).toHaveLength(0);
    const t = await mkTrainer('t');
    expect((await t.call('put', acc(bA, course, chs[0]), { isVisible: true })).status).toBe(404);
    expect((await t.call('get', `/batches/${bA._id}/chapter-access`)).status).toBe(404);
  });

  it('concurrent visibility updates converge to one record per chapter', async () => {
    const { admin, course, chs, bA } = await setup();
    await Promise.all(Array.from({ length: 12 }, (_, i) => admin.call('put', acc(bA, course, chs[0]), { isVisible: i % 2 === 0 })));
    expect(await BatchChapterAccess.countDocuments({ chapterId: chs[0]._id })).toBe(1);
  });

  it('concurrent enrollment of the same student yields one enrollment', async () => {
    const { admin, bA } = await setup();
    await Promise.all(Array.from({ length: 10 }, () => admin.call('post', `/batches/${bA._id}/enrollments`, { rollNumber: 'AB12CD34EF' })));
    expect(await Enrollment.countDocuments({ batchId: bA._id })).toBe(1);
  });
});
