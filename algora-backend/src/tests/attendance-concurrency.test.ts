import { beforeEach, it, expect, vi, afterEach } from 'vitest';
import { setupAttendance } from './attendance-setup.js';
import { listSchema } from '../attendance/contracts.js';
import { LearningService } from '../learning/service.js';
import { batchInput } from './learning-fixtures.js';
let f: Awaited<ReturnType<typeof setupAttendance>>;
const t = (expectedRevision: number) => ({
  expectedRevision,
  reason: 'Reviewed in-person attendance evidence',
  confirmed: true,
});
beforeEach(async () => {
  f = await setupAttendance();
});
afterEach(() => vi.restoreAllMocks());
it('serializes scan before closing without losing the mark', async () => {
  const a = await f.addStudent(),
    s = await f.session();
  await Promise.all([
    f.service.scan(f.admin.id, f.batch, s.id, { credential: a.token }, 'test'),
    f.service.transition(f.admin.id, f.batch, s.id, 'close', t(1), 'test'),
  ]);
  expect(f.repo.rows.size).toBe(1);
  expect(f.repo.sessions.get(s.id)?.status).toBe('CLOSED');
});
it('closing before scan denies the delayed request', async () => {
  const a = await f.addStudent(),
    s = await f.session();
  const results = await Promise.allSettled([
    f.service.transition(f.admin.id, f.batch, s.id, 'close', t(1), 'test'),
    f.service.scan(f.admin.id, f.batch, s.id, { credential: a.token }, 'test'),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(f.repo.rows.size).toBe(0);
});
it('finalization racing with a delayed scan cannot create a present record', async () => {
  const a = await f.addStudent(),
    s = await f.session();
  await f.service.transition(f.admin.id, f.batch, s.id, 'close', t(1), 'test');
  const results = await Promise.allSettled([
    f.service.transition(f.admin.id, f.batch, s.id, 'finalize', t(2), 'test'),
    f.service.scan(f.admin.id, f.batch, s.id, { credential: a.token }, 'test'),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect([...f.repo.rows.values()][0].status).toBe('ABSENT');
});
it('simultaneous finalizers publish one official result', async () => {
  await f.addStudent();
  const s = await f.session();
  await f.service.transition(f.admin.id, f.batch, s.id, 'close', t(1), 'test');
  const result = await Promise.allSettled([
    f.service.transition(f.admin.id, f.batch, s.id, 'finalize', t(2), 'test'),
    f.service.transition(f.admin.id, f.batch, s.id, 'finalize', t(2), 'test'),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(f.repo.rows.size).toBe(1);
  expect(
    f.repo.events.filter((r) => r.action === 'ATTENDANCE_SESSION_FINALIZED'),
  ).toHaveLength(1);
});
it('simultaneous corrections preserve one expected-revision transition', async () => {
  await f.addStudent();
  const s = await f.session();
  await f.service.transition(f.admin.id, f.batch, s.id, 'close', t(1), 'test');
  await f.service.transition(
    f.admin.id,
    f.batch,
    s.id,
    'finalize',
    t(2),
    'test',
  );
  const r = [...f.repo.rows.values()][0],
    result = await Promise.allSettled(
      (['PRESENT', 'EXCUSED'] as const).map((status) =>
        f.service.correct(
          f.admin.id,
          f.batch,
          s.id,
          r.id,
          { ...t(3), expectedRecordRevision: 0, status },
          'test',
        ),
      ),
    );
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    f.repo.events.filter((h) => h.action === 'ATTENDANCE_RECORD_CORRECTED'),
  ).toHaveLength(1);
});
it('rotation committed before scan invalidates the old token', async () => {
  const a = await f.addStudent(),
    s = await f.session();
  const result = await Promise.allSettled([
    f.students.rotate(
      a.user.id,
      { expectedVersion: a.profile.qrCredentialVersion, confirmed: true },
      'test',
    ),
    f.service.scan(f.admin.id, f.batch, s.id, { credential: a.token }, 'test'),
  ]);
  expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(f.repo.rows.size).toBe(0);
});
it('withdrawal committed before scan blocks current attendance', async () => {
  const a = await f.addStudent(),
    s = await f.session(),
    e = [...f.repo.curriculum.learning.enrollments.values()][0];
  const result = await Promise.allSettled([
    f.learning.withdraw(
      f.owner.id,
      f.batch,
      e.id,
      { ...t(e.revision) },
      'test',
    ),
    f.service.scan(f.admin.id, f.batch, s.id, { credential: a.token }, 'test'),
  ]);
  expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(f.repo.rows.size).toBe(0);
});
it('a same-College different Batch still requires its own enrollment', async () => {
  const a = await f.addStudent(),
    learning = f.repo.curriculum.learning;
  const b = await f.learning.saveBatch(
    f.owner.id,
    { ...batchInput(f.college, f.course), code: 'OTHER', name: 'Other Batch' },
    undefined,
    'test',
  );
  await f.learning.batchStatus(
    f.owner.id,
    b.id,
    'ACTIVE',
    { expectedRevision: 0, confirmed: true },
    'test',
  );
  const impact = await f.curriculum.assignmentPreview(
    f.owner.id,
    b.id,
    f.revision,
  );
  await f.curriculum.assign(
    f.owner.id,
    b.id,
    {
      curriculumRevisionId: f.revision,
      expectedBatchRevision: impact.batchRevision,
      expectedPreviousRevisionId: null,
      impactFingerprint: impact.impactFingerprint,
      reason: 'Reviewed alternate Batch curriculum delivery',
      confirmed: true,
    },
    'test',
  );
  const s = await f.service.create(
    f.admin.id,
    b.id,
    { learningDayId: f.day, sessionType: 'MORNING' },
    'test',
  );
  await f.service.transition(f.admin.id, b.id, s.id, 'open', t(0), 'test');
  await expect(
    f.service.scan(f.admin.id, b.id, s.id, { credential: a.token }, 'test'),
  ).rejects.toMatchObject({ code: 'ENROLLMENT_REQUIRED' });
  expect([...learning.enrollments.values()][0].batchId).toBe(f.batch);
});
it('failed correction audit rolls back record and history', async () => {
  await f.addStudent();
  const s = await f.session();
  await f.service.transition(f.admin.id, f.batch, s.id, 'close', t(1), 'test');
  await f.service.transition(
    f.admin.id,
    f.batch,
    s.id,
    'finalize',
    t(2),
    'test',
  );
  const r = [...f.repo.rows.values()][0],
    unit = f.repo.curriculum.learning.students.admin.read;
  vi.spyOn(unit, 'audit').mockRejectedValue(Error('audit failed'));
  await expect(
    f.service.correct(
      f.admin.id,
      f.batch,
      s.id,
      r.id,
      { ...t(3), expectedRecordRevision: 0, status: 'PRESENT' },
      'test',
    ),
  ).rejects.toThrow();
  expect(f.repo.rows.get(r.id)?.status).toBe('ABSENT');
  expect(
    f.repo.events.filter((r) => r.action === 'ATTENDANCE_RECORD_CORRECTED'),
  ).toHaveLength(0);
});
it('historical own Batch discovery does not grant private learning access', async () => {
  const a = await f.addStudent(),
    b = await f.addStudent(false),
    s = await f.session();
  await f.service.transition(f.admin.id, f.batch, s.id, 'close', t(1), 'test');
  await f.service.transition(
    f.admin.id,
    f.batch,
    s.id,
    'finalize',
    t(2),
    'test',
  );
  f.repo.curriculum.learning.batches.get(f.batch)!.status = 'COMPLETED';
  expect(
    (await f.service.ownBatches(a.user.id, listSchema.parse({}))).items[0].id,
  ).toBe(f.batch);
  expect(
    (await f.service.ownBatches(b.user.id, listSchema.parse({}))).items,
  ).toHaveLength(0);
  await expect(
    new LearningService(f.repo.curriculum.learning).effective(
      a.user.id,
      f.batch,
    ),
  ).rejects.toMatchObject({ status: 403 });
});
