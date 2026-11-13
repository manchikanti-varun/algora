import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { setupAttendance } from './attendance-setup.js';
import {
  listSchema,
  createSchema,
  scanSchema,
  transitionSchema,
} from '../attendance/contracts.js';
import { percentage, csvCell } from '../attendance/service.js';
import {
  AttendanceSession,
  AttendanceRosterSnapshot,
  AttendanceRecord,
  AttendanceHistory,
} from '../models/attendance.js';
import { SessionService, csrfFor } from '../auth/session-service.js';
import { createApp } from '../app.js';
import { identity } from './auth-fixtures.js';
import request from 'supertest';
let f: Awaited<ReturnType<typeof setupAttendance>>;
const o = listSchema.parse({});
const transition = (expectedRevision: number) => ({
  expectedRevision,
  confirmed: true,
  reason: 'Reviewed attendance operation with evidence',
});
beforeEach(async () => {
  f = await setupAttendance();
});
afterEach(() => vi.restoreAllMocks());
const scan = (session: string, token: string, actor = f.admin.id) =>
  f.service.scan(actor, f.batch, session, { credential: token }, 'test');
async function finalize(id: string) {
  let s = f.repo.sessions.get(id)!;
  if (s.status === 'OPEN')
    s = (await f.service.transition(
      f.admin.id,
      f.batch,
      id,
      'close',
      transition(s.revision),
      'test',
    ))!;
  return f.service.transition(
    f.admin.id,
    f.batch,
    id,
    'finalize',
    transition(s.revision),
    'test',
  );
}
describe('attendance contracts and calculations', () => {
  it.each(['EVENING', 'NIGHT', 'CUSTOM'])(
    'rejects unsupported session type %s',
    (sessionType) =>
      expect(
        createSchema.safeParse({ learningDayId: f.day, sessionType }).success,
      ).toBe(false),
  );
  it.each([
    'bad',
    'a'.repeat(1000),
    'http://example.org/qr',
    '<script>attack</script>',
  ])('rejects malformed credential %s', (credential) =>
    expect(scanSchema.safeParse({ credential }).success).toBe(false),
  );
  it('rejects scan identity mass assignment', () =>
    expect(
      scanSchema.safeParse({
        credential: 'a'.repeat(43),
        studentProfileId: f.admin.id,
      }).success,
    ).toBe(false));
  it('requires meaningful reasons and explicit confirmation', () =>
    expect(
      transitionSchema.safeParse({
        expectedRevision: 0,
        reason: 'x',
        confirmed: false,
      }).success,
    ).toBe(false));
  it('calculates finalized percentage with zero denominator N/A', () => {
    expect(percentage(0, 0)).toBeNull();
    expect(percentage(3, 1)).toBe(75);
  });
  it.each(['=SUM(A1:A2)', '+cmd', '-1', '@SUM(A1)', ' \t=cmd', '\tcmd'])(
    'escapes CSV formula prefix %s',
    (v) => expect(csvCell(v)).toContain("'"),
  );
  it('quotes CSV delimiters and multiline names', () =>
    expect(csvCell('Example, "Learner"\nName')).toBe(
      '"Example, ""Learner""\nName"',
    ));
});
describe('lifecycle and immutable rosters', () => {
  it('creates exactly the supported canonical slots without absence', async () => {
    const morning = await f.session('MORNING', false),
      afternoon = await f.session('AFTERNOON', false);
    expect(morning.status).toBe('DRAFT');
    expect(afternoon.sessionType).toBe('AFTERNOON');
    expect(f.repo.rows.size).toBe(0);
    expect(f.repo.rosterRows.size).toBe(0);
    await expect(f.session('MORNING', false)).rejects.toThrow();
  });
  it('captures only verified currently eligible members at open', async () => {
    await f.addStudent();
    await f.addStudent(false);
    await f.addStudent(true, false);
    const s = await f.session();
    expect(s.rosterCount).toBe(1);
    expect(
      (await f.service.roster(f.admin.id, f.batch, s.id, o)).counts,
    ).toMatchObject({ unmarked: 1, absent: 0, present: 0 });
  });
  it('allows close/reopen with reason, preserving original roster', async () => {
    await f.addStudent();
    let s = await f.session();
    s = (await f.service.transition(
      f.admin.id,
      f.batch,
      s.id,
      'close',
      transition(s.revision),
      'test',
    ))!;
    await f.addStudent();
    s = (await f.service.transition(
      f.admin.id,
      f.batch,
      s.id,
      'reopen',
      transition(s.revision),
      'test',
    ))!;
    expect(s.status).toBe('OPEN');
    expect(await f.repo.read.roster(s.id)).toHaveLength(1);
  });
  it('rejects invalid transitions and stale concurrent opens', async () => {
    const s = await f.session('MORNING', false);
    await expect(
      f.service.transition(
        f.admin.id,
        f.batch,
        s.id,
        'finalize',
        transition(0),
        'test',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    const result = await Promise.allSettled([
      f.service.transition(
        f.admin.id,
        f.batch,
        s.id,
        'open',
        transition(0),
        'test',
      ),
      f.service.transition(
        f.admin.id,
        f.batch,
        s.id,
        'open',
        transition(0),
        'test',
      ),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('does not silently admit new enrollments and reviews additive refresh', async () => {
    const s = await f.session(),
      student = await f.addStudent();
    await expect(scan(s.id, student.token)).rejects.toMatchObject({
      code: 'ROSTER_REFRESH_REQUIRED',
    });
    const impact = await f.service.refreshPreview(f.admin.id, f.batch, s.id);
    expect(impact.additions).toBe(1);
    await f.service.refresh(
      f.admin.id,
      f.batch,
      s.id,
      {
        ...transition(s.revision),
        impactFingerprint: impact.impactFingerprint,
      },
      'test',
    );
    expect((await scan(s.id, student.token)).outcome).toBe('MARKED');
  });
  it('rejects stale roster impact when another member joins', async () => {
    const s = await f.session();
    await f.addStudent();
    const review = await f.service.refreshPreview(f.admin.id, f.batch, s.id);
    await f.addStudent();
    await expect(
      f.service.refresh(
        f.admin.id,
        f.batch,
        s.id,
        {
          ...transition(s.revision),
          impactFingerprint: review.impactFingerprint,
        },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'STALE_IMPACT' });
    expect(f.repo.rosterRows.size).toBe(0);
  });
  it('preserves original name and roll snapshots across identity edits', async () => {
    const student = await f.addStudent(),
      s = await f.session(),
      original = (await f.repo.read.roster(s.id))[0];
    f.repo.curriculum.learning.students.profiles.get(
      student.profile.id,
    )!.fullName = 'Later corrected name';
    expect((await f.repo.read.roster(s.id))[0].studentNameSnapshot).toBe(
      original.studentNameSnapshot,
    );
  });
  it('retains withdrawn roster members and creates absence at finalization only', async () => {
    const student = await f.addStudent(),
      s = await f.session();
    const e = [...f.repo.curriculum.learning.enrollments.values()].find(
      (e) => e.studentProfileId === student.profile.id,
    )!;
    e.status = 'WITHDRAWN';
    expect(
      (await f.service.roster(f.admin.id, f.batch, s.id, o)).counts.unmarked,
    ).toBe(1);
    await expect(scan(s.id, student.token)).rejects.toMatchObject({
      status: 403,
    });
    await finalize(s.id);
    expect(
      (await f.service.roster(f.admin.id, f.batch, s.id, o)).counts.absent,
    ).toBe(1);
  });
  it('rejects unrelated and unreleased Learning Days', async () => {
    await expect(
      f.service.create(
        f.admin.id,
        f.batch,
        { learningDayId: f.owner.id, sessionType: 'MORNING' },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'DAY_NOT_ASSIGNED' });
    const frozen = [...f.repo.curriculum.frozen.values()][0];
    frozen.publicationStatus = 'UNPUBLISHED';
    await expect(f.session()).rejects.toMatchObject({ code: 'DAY_RESTRICTED' });
  });
  it('blocks curriculum replacement after even a draft attendance session exists', async () => {
    await f.session('MORNING', false);
    const clone = await f.curriculum.newDraft(
      f.owner.id,
      f.course,
      { sourceRevisionId: f.revision },
      'test',
    );
    await f.curriculum.publish(
      f.owner.id,
      f.course,
      clone.id,
      { expectedRevision: 0, confirmed: true },
      'test',
    );
    const impact = await f.curriculum.assignmentPreview(
      f.owner.id,
      f.batch,
      clone.id,
    );
    await expect(
      f.curriculum.assign(
        f.owner.id,
        f.batch,
        {
          curriculumRevisionId: clone.id,
          expectedBatchRevision: impact.batchRevision,
          expectedPreviousRevisionId: f.revision,
          impactFingerprint: impact.impactFingerprint,
          reason: 'Reviewed incompatible curriculum upgrade',
          confirmed: true,
        },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_HISTORY_LOCKED' });
  });
});
describe('secure QR scans', () => {
  it('reuses Phase 4 QR hash and records authorized current enrollment once', async () => {
    const student = await f.addStudent(),
      s = await f.session();
    expect((await scan(s.id, student.token)).outcome).toBe('MARKED');
    expect((await scan(s.id, student.token)).outcome).toBe('ALREADY_MARKED');
    expect(f.repo.rows.size).toBe(1);
    expect(
      f.repo.events.filter((h) => h.action === 'ATTENDANCE_QR_MARKED'),
    ).toHaveLength(1);
    expect(JSON.stringify(f.repo.events)).not.toContain(student.token);
  });
  it('handles simultaneous duplicate scans idempotently', async () => {
    const student = await f.addStudent(),
      s = await f.session();
    const responses = await Promise.all([
      scan(s.id, student.token),
      scan(s.id, student.token),
    ]);
    expect(responses.map((r) => r.outcome).sort()).toEqual([
      'ALREADY_MARKED',
      'MARKED',
    ]);
    expect(f.repo.rows.size).toBe(1);
  });
  it('rotation invalidates old copies', async () => {
    const student = await f.addStudent(),
      s = await f.session();
    await f.students.rotate(
      student.user.id,
      { expectedVersion: student.profile.qrCredentialVersion, confirmed: true },
      'test',
    );
    await expect(scan(s.id, student.token)).rejects.toMatchObject({
      code: 'INVALID_OR_REVOKED_QR',
    });
    expect(f.repo.rows.size).toBe(0);
  });
  it('does not reveal identity for unknown QR', async () => {
    const s = await f.session();
    await expect(scan(s.id, 'a'.repeat(43))).rejects.toMatchObject({
      code: 'INVALID_OR_REVOKED_QR',
      message: 'QR is invalid or was rotated',
    });
  });
  it.each([
    'unverified',
    'unenrolled',
    'pending',
    'withdrawn',
    'suspended',
    'wrongCollege',
    'rollChanged',
    'wrongRole',
    'credentialVersion',
    'collegeInactive',
    'courseArchived',
    'batchCompleted',
    'adminRevoked',
    'restrictedDay',
  ])('denies scan after %s', async (kind) => {
    const student = await f.addStudent(),
      s = await f.session(),
      learning = f.repo.curriculum.learning,
      p = learning.students.profiles.get(student.profile.id)!,
      e = [...learning.enrollments.values()][0];
    if (kind === 'unverified') p.verificationStatus = 'PENDING_VERIFICATION';
    if (kind === 'unenrolled') learning.enrollments.clear();
    if (kind === 'pending') e.status = 'PENDING_VERIFICATION';
    if (kind === 'withdrawn') e.status = 'WITHDRAWN';
    if (kind === 'suspended')
      learning.students.admin.auth.users.get(student.user.id)!.accountStatus =
        'SUSPENDED';
    if (kind === 'wrongCollege') p.collegeId = f.owner.id;
    if (kind === 'rollChanged') p.rollNumber = 'DIFFERENT1';
    if (kind === 'wrongRole')
      learning.students.admin.auth.users.get(student.user.id)!.role = 'ADMIN';
    if (kind === 'credentialVersion') p.qrCredentialVersion++;
    if (kind === 'collegeInactive')
      learning.students.admin.colleges.get(f.college)!.status = 'INACTIVE';
    if (kind === 'courseArchived')
      learning.courses.get(f.course)!.status = 'ARCHIVED';
    if (kind === 'batchCompleted')
      learning.batches.get(f.batch)!.status = 'COMPLETED';
    if (kind === 'adminRevoked')
      for (const a of learning.students.admin.assignments.values())
        a.status = 'REVOKED';
    if (kind === 'restrictedDay')
      await f.curriculum.release(
        f.owner.id,
        f.batch,
        f.day,
        {
          restricted: true,
          expectedRevision: 0,
          reason: 'Restrict current learning access for review',
          confirmed: true,
        },
        'test',
      );
    await expect(scan(s.id, student.token)).rejects.toBeInstanceOf(Error);
    expect(f.repo.rows.size).toBe(0);
  });
  it('rejects known Student acting as scanner', async () => {
    const student = await f.addStudent(),
      s = await f.session();
    await expect(
      scan(s.id, student.token, student.user.id),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('rejects scanning after closure and after finalization', async () => {
    const student = await f.addStudent(),
      s = await f.session();
    await f.service.transition(
      f.admin.id,
      f.batch,
      s.id,
      'close',
      transition(1),
      'test',
    );
    await expect(scan(s.id, student.token)).rejects.toMatchObject({
      code: 'SESSION_CLOSED',
    });
    await finalize(s.id);
    await expect(scan(s.id, student.token)).rejects.toMatchObject({
      code: 'SESSION_CLOSED',
    });
  });
  it('rolls back marked record and history if audit is unavailable', async () => {
    const student = await f.addStudent(),
      s = await f.session(),
      a = f.repo.curriculum.learning.students.admin;
    vi.spyOn(a.read, 'audit').mockRejectedValue(Error('audit failed'));
    await expect(scan(s.id, student.token)).rejects.toThrow();
    expect(f.repo.rows.size).toBe(0);
    expect(
      f.repo.events.filter((h) => h.action === 'ATTENDANCE_QR_MARKED'),
    ).toHaveLength(0);
  });
});
describe('finalization, corrections and reports', () => {
  it('finalizes mixed present and absent without changing present marks', async () => {
    const a = await f.addStudent();
    await f.addStudent();
    const s = await f.session();
    await scan(s.id, a.token);
    await finalize(s.id);
    const result = await f.service.roster(f.admin.id, f.batch, s.id, o);
    expect(result.counts).toMatchObject({ present: 1, absent: 1, unmarked: 0 });
    expect(
      (await f.service.reports(f.admin.id, f.batch, o)).summary.percentage,
    ).toBe(50);
    await expect(
      f.service.transition(
        f.admin.id,
        f.batch,
        s.id,
        'reopen',
        transition(result.session.revision),
        'test',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('supports explicit excused review before finalization and excludes excused denominator', async () => {
    const a = await f.addStudent(),
      s = await f.session();
    await f.service.transition(
      f.admin.id,
      f.batch,
      s.id,
      'close',
      transition(1),
      'test',
    );
    await f.service.excuse(
      f.admin.id,
      f.batch,
      s.id,
      a.profile.id,
      transition(2),
      'test',
    );
    await finalize(s.id);
    const report = await f.service.reports(f.admin.id, f.batch, o);
    expect(report.summary).toEqual({
      present: 0,
      absent: 0,
      excused: 1,
      percentage: null,
    });
  });
  it('does not include unfinalized present or unmarked rows in official percentage', async () => {
    const a = await f.addStudent();
    await f.addStudent();
    const s = await f.session();
    await scan(s.id, a.token);
    const report = await f.service.reports(f.admin.id, f.batch, o);
    expect(report.summary).toEqual({
      present: 0,
      absent: 0,
      excused: 0,
      percentage: null,
    });
  });
  it('finalizes empty roster with N/A and rejects duplicate finalization', async () => {
    const s = await f.session();
    await finalize(s.id);
    expect(
      (await f.service.reports(f.admin.id, f.batch, o)).summary.percentage,
    ).toBeNull();
    await expect(finalize(s.id)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });
  it('preserves actor/reason/previous status under revision-guarded corrections', async () => {
    await f.addStudent();
    const s = await f.session();
    await finalize(s.id);
    const record = [...f.repo.rows.values()][0],
      session = f.repo.sessions.get(s.id)!;
    await f.service.correct(
      f.admin.id,
      f.batch,
      s.id,
      record.id,
      {
        ...transition(session.revision),
        expectedRecordRevision: 0,
        status: 'PRESENT',
      },
      'test',
    );
    await expect(
      f.service.correct(
        f.admin.id,
        f.batch,
        s.id,
        record.id,
        {
          ...transition(session.revision),
          expectedRecordRevision: 0,
          status: 'ABSENT',
        },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'STALE_STATE' });
    const history = f.repo.events.find(
      (e) => e.action === 'ATTENDANCE_RECORD_CORRECTED',
    );
    expect(history).toMatchObject({
      previousStatus: 'ABSENT',
      newStatus: 'PRESENT',
      actorUserId: f.admin.id,
      reason: transition(0).reason,
    });
  });
  it('permits audited historical correction after Batch completion', async () => {
    await f.addStudent();
    const s = await f.session();
    await finalize(s.id);
    f.repo.curriculum.learning.batches.get(f.batch)!.status = 'COMPLETED';
    const record = [...f.repo.rows.values()][0];
    expect(
      (
        await f.service.correct(
          f.admin.id,
          f.batch,
          s.id,
          record.id,
          {
            ...transition(f.repo.sessions.get(s.id)!.revision),
            expectedRecordRevision: 0,
            status: 'EXCUSED',
          },
          'test',
        )
      )?.status,
    ).toBe('EXCUSED');
  });
  it('rejects corrections before finalization and identity mass assignment', async () => {
    const a = await f.addStudent(),
      s = await f.session();
    await scan(s.id, a.token);
    const record = [...f.repo.rows.values()][0];
    await expect(
      f.service.correct(
        f.admin.id,
        f.batch,
        s.id,
        record.id,
        { ...transition(1), status: 'ABSENT', expectedRecordRevision: 0 },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FINALIZED' });
    await expect(
      f.service.correct(
        f.admin.id,
        f.batch,
        s.id,
        record.id,
        {
          ...transition(1),
          status: 'ABSENT',
          expectedRecordRevision: 0,
          studentProfileId: f.owner.id,
        },
        'test',
      ),
    ).rejects.toThrow();
  });
  it('rolls finalization back on a failed history write', async () => {
    await f.addStudent();
    const s = await f.session();
    await f.service.transition(
      f.admin.id,
      f.batch,
      s.id,
      'close',
      transition(1),
      'test',
    );
    const unit = f.repo.read;
    vi.spyOn(f.repo, 'read', 'get').mockReturnValue({
      ...unit,
      addHistory: async () => {
        throw Error('history failed');
      },
    });
    await expect(
      f.service.transition(
        f.admin.id,
        f.batch,
        s.id,
        'finalize',
        transition(2),
        'test',
      ),
    ).rejects.toThrow();
    expect(f.repo.rows.size).toBe(0);
    expect(f.repo.sessions.get(s.id)!.status).toBe('CLOSED');
  });
  it('protects CSV and XLSX exports with current authority and omits credentials', async () => {
    const a = await f.addStudent(),
      s = await f.session();
    await scan(s.id, a.token);
    await finalize(s.id);
    const csv = await f.service.export(
      f.admin.id,
      f.batch,
      { format: 'CSV', scope: 'SESSION', sessionId: s.id, confirmed: true },
      'test',
    );
    expect(Buffer.from(csv.base64, 'base64').toString()).not.toContain(a.token);
    expect(csv.rowCount).toBe(1);
    const xlsx = await f.service.export(
        f.admin.id,
        f.batch,
        { format: 'XLSX', scope: 'BATCH', confirmed: true },
        'test',
      ),
      workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(xlsx.base64, 'base64') as never);
    expect(workbook.worksheets[0].getCell('A2').type).toBe(
      ExcelJS.ValueType.String,
    );
    await expect(
      f.service.export(
        a.user.id,
        f.batch,
        { format: 'CSV', scope: 'BATCH', confirmed: true },
        'test',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('finalizes a typical 120-member cohort atomically', async () => {
    for (let i = 0; i < 120; i++) await f.addStudent();
    const s = await f.session();
    await finalize(s.id);
    expect(f.repo.rows.size).toBe(120);
    expect(
      (await f.service.roster(f.admin.id, f.batch, s.id, o)).counts.absent,
    ).toBe(120);
  }, 20000);
});
describe('self-only Student history', () => {
  it('shows UNMARKED before finalization and finalized history after completion', async () => {
    const a = await f.addStudent(),
      s = await f.session();
    expect((await f.service.own(a.user.id, f.batch, o)).items[0]).toMatchObject(
      { status: 'UNMARKED', official: false },
    );
    await finalize(s.id);
    f.repo.curriculum.learning.batches.get(f.batch)!.status = 'COMPLETED';
    const data = await f.service.own(a.user.id, f.batch, o);
    expect(data.items[0]).toMatchObject({ status: 'ABSENT', official: true });
    await expect(
      f.learning.effective(a.user.id, f.batch),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('never includes other roster identities or admits Student self-marking', async () => {
    const a = await f.addStudent(),
      b = await f.addStudent(),
      s = await f.session();
    await scan(s.id, a.token);
    const data = await f.service.own(a.user.id, f.batch, o);
    expect(JSON.stringify(data)).not.toContain(b.profile.id);
    expect(JSON.stringify(data)).not.toContain(b.profile.rollNumber);
    await expect(
      f.service.roster(a.user.id, f.batch, s.id, o),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('hides unfinalized attendance when enrollment is withdrawn', async () => {
    const a = await f.addStudent();
    await f.session();
    for (const e of f.repo.curriculum.learning.enrollments.values())
      e.status = 'WITHDRAWN';
    expect((await f.service.own(a.user.id, f.batch, o)).items).toHaveLength(0);
  });
});
describe('schema constraints', () => {
  it('declares canonical compound unique indexes', () => {
    for (const [model, keys] of [
      [AttendanceSession, ['batchId', 'learningDayId', 'sessionType']],
      [AttendanceRecord, ['attendanceSessionId', 'studentProfileId']],
      [AttendanceRosterSnapshot, ['attendanceSessionId', 'studentProfileId']],
    ] as const)
      expect(
        model.schema
          .indexes()
          .some(([k, o]) => o.unique && keys.every((f) => f in k)),
      ).toBe(true);
  });
  it.each(['updateOne', 'deleteMany', 'findOneAndUpdate'] as const)(
    'rejects append-only history and roster %s',
    async (method) => {
      await expect(
        AttendanceHistory[method]({}, { $set: { reason: 'overwrite' } }).exec(),
      ).rejects.toMatchObject({ code: 'IMMUTABLE_HISTORY' });
      await expect(
        AttendanceRosterSnapshot[method](
          {},
          { $set: { studentNameSnapshot: 'overwrite' } },
        ).exec(),
      ).rejects.toMatchObject({ code: 'IMMUTABLE_HISTORY' });
    },
  );
  it('rejects unguarded session and record updates', async () => {
    await expect(
      AttendanceSession.updateOne({}, { $set: { status: 'OPEN' } }).exec(),
    ).rejects.toMatchObject({ code: 'GUARDED_WRITE_REQUIRED' });
    await expect(
      AttendanceRecord.updateMany({}, { $set: { status: 'PRESENT' } }).exec(),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_HISTORY' });
  });
});
describe('HTTP auth, CSRF and private output', () => {
  function app() {
    const l = f.repo.curriculum.learning;
    return createApp(
      async () => true,
      {
        repository: l.students.admin.auth,
        google: {
          configured: () => false,
          authorize: async () => '',
          verify: async () => identity,
        },
      },
      l.students.admin,
      l.students,
      l,
      f.repo.curriculum,
      f.repo,
    );
  }
  async function headers(user = f.admin) {
    const c = await new SessionService(
      f.repo.curriculum.learning.students.admin.auth,
      3600,
    ).create(user);
    return {
      Cookie: 'algora_session=' + c.token,
      Origin: 'http://localhost:3000',
      'X-CSRF-Token': csrfFor(c.session.tokenHash),
    };
  }
  it('denies unauthenticated attendance and spoofed roles with no-store', async () => {
    const r = await request(app())
      .get('/api/v1/batches/' + f.batch + '/attendance')
      .set('X-Role', 'SUPER_ADMIN');
    expect(r.status).toBe(401);
    expect(r.headers['cache-control']).toContain('no-store');
  });
  it('requires exact Origin and CSRF for QR POST bodies', async () => {
    const a = await f.addStudent(),
      s = await f.session(),
      h = await headers();
    const r = await request(app())
      .post(
        '/api/v1/batches/' + f.batch + '/attendance/sessions/' + s.id + '/scan',
      )
      .set({ Cookie: h.Cookie })
      .send({ credential: a.token });
    expect(r.status).toBe(403);
    expect(f.repo.rows.size).toBe(0);
  });
  it('marks through authorized HTTP without returning QR credential or Google identifiers', async () => {
    const a = await f.addStudent(),
      s = await f.session();
    const r = await request(app())
      .post(
        '/api/v1/batches/' + f.batch + '/attendance/sessions/' + s.id + '/scan',
      )
      .set(await headers())
      .send({ credential: a.token });
    expect(r.status).toBe(200);
    expect(r.body.data.outcome).toBe('MARKED');
    expect(JSON.stringify(r.body)).not.toMatch(
      /tokenHash|ciphertext|googleSubject/,
    );
    expect(JSON.stringify(r.body)).not.toContain(a.token);
  });
  it('rejects Student self-marking, public resolution and unsupported query injection', async () => {
    const a = await f.addStudent(),
      s = await f.session(),
      h = await headers(a.user);
    expect(
      (
        await request(app())
          .post(
            '/api/v1/batches/' +
              f.batch +
              '/attendance/sessions/' +
              s.id +
              '/scan',
          )
          .set(h)
          .send({ credential: a.token })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app()).get(
          '/api/v1/attendance/resolve?credential=' + randomUUID(),
        )
      ).status,
    ).not.toBe(200);
    expect(
      (
        await request(app())
          .get('/api/v1/batches/' + f.batch + '/attendance?role=SUPER_ADMIN')
          .set(await headers())
      ).status,
    ).toBe(400);
  });
  it('requires a staff sign-in less than eight hours old for scanning', async () => {
    const a = await f.addStudent(),
      s = await f.session(),
      auth = f.repo.curriculum.learning.students.admin.auth,
      c = await new SessionService(auth, 86400).create(f.admin);
    auth.sessions.get(c.session.tokenHash)!.createdAt = new Date(
      Date.now() - 9 * 60 * 60 * 1000,
    );
    const r = await request(app())
      .post(
        '/api/v1/batches/' + f.batch + '/attendance/sessions/' + s.id + '/scan',
      )
      .set({
        Cookie: 'algora_session=' + c.token,
        Origin: 'http://localhost:3000',
        'X-CSRF-Token': csrfFor(c.session.tokenHash),
      })
      .send({ credential: a.token });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('SCANNER_SESSION_RENEWAL_REQUIRED');
    expect(f.repo.rows.size).toBe(0);
  });
});
