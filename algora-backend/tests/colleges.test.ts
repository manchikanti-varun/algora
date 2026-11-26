import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, login, resetDb, startDb, stopDb, studentBody, tok } from './helpers';
import { Batch, College, Enrollment, TrainerBatchAssignment, User } from '../src/models';
import { collegeRegistryReport, applyCollegeMerge, previewCollegeMerge } from '../src/modules/colleges/reconcile';
import { registryFields } from '../src/modules/colleges/registry';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const mk = async (name: string, code: string, aliases: string[] = []) => College.create(await registryFields({ name, code, aliases }));

const admin = () => login(tok('sub-admin', 'admin@example.com', 'Admin'));
const register = (sub: string, rollNumber: string, collegeId: string) => request(app).post('/api/v1/auth/register/student')
  .set('Origin', 'http://localhost:3000').send({ idToken: tok(sub, `${sub}@x.com`, 'Student Name'), ...studentBody({ rollNumber, collegeId, leetcodeUsername: sub }) });
const search = (q: string) => request(app).get(`/api/v1/auth/colleges?q=${encodeURIComponent(q)}`);

describe('college registry workflow', () => {
  it('resolves name, code and aliases to one record and rejects duplicate codes, names and aliases', async () => {
    const a = await admin();
    const ace = (await a.call('post', '/colleges', { name: 'Ace Engineering College', code: 'ACEEC', aliases: ['ACE'] })).body;
    for (const q of ['ACE', 'ACEEC', 'Ace Engineering College']) {
      const found = (await search(q)).body.items.filter((item: any) => item._id === ace._id);
      expect(found, q).toHaveLength(1);
      expect(found[0].name).toBe('Ace Engineering College [ACEEC]');
    }
    expect((await a.call('post', '/colleges', { name: 'Another College', code: 'ACEEC' })).status).toBe(409);
    expect((await a.call('post', '/colleges', { name: 'Another College', code: 'AC2', aliases: ['ace'] })).status).toBe(409);
    expect((await a.call('post', '/colleges', { name: 'ace engineering college', code: 'AC3' })).status).toBe(409);
  });

  it('archived colleges disappear from selection and cannot be used for registration or batches', async () => {
    const a = await admin();
    const ace = (await a.call('post', '/colleges', { name: 'Ace Engineering College', code: 'ACEEC', aliases: ['ACE'] })).body;
    expect((await a.call('patch', `/colleges/${ace._id}`, { status: 'ARCHIVED' })).status).toBe(200);
    expect((await search('ACE')).body.items.some((item: any) => item._id === ace._id)).toBe(false);
    expect((await register('archived', 'AR12CD34EF', ace._id)).status).toBe(400);
    expect((await a.call('post', '/batches', { name: 'Archived batch', collegeId: ace._id })).status).toBe(400);
  });

  it('supports registration, batch association, both approvers, filters and reports', async () => {
    const a = await admin();
    const ace = (await a.call('post', '/colleges', { name: 'Ace Engineering College', code: 'ACEEC', aliases: ['ACEEC'] })).body;
    const ou = (await a.call('post', '/colleges', { name: 'Osmania University', code: 'OU' })).body;
    expect((await register('s-one', 'AA12CD34EF', ace._id)).status).toBe(201);
    expect((await register('s-two', 'BB12CD34EF', ace._id)).status).toBe(201);

    const batch = (await a.call('post', '/batches', { name: 'ACE batch', status: 'ACTIVE', collegeId: ace._id })).body;
    expect((await a.call('get', `/batches/${batch._id}`)).body.college).toBe('Ace Engineering College [ACEEC]');
    for (const rollNumber of ['AA12CD34EF', 'BB12CD34EF']) expect((await a.call('post', `/batches/${batch._id}/enrollments`, { rollNumber })).status).toBe(201);
    const trainer = await User.create({ googleSub: 'tr', email: 'tr@x.com', role: 'TRAINER', fullName: 'Trainer One', trainerId: 'tr_one' });
    await TrainerBatchAssignment.create({ trainerId: trainer._id, batchId: batch._id, assignedBy: trainer._id });
    const t = await login(tok('tr', 'tr@x.com', 'Trainer One'));

    const s1 = await login(tok('s-one', 's-one@x.com', 'Student Name'));
    const r1 = await s1.call('patch', '/student/profile', { collegeId: ou._id, reason: 'I moved to Osmania' });
    expect(r1.status).toBe(202);
    expect((await t.call('post', `/student-requests/${r1.body._id}/review`, { status: 'APPROVED' })).status).toBe(200);
    expect((await s1.call('get', '/student/profile')).body.college).toBe('Osmania University [OU]');

    const s2 = await login(tok('s-two', 's-two@x.com', 'Student Name'));
    const r2 = await s2.call('patch', '/student/profile', { collegeId: ou._id, reason: 'College correction' });
    expect((await a.call('post', `/student-requests/${r2.body._id}/review`, { status: 'APPROVED' })).status).toBe(200);
    expect((await s2.call('get', '/student/profile')).body.college).toBe('Osmania University [OU]');

    expect((await a.call('get', `/students?collegeId=${ou._id}`)).body.total).toBe(2);
    const course = (await a.call('post', '/courses', { title: 'College report course' })).body;
    const chapter = (await a.call('post', `/courses/${course._id}/chapters`, { title: 'Basics' })).body;
    await a.call('post', `/chapters/${chapter._id}/problems`, { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'EASY' });
    await a.call('patch', `/courses/${course._id}`, { status: 'PUBLISHED' });
    await a.call('post', `/batches/${batch._id}/courses`, { courseId: course._id });
    const csv = (await a.call('get', '/reports/export?type=student')).text;
    expect(csv).toContain('Osmania University');

    expect((await a.call('patch', `/batches/${batch._id}`, { collegeId: ou._id })).status).toBe(200);
    expect((await a.call('get', `/batches/${batch._id}`)).body.college).toBe('Osmania University [OU]');
  });
});

