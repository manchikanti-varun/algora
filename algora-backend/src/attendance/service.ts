import { createHash } from 'node:crypto';
import { z } from 'zod';
import { attendanceFile } from './file.js';
import { AppError } from '../middleware/errors.js';
import { LearningService } from '../learning/service.js';
import { released } from '../curriculum/service.js';
import { QrVault } from '../students/crypto.js';
import { listSchema as learningList } from '../learning/contracts.js';
import type { UserRecord } from '../auth/types.js';
import type { AuditAction } from '../administration/contracts.js';
import {
  createSchema,
  transitionSchema,
  refreshSchema,
  scanSchema,
  correctionSchema,
  exportSchema,
  MAX_ROSTER,
  MAX_REPORT_ROWS,
  type ReportRow,
  type AttendanceRepository,
  type AttendanceUnit,
  type SessionRecord,
  type AttendanceRow,
  type RosterRow,
  type List,
  type Candidate,
} from './contracts.js';
const fail = (code: string, message: string, status = 409): never => {
  throw new AppError(status, code, message);
};
const need = <T>(v: T | null): T =>
  v ?? fail('NOT_FOUND', 'Attendance resource not found', 404);
const page = <T>(rows: T[], o: List) => ({
  items: rows.slice((o.page - 1) * o.pageSize, o.page * o.pageSize),
  total: rows.length,
  page: o.page,
  pageSize: o.pageSize,
  totalPages: Math.ceil(rows.length / o.pageSize),
});
export const percentage = (present: number, absent: number) =>
  present + absent
    ? Math.round((present / (present + absent)) * 10000) / 100
    : null;
