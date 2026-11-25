import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BatchCourse, LeetcodeLink, SolveEvidence, User } from '../src/models';
import { evidenceFor, login, resetDb, startDb, stopDb, tok, verifiedLink } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const ADMIN = tok('sub-admin', 'admin@example.com', 'Admin');
type Api = Awaited<ReturnType<typeof login>>;
let seq = 0;
async function mkStudent(n: string, username = n) {
  const user = await User.create({ googleSub: `s-${n}`, email: `${n}@x.com`, role: 'STUDENT', fullName: `Stu ${n}`, rollNumber: `R${String(++seq).padStart(9, '0')}`, leetcodeUsername: username });
  const link = await verifiedLink(user._id, username);
  return { user, link, api: await login(tok(`s-${n}`, `${n}@x.com`, n)) };
}
const solve = (s: { user: any; link: any }, slug: string) => evidenceFor(s.user._id, s.link, slug);

/** Course: Arrays[two-sum E, add-two-numbers M, median H], Strings[valid-anagram E, two-sum E (reused)] */
async function world(admin: Api) {
  const course = (await admin.call('post', '/courses', { title: 'DSA' })).body;
  const arrays = (await admin.call('post', `/courses/${course._id}/chapters`, { title: 'Arrays' })).body;
  const strings = (await admin.call('post', `/courses/${course._id}/chapters`, { title: 'Strings' })).body;
  const add = (ch: any, slug: string, d: string) => admin.call('post', `/chapters/${ch._id}/problems`, { title: slug, url: `https://leetcode.com/problems/${slug}/`, difficulty: d });
  await add(arrays, 'two-sum', 'EASY'); await add(arrays, 'add-two-numbers', 'MEDIUM'); await add(arrays, 'median-of-two-sorted-arrays', 'HARD');
  await add(strings, 'valid-anagram', 'EASY'); await add(strings, 'two-sum', 'EASY');
  await admin.call('patch', `/courses/${course._id}`, { status: 'PUBLISHED' });
  const mkBatch = async (name: string) => { const b = (await admin.call('post', '/batches', { name, status: 'ACTIVE' })).body; await admin.call('post', `/batches/${b._id}/courses`, { courseId: course._id }); return b; };
  const bA = await mkBatch('A'), bB = await mkBatch('B');
  const unlock = (b: any, ch: any) => admin.call('put', `/batches/${b._id}/courses/${course._id}/chapters/${ch._id}/access`, { isVisible: true });
  const bc = async (b: any) => String((await BatchCourse.findOne({ batchId: b._id }))!._id);
  return { course, arrays, strings, bA, bB, unlock, bc };
}
const enroll = (admin: Api, b: any, u: any) => admin.call('post', `/batches/${b._id}/enrollments`, { rollNumber: u.rollNumber });