describe('college registry reconciliation', () => {
  it('reports legacy records and same-name candidates without changing anything', async () => {
    const canonical = await mk('Ace Engineering College', 'ACEEC', ['ACE', 'Ace Engg']);
    const duplicate = await mk('Ace-Engineering College', 'ACE2');
    await College.create({ name: 'Legacy College', nameKey: 'legacy college' }); // pre-registry record without a code
    const student = await User.create({ googleSub: 's1', email: 's1@x.com', role: 'STUDENT', fullName: 'S', rollNumber: 'AB12CD34EF', collegeId: duplicate._id });
    await Batch.create({ name: 'B', collegeId: duplicate._id, createdBy: student._id });

    const report = await collegeRegistryReport();
    expect(report.totals).toMatchObject({ colleges: 4, missingCode: 1, merged: 0 }); // includes the fixture college
    expect(report.missingCodes[0]).toMatchObject({ name: 'Legacy College' });
    const group = report.duplicateCandidates.find((g) => g.key === 'aceengineeringcollege');
    expect(group?.suggestedTargetId).toBe(String(canonical._id));
    expect(group?.colleges.find((c) => c._id === String(duplicate._id))).toMatchObject({ students: 1, batches: 1 });

    const preview = await previewCollegeMerge(duplicate._id, canonical._id);
    expect(preview).toMatchObject({ students: 1, batches: 1, alreadyMerged: false });
    expect((await College.findById(duplicate._id))!.mergedInto).toBeUndefined(); // dry run wrote nothing
    expect((await User.findById(student._id))!.collegeId?.toString()).toBe(String(duplicate._id));
  });

  it('reports alias conflicts from legacy records without resolving them', async () => {
    await College.create({ name: 'Alias One', nameKey: 'alias one', code: 'A1', aliases: ['Shared'] });
    await College.create({ name: 'Alias Two', nameKey: 'alias two', code: 'A2', aliases: ['Shared'] });
    const report = await collegeRegistryReport();
    expect(report.aliasConflicts.find((conflict) => conflict.key === 'shared')?.colleges).toHaveLength(2);
    expect(report.manualReview.some((item) => item.reason === 'alias conflict: shared')).toBe(true);
    expect(report.totals.aliasConflicts).toBe(1);
  });

  it('merges explicitly and is idempotent', async () => {
    const canonical = await mk('Ace Engineering College', 'ACEEC');
    const duplicate = await mk('Ace Engineering College (old)', 'ACE2');
    const student = await User.create({ googleSub: 's1', email: 's1@x.com', role: 'STUDENT', fullName: 'S', rollNumber: 'AB12CD34EF', collegeId: duplicate._id });

    expect(await applyCollegeMerge(duplicate._id, canonical._id)).toMatchObject({ alreadyMerged: false, students: 1, batches: 0 });
    expect((await User.findById(student._id))!.collegeId?.toString()).toBe(String(canonical._id));
    expect((await College.findById(duplicate._id))!).toMatchObject({ status: 'ARCHIVED' });
    expect(String((await College.findById(duplicate._id))!.mergedInto)).toBe(String(canonical._id));

    expect(await applyCollegeMerge(duplicate._id, canonical._id)).toMatchObject({ alreadyMerged: true, students: 0 });
    expect((await User.findById(student._id))!.collegeId?.toString()).toBe(String(canonical._id));
  });
});