export const csvCell = (value: unknown) => {
  let s = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function counts(roster: RosterRow[], records: AttendanceRow[]) {
  const result = {
    present: 0,
    absent: 0,
    excused: 0,
    unmarked: 0,
    total: roster.length,
  };
  for (const r of roster) {
    const record = records.find(
      (v) => v.studentProfileId === r.studentProfileId,
    );
    if (!record) result.unmarked++;
    else if (record.status === 'PRESENT') result.present++;
    else if (record.status === 'ABSENT') result.absent++;
    else result.excused++;
  }
  return result;
}
export class AttendanceService {
  constructor(
    private repo: AttendanceRepository,
    private authority: LearningService,
    private now: () => Date = () => new Date(),
  ) {}
  private audit(
    tx: AttendanceUnit,
    u: UserRecord,
    s: SessionRecord,
    action: AuditAction,
    requestId: string,
    before?: string,
    after?: string,
    count?: number,
  ) {
    return tx.curriculum.learning.students.admin.audit({
      actorUserId: u.id,
      actorName: u.displayName,
      action,
      targetType:
        action === 'ATTENDANCE_REPORT_EXPORTED'
          ? 'BATCH'
          : 'ATTENDANCE_SESSION',
      targetId: s.id,
      collegeId: s.collegeId,
      requestId,
      metadata: { before, after, count },
    });
  }
  private history(
    tx: AttendanceUnit,
    u: UserRecord,
    s: SessionRecord,
    action: string,
    reason: string,
    before?: string,
    after: string = s.status,
    record?: AttendanceRow,
  ) {
    return tx.addHistory({
      attendanceSessionId: s.id,
      ...(record
        ? {
            attendanceRecordId: record.id,
            studentProfileId: record.studentProfileId,
          }
        : {}),
      previousStatus: before,
      newStatus: after,
      action,
      actorUserId: u.id,
      actorName: u.displayName,
      reason,
    });
  }
  private async context(
    tx: AttendanceUnit,
    actor: string,
    batch: string,
    id?: string,
    write = false,
    historical = false,
  ) {
    const a = await this.authority.attendanceAuthority(
      tx.curriculum.learning,
      actor,
      batch,
      write,
      historical,
    );
    const session = id ? need(await tx.session(id)) : null;
    if (session && session.batchId !== batch)
      fail('NOT_FOUND', 'Attendance session not found', 404);
    if (
      write &&
      session &&
      session.curriculumRevisionId !== a.b.curriculumRevisionId
    )
      fail(
        'CURRICULUM_CHANGED',
        'Session curriculum does not match the pinned Batch revision',
      );
    return { ...a, session };
  }
  private async day(
    tx: AttendanceUnit,
    batch: string,
    revision: string | undefined | null,
    id: string,
  ) {
    if (!revision)
      fail('CURRICULUM_NOT_ASSIGNED', 'Assign a published curriculum first');
    const r = need(await tx.curriculum.revision(revision!));
    if (r.status !== 'PUBLISHED')
      fail('CURRICULUM_UNAVAILABLE', 'Pinned curriculum is not published');
    const batchRecord = need(await tx.curriculum.learning.batch(batch));
    if (r.courseId !== batchRecord.courseId)
      fail(
        'CURRICULUM_UNAVAILABLE',
        'Pinned curriculum belongs to another Course',
      );
    const d =
      (await tx.curriculum.frozenDayById(r.id, id)) ??
      fail(
        'DAY_NOT_ASSIGNED',
        'Choose a Learning Day from the pinned revision',
        404,
      );
    const controls = await tx.curriculum.releases(batch, r.id);
    if (
      !released(d, this.now()) ||
      controls.some((c) => c.dayId === id && c.restricted)
    )
      fail(
        'DAY_RESTRICTED',
        'The assigned Learning Day is not currently released',
        403,
      );
    return d;
  }
  async hub(actor: string, input: unknown) {
    const o = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(10),
        collegeId: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .optional(),
        courseId: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .optional(),
        search: z.string().max(100).default(''),
      })
      .strict()
      .parse(input);
    await this.repo.ensureReady();
    const tx = this.repo.read.curriculum.learning,
      u = need(await tx.students.admin.user(actor));
    if (
      !u.emailVerified ||
      u.accountStatus !== 'ACTIVE' ||
      !['ADMIN', 'SUPER_ADMIN'].includes(u.role)
    )
      fail('FORBIDDEN', 'Attendance management authority required', 403);
    let scope: string[] | null = null;
    if (u.role !== 'SUPER_ADMIN') {
      scope = [];
      for (const a of await tx.students.admin.assignments(actor))
        if (
          a.status === 'ACTIVE' &&
          a.permissions.includes('college.view') &&
          a.permissions.includes('attendance.manage') &&
          (await tx.students.admin.college(a.collegeId))?.status === 'ACTIVE'
        )
          scope.push(a.collegeId);
      if (!scope.length)
        fail('FORBIDDEN', 'Current attendance.manage grant required', 403);
    }
    const data = await tx.batches(learningList.parse(o), scope);
    return {
      ...data,
      items: data.items.map((b) => ({
        id: b.id,
        name: b.name,
        collegeId: b.collegeId,
        courseId: b.courseId,
        status: b.status,
        courseTitle: b.snapshot.title,
      })),
    };
  }
  async dashboard(actor: string, batch: string, o: List) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      { b, c } = await this.context(tx, actor, batch);
    if (!b.curriculumRevisionId)
      return {
        batch: {
          id: b.id,
          name: b.name,
          status: b.status,
          courseTitle: c.title,
        },
        revision: null,
        days: page([], o),
        message: 'Curriculum not assigned',
      };
    const revision = need(await tx.curriculum.revision(b.curriculumRevisionId)),
      days = await tx.curriculum.frozenDays(revision.id, {
        page: o.page,
        pageSize: o.pageSize,
        search: '',
      }),
      controls = await tx.curriculum.releases(batch, revision.id),
      items = [];
    for (const d of days.items) {
      const sessions = await tx.sessions(batch, {
        ...o,
        page: 1,
        pageSize: 50,
        dayId: d.id,
      });
      const cards = [];
      for (const sessionType of ['MORNING', 'AFTERNOON'] as const) {
        const s = sessions.items.find((v) => v.sessionType === sessionType);
        cards.push({
          sessionType,
          session: s ?? null,
          counts: s
            ? counts(await tx.roster(s.id), await tx.records(s.id))
            : null,
        });
      }
      items.push({
        id: d.id,
        dayNumber: d.dayNumber,
        title: d.title,
        released:
          released(d, this.now()) &&
          !controls.some((v) => v.dayId === d.id && v.restricted),
        sessions: cards,
      });
    }
    return {
      batch: { id: b.id, name: b.name, status: b.status, courseTitle: c.title },
      revision: { id: revision.id, revisionNumber: revision.revisionNumber },
      days: { ...days, items },
      message: items.length ? '' : 'No Learning Days in the assigned revision',
    };
  }
  async create(
    actor: string,
    batch: string,
    input: unknown,
    requestId: string,
  ) {
    const d = createSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, b, c } = await this.context(tx, actor, batch, undefined, true),
        day = await this.day(tx, b.id, b.curriculumRevisionId, d.learningDayId),
        college = need(
          await tx.curriculum.learning.students.admin.college(b.collegeId),
        );
      const s = await tx.insertSession({
        collegeId: b.collegeId,
        courseId: b.courseId,
        batchId: b.id,
        curriculumRevisionId: b.curriculumRevisionId!,
        learningDayId: day.id,
        dayNumber: day.dayNumber,
        dayTitle: day.title,
        batchName: b.name,
        collegeName: college.name,
        courseTitle: c.title,
        sessionType: d.sessionType,
        status: 'DRAFT',
        revision: 0,
        rosterCount: 0,
        createdBy: u.id,
      });
      await this.audit(
        tx,
        u,
        s,
        'ATTENDANCE_SESSION_CREATED',
        requestId,
        undefined,
        'DRAFT',
      );
      return s;
    });
  }
  async detail(actor: string, batch: string, id: string) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      { session } = await this.context(tx, actor, batch, id);
    const s = need(session);
    return {
      session: s,
      counts: counts(await tx.roster(id), await tx.records(id)),
    };
  }
  private async eligible(tx: AttendanceUnit, batch: string, lock = false) {
    const candidates = await tx.candidates(batch),
      result: Candidate[] = [];
    for (const candidate of candidates) {
      try {
        const e = await this.authority.effectiveIn(
          tx.curriculum.learning,
          candidate.profile.userId,
          batch,
          lock,
        );
        if (e.enrollment.id !== candidate.enrollment.id) continue;
        if (lock && !(await tx.lockIdentity(e.profile, e.enrollment)))
          fail('STALE_STATE', 'Enrollment changed');
        result.push({ profile: e.profile, enrollment: e.enrollment });
      } catch (e) {
        if (!(e instanceof AppError && [403, 404].includes(e.status))) throw e;
      }
    }
    if (result.length > MAX_ROSTER)
      fail(
        'ROSTER_TOO_LARGE',
        'Roster exceeds the supported transactional limit',
        413,
      );
    return result;
  }
  private rows(id: string, candidates: Candidate[]) {
    return candidates.map((c) => ({
      attendanceSessionId: id,
      enrollmentId: c.enrollment.id,
      studentProfileId: c.profile.id,
      rollNumberSnapshot: c.profile.rollNumber,
      studentNameSnapshot: c.profile.fullName,
      eligibilityAtOpen: true as const,
    }));
  }
  async transition(
    actor: string,
    batch: string,
    id: string,
    action: 'open' | 'close' | 'reopen' | 'finalize',
    input: unknown,
    requestId: string,
  ) {
    const d = transitionSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, b, session } = await this.context(tx, actor, batch, id, true),
        s = need(session);
      const from = {
        open: 'DRAFT',
        close: 'OPEN',
        reopen: 'CLOSED',
        finalize: 'CLOSED',
      } as const;
      if (s.status !== from[action])
        fail(
          'INVALID_TRANSITION',
          'This session state does not allow that action',
        );
      if (s.revision !== d.expectedRevision)
        fail('STALE_STATE', 'Session changed; refresh and review again');
      const patch: Partial<SessionRecord> = {};
      const now = this.now().toISOString();
      if (action === 'open' || action === 'reopen')
        await this.day(tx, batch, b.curriculumRevisionId, s.learningDayId);
      if (action === 'open') {
        const eligible = await this.eligible(tx, batch, true);
        await tx.addRoster(this.rows(id, eligible));
        Object.assign(patch, {
          openedAt: now,
          openedBy: u.id,
          rosterCount: eligible.length,
          status: 'OPEN',
        });
      }
      if (action === 'reopen') Object.assign(patch, { status: 'OPEN' });
      if (action === 'close')
        Object.assign(patch, {
          status: 'CLOSED',
          closedAt: now,
          closedBy: u.id,
        });
      if (action === 'finalize') {
        const roster = await tx.roster(id),
          records = await tx.records(id);
        for (const row of roster) {
          if (records.some((r) => r.studentProfileId === row.studentProfileId))
            continue;
          const record = await tx.insertRecord({
            attendanceSessionId: id,
            batchId: batch,
            studentProfileId: row.studentProfileId,
            enrollmentId: row.enrollmentId,
            rollNumberSnapshot: row.rollNumberSnapshot,
            status: 'ABSENT',
            source: 'FINALIZATION',
            markedBy: u.id,
            updatedBy: u.id,
            markedAt: now,
            revision: 0,
          });
          await this.history(
            tx,
            u,
            s,
            'ABSENCE_FINALIZED',
            d.reason,
            'UNMARKED',
            'ABSENT',
            record,
          );
        }
        Object.assign(patch, {
          status: 'FINALIZED',
          finalizedBy: u.id,
          finalizedAt: now,
        });
      }
      const next = await tx.changeSession(
        id,
        d.expectedRevision,
        s.status,
        patch,
      );
      if (!next) fail('STALE_STATE', 'Session changed; review again');
      const auditAction = (
        {
          open: 'ATTENDANCE_SESSION_OPENED',
          close: 'ATTENDANCE_SESSION_CLOSED',
          reopen: 'ATTENDANCE_SESSION_REOPENED',
          finalize: 'ATTENDANCE_SESSION_FINALIZED',
        } as const
      )[action];
      await this.audit(
        tx,
        u,
        s,
        auditAction,
        requestId,
        s.status,
        patch.status,
        patch.rosterCount ?? s.rosterCount,
      );
      await this.history(
        tx,
        u,
        s,
        auditAction,
        d.reason,
        s.status,
        patch.status,
      );
      return next;
    });
  }
  async refreshPreview(actor: string, batch: string, id: string) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      { session } = await this.context(tx, actor, batch, id);
    const s = need(session);
    if (!['OPEN', 'CLOSED'].includes(s.status))
      fail(
        'INVALID_TRANSITION',
        'Roster refresh requires an unfinalized open or closed session',
      );
    const current = await tx.roster(id),
      eligible = await this.eligible(tx, batch),
      additions = eligible.filter(
        (c) => !current.some((r) => r.studentProfileId === c.profile.id),
      );
    const summary = {
      sessionId: id,
      sessionRevision: s.revision,
      existing: current.length,
      additions: additions.length,
    };
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          ...summary,
          bindings: additions
            .map((c) => [
              c.profile.id,
              c.profile.revision,
              c.enrollment.id,
              c.enrollment.revision,
            ])
            .sort(),
        }),
      )
      .digest('hex');
    return { ...summary, impactFingerprint: fingerprint };
  }
  async refresh(
    actor: string,
    batch: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    const d = refreshSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, b, session } = await this.context(tx, actor, batch, id, true),
        s = need(session);
      if (
        !['OPEN', 'CLOSED'].includes(s.status) ||
        s.revision !== d.expectedRevision
      )
        fail(
          'STALE_STATE',
          'Refresh requires the reviewed current unfinalized session',
        );
      await this.day(tx, batch, b.curriculumRevisionId, s.learningDayId);
      const current = await tx.roster(id),
        eligible = await this.eligible(tx, batch, true),
        additions = eligible.filter(
          (c) => !current.some((r) => r.studentProfileId === c.profile.id),
        );
      const summary = {
        sessionId: id,
        sessionRevision: s.revision,
        existing: current.length,
        additions: additions.length,
      };
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            ...summary,
            bindings: additions
              .map((c) => [
                c.profile.id,
                c.profile.revision,
                c.enrollment.id,
                c.enrollment.revision,
              ])
              .sort(),
          }),
        )
        .digest('hex');
      if (fingerprint !== d.impactFingerprint)
        fail('STALE_IMPACT', 'Roster changed; review additions again');
      if (current.length + additions.length > MAX_ROSTER)
        fail('ROSTER_TOO_LARGE', 'Roster exceeds the transactional limit', 413);
      await tx.addRoster(this.rows(id, additions));
      const next = need(
        await tx.changeSession(id, s.revision, s.status, {
          rosterCount: current.length + additions.length,
        }),
      );
      await this.history(
        tx,
        u,
        s,
        'ATTENDANCE_ROSTER_REFRESHED',
        d.reason,
        undefined,
        s.status,
      );
      await this.audit(
        tx,
        u,
        s,
        'ATTENDANCE_ROSTER_REFRESHED',
        requestId,
        undefined,
        undefined,
        additions.length,
      );
      return next;
    });
  }
  async scan(
    actor: string,
    batch: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    const d = scanSchema.parse(input),
      hash = QrVault.hash(d.credential);
    return this.repo.transaction(async (tx) => {
      const { u, b, session } = await this.context(tx, actor, batch, id, true),
        s = need(session);
      if (s.status !== 'OPEN')
        fail('SESSION_CLOSED', 'This attendance session is not open');
      await this.day(tx, batch, b.curriculumRevisionId, s.learningDayId);
      const credential = await tx.credentialByHash(hash);
      if (!credential)
        fail('INVALID_OR_REVOKED_QR', 'QR is invalid or was rotated', 400);
      const profile = need(
        await tx.curriculum.learning.students.profile(credential!.profileId),
      );
      if (credential!.version !== profile.qrCredentialVersion)
        fail('REVOKED_QR', 'QR credential is no longer current', 400);
      if (profile.collegeId !== b.collegeId)
        fail('WRONG_COLLEGE', 'QR is not eligible for this College', 403);
      if (profile.verificationStatus !== 'VERIFIED')
        fail(
          'STUDENT_NOT_VERIFIED',
          'Student identity is not currently verified',
          403,
        );
      const access = await this.authority.effectiveIn(
        tx.curriculum.learning,
        profile.userId,
        batch,
        true,
      );
      const roster = (await tx.roster(id)).find(
        (r) => r.studentProfileId === profile.id,
      );
      if (!roster)
        fail(
          'ROSTER_REFRESH_REQUIRED',
          'Current eligible member is not in this session roster; review roster additions',
          409,
        );
      if (!(await tx.lockIdentity(access.profile, access.enrollment, hash)))
        fail('REVOKED_QR', 'Credential or enrollment changed; rescan', 409);
      if (!(await tx.lockSession(id, s.revision, 'OPEN')))
        fail('SESSION_CLOSED', 'Session changed; refresh', 409);
      const existing = (await tx.records(id)).find(
        (r) => r.studentProfileId === profile.id,
      );
      if (existing)
        return {
          outcome: 'ALREADY_MARKED',
          student: {
            name: roster!.studentNameSnapshot,
            rollNumber: roster!.rollNumberSnapshot,
          },
          status: existing.status,
        };
      const record = await tx.insertRecord({
        attendanceSessionId: id,
        batchId: batch,
        studentProfileId: profile.id,
        enrollmentId: access.enrollment.id,
        rollNumberSnapshot: roster!.rollNumberSnapshot,
        status: 'PRESENT',
        source: 'QR_SCAN',
        markedBy: u.id,
        updatedBy: u.id,
        markedAt: this.now().toISOString(),
        revision: 0,
      });
      await this.history(
        tx,
        u,
        s,
        'ATTENDANCE_QR_MARKED',
        'Authorized in-person QR scan',
        'UNMARKED',
        'PRESENT',
        record,
      );
      await this.audit(
        tx,
        u,
        s,
        'ATTENDANCE_QR_MARKED',
        requestId,
        'UNMARKED',
        'PRESENT',
        1,
      );
      return {
        outcome: 'MARKED',
        student: {
          name: roster!.studentNameSnapshot,
          rollNumber: roster!.rollNumberSnapshot,
        },
        status: 'PRESENT',
      };
    });
  }
  async roster(actor: string, batch: string, id: string, o: List) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      { session } = await this.context(tx, actor, batch, id),
      s = need(session),
      roster = await tx.roster(id),
      records = await tx.records(id);
    const rows = roster
      .map((row) => {
        const record = records.find(
          (r) => r.studentProfileId === row.studentProfileId,
        );
        return {
          id: row.id,
          studentProfileId: row.studentProfileId,
          studentName: row.studentNameSnapshot,
          rollNumber: row.rollNumberSnapshot,
          status: record?.status ?? 'UNMARKED',
          record: record
            ? {
                id: record.id,
                revision: record.revision,
                markedAt: record.markedAt,
                source: record.source,
              }
            : null,
        };
      })
      .filter(
        (r) =>
          (!o.search ||
            (r.studentName + ' ' + r.rollNumber)
              .toLowerCase()
              .includes(o.search.toLowerCase())) &&
          (!o.recordStatus || r.status === o.recordStatus),
      );
    return { session: s, counts: counts(roster, records), rows: page(rows, o) };
  }
  async historyList(actor: string, batch: string, id: string, o: List) {
    await this.repo.ensureReady();
    await this.context(this.repo.read, actor, batch, id);
    return this.repo.read.history(id, o);
  }
  async excuse(
    actor: string,
    batch: string,
    id: string,
    profileId: string,
    input: unknown,
    requestId: string,
  ) {
    const d = transitionSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, session } = await this.context(tx, actor, batch, id, true),
        s = need(session);
      if (
        s.status !== 'CLOSED' ||
        !(await tx.lockSession(id, d.expectedRevision, 'CLOSED'))
      )
        fail(
          'INVALID_TRANSITION',
          'Excusing an unmarked member requires the current closed session',
        );
      const row = (await tx.roster(id)).find(
        (r) => r.studentProfileId === profileId,
      );
      if (!row) fail('NOT_FOUND', 'Roster member not found', 404);
      if ((await tx.records(id)).some((r) => r.studentProfileId === profileId))
        fail(
          'ALREADY_MARKED',
          'Only an unmarked member can be excused before finalization',
        );
      const record = await tx.insertRecord({
        attendanceSessionId: id,
        batchId: batch,
        studentProfileId: profileId,
        enrollmentId: row!.enrollmentId,
        rollNumberSnapshot: row!.rollNumberSnapshot,
        status: 'EXCUSED',
        source: 'ADMIN_CORRECTION',
        markedBy: u.id,
        updatedBy: u.id,
        markedAt: this.now().toISOString(),
        revision: 0,
      });
      await this.history(
        tx,
        u,
        s,
        'ATTENDANCE_RECORD_CORRECTED',
        d.reason,
        'UNMARKED',
        'EXCUSED',
        record,
      );
      await this.audit(
        tx,
        u,
        s,
        'ATTENDANCE_RECORD_CORRECTED',
        requestId,
        'UNMARKED',
        'EXCUSED',
        1,
      );
      return record;
    });
  }
  async correct(
    actor: string,
    batch: string,
    id: string,
    recordId: string,
    input: unknown,
    requestId: string,
  ) {
    const d = correctionSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, session } = await this.context(
          tx,
          actor,
          batch,
          id,
          true,
          true,
        ),
        s = need(session);
      if (s.status !== 'FINALIZED')
        fail(
          'NOT_FINALIZED',
          'Only finalized official records may be corrected',
        );
      if (!(await tx.lockSession(id, d.expectedRevision, 'FINALIZED')))
        fail('STALE_STATE', 'Session changed');
      const old = need(await tx.record(recordId));
      if (old.attendanceSessionId !== id)
        fail('NOT_FOUND', 'Attendance record not found', 404);
      if (old.status === d.status)
        fail('NO_CHANGE', 'Choose a different attendance status', 400);
      const result = await tx.updateRecord(recordId, d.expectedRecordRevision, {
        status: d.status,
        source: 'ADMIN_CORRECTION',
        updatedBy: u.id,
      });
      if (!result) fail('STALE_STATE', 'Record changed; review again');
      await this.history(
        tx,
        u,
        s,
        'ATTENDANCE_RECORD_CORRECTED',
        d.reason,
        old.status,
        d.status,
        result!,
      );
      await this.audit(
        tx,
        u,
        s,
        'ATTENDANCE_RECORD_CORRECTED',
        requestId,
        old.status,
        d.status,
        1,
      );
      return result;
    });
  }
  async ownBatches(actor: string, o: List) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      u = need(await tx.curriculum.learning.students.admin.user(actor)),
      p = need(await tx.curriculum.learning.students.own(actor));
    if (
      u.role !== 'STUDENT' ||
      u.accountStatus !== 'ACTIVE' ||
      !u.emailVerified
    )
      fail('FORBIDDEN', 'An active Student account is required', 403);
    return tx.ownBatches(p.id, o);
  }
  async own(actor: string, batch: string, o: List) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      l = tx.curriculum.learning,
      u = need(await l.students.admin.user(actor)),
      p = need(await l.students.own(actor));
    if (
      u.role !== 'STUDENT' ||
      u.accountStatus !== 'ACTIVE' ||
      !u.emailVerified
    )
      fail('FORBIDDEN', 'An active Student account is required', 403);
    const data = await tx.ownSessions(batch, p.id, o),
      items = [];
    for (const s of data.items) {
      if (s.status !== 'FINALIZED') {
        try {
          await this.authority.effectiveIn(l, actor, batch);
        } catch (e) {
          if (e instanceof AppError && [403, 404].includes(e.status)) continue;
          throw e;
        }
      }
      const row = await tx.ownRecord(s.id, p.id);
      items.push({
        id: s.id,
        dayNumber: s.dayNumber,
        dayTitle: s.dayTitle,
        sessionType: s.sessionType,
        sessionStatus: s.status,
        status: row?.status ?? 'UNMARKED',
        openedAt: s.openedAt,
        markedAt: row?.markedAt,
        finalizedAt: s.finalizedAt,
        official: s.status === 'FINALIZED',
      });
    }
    return {
      ...data,
      items,
      message: items.length ? '' : 'No attendance records to display',
    };
  }
  async reports(actor: string, batch: string, o: List) {
    await this.repo.ensureReady();
    await this.context(this.repo.read, actor, batch);
    return this.report(this.repo.read, batch, o);
  }
  private async report(tx: AttendanceUnit, batch: string, o: List) {
    const sessions = await tx.reportSessions(batch, o),
      rows: ReportRow[] = [];
    let count = 0;
    for (const s of sessions) {
      const roster = await tx.roster(s.id),
        records = await tx.records(s.id);
      for (const r of roster) {
        if (o.studentProfileId && r.studentProfileId !== o.studentProfileId)
          continue;
        if (
          o.search &&
          !(r.rollNumberSnapshot + ' ' + r.studentNameSnapshot)
            .toLowerCase()
            .includes(o.search.toLowerCase())
        )
          continue;
        const record = records.find(
          (v) => v.studentProfileId === r.studentProfileId,
        );
        if (o.recordStatus && (record?.status ?? 'UNMARKED') !== o.recordStatus)
          continue;
        if (++count > MAX_REPORT_ROWS)
          fail('REPORT_TOO_LARGE', 'Narrow report filters', 413);
        rows.push({
          sessionId: s.id,
          studentProfileId: r.studentProfileId,
          rollNumber: r.rollNumberSnapshot,
          studentName: r.studentNameSnapshot,
          college: s.collegeName,
          course: s.courseTitle,
          batch: s.batchName,
          dayNumber: s.dayNumber,
          dayTitle: s.dayTitle,
          sessionType: s.sessionType,
          sessionStatus: s.status,
          status: record?.status ?? 'UNMARKED',
          markedAt: record?.markedAt ?? null,
          finalizedAt: s.finalizedAt ?? null,
          official: s.status === 'FINALIZED',
        });
      }
    }
    const summary = (data: typeof rows) => {
      let present = 0,
        absent = 0,
        excused = 0;
      for (const r of data)
        if (r.official) {
          if (r.status === 'PRESENT') present++;
          else if (r.status === 'ABSENT') absent++;
          else if (r.status === 'EXCUSED') excused++;
        }
      return {
        present,
        absent,
        excused,
        percentage: percentage(present, absent),
      };
    };
    const students = [...new Set(rows.map((r) => r.studentProfileId))].map(
      (id) => {
        const own = rows.filter((r) => r.studentProfileId === id);
        return {
          studentProfileId: id,
          studentName: own[0]!.studentName,
          rollNumber: own[0]!.rollNumber,
          ...summary(own),
        };
      },
    );
    const days = [...new Set(rows.map((r) => r.dayNumber))].map(
      (dayNumber) => ({
        dayNumber,
        ...summary(rows.filter((r) => r.dayNumber === dayNumber)),
      }),
    );
    return {
      rows: page(rows, o),
      summary: summary(rows),
      students: page(students, o),
      days: page(days, o),
      comparison: {
        MORNING: summary(rows.filter((r) => r.sessionType === 'MORNING')),
        AFTERNOON: summary(rows.filter((r) => r.sessionType === 'AFTERNOON')),
      },
      policy:
        'Finalized sessions only. EXCUSED excluded from denominator. Zero denominator is N/A.',
    };
  }
  async export(
    actor: string,
    batch: string,
    input: unknown,
    requestId: string,
  ) {
    const d = exportSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, b, c } = await this.context(tx, actor, batch);
      if (
        !(await tx.curriculum.learning.students.admin.lockUser(
          u.id,
          u.sessionVersion,
        ))
      )
        fail('STALE_STATE', 'Authority changed');
      if (!(await tx.curriculum.learning.students.lockCollege(b.collegeId)))
        fail('COLLEGE_UNAVAILABLE', 'College must be active for exports', 403);
      let target: SessionRecord | null = null;
      if (d.scope === 'SESSION') {
        target = need(await tx.session(d.sessionId!));
        if (target.batchId !== batch)
          fail('NOT_FOUND', 'Session not found', 404);
      }
      const o = {
        ...d.filters,
        ...(d.studentProfileId ? { studentProfileId: d.studentProfileId } : {}),
        ...(target
          ? { dayId: target.learningDayId, sessionType: target.sessionType }
          : {}),
        page: 1,
        pageSize: MAX_REPORT_ROWS,
      };
      const report = await this.report(tx, batch, o);
      const rows = target
        ? report.rows.items.filter((r) => r.sessionId === target!.id)
        : report.rows.items;
      const headers = [
        'Roll number',
        'Student name',
        'College',
        'Course',
        'Batch',
        'Learning day',
        'Session type',
        'Session state',
        'Attendance status',
        'Marked time',
        'Finalization time',
        'Official present',
        'Official absent',
        'Official excused',
        'Attendance percentage',
      ];
      const data = rows.map((r) => [
        r.rollNumber,
        r.studentName,
        r.college,
        r.course,
        r.batch,
        'Day ' + r.dayNumber + ' — ' + r.dayTitle,
        r.sessionType,
        r.sessionStatus,
        r.status,
        r.markedAt ?? '',
        r.finalizedAt ?? '',
        report.students.items.find(
          (s) => s.studentProfileId === r.studentProfileId,
        )?.present ?? 0,
        report.students.items.find(
          (s) => s.studentProfileId === r.studentProfileId,
        )?.absent ?? 0,
        report.students.items.find(
          (s) => s.studentProfileId === r.studentProfileId,
        )?.excused ?? 0,
        report.students.items.find(
          (s) => s.studentProfileId === r.studentProfileId,
        )?.percentage ?? 'N/A',
      ]);
      const file = await attendanceFile(headers, data, d.format);
      const auditTarget = { id: b.id, collegeId: b.collegeId } as SessionRecord;
      await this.audit(
        tx,
        u,
        auditTarget,
        'ATTENDANCE_REPORT_EXPORTED',
        requestId,
        undefined,
        d.format,
        rows.length,
      );
      void c;
      return {
        filename: 'algora-attendance.' + d.format.toLowerCase(),
        ...file,
        rowCount: rows.length,
      };
    });
  }
}
