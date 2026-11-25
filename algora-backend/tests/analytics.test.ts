import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog, BatchCourse, Enrollment, LeetcodeLink, PendingEnrollment, SolveEvidence, User } from '../src/models';
import { app, evidenceFor, login, resetDb, startDb, stopDb, studentBody, tok, verifiedLink } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);
const ADMIN = tok('sub-admin', 'admin@example.com', 'Admin');
let seq = 0;
async function stu(n: string, college?: any) {
  const user = await User.create({ googleSub: `s-${n}`, email: `${n}@x.com`, role: 'STUDENT', fullName: `Stu ${n}`, rollNumber: `R${String(++seq).padStart(9, '0')}`, leetcodeUsername: n, mobile: '9999999999', collegeId: college });
  const link = await verifiedLink(user._id, n);
  return { user, link };
}
async function world() {
  const admin = await login(ADMIN);
  const c = (await admin.call('post', '/courses', { title: 'DSA' })).body;
  const ch1 = (await admin.call('post', `/courses/${c._id}/chapters`, { title: 'Arrays' })).body;
  const ch2 = (await admin.call('post', `/courses/${c._id}/chapters`, { title: 'Strings' })).body;
  const add = (ch: any, slug: string, d: string) => admin.call('post', `/chapters/${ch._id}/problems`, { title: slug, url: `https://leetcode.com/problems/${slug}/`, difficulty: d });
  await add(ch1, 'two-sum', 'EASY'); await add(ch1, 'three-sum', 'MEDIUM'); await add(ch2, 'valid-anagram', 'EASY');
  await admin.call('patch', `/courses/${c._id}`, { status: 'PUBLISHED' });
  const bA = (await admin.call('post', '/batches', { name: 'A', status: 'ACTIVE', college: 'JNTU' })).body;
  const bB = (await admin.call('post', '/batches', { name: 'B', status: 'ACTIVE', college: 'OU' })).body;
  for (const b of [bA, bB]) { await admin.call('post', `/batches/${b._id}/courses`, { courseId: c._id }); await admin.call('post', `/batches/${b._id}/chapter-access/bulk`, { courseId: c._id, all: true, isVisible: true }); }
  const s = [await stu('a', bA.collegeId), await stu('b', bA.collegeId), await stu('c', bB.collegeId)];
  await admin.call('post', `/batches/${bA._id}/enrollments`, { rollNumber: s[0].user.rollNumber });
  await admin.call('post', `/batches/${bA._id}/enrollments`, { rollNumber: s[1].user.rollNumber });
  await admin.call('post', `/batches/${bB._id}/enrollments`, { rollNumber: s[2].user.rollNumber });
  await evidenceFor(s[0].user._id, s[0].link, 'two-sum'); await evidenceFor(s[0].user._id, s[0].link, 'three-sum'); await evidenceFor(s[0].user._id, s[0].link, 'valid-anagram');
  await evidenceFor(s[2].user._id, s[2].link, 'two-sum');
  await User.create({ googleSub: 't1', email: 't1@x.com', role: 'TRAINER', fullName: 'T1', trainerId: 'tr_t1' });
  const tid = (await User.findOne({ trainerId: 'tr_t1' }))!._id;
  await admin.call('post', `/batches/${bA._id}/trainers`, { trainerId: String(tid) });
  const trainer = await login(tok('t1', 't1@x.com', 'T1'));
  return { admin, trainer, c, ch1, ch2, bA, bB, s };
}