describe('dashboard and progress calculation', () => {
  it('nothing unlocked: zero accessible, null percentage (not 100%), no fabricated progress', async () => {
    const admin = await login(ADMIN); const w = await world(admin); const s = await mkStudent('a');
    await enroll(admin, w.bA, s.user);
    const d = (await s.api.call('get', '/student/dashboard')).body;
    expect(d.summary).toMatchObject({ accessibleProblems: 0, verifiedSolved: 0, completionPct: null, points: 0, unlockedChapters: 0 });
    expect(d.sync.status).toBe('IDLE');
  });

  it('counts verified problems once, uses default points, difficulty breakdown, chapter progress, completed chapters', async () => {
    const admin = await login(ADMIN); const w = await world(admin); const s = await mkStudent('a');
    await enroll(admin, w.bA, s.user);
    await w.unlock(w.bA, w.arrays); await w.unlock(w.bA, w.strings);
    await solve(s, 'two-sum'); await solve(s, 'two-sum'); await solve(s, 'valid-anagram');
    const d = (await s.api.call('get', '/student/dashboard')).body;
    // distinct problems: two-sum, add-two-numbers, median, valid-anagram = 4 (two-sum is in both chapters but counts once)
    expect(d.summary).toMatchObject({ accessibleProblems: 4, verifiedSolved: 2, completionPct: 50, points: 20, unlockedChapters: 2, completedChapters: 1 });
    expect(d.difficulty).toEqual({ EASY: { solved: 2, total: 2 }, MEDIUM: { solved: 0, total: 1 }, HARD: { solved: 0, total: 1 } });
    const strings = d.chapters.find((c: any) => c.title === 'Strings');
    expect(strings).toMatchObject({ total: 2, solved: 2, completionPct: 100 }); // reused problem shows solved in both chapters
    expect(d.chapters.find((c: any) => c.title === 'Arrays').solved).toBe(1);
  });

  it('hiding a chapter removes it from the denominator and numerator but keeps evidence; unlocking restores', async () => {
    const admin = await login(ADMIN); const w = await world(admin); const s = await mkStudent('a');
    await enroll(admin, w.bA, s.user); await w.unlock(w.bA, w.arrays); await solve(s, 'add-two-numbers');
    expect((await s.api.call('get', '/student/dashboard')).body.summary).toMatchObject({ accessibleProblems: 3, verifiedSolved: 1, points: 20 });
    await admin.call('put', `/batches/${w.bA._id}/courses/${w.course._id}/chapters/${w.arrays._id}/access`, { isVisible: false });
    expect((await s.api.call('get', '/student/dashboard')).body.summary).toMatchObject({ accessibleProblems: 0, verifiedSolved: 0, points: 0 });
    expect(await SolveEvidence.countDocuments()).toBe(1);
    await w.unlock(w.bA, w.arrays);
    expect((await s.api.call('get', '/student/dashboard')).body.summary.verifiedSolved).toBe(1);
  });

  it('a new problem added later raises the denominator; verified evidence from before still counts (reuse across courses)', async () => {
    const admin = await login(ADMIN); const w = await world(admin); const s = await mkStudent('a');
    await enroll(admin, w.bA, s.user); await w.unlock(w.bA, w.arrays);
    await solve(s, 'two-sum');
    expect((await s.api.call('get', '/student/dashboard')).body.summary).toMatchObject({ accessibleProblems: 3, verifiedSolved: 1 });
    await admin.call('post', `/chapters/${w.arrays._id}/problems`, { title: 'x', url: 'https://leetcode.com/problems/three-sum/', difficulty: 'MEDIUM' });
    expect((await s.api.call('get', '/student/dashboard')).body.summary).toMatchObject({ accessibleProblems: 4, verifiedSolved: 1 });
    // second course reusing the same problem: the student already has the evidence
    const c2 = (await admin.call('post', '/courses', { title: 'Interview' })).body;
    const ch = (await admin.call('post', `/courses/${c2._id}/chapters`, { title: 'Warmup' })).body;
    await admin.call('post', `/chapters/${ch._id}/problems`, { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'EASY' });
    await admin.call('patch', `/courses/${c2._id}`, { status: 'PUBLISHED' });
    await admin.call('post', `/batches/${w.bA._id}/courses`, { courseId: c2._id });
    await admin.call('put', `/batches/${w.bA._id}/courses/${c2._id}/chapters/${ch._id}/access`, { isVisible: true });
    const bc2 = String((await BatchCourse.findOne({ batchId: w.bA._id, courseId: c2._id }))!._id);
    const d2 = (await s.api.call('get', `/student/dashboard?batchCourseId=${bc2}`)).body;
    expect(d2.summary).toMatchObject({ accessibleProblems: 1, verifiedSolved: 1, completionPct: 100 });
    // combined batch leaderboard counts two-sum once across both courses
    const lb = (await s.api.call('get', `/student/leaderboard?batchCourseId=${bc2}&scope=batch`)).body;
    expect(lb.me.points).toBe(10);
  });

  it('username change: old evidence keeps counting until the new account is verified, then stops, and changing back does NOT restore it', async () => {
    const admin = await login(ADMIN); const w = await world(admin); const s = await mkStudent('a', 'old_name');
    await enroll(admin, w.bA, s.user); await w.unlock(w.bA, w.arrays); await solve(s, 'two-sum');
    const dash = async () => (await s.api.call('get', '/student/dashboard')).body.summary.verifiedSolved;
    expect(await dash()).toBe(1);
    // request a change: the established link still counts while the request is pending
    expect((await s.api.call('post', '/student/leetcode/link', { username: 'new_name', consent: true })).status).toBe(201);
    expect(await dash()).toBe(1);
    // verification completes (simulate the provider proof): old link superseded, evidence stops counting
    const pending = (await LeetcodeLink.findOne({ studentId: s.user._id, isPending: true }))!;
    await LeetcodeLink.updateOne({ _id: s.link._id }, { $set: { status: 'SUPERSEDED', isActive: false, isCurrent: false } });
    await LeetcodeLink.updateOne({ _id: pending._id }, { $set: { status: 'VERIFIED', isPending: false, isCurrent: true } });
    expect(await dash()).toBe(0);
    expect(await SolveEvidence.countDocuments()).toBe(1); // kept
    // changing back to the old username creates a brand-new link, so the old evidence is NOT restored
    await s.api.call('post', '/student/leetcode/link', { username: 'OLD_NAME', consent: true });
    const back = (await LeetcodeLink.findOne({ studentId: s.user._id, isPending: true }))!;
    await LeetcodeLink.updateOne({ _id: pending._id }, { $set: { status: 'SUPERSEDED', isActive: false, isCurrent: false } });
    await LeetcodeLink.updateOne({ _id: back._id }, { $set: { status: 'VERIFIED', isPending: false, isCurrent: true } });
    expect(await dash()).toBe(0);
  });

  it('legacy attested rows never count', async () => {
    const admin = await login(ADMIN); const w = await world(admin); const s = await mkStudent('a');
    await enroll(admin, w.bA, s.user); await w.unlock(w.bA, w.arrays);
    await SolveEvidence.create({ studentId: s.user._id, slug: 'two-sum', leetcodeUsername: 'a', status: 'VERIFIED', source: 'TRAINER_ATTESTATION' }); // legacy: no linkId
    expect((await s.api.call('get', '/student/dashboard')).body.summary.verifiedSolved).toBe(0);
  });

  it('context isolation: cannot read another batch-course; profile cannot change roll number or role', async () => {
    const admin = await login(ADMIN); const w = await world(admin); const s = await mkStudent('a'); const o = await mkStudent('b');
    await enroll(admin, w.bA, s.user); await enroll(admin, w.bB, o.user);
    expect((await s.api.call('get', `/student/dashboard?batchCourseId=${await w.bc(w.bB)}`)).status).toBe(404);
    expect((await s.api.call('get', `/student/leaderboard?batchCourseId=${await w.bc(w.bB)}`)).status).toBe(404);
    expect((await s.api.call('patch', '/student/profile', { rollNumber: 'ZZZZZZZZZZ' })).status).toBe(400);
    expect((await s.api.call('patch', '/student/profile', { leetcodeUsername: 'someone_else' })).status).toBe(400); // must use the ownership flow
    expect((await s.api.call('patch', '/student/profile', { role: 'SUPER_ADMIN' })).status).toBe(400);
    const p = (await s.api.call('get', '/student/profile')).body;
    expect(p.rollNumber).toBe(s.user.rollNumber);
  });
});

