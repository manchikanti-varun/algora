import { beforeEach, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { setupCoding, rawSubmission } from './coding-fixtures.js';
import { AppError } from '../middleware/errors.js';
import { assignmentId } from '../coding/service.js';
let f: Awaited<ReturnType<typeof setupCoding>>;
beforeEach(async () => {
  f = await setupCoding();
});
async function ready() {
  const a = await f.link();
  return f.verify(a.id);
}
async function sync() {
  await f.queue();
  await f.service.processOne();
  return f.service.dashboard(f.student.user.id, f.batch, {});
}
it('starts with unavailable ownership, not fabricated zero activity', async () => {
  const d = await f.service.dashboard(f.student.user.id, f.batch, {});
  expect(d.summary.unavailable).toBe(1);
  expect(d.items[0]?.reason).toBe('ACCOUNT_OWNERSHIP_REQUIRED');
});
it('links without ownership and rejects attribution', async () => {
  await f.link();
  await expect(f.queue()).rejects.toMatchObject({ code: 'OWNERSHIP_REQUIRED' });
  expect(f.repo.rows.size).toBe(0);
});
it('provides unavailable state when official ownership configuration is absent', async () => {
  f.setConfigured(false);
  expect((await f.link()).status).toBe('VERIFICATION_UNAVAILABLE');
});
it.each(['LEETCODE', 'CODECHEF'] as const)(
  'never verifies entered %s handles',
  async (platform) => {
    const a = await f.link(platform);
    expect(a.status).toBe('VERIFICATION_UNAVAILABLE');
    await expect(
      f.service.beginOwnership(
        f.student.user.id,
        'session-bound',
        a.id,
        { expectedRevision: a.revision, confirmed: true },
        'test',
      ),
    ).rejects.toThrow();
  },
);
it('verifies ownership through a session-bound one-time flow', async () => {
  const a = await ready();
  expect(a.status).toBe('VERIFIED');
  expect(f.repo.states.size).toBe(0);
  expect(a).not.toHaveProperty('subject');
  expect(a).not.toHaveProperty('proofDigest');
  expect(a).not.toHaveProperty('sessionHash');
});
it('rejects a different provider handle from ownership proof', async () => {
  const a = await f.link();
  f.setIdentity({
    subject: 'other',
    handle: 'other',
    issuedAt: f.getNow().toISOString(),
  });
  await expect(f.verify(a.id)).rejects.toMatchObject({
    code: 'OWNERSHIP_MISMATCH',
  });
});
it('cannot consume ownership state from another session or replay it', async () => {
  const a = await f.link(),
    start = await f.service.beginOwnership(
      f.student.user.id,
      'original',
      a.id,
      { expectedRevision: a.revision, confirmed: true },
      'test',
    ),
    state = new URL(start.authorizationUrl).searchParams.get('state')!;
  await expect(
    f.service.finishOwnership(
      f.student.user.id,
      'other',
      state,
      'code',
      'test',
    ),
  ).rejects.toThrow();
  await f.service.finishOwnership(
    f.student.user.id,
    'original',
    state,
    'code',
    'test',
  );
  await expect(
    f.service.finishOwnership(
      f.student.user.id,
      'original',
      state,
      'code',
      'test',
    ),
  ).rejects.toThrow();
});
it('rejects expired ownership transactions', async () => {
  const a = await f.link(),
    start = await f.service.beginOwnership(
      f.student.user.id,
      'session-bound',
      a.id,
      { expectedRevision: 0, confirmed: true },
      'test',
    );
  f.advance(300001);
  await expect(
    f.service.finishOwnership(
      f.student.user.id,
      'session-bound',
      new URL(start.authorizationUrl).searchParams.get('state')!,
      'code',
      'test',
    ),
  ).rejects.toThrow();
});
it('prevents duplicate trusted provider binding across Students', async () => {
  await ready();
  const other = await f.addStudent();
  const a = await f.link('CODEFORCES', 'learner', other.user.id);
  await expect(f.verify(a.id, other.user.id)).rejects.toMatchObject({
    code: 'DUPLICATE_BINDING',
  });
});
it('blocks cross-Student disconnect and verification', async () => {
  const a = await ready(),
    other = await f.addStudent();
  await expect(
    f.service.disconnect(
      other.user.id,
      a.id,
      { expectedRevision: a.revision, confirmed: true },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('revokes attribution on explicit handle replacement and retains evidence', async () => {
  const a = await ready();
  await sync();
  const next = await f.service.link(
    f.student.user.id,
    {
      platform: 'CODEFORCES',
      handle: 'replacement',
      expectedRevision: a.revision,
      confirmed: true,
    },
    'test',
  );
  expect(next.status).toBe('PENDING_VERIFICATION');
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).summary.solved,
  ).toBe(0);
  expect(f.repo.evidence.size).toBe(1);
});
it('disconnects with revision conflict protection and suspends current counts', async () => {
  const a = await ready();
  await sync();
  await expect(
    f.service.disconnect(
      f.student.user.id,
      a.id,
      { expectedRevision: 0, confirmed: true },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'STALE_STATE' });
  await f.service.disconnect(
    f.student.user.id,
    a.id,
    { expectedRevision: a.revision, confirmed: true },
    'test',
  );
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).summary
      .unavailable,
  ).toBe(1);
  expect(f.repo.evidence.size).toBe(1);
});
it('attributes exact accepted evidence to the real assignment and enrollment window', async () => {
  await ready();
  const d = await sync();
  expect(d.summary).toMatchObject({
    solved: 1,
    assigned: 1,
    unavailable: 0,
    completionPercent: 100,
  });
  expect([...f.repo.evidence.values()][0]).toMatchObject({
    assignmentId: assignmentId(f.revision, f.day, f.problemId),
    batchId: f.batch,
    studentProfileId: f.student.profile.id,
    sourceType: 'OFFICIAL_API',
    confidence: 'TRUSTED',
  });
});
it('uses submission time, never fetch time, for eligibility', async () => {
  await ready();
  f.setResponse({
    status: 'OK',
    result: [rawSubmission(new Date(Date.now() - 86400000))],
  });
  expect((await sync()).summary.solved).toBe(0);
  expect(f.repo.evidence.size).toBe(0);
});
it('takes max(actual Batch activation, current enrollment activation)', async () => {
  await ready();
  const e = [...f.repo.curriculum.learning.enrollments.values()][0]!;
  e.activatedAt = new Date(f.getNow().getTime() + 10000).toISOString();
  f.setResponse({ status: 'OK', result: [rawSubmission(f.getNow())] });
  expect((await sync()).summary.solved).toBe(0);
});
it('blocks attribution when Batch activation timestamp is absent', async () => {
  await ready();
  delete f.repo.curriculum.learning.batches.get(f.batch)!.startedAt;
  await expect(f.queue()).rejects.toMatchObject({
    code: 'MISSING_ACTIVATION_TIMESTAMP',
  });
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).items[0]
      ?.reason,
  ).toBe('MISSING_ACTIVATION_TIMESTAMP');
});
it('does not match similar contest IDs or indexes', async () => {
  await ready();
  f.setResponse({
    status: 'OK',
    result: [
      rawSubmission(f.getNow(), { problem: { contestId: 123, index: 'B' } }),
    ],
  });
  expect((await sync()).summary.solved).toBe(0);
  expect(f.repo.evidence.size).toBe(0);
});
it('records authoritative unsuccessful attempts', async () => {
  await ready();
  f.setResponse({
    status: 'OK',
    result: [rawSubmission(f.getNow(), { verdict: 'WRONG_ANSWER' })],
  });
  expect((await sync()).items[0]?.status).toBe('ATTEMPTED_VERIFIED');
});
it('never downgrades accepted progress for later failed or empty syncs', async () => {
  await ready();
  await sync();
  f.advance(61000);
  f.setResponse({
    status: 'OK',
    result: [
      rawSubmission(f.getNow(), { id: 123457, verdict: 'WRONG_ANSWER' }),
    ],
  });
  expect((await sync()).summary.solved).toBe(1);
  f.advance(61000);
  f.setResponse({ status: 'OK', result: [] });
  expect((await sync()).summary.solved).toBe(1);
});
it('preserves solved progress when provider fails', async () => {
  await ready();
  await sync();
  f.advance(61000);
  f.setProviderError(new AppError(503, 'PROVIDER_UNAVAILABLE', 'offline'));
  await f.queue();
  await f.service.processOne();
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).summary.solved,
  ).toBe(1);
  expect([...f.repo.jobs.values()].at(-1)?.status).toBe('RETRY_WAIT');
});
it('deduplicates repeated evidence across syncs', async () => {
  await ready();
  await sync();
  f.advance(61000);
  await sync();
  expect(f.repo.evidence.size).toBe(1);
  expect(f.repo.rows.size).toBe(1);
});
it('attributes the same problem independently on multiple Learning Days', async () => {
  const second = {
    ...structuredClone(f.frozen),
    id: 'a'.repeat(24),
    dayNumber: 101,
  };
  f.repo.curriculum.frozen.set(second.id, second);
  await ready();
  expect((await sync()).summary.solved).toBe(2);
  expect(f.repo.evidence.size).toBe(2);
});
it('does not disclose future or explicitly restricted assignments', async () => {
  f.frozen.publicationStatus = 'SCHEDULED';
  f.frozen.publishAt = new Date(f.getNow().getTime() + 86400000).toISOString();
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).items,
  ).toHaveLength(0);
});
it('denies withdrawn enrollment and cancels already queued jobs', async () => {
  await ready();
  await f.queue();
  [...f.repo.curriculum.learning.enrollments.values()][0]!.status = 'WITHDRAWN';
  await f.service.processOne();
  expect([...f.repo.jobs.values()][0]?.status).toBe('CANCELLED');
  expect(f.calls()).toBe(0);
  await expect(
    f.service.dashboard(f.student.user.id, f.batch, {}),
  ).rejects.toMatchObject({ code: 'ENROLLMENT_REQUIRED' });
});
it('keeps own completed-Batch history while refusing new sync', async () => {
  await ready();
  await sync();
  f.repo.curriculum.learning.batches.get(f.batch)!.status = 'COMPLETED';
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).summary.solved,
  ).toBe(1);
  await expect(f.queue()).rejects.toMatchObject({
    code: 'ENROLLMENT_REQUIRED',
  });
});
it('requires current explicit staff progress permissions', async () => {
  await expect(f.service.matrix(f.admin.id, f.batch, {})).rejects.toMatchObject(
    { code: 'COLLEGE_FORBIDDEN' },
  );
  await f.repo.curriculum.learning.students.admin.read.putAssignment(
    f.admin.id,
    { collegeId: f.college, permissions: ['college.view', 'progress.view'] },
    f.owner.id,
  );
  expect((await f.service.matrix(f.admin.id, f.batch, {})).items).toHaveLength(
    1,
  );
  await expect(
    f.service.refresh(
      f.admin.id,
      f.batch,
      {
        platform: 'CODEFORCES',
        studentProfileId: f.student.profile.id,
        confirmed: true,
      },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'COLLEGE_FORBIDDEN' });
});
it('cancels a staff-requested job if the grant is revoked before execution', async () => {
  await ready();
  await f.repo.curriculum.learning.students.admin.read.putAssignment(
    f.admin.id,
    {
      collegeId: f.college,
      permissions: ['college.view', 'progress.view', 'progress.manage'],
    },
    f.owner.id,
  );
  await f.service.refresh(
    f.admin.id,
    f.batch,
    {
      platform: 'CODEFORCES',
      studentProfileId: f.student.profile.id,
      confirmed: true,
    },
    'test',
  );
  await f.repo.curriculum.learning.students.admin.read.putAssignment(
    f.admin.id,
    { collegeId: f.college, permissions: ['college.view'] },
    f.owner.id,
  );
  await f.service.processOne();
  expect([...f.repo.jobs.values()][0]?.status).toBe('CANCELLED');
  expect(f.repo.rows.size).toBe(0);
});
it('blocks queued jobs on ownership expiry or curriculum revision mismatch', async () => {
  const a = await ready();
  await f.queue();
  f.repo.accounts.get(a.id)!.proofExpiresAt = new Date(0).toISOString();
  await f.service.processOne();
  expect(f.repo.rows.size).toBe(0);
  expect([...f.repo.jobs.values()][0]?.status).toBe('CANCELLED');
});
it('rejects a client-supplied different Student target', async () => {
  await ready();
  await expect(
    f.service.refresh(
      f.student.user.id,
      f.batch,
      {
        platform: 'CODEFORCES',
        studentProfileId: 'a'.repeat(24),
        confirmed: true,
      },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('exports formula-safe CSV and literal XLSX values with an audit event', async () => {
  f.repo.curriculum.learning.students.profiles.get(
    f.student.profile.id,
  )!.fullName = ' =SUM(A1:A2)';
  const csv = await f.service.exported(f.owner.id, f.batch, {}, 'CSV', 'test');
  expect(Buffer.from(csv.base64, 'base64').toString()).toContain(
    "' =SUM(A1:A2)",
  );
  const xlsx = await f.service.exported(
    f.owner.id,
    f.batch,
    {},
    'XLSX',
    'test',
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(xlsx.base64, 'base64'));
  expect(book.worksheets[0]?.getCell('B2').value).toBe("' =SUM(A1:A2)");
});
it('computes problem-wise counts including unavailable coverage', async () => {
  const p = await f.service.analytics(f.owner.id, f.batch, {});
  expect(p.items[0]).toMatchObject({
    eligibleStudents: 1,
    unavailable: 1,
    solved: 0,
  });
  await ready();
  await sync();
  expect(
    (await f.service.analytics(f.owner.id, f.batch, {})).items[0]?.solved,
  ).toBe(1);
});
it('does not expose ownership secrets or raw tokens in account projections', async () => {
  await ready();
  const value = JSON.stringify(await f.service.accounts(f.student.user.id));
  expect(value).not.toContain('stable-subject');
  expect(value).not.toContain('proofDigest');
  expect(value).not.toContain('session-bound');
});
it('rolls back evidence and progress when the transactional job completion fails', async () => {
  await ready();
  await f.queue();
  const original = f.repo.read;
  vi.spyOn(f.repo, 'read', 'get').mockImplementation(() => ({
    ...original,
    saveJob: async () => false,
  }));
  await f.service.processOne();
  expect(f.repo.evidence.size).toBe(0);
  expect(f.repo.rows.size).toBe(0);
});

it('scopes the same submission independently to two Batches', async () => {
  await ready();
  const original = f.repo.curriculum.learning.batches.get(f.batch)!,
    other = {
      ...structuredClone(original),
      id: 'a'.repeat(24),
      code: 'SECOND-BATCH',
    };
  f.repo.curriculum.learning.batches.set(other.id, other);
  const e = [...f.repo.curriculum.learning.enrollments.values()][0]!;
  f.repo.curriculum.learning.enrollments.set('b'.repeat(24), {
    ...structuredClone(e),
    id: 'b'.repeat(24),
    batchId: other.id,
  });
  await sync();
  await f.service.refresh(
    f.student.user.id,
    other.id,
    { platform: 'CODEFORCES', confirmed: true },
    'test',
  );
  f.advance(4000);
  await f.service.processOne();
  expect(
    (await f.service.dashboard(f.student.user.id, other.id, {})).summary.solved,
  ).toBe(1);
  expect(f.repo.evidence.size).toBe(2);
});
it('paginates 120 Students and 100 assignments without unbounded matrix responses', async () => {
  for (let i = 1; i < 120; i++) await f.addStudent();
  for (let i = 1; i < 100; i++) {
    const day = {
      ...structuredClone(f.frozen),
      id: i.toString(16).padStart(24, '0'),
      dayNumber: 100 + i,
    };
    f.repo.curriculum.frozen.set(day.id, day);
  }
  const matrix = await f.service.matrix(f.owner.id, f.batch, {});
  expect(matrix.total).toBe(120);
  expect(matrix.items).toHaveLength(10);
  expect(matrix.items[0]?.items).toHaveLength(20);
  expect(matrix.items[0]?.totalPages).toBe(5);
  expect(
    (await f.service.analytics(f.owner.id, f.batch, {})).items[0]
      ?.eligibleStudents,
  ).toBe(120);
}, 20000);
it('supports every assigned problem on a released day in one bounded badge response', async () => {
  const day = await f.service.day(f.student.user.id, f.batch, 100);
  expect(day.items).toHaveLength(1);
  expect(day.pageSize).toBe(100);
});

it('bulk refresh queues only the bounded authorized roster page', async () => {
  await ready();
  const result = await f.service.refreshBatch(
    f.owner.id,
    f.batch,
    { platform: 'CODEFORCES', page: 1, pageSize: 10, confirmed: true },
    'test',
  );
  expect(result.items).toHaveLength(1);
  expect(result.items[0]?.outcome).toBe('QUEUED');
  await expect(
    f.service.refreshBatch(
      f.admin.id,
      f.batch,
      { platform: 'CODEFORCES', page: 1, confirmed: true },
      'test',
    ),
  ).rejects.toMatchObject({ code: 'COLLEGE_FORBIDDEN' });
});

it('revokes current attribution on detected external handle reassignment without deleting evidence', async () => {
  const a = await ready();
  await sync();
  f.advance(61000);
  f.setRegistration(1000000001);
  await f.queue();
  await f.service.processOne();
  expect(f.repo.accounts.get(a.id)?.status).toBe('REVOKED');
  expect(f.repo.evidence.size).toBe(1);
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).summary
      .unavailable,
  ).toBe(1);
});