describe('analytics', () => {
  it('overview: totals, coverage, difficulty, batch comparison, needs-support; trainer scope limited to assigned batch', async () => {
    const w = await world();
    const o = (await w.admin.call('get', '/analytics/overview')).body;
    expect(o.totals).toMatchObject({ batches: 2, courses: 1, enrolledStudents: 3, verifiedCompletions: 4, completedAllAvailable: 1 });
    expect(o.totals.avgCompletionPct).toBeCloseTo((100 + 0 + 33.3) / 3, 0);
    expect(o.verification).toMatchObject({ studentsInScope: 3, verifiedLinks: 3, coveragePct: 100 });
    expect(o.difficulty).toEqual({ EASY: { solved: 3, available: 6 }, MEDIUM: { solved: 1, available: 3 }, HARD: { solved: 0, available: 0 } });
    expect(o.batchComparison.map((b: any) => b.name).sort()).toEqual(['A', 'B']);
    expect(o.needsSupport.map((r: any) => r.name)).toContain('Stu b');
    const t = (await w.trainer.call('get', '/analytics/overview')).body;
    expect(t.totals).toMatchObject({ batches: 1, enrolledStudents: 2 });
    expect(JSON.stringify(t)).not.toContain('Stu c');
  });

  it('student table: filters (batch, college, difficulty, chapter, q, verification, completion), sort, pagination, ranks', async () => {
    const w = await world();
    const all = (await w.admin.call('get', '/analytics/students')).body;
    expect(all.total).toBe(3);
    expect(all.items[0]).toMatchObject({ name: 'Stu a', solved: 3, points: 40, rank: 1, completionPct: 100, linkState: 'VERIFIED' });
    expect(JSON.stringify(all)).not.toMatch(/9999999999|@x\.com/); // no contact data in tables
    expect((await w.admin.call('get', `/analytics/students?batchId=${w.bB._id}`)).body.items.map((r: any) => r.name)).toEqual(['Stu c']);
    expect((await w.admin.call('get', `/analytics/students?collegeId=${w.bB.collegeId}`)).body.total).toBe(1);
    const med = (await w.admin.call('get', '/analytics/students?difficulty=MEDIUM')).body.items.find((r: any) => r.name === 'Stu a');
    expect(med).toMatchObject({ accessible: 1, solved: 1, points: 20 });
    const ch = (await w.admin.call('get', `/analytics/students?chapterId=${w.ch2._id}`)).body.items.find((r: any) => r.name === 'Stu c');
    expect(ch).toMatchObject({ accessible: 1, solved: 0 });
    expect((await w.admin.call('get', '/analytics/students?q=stu%20b')).body.total).toBe(1);
    expect((await w.admin.call('get', `/analytics/students?q=${w.s[2].user.rollNumber}`)).body.total).toBe(1);
    expect((await w.admin.call('get', '/analytics/students?maxPct=10')).body.items.map((r: any) => r.name)).toEqual(['Stu b']);
    await LeetcodeLink.updateOne({ studentId: w.s[1].user._id }, { $set: { status: 'REVALIDATION_REQUIRED' } });
    expect((await w.admin.call('get', '/analytics/students?verification=REVALIDATION_REQUIRED')).body.items.map((r: any) => r.name)).toEqual(['Stu b']);
    const p = (await w.admin.call('get', '/analytics/students?pageSize=2&page=2&sort=name&dir=asc')).body;
    expect(p.items.map((r: any) => r.name)).toEqual(['Stu c']);
    expect((await w.trainer.call('get', `/analytics/students?batchId=${w.bB._id}`)).body.total).toBe(0); // not their batch
  });

  it('date range: verified basis and submitted basis', async () => {
    const w = await world();
    await SolveEvidence.updateMany({ studentId: w.s[0].user._id, slug: 'two-sum' }, { $set: { firstVerifiedAt: new Date('2024-01-01'), observedAt: [new Date('2023-06-01')] } });
    const r = (await w.admin.call('get', '/analytics/students?from=2025-01-01')).body.items.find((x: any) => x.name === 'Stu a');
    expect(r.solved).toBe(2);
    const s = (await w.admin.call('get', '/analytics/students?from=2023-05-01&to=2023-07-01&dateBasis=submitted')).body.items.find((x: any) => x.name === 'Stu a');
    expect(s.solved).toBe(1);
  });

  it('chapters and problems stats; batch and course analytics; student detail with IDOR protection', async () => {
    const w = await world();
    const ch = (await w.admin.call('get', `/analytics/chapters?batchId=${w.bA._id}`)).body.items;
    expect(ch.find((c: any) => c.chapter === 'Arrays')).toMatchObject({ problems: 2, students: 2, completedStudents: 1, avgCompletionPct: 50 });
    const pr = (await w.admin.call('get', '/analytics/problems')).body.items.filter((p: any) => p.slug === 'two-sum');
    expect(pr.map((p: any) => p.verifiedSolved).sort()).toEqual([1, 1]);
    expect((await w.trainer.call('get', `/analytics/batches/${w.bA._id}`)).status).toBe(200);
    expect((await w.trainer.call('get', `/analytics/batches/${w.bB._id}`)).status).toBe(404);
    expect((await w.admin.call('get', `/analytics/courses/${w.c._id}`)).body.totals.enrolledStudents).toBe(3);
    const det = (await w.trainer.call('get', `/analytics/students/${w.s[0].user._id}`)).body;
    expect(det.student.rollNumber).toBe(w.s[0].user.rollNumber);
    expect(det.history).toHaveLength(3);
    expect((await w.trainer.call('get', `/analytics/students/${w.s[2].user._id}`)).status).toBe(404);
  });

  it('CSV exports for every report type, injection-safe, trainer-scoped, audited', async () => {
    const w = await world();
    await User.updateOne({ _id: w.s[1].user._id }, { $set: { fullName: '=HYPERLINK("http://evil")' } });
    for (const type of ['student', 'batch', 'course', 'chapter', 'problem']) {
      const r = await w.admin.call('get', `/reports/export?type=${type}`);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('text/csv');
      expect(r.headers['content-disposition']).toContain(`algora-${type}-report`);
      expect(r.text.split('\n').length).toBeGreaterThan(1);
    }
    const st = (await w.admin.call('get', '/reports/export?type=student')).text;
    expect(st).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(st).not.toMatch(/@x\.com|9999999999/);
    const tr = (await w.trainer.call('get', '/reports/export?type=student')).text;
    expect(tr).not.toContain('Stu c');
    expect(await AuditLog.countDocuments({ action: 'report.export' })).toBe(7); // 5 types + student again + trainer
    const sc = await login(tok(`s-a`, 'a@x.com', 'a'));
    expect((await sc.call('get', '/reports/export?type=student')).status).toBe(403);
    expect((await sc.call('get', '/analytics/overview')).status).toBe(403);
  });
});

