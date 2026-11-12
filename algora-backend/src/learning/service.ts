import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import type { UserRecord } from '../auth/types.js';
import type { Permission, AuditAction } from '../administration/contracts.js';
import { rollSchema } from '../students/contracts.js';
import { parseImport } from './parser.js';
import {
  courseSchema,
  courseEditSchema,
  batchSchema,
  batchEditSchema,
  transitionSchema,
  manualSchema,
  importSchema,
  withdrawSchema,
  transferSchema,
  currentStatuses,
  type LearningRepository,
  type LearningUnit,
  type CourseRecord,
  type BatchRecord,
  type EnrollmentRecord,
  type List,
  type Row,
  type Result,
  type ImportRecord,
} from './contracts.js';
const fail = (code: string, message: string, status = 409): never => {
  throw new AppError(status, code, message);
};
const need = <T>(v: T | null): T =>
  v ?? fail('NOT_FOUND', 'Record not found', 404);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const eligible = (c: CourseRecord, college: string) =>
  c.status === 'PUBLISHED' &&
  (c.scope === 'PLATFORM' ||
    c.ownerCollegeId === college ||
    c.sharedCollegeIds.includes(college));
const snapshot = (c: CourseRecord) => ({
  title: c.title,
  code: c.code,
  slug: c.slug,
  description: c.description,
  difficulty: c.difficulty,
  courseRevision: c.revision,
});
export class LearningService {
  constructor(private repo: LearningRepository) {}
  private async actor(
    tx: LearningUnit,
    id: string,
    student = false,
    lock = false,
  ) {
    const u = need(await tx.students.admin.user(id));
    if (!u.emailVerified || u.accountStatus !== 'ACTIVE')
      fail('ACCOUNT_INELIGIBLE', 'An active verified account is required', 403);
    if (
      student
        ? u.role !== 'STUDENT'
        : !['ADMIN', 'SUPER_ADMIN'].includes(u.role)
    )
      fail('FORBIDDEN', 'Access is not allowed', 403);
    if (lock && !(await tx.students.admin.lockUser(id, u.sessionVersion)))
      fail('STALE_STATE', 'Account changed; retry');
    return u;
  }
  private async scopes(
    tx: LearningUnit,
    u: UserRecord,
    permission: Permission,
  ) {
    if (u.role === 'SUPER_ADMIN') return null;
    const ids: string[] = [];
    for (const a of await tx.students.admin.assignments(u.id))
      if (
        a.status === 'ACTIVE' &&
        a.permissions.includes(permission) &&
        (await tx.students.admin.college(a.collegeId))?.status === 'ACTIVE'
      )
        ids.push(a.collegeId);
    return ids;
  }
  private async college(
    tx: LearningUnit,
    u: UserRecord,
    id: string,
    permission: Permission,
    write = false,
  ) {
    const ids = await this.scopes(tx, u, permission);
    if (ids && !ids.includes(id))
      fail(
        'COLLEGE_FORBIDDEN',
        'College access or permission is unavailable',
        403,
      );
    const c = need(await tx.students.admin.college(id));
    if (
      write &&
      (c.status !== 'ACTIVE' || !(await tx.students.lockCollege(id)))
    )
      fail('COLLEGE_UNAVAILABLE', 'College must be active', 403);
    return c;
  }
  private audit(
    tx: LearningUnit,
    u: UserRecord,
    action: AuditAction,
    targetType: 'COURSE' | 'BATCH' | 'ENROLLMENT' | 'IMPORT',
    targetId: string,
    requestId: string,
    collegeId?: string,
    before?: string,
    after?: string,
    count?: number,
  ) {
    return tx.students.admin.audit({
      actorUserId: u.id,
      actorName: u.displayName,
      action,
      targetType,
      targetId,
      collegeId,
      metadata: { before, after, count },
      requestId,
    });
  }
  private async courseAccess(
    tx: LearningUnit,
    u: UserRecord,
    c: CourseRecord,
    edit = false,
  ) {
    if (u.role === 'SUPER_ADMIN') {
      if (edit && c.ownerCollegeId)
        await this.college(tx, u, c.ownerCollegeId, 'course.manage', true);
      return;
    }
    if (edit) {
      if (c.scope !== 'COLLEGE' || !c.ownerCollegeId)
        fail(
          'COURSE_FORBIDDEN',
          'Platform courses are managed by the Super Admin',
          403,
        );
      await this.college(tx, u, c.ownerCollegeId!, 'course.manage', true);
      return;
    }
    const ids = await this.scopes(tx, u, 'college.view');
    const management = await this.scopes(tx, u, 'course.manage');
    if (
      !ids?.some((id) => eligible(c, id)) &&
      !management?.includes(c.ownerCollegeId ?? '')
    )
      fail(
        'COURSE_FORBIDDEN',
        'Course is outside your authorized catalog',
        403,
      );
  }
  async courses(id: string, o: List) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      u = await this.actor(tx, id),
      scope = await this.scopes(tx, u, 'college.view'),
      managed = await this.scopes(tx, u, 'course.manage');
    const page = await tx.courses(o, scope, managed ?? []);
    const items = [];
    for (const c of page.items)
      items.push({
        ...c,
        canManage:
          (u.role === 'SUPER_ADMIN' &&
            (!c.ownerCollegeId ||
              (await tx.students.admin.college(c.ownerCollegeId))?.status ===
                'ACTIVE')) ||
          managed?.includes(c.ownerCollegeId ?? '') === true,
      });
    return { ...page, items };
  }
  async course(id: string, target: string) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      u = await this.actor(tx, id),
      c = need(await tx.course(target));
    await this.courseAccess(tx, u, c);
    const managed = await this.scopes(tx, u, 'course.manage');
    return {
      ...c,
      canManage:
        (u.role === 'SUPER_ADMIN' &&
          (!c.ownerCollegeId ||
            (await tx.students.admin.college(c.ownerCollegeId))?.status ===
              'ACTIVE')) ||
        managed?.includes(c.ownerCollegeId ?? '') === true,
    };
  }
  async saveCourse(
    id: string,
    input: unknown,
    target: string | undefined,
    requestId: string,
  ) {
    const data = target
      ? courseEditSchema.parse(input)
      : courseSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, false, true);
      const old = target ? need(await tx.course(target)) : null;
      if (old) {
        await this.courseAccess(tx, u, old, true);
        if (old.status === 'ARCHIVED')
          fail('COURSE_ARCHIVED', 'Archived course metadata is preserved');
        if (
          data.scope !== old.scope ||
          data.ownerCollegeId !== old.ownerCollegeId
        )
          fail('IMMUTABLE_OWNERSHIP', 'Course ownership cannot be changed');
        if (
          u.role !== 'SUPER_ADMIN' &&
          JSON.stringify(data.sharedCollegeIds) !==
            JSON.stringify(old.sharedCollegeIds)
        )
          fail('FORBIDDEN', 'Only the Super Admin can share a course', 403);
      } else if (
        u.role !== 'SUPER_ADMIN' &&
        (data.scope !== 'COLLEGE' ||
          !data.ownerCollegeId ||
          data.sharedCollegeIds.length)
      )
        fail(
          'FORBIDDEN',
          'Choose an authorized college-owned draft without sharing',
          403,
        );
      if (data.ownerCollegeId)
        await this.college(tx, u, data.ownerCollegeId, 'course.manage', true);
      for (const c of data.sharedCollegeIds) {
        if (u.role !== 'SUPER_ADMIN' && !old?.sharedCollegeIds.includes(c))
          fail('FORBIDDEN', 'Sharing requires Super Admin', 403);
        if ((await tx.students.admin.college(c))?.status !== 'ACTIVE')
          fail('COLLEGE_UNAVAILABLE', 'Shared colleges must be active');
      }
      const { expectedRevision, ...fields } = data as typeof data & {
        expectedRevision?: number;
      };
      const result = old
        ? await tx.updateCourse(old.id, expectedRevision!, {
            ...fields,
            updatedBy: u.id,
          })
        : await tx.insertCourse({
            ...fields,
            status: 'DRAFT',
            revision: 0,
            createdBy: u.id,
            updatedBy: u.id,
          });
      const saved =
        result ?? fail('STALE_STATE', 'Course changed; refresh and retry');
      await this.audit(
        tx,
        u,
        old ? 'COURSE_UPDATED' : 'COURSE_CREATED',
        'COURSE',
        saved.id,
        requestId,
        saved.ownerCollegeId ?? undefined,
        old?.status,
        saved.status,
      );
      return saved;
    });
  }
  async courseStatus(
    id: string,
    target: string,
    status: 'PUBLISHED' | 'ARCHIVED',
    input: unknown,
    requestId: string,
  ) {
    const d = transitionSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, false, true),
        c = need(await tx.course(target));
      await this.courseAccess(tx, u, c, true);
      if (c.revision !== d.expectedRevision)
        fail('STALE_STATE', 'Course changed');
      if (c.status === status) return c;
      if (
        c.status === 'ARCHIVED' ||
        (status === 'PUBLISHED' && c.status !== 'DRAFT')
      )
        fail(
          'INVALID_TRANSITION',
          'Course lifecycle transition is not allowed',
        );
      const next = need(
        await tx.updateCourse(c.id, c.revision, { status, updatedBy: u.id }),
      );
      await this.audit(
        tx,
        u,
        status === 'PUBLISHED' ? 'COURSE_PUBLISHED' : 'COURSE_ARCHIVED',
        'COURSE',
        c.id,
        requestId,
        c.ownerCollegeId ?? undefined,
        c.status,
        status,
      );
      return next;
    });
  }
  async batches(id: string, o: List) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      u = await this.actor(tx, id);
    const scope = await this.scopes(tx, u, 'college.view');
    const page = await tx.batches(o, scope);
    const items = [];
    for (const b of page.items)
      items.push({ ...b, ...(await this.capabilities(tx, u, b.collegeId)) });
    return { ...page, items };
  }
  async batch(id: string, target: string) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      u = await this.actor(tx, id),
      b = need(await tx.batch(target));
    await this.college(tx, u, b.collegeId, 'college.view');
    return { ...b, ...(await this.capabilities(tx, u, b.collegeId)) };
  }
  private async capabilities(
    tx: LearningUnit,
    u: UserRecord,
    collegeId: string,
  ) {
    const active =
      (await tx.students.admin.college(collegeId))?.status === 'ACTIVE';
    const grant =
      u.role === 'SUPER_ADMIN'
        ? undefined
        : (await tx.students.admin.assignments(u.id)).find(
            (a) => a.status === 'ACTIVE' && a.collegeId === collegeId,
          );
    const has = (p: Permission) =>
      u.role === 'SUPER_ADMIN' || !!grant?.permissions.includes(p);
    const canViewRoster =
      has('student.view') && (active || u.role === 'SUPER_ADMIN');
    return {
      canManage: active && has('batch.manage'),
      canEnroll: active && has('student.enroll'),
      canViewRoster,
      canViewHistory:
        canViewRoster &&
        (has('report.view') || has('student.enroll') || has('batch.manage')),
    };
  }
  async saveBatch(
    id: string,
    input: unknown,
    target: string | undefined,
    requestId: string,
  ) {
    const d = target ? batchEditSchema.parse(input) : batchSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, false, true),
        old = target ? need(await tx.batch(target)) : null;
      const data = d as typeof d & {
        courseId?: string;
        collegeId?: string;
        expectedRevision?: number;
      };
      const collegeId = old?.collegeId ?? data.collegeId!;
      await this.college(tx, u, collegeId, 'batch.manage', true);
      if (old && ['COMPLETED', 'ARCHIVED'].includes(old.status))
        fail(
          'BATCH_CLOSED',
          'Closed batch metadata and snapshot are preserved',
        );
      if (old && data.capacity !== null && data.capacity < old.seatCount)
        fail(
          'CAPACITY_CONFLICT',
          'Capacity cannot be lower than reserved memberships',
        );
      const c = need(await tx.course(old?.courseId ?? data.courseId!));
      if (!eligible(c, collegeId))
        fail('COURSE_INELIGIBLE', 'Select a published eligible course');
      await tx.lockCourse(c.id);
      const {
        expectedRevision,
        courseId: ignoredCourse,
        collegeId: ignoredCollege,
        ...fields
      } = data;
      void ignoredCourse;
      void ignoredCollege;
      const next = old
        ? await tx.updateBatch(old.id, expectedRevision!, {
            ...fields,
            updatedBy: u.id,
          })
        : await tx.insertBatch({
            ...fields,
            courseId: c.id,
            collegeId,
            status: 'DRAFT',
            enrollmentPolicy: 'ADMIN_ROLL_ONLY',
            snapshot: snapshot(c),
            seatCount: 0,
            revision: 0,
            createdBy: u.id,
            updatedBy: u.id,
          });
      const saved =
        next ?? fail('STALE_STATE', 'Batch changed; refresh and retry');
      await this.audit(
        tx,
        u,
        old ? 'BATCH_UPDATED' : 'BATCH_CREATED',
        'BATCH',
        saved.id,
        requestId,
        collegeId,
        old?.status,
        saved.status,
      );
      return saved;
    });
  }
  async batchStatus(
    id: string,
    target: string,
    status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED',
    input: unknown,
    requestId: string,
  ) {
    const d = transitionSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, false, true),
        b = need(await tx.batch(target));
      await this.college(tx, u, b.collegeId, 'batch.manage', true);
      if (b.revision !== d.expectedRevision)
        fail('STALE_STATE', 'Batch changed');
      if (b.status === status) return b;
      if (
        b.status === 'ARCHIVED' ||
        (status === 'ACTIVE' && b.status !== 'DRAFT') ||
        (status === 'COMPLETED' && b.status !== 'ACTIVE')
      )
        fail('INVALID_TRANSITION', 'Batch lifecycle transition is not allowed');
      let snap = b.snapshot;
      if (status === 'ACTIVE') {
        const c = need(await tx.course(b.courseId));
        if (!eligible(c, b.collegeId))
          fail(
            'COURSE_INELIGIBLE',
            'Activation requires a published eligible course',
          );
        await tx.lockCourse(c.id);
        snap = snapshot(c);
      }
      const next = need(
        await tx.updateBatch(b.id, b.revision, {
          status,
          snapshot: snap,
          updatedBy: u.id,
        }),
      );
      await this.audit(
        tx,
        u,
        status === 'ACTIVE'
          ? 'BATCH_ACTIVATED'
          : status === 'COMPLETED'
            ? 'BATCH_COMPLETED'
            : 'BATCH_ARCHIVED',
        'BATCH',
        b.id,
        requestId,
        b.collegeId,
        b.status,
        status,
      );
      return next;
    });
  }
  private async enrollmentAuthority(
    tx: LearningUnit,
    id: string,
    batchId: string,
    write: boolean,
  ) {
    const u = await this.actor(tx, id, false, write),
      b = need(await tx.batch(batchId));
    await this.college(
      tx,
      u,
      b.collegeId,
      write ? 'student.enroll' : 'student.view',
      write,
    );
    if (write) {
      if (!['DRAFT', 'ACTIVE'].includes(b.status))
        fail('BATCH_CLOSED', 'This batch no longer permits enrollment');
      await tx.lockBatch(b.id);
      const c = need(await tx.course(b.courseId));
      if (!eligible(c, b.collegeId))
        fail('COURSE_INELIGIBLE', 'Course is not available for this college');
      await tx.lockCourse(c.id);
    }
    return { u, b };
  }
  private async state(
    tx: LearningUnit,
    b: BatchRecord,
    roll: string,
    bound?: string,
    lock = false,
  ) {
    const p = bound
      ? await tx.students.profile(bound)
      : await tx.profileByRoll(roll);
    if (!p) {
      const historical = await tx.students.rollOwner(roll);
      return {
        status: 'PENDING_REGISTRATION' as const,
        reason: historical
          ? 'HISTORICAL_ROLL_CONFLICT'
          : 'REGISTRATION_REQUIRED',
        conflict: historical ? 'HISTORICAL_ROLL_CONFLICT' : undefined,
      };
    }
    if (p.rollNumber !== roll)
      return {
        status: 'PENDING_VERIFICATION' as const,
        reason: 'CURRENT_IDENTITY_CHANGED',
        conflict: 'HISTORICAL_ROLL_CONFLICT',
      };
    if (p.collegeId !== b.collegeId)
      return {
        status: 'PENDING_VERIFICATION' as const,
        reason: 'COLLEGE_CONFLICT',
        conflict: 'COLLEGE_CONFLICT',
      };
    const u = need(await tx.students.admin.user(p.userId));
    if (lock && !(await tx.students.admin.lockUser(u.id, u.sessionVersion)))
      fail('STALE_STATE', 'Student identity changed');
    const college = await tx.students.admin.college(b.collegeId),
      c = await tx.course(b.courseId);
    const identity =
      p.verificationStatus === 'VERIFIED' &&
      u.emailVerified &&
      u.role === 'STUDENT' &&
      u.accountStatus === 'ACTIVE' &&
      u.registrationStatus === 'VERIFIED';
    const operational =
      college?.status === 'ACTIVE' && !!c && eligible(c, b.collegeId);
    return {
      profileId: p.id,
      status:
        identity && operational && b.status === 'ACTIVE'
          ? ('ACTIVE' as const)
          : ('PENDING_VERIFICATION' as const),
      reason: !identity
        ? 'IDENTITY_NOT_ELIGIBLE'
        : !operational
          ? 'COLLEGE_OR_COURSE_UNAVAILABLE'
          : b.status !== 'ACTIVE'
            ? 'BATCH_NOT_ACTIVE'
            : '',
      identityEligible: identity && operational,
    };
  }
  private async rows(
    tx: LearningUnit,
    u: UserRecord,
    b: BatchRecord,
    rows: Row[],
    source: EnrollmentRecord['source'],
    execute: boolean,
    requestId: string,
  ) {
    const results: Result[] = [];
    const seen = new Set<string>();
    let seats = b.seatCount;
    for (const row of rows) {
      const parsed = rollSchema.safeParse(row.value);
      const roll = parsed.success ? parsed.data : row.value;
      let outcome = '',
        reason = '',
        status: EnrollmentRecord['status'] | undefined;
      if (row.error || !parsed.success) {
        outcome = 'INVALID_ROLL';
        reason = row.error ?? 'Exactly 10 ASCII letters or digits required';
      } else if (seen.has(roll)) {
        outcome = 'DUPLICATE_INPUT';
        reason = 'Duplicate input row';
      } else {
        seen.add(roll);
        const current = await tx.current(b.id, roll);
        if (current) {
          outcome = 'ALREADY_ENROLLED';
          reason = 'A current membership already exists';
          status = current.status;
        } else if (await tx.prior(b.id, roll)) {
          outcome = 'HISTORY_CONFLICT';
          reason =
            'A former membership is preserved; re-enrollment requires separate reviewed recovery';
        } else {
          const state = await this.state(tx, b, roll, undefined, execute);
          status = state.status;
          if (state.conflict) {
            outcome = state.conflict;
            reason =
              'Identity does not match this batch; authorized identity review is required';
          } else if (
            state.profileId &&
            (await tx.current(b.id, roll, state.profileId))
          ) {
            outcome = 'ALREADY_ENROLLED';
            reason = 'Current membership already exists for this identity';
          } else if (b.capacity !== null && seats >= b.capacity) {
            outcome = 'CAPACITY_CONFLICT';
            reason = 'All seats, including pending reservations, are occupied';
          } else {
            outcome = state.status;
            reason = state.reason;
            seats++;
            if (execute) {
              if (!(await tx.seat(b.id, 1)))
                fail(
                  'CAPACITY_CHANGED',
                  'Batch capacity changed; retry the same import',
                );
              const e = await tx.insertEnrollment({
                batchId: b.id,
                collegeId: b.collegeId,
                rollNumber: roll,
                ...(state.profileId
                  ? { studentProfileId: state.profileId }
                  : {}),
                status: state.status,
                source,
                reason: state.reason,
                createdBy: u.id,
                revision: 0,
                ...(state.status === 'ACTIVE'
                  ? { activatedAt: new Date().toISOString() }
                  : {}),
              });
              await tx.history({
                enrollmentId: e.id,
                batchId: b.id,
                collegeId: b.collegeId,
                actorUserId: u.id,
                action: 'CREATED',
                after: e.status,
                reason: e.reason,
              });
              await this.audit(
                tx,
                u,
                e.status === 'ACTIVE'
                  ? 'ENROLLMENT_CREATED'
                  : 'PENDING_ENROLLMENT_CREATED',
                'ENROLLMENT',
                e.id,
                requestId,
                b.collegeId,
                undefined,
                e.status,
              );
            }
          }
        }
      }
      results.push({
        row: row.row,
        rollNumber: roll.slice(0, 100),
        outcome,
        status,
        reason,
      });
    }
    return results;
  }
  async preview(id: string, batchId: string, input: unknown) {
    // Reject unauthorized upload parsing early; the transaction below still
    // revalidates every condition after parsing.
    await this.repo.ensureReady();
    const candidate = await this.actor(this.repo.read, id);
    const candidateBatch = need(await this.repo.read.batch(batchId));
    await this.college(
      this.repo.read,
      candidate,
      candidateBatch.collegeId,
      'student.enroll',
    );
    const parsed = await parseImport(input);
    return this.repo.transaction(async (tx) => {
      const { u, b } = await this.enrollmentAuthority(tx, id, batchId, true),
        token = randomBytes(32).toString('base64url');
      const operation = await tx.insertImport({
        actorUserId: u.id,
        batchId: b.id,
        tokenHash: hash(token),
        requestKey: randomUUID(),
        source: parsed.source,
        rows: parsed.rows,
        warnings: parsed.warnings,
        expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
        status: 'PREVIEW',
        results: [],
      });
      return {
        previewToken: token,
        operationId: operation.id,
        expiresAt: operation.expiresAt,
        warnings: parsed.warnings,
        results: await this.rows(
          tx,
          u,
          b,
          parsed.rows,
          parsed.source,
          false,
          'preview',
        ),
      };
    });
  }
  private async execute(
    tx: LearningUnit,
    u: UserRecord,
    b: BatchRecord,
    operation: ImportRecord,
    requestId: string,
  ) {
    if (operation.status === 'COMPLETED')
      return {
        operationId: operation.id,
        replayed: true,
        results: operation.results,
        warnings: operation.warnings,
      };
    if (Date.parse(operation.expiresAt) < Date.now())
      fail('PREVIEW_EXPIRED', 'Preview expired; create a new one');
    const results = await this.rows(
      tx,
      u,
      b,
      operation.rows,
      operation.source,
      true,
      requestId,
    );
    await tx.completeImport(operation.id, results);
    await this.audit(
      tx,
      u,
      'BULK_IMPORT_COMPLETED',
      'IMPORT',
      operation.id,
      requestId,
      b.collegeId,
      undefined,
      'COMPLETED',
      results.filter((r) => currentStatuses.includes(r.outcome as never))
        .length,
    );
    const conflicts = results.filter(
      (r) =>
        !currentStatuses.includes(r.outcome as never) &&
        r.outcome !== 'ALREADY_ENROLLED',
    ).length;
    if (conflicts)
      await this.audit(
        tx,
        u,
        'IMPORT_CONFLICTS',
        'IMPORT',
        operation.id,
        requestId,
        b.collegeId,
        undefined,
        'REJECTED_ROWS',
        conflicts,
      );
    return {
      operationId: operation.id,
      replayed: false,
      results,
      warnings: operation.warnings,
    };
  }
  async import(id: string, batchId: string, input: unknown, requestId: string) {
    const d = importSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, b } = await this.enrollmentAuthority(tx, id, batchId, true),
        op = need(await tx.importByHash(hash(d.previewToken)));
      if (op.actorUserId !== id || op.batchId !== batchId)
        fail('NOT_FOUND', 'Preview not found', 404);
      return this.execute(tx, u, b, op, requestId);
    });
  }
  async manual(id: string, batchId: string, input: unknown, requestId: string) {
    const d = manualSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, b } = await this.enrollmentAuthority(tx, id, batchId, true);
      let op = await tx.importByKey(id, batchId, d.requestKey);
      if (op && op.rows[0]?.value !== d.rollNumber)
        fail(
          'IDEMPOTENCY_CONFLICT',
          'Request key was used for different input',
        );
      op ??= await tx.insertImport({
        actorUserId: id,
        batchId,
        tokenHash: hash(randomBytes(32).toString('base64url')),
        requestKey: d.requestKey,
        source: 'MANUAL',
        rows: [{ row: 1, value: d.rollNumber }],
        warnings: [],
        expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
        status: 'PREVIEW',
        results: [],
      });
      return this.execute(tx, u, b, op, requestId);
    });
  }
  async reconcileRows(
    tx: LearningUnit,
    rows: EnrollmentRecord[],
    requestId: string,
  ) {
    for (const e of rows) {
      const b = need(await tx.batch(e.batchId));
      await tx.lockBatch(b.id);
      const state = await this.state(
        tx,
        b,
        e.rollNumber,
        e.studentProfileId,
        true,
      );
      const status =
        e.status === 'ACTIVE' &&
        state.identityEligible &&
        ['COMPLETED', 'ARCHIVED'].includes(b.status)
          ? 'ACTIVE'
          : state.status;
      const profileId = state.profileId ?? e.studentProfileId;
      if (
        status === e.status &&
        state.reason === e.reason &&
        profileId === e.studentProfileId
      )
        continue;
      const next = need(
        await tx.updateEnrollment(e.id, e.revision, {
          status,
          reason: state.reason,
          ...(profileId ? { studentProfileId: profileId } : {}),
          ...(status === 'ACTIVE' && !e.activatedAt
            ? { activatedAt: new Date().toISOString() }
            : {}),
        }),
      );
      await tx.history({
        enrollmentId: e.id,
        batchId: e.batchId,
        collegeId: e.collegeId,
        actorUserId: e.createdBy,
        action: 'RECONCILED',
        before: e.status,
        after: next.status,
        reason: next.reason,
      });
      const creator = await tx.students.admin.user(e.createdBy);
      if (creator)
        await this.audit(
          tx,
          { ...creator, displayName: 'System reconciliation' },
          status === 'ACTIVE' && e.status !== 'ACTIVE'
            ? 'ENROLLMENT_ACTIVATED'
            : 'ENROLLMENT_RECONCILED',
          'ENROLLMENT',
          e.id,
          requestId,
          e.collegeId,
          e.status,
          status,
        );
    }
  }
  async enrollments(id: string, batchId: string, o: List, history = false) {
    return this.repo.transaction(async (tx) => {
      const { u, b } = await this.enrollmentAuthority(tx, id, batchId, false);
      if (
        history &&
        !(await this.capabilities(tx, u, b.collegeId)).canViewHistory
      )
        fail(
          'HISTORY_FORBIDDEN',
          'History requires reporting or membership-management permission',
          403,
        );
      if (!history)
        await this.reconcileRows(
          tx,
          await tx.reconciliationRows('BATCH', b.id, ''),
          'read-reconciliation',
        );
      void u;
      return tx.enrollments(batchId, o, history);
    });
  }
  async history(id: string, batchId: string, o: List) {
    await this.repo.ensureReady();
    const { u, b } = await this.enrollmentAuthority(
      this.repo.read,
      id,
      batchId,
      false,
    );
    if (
      !(await this.capabilities(this.repo.read, u, b.collegeId)).canViewHistory
    )
      fail(
        'HISTORY_FORBIDDEN',
        'History requires reporting or membership-management permission',
        403,
      );
    return this.repo.read.histories(batchId, o);
  }
  async withdraw(
    id: string,
    batchId: string,
    target: string,
    input: unknown,
    requestId: string,
  ) {
    const d = withdrawSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, false, true),
        b = need(await tx.batch(batchId));
      await this.college(tx, u, b.collegeId, 'student.enroll', true);
      await tx.lockBatch(b.id);
      const e = need(await tx.enrollment(target));
      if (e.batchId !== b.id) fail('NOT_FOUND', 'Enrollment not found', 404);
      if (e.revision !== d.expectedRevision)
        fail('STALE_STATE', 'Membership changed');
      if (!currentStatuses.includes(e.status as never))
        fail('INVALID_TRANSITION', 'Membership is no longer current');
      const next = need(
        await tx.updateEnrollment(e.id, e.revision, {
          status: 'WITHDRAWN',
          withdrawnAt: new Date().toISOString(),
          reason: d.reason,
        }),
      );
      if (!(await tx.seat(b.id, -1)))
        fail('COUNTER_CONFLICT', 'Membership counter requires repair');
      await tx.history({
        enrollmentId: e.id,
        batchId: b.id,
        collegeId: b.collegeId,
        actorUserId: u.id,
        action: 'WITHDRAWN',
        before: e.status,
        after: 'WITHDRAWN',
        reason: d.reason,
      });
      await this.audit(
        tx,
        u,
        'ENROLLMENT_WITHDRAWN',
        'ENROLLMENT',
        e.id,
        requestId,
        b.collegeId,
        e.status,
        'WITHDRAWN',
      );
      return next;
    });
  }
  async transfer(
    id: string,
    batchId: string,
    target: string,
    input: unknown,
    requestId: string,
  ) {
    const d = transferSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, b: dest } = await this.enrollmentAuthority(
          tx,
          id,
          d.destinationBatchId,
          true,
        ),
        source = need(await tx.batch(batchId));
      await this.college(tx, u, source.collegeId, 'student.enroll', true);
      await tx.lockBatch(source.id);
      if (
        source.id === dest.id ||
        source.collegeId !== dest.collegeId ||
        source.courseId !== dest.courseId
      )
        fail(
          'TRANSFER_INELIGIBLE',
          'Transfers require different batches of the same course and college',
        );
      const e = need(await tx.enrollment(target));
      if (e.batchId !== source.id)
        fail('NOT_FOUND', 'Enrollment not found', 404);
      if (
        e.revision !== d.expectedRevision ||
        !currentStatuses.includes(e.status as never)
      )
        fail('STALE_STATE', 'Membership changed');
      const state = await this.state(
        tx,
        dest,
        e.rollNumber,
        e.studentProfileId,
        true,
      );
      if (state.conflict)
        fail(
          'IDENTITY_CONFLICT',
          'Current identity requires separate authorized review',
        );
      if (
        (await tx.current(dest.id, e.rollNumber, state.profileId)) ||
        (await tx.prior(dest.id, e.rollNumber))
      )
        fail(
          'ALREADY_ENROLLED',
          'Destination membership or history already exists',
        );
      if (!(await tx.seat(dest.id, 1)))
        fail('CAPACITY_CONFLICT', 'Destination is full');
      const next = await tx.insertEnrollment({
        batchId: dest.id,
        collegeId: dest.collegeId,
        rollNumber: e.rollNumber,
        ...(state.profileId ? { studentProfileId: state.profileId } : {}),
        status: state.status,
        source: 'TRANSFER',
        reason: state.reason,
        createdBy: u.id,
        transferredFrom: e.id,
        revision: 0,
        ...(state.status === 'ACTIVE'
          ? { activatedAt: new Date().toISOString() }
          : {}),
      });
      need(
        await tx.updateEnrollment(e.id, e.revision, {
          status: 'WITHDRAWN',
          reason: d.reason,
          withdrawnAt: new Date().toISOString(),
          transferredTo: next.id,
        }),
      );
      if (!(await tx.seat(source.id, -1)))
        fail('COUNTER_CONFLICT', 'Source counter requires repair');
      for (const [row, before, after] of [
        [e, e.status, 'WITHDRAWN'],
        [next, undefined, next.status],
      ] as const)
        await tx.history({
          enrollmentId: row.id,
          batchId: row.batchId,
          collegeId: row.collegeId,
          actorUserId: u.id,
          action: 'TRANSFERRED',
          before,
          after,
          reason: d.reason,
        });
      await this.audit(
        tx,
        u,
        'ENROLLMENT_TRANSFERRED',
        'ENROLLMENT',
        e.id,
        requestId,
        e.collegeId,
        e.batchId,
        dest.id,
      );
      return next;
    });
  }
  async effective(id: string, batchId: string) {
    await this.repo.ensureReady();
    const tx = this.repo.read,
      u = await this.actor(tx, id, true),
      p = need(await tx.students.own(id)),
      b = need(await tx.batch(batchId)),
      e = await tx.current(b.id, p.rollNumber, p.id);
    if (
      !e ||
      e.studentProfileId !== p.id ||
      e.rollNumber !== p.rollNumber ||
      e.status !== 'ACTIVE' ||
      (await this.state(tx, b, e.rollNumber, p.id)).status !== 'ACTIVE'
    )
      fail(
        'ENROLLMENT_REQUIRED',
        'Current verified active enrollment is required',
        403,
      );
    void u;
    return { batch: b, enrollment: e };
  }
  async own(id: string, o: List) {
    await this.repo.ensureReady();
    const tx = this.repo.read;
    await this.actor(tx, id, true);
    const p = need(await tx.students.own(id));
    if (p.verificationStatus !== 'VERIFIED')
      return {
        items: [],
        total: 0,
        page: o.page,
        pageSize: o.pageSize,
        totalPages: 0,
        message:
          'Institutional verification is required to view enrollment details',
      };
    const page = await tx.ownEnrollments(p.id, o);
    const items = [];
    for (const e of page.items) {
      const b = await tx.batch(e.batchId);
      if (!b || e.rollNumber !== p.rollNumber || e.collegeId !== p.collegeId) {
        items.push({
          id: e.id,
          status: e.status,
          effectiveAccess: false,
          message: 'Membership requires identity review',
        });
        continue;
      }
      const state = await this.state(tx, b, e.rollNumber, p.id),
        course = await tx.course(b.courseId),
        college = await tx.students.admin.college(b.collegeId);
      const visible =
        college?.status === 'ACTIVE' &&
        !!course &&
        eligible(course, b.collegeId);
      items.push({
        id: e.id,
        status: e.status,
        effectiveAccess:
          visible && e.status === 'ACTIVE' && state.status === 'ACTIVE',
        ...(visible
          ? {
              courseTitle: b.snapshot.title,
              batchName: b.name,
              collegeName: college.name,
              batchStatus: b.status,
              startDate: b.startDate,
              endDate: b.endDate,
            }
          : {}),
        message: visible ? state.reason : 'Membership is currently unavailable',
      });
    }
    return { ...page, items };
  }
}
export { eligible, hash };