describe('leaderboards', () => {
  it('ranks by points, ties share rank (1,2,2,4), deterministic tie order, hides ids and roll numbers from students, highlights me', async () => {
    const admin = await login(ADMIN); const w = await world(admin);
    await w.unlock(w.bA, w.arrays);
    const S = [await mkStudent('a'), await mkStudent('b'), await mkStudent('c'), await mkStudent('d')];
    for (const s of S) await enroll(admin, w.bA, s.user);
    await solve(S[0], 'median-of-two-sorted-arrays'); // 30
    await solve(S[1], 'two-sum'); await solve(S[1], 'add-two-numbers'); // 30
    await solve(S[2], 'two-sum'); // 10
    // d: 0
    const lb = (await S[2].api.call('get', `/student/leaderboard?batchCourseId=${await w.bc(w.bA)}`)).body;
    expect(lb.items.map((r: any) => r.rank)).toEqual([1, 1, 3, 4]);
    expect(lb.items.map((r: any) => r.points)).toEqual([30, 30, 10, 0]);
    expect(lb.items[0].solved).toBe(2); // equal points, more solved listed first
    expect(lb.me).toMatchObject({ isMe: true, rank: 3, points: 10 });
    expect(lb.items.filter((r: any) => r.isMe)).toHaveLength(1);
    expect(JSON.stringify(lb)).not.toMatch(/rollNumber|studentId|@x\.com/);
    expect(lb.top3).toHaveLength(3);
    const p2 = (await S[2].api.call('get', `/student/leaderboard?batchCourseId=${await w.bc(w.bA)}&pageSize=2&page=2`)).body;
    expect(p2.items).toHaveLength(2); expect(p2.me.rank).toBe(3);
  });

  it('course-wide uses only problems unlocked in every batch', async () => {
    const admin = await login(ADMIN); const w = await world(admin);
    await w.unlock(w.bA, w.arrays); await w.unlock(w.bA, w.strings); // A: 4 problems
    await w.unlock(w.bB, w.arrays);                                    // B: 3 problems (subset)
    const a = await mkStudent('a'), b = await mkStudent('b');
    await enroll(admin, w.bA, a.user); await enroll(admin, w.bB, b.user);
    await solve(a, 'valid-anagram');                             // only in A's extra chapter: must not count course-wide
    await solve(a, 'two-sum'); await solve(b, 'two-sum'); await solve(b, 'add-two-numbers');
    const lb = (await a.api.call('get', `/student/leaderboard?batchCourseId=${await w.bc(w.bA)}&scope=course`)).body;
    expect(lb.scope).toMatchObject({ type: 'COURSE', problems: 3, batches: 2 });
    expect(lb.items.map((r: any) => r.points)).toEqual([30, 10]); // b first; a's valid-anagram ignored
    const own = (await a.api.call('get', `/student/leaderboard?batchCourseId=${await w.bc(w.bA)}`)).body;
    expect(own.me.points).toBe(20); // own batch ranking still counts it
  });

  it('course-wide is empty and says so when a participating batch has nothing unlocked', async () => {
    const admin = await login(ADMIN); const w = await world(admin);
    await w.unlock(w.bA, w.arrays); const a = await mkStudent('a'); await enroll(admin, w.bA, a.user);
    const lb = (await a.api.call('get', `/student/leaderboard?batchCourseId=${await w.bc(w.bA)}&scope=course`)).body;
    expect(lb.scope.problems).toBe(0);
    expect(lb.items.every((r: any) => r.completionPct === null)).toBe(true);
  });

  it('removed and suspended students are excluded; deactivated course disappears', async () => {
    const admin = await login(ADMIN); const w = await world(admin); await w.unlock(w.bA, w.arrays);
    const a = await mkStudent('a'), b = await mkStudent('b');
    await enroll(admin, w.bA, a.user); await enroll(admin, w.bA, b.user);
    await admin.call('delete', `/batches/${w.bA._id}/enrollments/${b.user._id}`);
    const lb = (await a.api.call('get', `/student/leaderboard?batchCourseId=${await w.bc(w.bA)}`)).body;
    expect(lb.total).toBe(1);
  });

  it('management leaderboard shows roll numbers, respects trainer assignment; course-wide is admin-only', async () => {
    const admin = await login(ADMIN); const w = await world(admin); await w.unlock(w.bA, w.arrays);
    const a = await mkStudent('a'); await enroll(admin, w.bA, a.user);
    const m = (await admin.call('get', `/leaderboards/batches/${w.bA._id}?courseId=${w.course._id}`)).body;
    expect(m.items[0].rollNumber).toBe(a.user.rollNumber);
    await User.create({ googleSub: 't1', email: 't1@x.com', role: 'TRAINER', fullName: 'T', trainerId: 'tr_t' });
    const t = await login(tok('t1', 't1@x.com', 'T'));
    expect((await t.call('get', `/leaderboards/batches/${w.bA._id}`)).status).toBe(404);
    expect((await t.call('get', `/leaderboards/courses/${w.course._id}`)).status).toBe(403);
    expect((await admin.call('get', `/leaderboards/courses/${w.course._id}`)).status).toBe(200);
  });

  it('Super Admin can change scoring; trainers cannot; invalid values rejected; applies to ranking', async () => {
    const admin = await login(ADMIN); const w = await world(admin); await w.unlock(w.bA, w.arrays);
    const a = await mkStudent('a'); await enroll(admin, w.bA, a.user); await solve(a, 'median-of-two-sorted-arrays');
    expect((await a.api.call('get', `/student/dashboard`)).body.summary.points).toBe(30);
    expect((await admin.call('put', '/settings/scoring', { EASY: 1, MEDIUM: 2, HARD: 100 })).status).toBe(200);
    expect((await a.api.call('get', `/student/dashboard`)).body.summary.points).toBe(100);
    expect((await admin.call('put', '/settings/scoring', { EASY: -1, MEDIUM: 2, HARD: 3 })).status).toBe(400);
    expect((await admin.call('put', '/settings/scoring', { EASY: 1 })).status).toBe(400);
    await User.create({ googleSub: 't1', email: 't1@x.com', role: 'TRAINER', fullName: 'T', trainerId: 'tr_t' });
    const t = await login(tok('t1', 't1@x.com', 'T'));
    expect((await t.call('put', '/settings/scoring', { EASY: 1, MEDIUM: 2, HARD: 3 })).status).toBe(403);
    expect((await t.call('get', '/settings/scoring')).status).toBe(200);
  });
});