describe('admin APIs', () => {
  it('colleges: list with counts, create, rename, duplicates; trainers read-only', async () => {
    const w = await world();
    const l = (await w.admin.call('get', '/colleges')).body;
    expect(l.items.find((c: any) => c.name === 'JNTU')).toMatchObject({ students: 2, batches: 1 });
    expect((await w.admin.call('post', '/colleges', { name: 'IIT' })).status).toBe(201);
    expect((await w.admin.call('post', '/colleges', { name: 'iit' })).status).toBe(409);
    const iit = (await w.admin.call('get', '/colleges?q=iit')).body.items[0];
    expect((await w.admin.call('patch', `/colleges/${iit._id}`, { name: 'JNTU' })).status).toBe(409);
    expect((await w.admin.call('patch', `/colleges/${iit._id}`, { status: 'ARCHIVED' })).body.status).toBe('ARCHIVED');
    expect((await w.trainer.call('post', '/colleges', { name: 'X' })).status).toBe(403);
    expect((await w.trainer.call('get', '/colleges')).status).toBe(200);
  });

  it('students: scoped list, suspend (session killed), revalidate, revoke', async () => {
    const w = await world();
    expect((await w.admin.call('get', '/students')).body.total).toBe(3);
    const tl = (await w.trainer.call('get', '/students')).body;
    expect(tl.total).toBe(2);
    expect(tl.items[0].link.status).toBe('VERIFIED');
    const sa = await login(tok('s-a', 'a@x.com', 'a'));
    expect((await sa.call('get', '/auth/me')).status).toBe(200);
    expect((await w.trainer.call('patch', `/students/${w.s[0].user._id}/status`, { status: 'SUSPENDED' })).status).toBe(403);
    expect((await w.admin.call('patch', `/students/${w.s[0].user._id}/status`, { status: 'SUSPENDED' })).status).toBe(200);
    expect((await sa.call('get', '/auth/me')).status).toBe(401);
    expect((await w.trainer.call('post', `/students/${w.s[1].user._id}/leetcode/revalidate`, {})).status).toBe(200);
    expect((await LeetcodeLink.findOne({ studentId: w.s[1].user._id }))!.status).toBe('REVALIDATION_REQUIRED');
    expect((await w.trainer.call('post', `/students/${w.s[2].user._id}/leetcode/revalidate`, {})).status).toBe(404); // not their student
    expect((await w.trainer.call('post', `/students/${w.s[2].user._id}/leetcode/revoke`, { reason: 'abuse' })).status).toBe(403);
    expect((await w.admin.call('post', `/students/${w.s[2].user._id}/leetcode/revoke`, { reason: 'shared account' })).body.revoked).toBe(1);
  });

  it('pending enrollments: list (no hashes), regenerate (old code stops working), cancel; claim is atomic', async () => {
    const w = await world();
    const p = (await w.trainer.call('post', `/batches/${w.bA._id}/enrollments`, { rollNumber: 'NEW1234567' })).body;
    const list = (await w.trainer.call('get', `/batches/${w.bA._id}/pending`)).body.items;
    expect(list).toHaveLength(1); expect(JSON.stringify(list)).not.toMatch(/claimCodeHash/);
    const re = (await w.trainer.call('post', `/batches/${w.bA._id}/pending/${list[0]._id}/regenerate`, {})).body;
    expect(re.claimCode).not.toBe(p.claimCode);
    const reg = (code: string, sub: string) => request(app).post('/api/v1/auth/register/student').set('Origin', 'http://localhost:3000')
      .send({ idToken: tok(sub, `${sub}@y.com`), ...studentBody({ rollNumber: 'NEW1234567', claimCode: code, leetcodeUsername: sub }) });
    expect((await reg(p.claimCode, 'old-code')).status).toBe(403);
    // two simultaneous registrations with the right code: one wins, the other is rejected, one enrollment
    const [x, y] = await Promise.all([reg(re.claimCode, 'racer1'), reg(re.claimCode, 'racer2')]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(await Enrollment.countDocuments({ batchId: w.bA._id, status: 'ACTIVE' })).toBe(3);
    expect(await User.countDocuments({ rollNumber: 'NEW1234567' })).toBe(1);
    // cancel
    const p2 = (await w.trainer.call('post', `/batches/${w.bA._id}/enrollments`, { rollNumber: 'CAN1234567' })).body;
    const pid = (await PendingEnrollment.findOne({ rollNumber: 'CAN1234567' }))!._id;
    expect((await w.trainer.call('delete', `/batches/${w.bA._id}/pending/${pid}`)).status).toBe(204);
    expect((await reg(p2.claimCode, 'late')).status).toBe(409); // username/roll differ: reservation gone, registration proceeds without claim
    expect((await w.trainer.call('get', `/batches/${w.bB._id}/pending`)).status).toBe(404);
  });

  it('audit logs and sync logs are Super Admin only and filterable', async () => {
    const w = await world();
    const a = (await w.admin.call('get', '/audit-logs?action=batch.')).body;
    expect(a.total).toBeGreaterThan(0);
    expect(a.items.every((i: any) => i.action.startsWith('batch.'))).toBe(true);
    expect((await w.trainer.call('get', '/audit-logs')).status).toBe(403);
    expect((await w.admin.call('get', '/audit-logs/sync-logs')).status).toBe(200);
  });

  it('course and batch lists include counts and search', async () => {
    const w = await world();
    const c = (await w.admin.call('get', '/courses?q=ds')).body.items[0];
    expect(c).toMatchObject({ chapterCount: 2, problemCount: 3, batchCount: 2 });
    const b = (await w.admin.call('get', '/batches?q=a')).body.items.find((x: any) => x.name === 'A');
    expect(b).toMatchObject({ studentCount: 2, courseCount: 1, college: 'JNTU' });
  });
});

describe('student chapter API', () => {
  it('per-problem verification, evidence timestamps, navigation only between visible chapters', async () => {
    const w = await world();
    const sa = await login(tok('s-a', 'a@x.com', 'a'));
    const bc = String((await BatchCourse.findOne({ batchId: w.bA._id }))!._id);
    const r = (await sa.call('get', `/student/chapters/${w.ch1._id}?batchCourseId=${bc}`)).body;
    expect(r.problems.map((p: any) => p.verified)).toEqual([true, true]);
    expect(r.problems[0].evidence.firstVerifiedAt).toBeTruthy();
    expect(r.next.title).toBe('Strings'); expect(r.prev).toBeNull();
    await w.admin.call('put', `/batches/${w.bA._id}/courses/${w.c._id}/chapters/${w.ch2._id}/access`, { isVisible: false });
    expect((await sa.call('get', `/student/chapters/${w.ch1._id}?batchCourseId=${bc}`)).body.next).toBeNull();
    expect((await sa.call('get', `/student/chapters/${w.ch2._id}?batchCourseId=${bc}`)).status).toBe(404);
  });
});
export { mongoose };
