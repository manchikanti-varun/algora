import {
  buildProgressReport,
  exportFilters,
  MAX_EXPORT_ROWS,
  MAX_EXPORT_STUDENTS,
  type ReportType,
  type ReportRow,
  type ReportStudent,
} from './reports.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError } from '../middleware/errors.js';
import type { AuditAction } from '../administration/contracts.js';
import type { BatchRecord, EnrollmentRecord } from '../learning/contracts.js';
import { listSchema } from '../learning/contracts.js';
import { LearningService } from '../learning/service.js';
import { released } from '../curriculum/service.js';
import { env } from '../config/env.js';
import { adapters, digest, ProviderCooldown } from './providers.js';
import { codingOwnership, type CodingOwnership } from './ownership.js';
import {
  platforms,
  linkSchema,
  confirmSchema,
  refreshSchema,
  querySchema,
  type Account,
  type Assignment,
  type ProgressUnit,
  type ProgressRepository,
  type Platform,
  type Job,
  type Progress,
  type Evidence,
  type Adapter,
  type Query,
} from './contracts.js';
const id = () => new Types.ObjectId().toHexString();
const need = <T>(v: T | null | undefined): T => {
  if (v == null) throw new AppError(404, 'NOT_FOUND', 'Record not found');
  return v;
};
const reject = (code: string, message: string, status = 409): never => {
  throw new AppError(status, code, message);
};
export const assignmentId = (revision: string, day: string, problem: string) =>
  digest(revision + ':' + day + ':' + problem).slice(0, 24);
export const eligibleAfter = (
  batch: BatchRecord,
  enrollment: EnrollmentRecord,
) => {
  if (
    !batch.startedAt ||
    !enrollment.activatedAt ||
    !Number.isFinite(Date.parse(batch.startedAt)) ||
    !Number.isFinite(Date.parse(enrollment.activatedAt))
  )
    return null;
  return new Date(
    Math.max(Date.parse(batch.startedAt), Date.parse(enrollment.activatedAt)),
  ).toISOString();
};
export const owned = (a: Account | undefined | null, now: Date) =>
  !!a &&
  a.active &&
  a.status === 'VERIFIED' &&
  !!a.subject &&
  !!a.proofExpiresAt &&
  Date.parse(a.proofExpiresAt) > now.getTime();
export const publicAccount = (a: Account) => ({
  id: a.id,
  platform: a.platform,
  handle: a.handle,
  status: a.status,
  active: a.active,
  revision: a.revision,
  method: a.method,
  verifiedAt: a.verifiedAt ?? null,
  proofExpiresAt: a.proofExpiresAt ?? null,
  proofExpired:
    !!a.proofExpiresAt && Date.parse(a.proofExpiresAt) <= Date.now(),
  syncStatus: a.syncStatus,
  lastCheckedAt: a.lastCheckedAt ?? null,
  lastSuccessAt: a.lastSuccessAt ?? null,
  lastError: a.lastError ?? null,
});
export class CodingService {
  constructor(
    public repo: ProgressRepository,
    private learning: LearningService,
    private providers: Record<Platform, Adapter> = adapters,
    private ownership: CodingOwnership = codingOwnership,
    private now = () => new Date(),
    private wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}
  async student(tx: ProgressUnit, userId: string, lock = false) {
    const l = tx.curriculum.learning,
      u = need(await l.students.admin.user(userId)),
      p = need(await l.students.own(userId));
    if (
      u.role !== 'STUDENT' ||
      u.accountStatus !== 'ACTIVE' ||
      !u.emailVerified ||
      u.registrationStatus !== 'VERIFIED' ||
      p.verificationStatus !== 'VERIFIED' ||
      (await l.students.admin.college(p.collegeId))?.status !== 'ACTIVE'
    )
      reject(
        'STUDENT_INELIGIBLE',
        'An active verified Student is required',
        403,
      );
    if (lock && !(await l.students.admin.lockUser(u.id, u.sessionVersion)))
      reject('STALE_STATE', 'Account changed');
    return { u, p };
  }
  private async audit(
    tx: ProgressUnit,
    actor: string,
    action: AuditAction,
    targetType: 'CODING_ACCOUNT' | 'CODING_SYNC' | 'CODING_PROGRESS',
    targetId: string,
    requestId: string,
    collegeId?: string,
    after?: string,
    count?: number,
  ) {
    const u = need(await tx.curriculum.learning.students.admin.user(actor));
    await tx.curriculum.learning.students.admin.audit({
      actorUserId: u.id,
      actorName: u.username ?? 'Algora member',
      action,
      targetType,
      targetId,
      requestId,
      ...(collegeId ? { collegeId } : {}),
      metadata: {
        ...(after ? { after } : {}),
        ...(count !== undefined ? { count } : {}),
      },
    });
  }
  async accounts(user: string) {
    await this.repo.ensureReady();
    const { p } = await this.student(this.repo.read, user);
    const rows = await this.repo.read.accounts(p.id);
    return {
      accounts: rows.map(publicAccount),
      syncEnabled: env.CODING_SYNC_ENABLED === 'true',
      capabilities: platforms.map((platform) => ({
        platform,
        submissions: this.providers[platform].available,
        ownership: platform === 'CODEFORCES' && this.ownership.configured(),
        reason: this.providers[platform].reason,
        ownershipReason:
          platform === 'CODEFORCES'
            ? this.ownership.configured()
              ? 'Official Codeforces OpenID Connect'
              : 'Operator configuration required for official Codeforces OpenID Connect'
            : 'No approved ownership integration; verification unavailable',
      })),
    };
  }
  async link(user: string, input: unknown, request: string) {
    const d = linkSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { p } = await this.student(tx, user, true),
        old = await tx.accountFor(p.id, d.platform);
      if ((old?.revision ?? null) !== d.expectedRevision)
        reject('STALE_STATE', 'Coding account changed');
      const now = this.now().toISOString();
      const a: Account = {
        id: old?.id ?? id(),
        studentProfileId: p.id,
        userId: user,
        platform: d.platform,
        handle: d.handle,
        normalizedHandle: d.handle.toLowerCase(),
        status:
          d.platform === 'CODEFORCES' && this.ownership.configured()
            ? 'PENDING_VERIFICATION'
            : 'VERIFICATION_UNAVAILABLE',
        active: true,
        revision: (old?.revision ?? -1) + 1,
        method: d.platform === 'CODEFORCES' ? 'OIDC' : 'UNAVAILABLE',
        syncStatus: this.providers[d.platform].available
          ? 'NEVER_CHECKED'
          : 'PROVIDER_UNAVAILABLE',
        nextSyncAt: now,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      };
      // Replacement drops the previous proof explicitly; historic evidence remains immutable.
      const next = await tx.saveAccount(a, old?.revision ?? null);
      await this.audit(
        tx,
        user,
        'CODING_ACCOUNT_LINKED',
        'CODING_ACCOUNT',
        a.id,
        request,
        p.collegeId,
        a.status,
      );
      return publicAccount(next);
    });
  }
  async disconnect(
    user: string,
    account: string,
    input: unknown,
    request: string,
  ) {
    const d = confirmSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { p } = await this.student(tx, user, true),
        a = need(await tx.account(account));
      if (a.studentProfileId !== p.id)
        reject('NOT_FOUND', 'Record not found', 404);
      if (a.revision !== d.expectedRevision)
        reject('STALE_STATE', 'Coding account changed');
      const next = await tx.saveAccount(
        {
          ...a,
          active: false,
          status: 'REVOKED',
          revision: a.revision + 1,
          updatedAt: this.now().toISOString(),
        },
        a.revision,
      );
      await this.audit(
        tx,
        user,
        'CODING_ACCOUNT_REVOKED',
        'CODING_ACCOUNT',
        a.id,
        request,
        p.collegeId,
        'REVOKED',
      );
      return publicAccount(next);
    });
  }
  async beginOwnership(
    user: string,
    sessionHash: string,
    account: string,
    input: unknown,
    request: string,
  ) {
    const d = confirmSchema.parse(input);
    if (!this.ownership.configured())
      reject(
        'OWNERSHIP_NOT_CONFIGURED',
        'Official ownership integration is not configured',
        503,
      );
    return this.repo.transaction(async (tx) => {
      const { p } = await this.student(tx, user, true),
        a = need(await tx.account(account));
      if (
        a.studentProfileId !== p.id ||
        a.platform !== 'CODEFORCES' ||
        !a.active
      )
        reject('NOT_FOUND', 'Record not found', 404);
      if (a.revision !== d.expectedRevision)
        reject('STALE_STATE', 'Coding account changed');
      const state = randomBytes(32).toString('base64url'),
        nonce = randomBytes(32).toString('base64url');
      await tx.insertOAuth({
        id: id(),
        stateHash: digest(state),
        userId: user,
        sessionHash,
        accountId: a.id,
        accountRevision: a.revision,
        nonce,
        expiresAt: new Date(this.now().getTime() + 300000).toISOString(),
      });
      await this.audit(
        tx,
        user,
        'CODING_ACCOUNT_LINKED',
        'CODING_ACCOUNT',
        a.id,
        request,
        p.collegeId,
        'OWNERSHIP_REQUESTED',
      );
      return { authorizationUrl: this.ownership.authorize({ state, nonce }) };
    });
  }
  async finishOwnership(
    user: string,
    sessionHash: string,
    state: string,
    code: string,
    request: string,
  ) {
    const transaction = await this.repo.transaction(async (tx) => {
      await this.student(tx, user, true);
      return need(
        await tx.consumeOAuth(
          digest(state),
          user,
          sessionHash,
          this.now().toISOString(),
        ),
      );
    });
    const identity = await this.ownership.verify(code, transaction.nonce);
    const reservation = randomUUID();
    if (
      !(await this.repo.reserveProvider(this.now().toISOString(), reservation))
    )
      reject(
        'PROVIDER_RATE_LIMITED',
        'Codeforces is busy; restart ownership verification shortly',
        429,
      );
    let registrationTimeSeconds: number;
    let ownershipCooldown = 3000;
    try {
      registrationTimeSeconds = await need(this.providers.CODEFORCES.identity)(
        identity.handle,
      );
    } catch (error) {
      ownershipCooldown =
        error instanceof ProviderCooldown ? error.retryAfterMs : 30000;
      throw error;
    } finally {
      await this.repo.releaseProvider(
        reservation,
        new Date(this.now().getTime() + ownershipCooldown).toISOString(),
      );
    }

    return this.repo.transaction(async (tx) => {
      const { p } = await this.student(tx, user, true),
        a = need(await tx.account(transaction.accountId));
      if (
        !a.active ||
        a.studentProfileId !== p.id ||
        a.revision !== transaction.accountRevision ||
        a.normalizedHandle !== identity.handle.toLowerCase()
      )
        reject(
          'OWNERSHIP_MISMATCH',
          'The authenticated Codeforces handle must match the linked handle',
        );
      const now = this.now(),
        next = await tx.saveAccount(
          {
            ...a,
            status: 'VERIFIED',
            handle: identity.handle,
            normalizedHandle: identity.handle.toLowerCase(),
            subject: identity.subject,
            method: 'OIDC',
            registrationTimeSeconds,
            verifiedAt: now.toISOString(),
            proofExpiresAt: new Date(
              now.getTime() + 30 * 86400000,
            ).toISOString(),
            proofDigest: digest(
              identity.subject +
                ':' +
                identity.issuedAt +
                ':' +
                transaction.nonce,
            ),
            revision: a.revision + 1,
            updatedAt: now.toISOString(),
          },
          a.revision,
        );
      await this.audit(
        tx,
        user,
        'CODING_ACCOUNT_VERIFIED',
        'CODING_ACCOUNT',
        a.id,
        request,
        p.collegeId,
        'OIDC_VERIFIED',
      );
      return publicAccount(next);
    });
  }
  async assignments(tx: ProgressUnit, b: BatchRecord) {
    if (!b.curriculumRevisionId) return [];
    const controls = await tx.curriculum.releases(b.id, b.curriculumRevisionId);
    const days = await tx.curriculum.allFrozenDays(b.curriculumRevisionId),
      out: Assignment[] = [];
    for (const day of days) {
      if (
        !released(day, this.now()) ||
        controls.some((c) => c.dayId === day.id && c.restricted)
      )
        continue;
      for (const a of day.problemAssignments) {
        out.push({
          id: assignmentId(b.curriculumRevisionId, day.id, a.problemId),
          dayId: day.id,
          dayNumber: day.dayNumber,
          problemId: a.problemId,
          platform: a.problem.platform,
          problemKey: a.problem.platformProblemId,
          title: a.problem.title,
          url: a.problem.url,
          difficulty: a.problem.difficulty,
        });
      }
    }
    if (out.length > 10000)
      reject(
        'CURRICULUM_LIMIT',
        'Progress supports at most 10000 released assignments',
        422,
      );
    return out;
  }
  async ownBatches(user: string, page = 1) {
    await this.repo.ensureReady();
    const { p } = await this.student(this.repo.read, user);
    const rows = await this.repo.read.curriculum.learning.ownEnrollments(
      p.id,
      listSchema.parse({ page, pageSize: 20 }),
    );
    const items = [];
    for (const e of rows.items) {
      try {
        const current = await this.progressContext(
          this.repo.read,
          user,
          e.batchId,
        );
        items.push({
          id: current.batch.id,
          name: current.batch.name,
          course: current.batch.snapshot.title,
        });
      } catch {
        /* No stale enrollment access. */
      }
    }
    return { items, page, totalPages: rows.totalPages };
  }
  async dashboard(user: string, batchId: string, input: unknown) {
    const q = querySchema.parse(input);
    await this.repo.ensureReady();
    const current = await this.progressContext(this.repo.read, user, batchId);
    return this.projection(
      this.repo.read,
      current.batch,
      current.enrollment,
      current.profile.id,
      q,
    );
  }
  async personalData(
    user: string,
    batchId: string,
    input: unknown,
    unit: ProgressUnit = this.repo.read,
  ) {
    const q = querySchema.parse(input);
    await this.repo.ensureReady();
    const current = await this.progressContext(unit, user, batchId);
    const projection = await this.projection(
      unit,
      current.batch,
      current.enrollment,
      current.profile.id,
      { ...q, page: 1, pageSize: 10000 },
    );
    return {
      current,
      projection,
      accounts: (await unit.accounts(current.profile.id)).map(publicAccount),
    };
  }
  async day(user: string, batchId: string, day: number) {
    const q = querySchema.parse({ day });
    await this.repo.ensureReady();
    const current = await this.learning.effectiveIn(
      this.repo.read.curriculum.learning,
      user,
      batchId,
    );
    return this.projection(
      this.repo.read,
      current.batch,
      current.enrollment,
      current.profile.id,
      { ...q, pageSize: 100 },
    );
  }
  private async progressContext(
    tx: ProgressUnit,
    user: string,
    batchId: string,
  ) {
    const { p } = await this.student(tx, user),
      b = need(await tx.curriculum.learning.batch(batchId));
    if (b.status !== 'COMPLETED')
      return this.learning.effectiveIn(tx.curriculum.learning, user, batchId);
    if (p.collegeId !== b.collegeId)
      reject(
        'ENROLLMENT_REQUIRED',
        'Historical College membership is unavailable',
        403,
      );
    let found: EnrollmentRecord | undefined;
    for (let page = 1; page <= 50; page++) {
      const rows = await tx.curriculum.learning.ownEnrollments(
        p.id,
        listSchema.parse({ page, pageSize: 50 }),
      );
      for (const e of rows.items)
        if (
          e.batchId === b.id &&
          e.collegeId === p.collegeId &&
          e.activatedAt &&
          ['ACTIVE', 'WITHDRAWN'].includes(e.status) &&
          (!found || e.activatedAt > (found.activatedAt ?? ''))
        )
          found = e;
      if (page >= rows.totalPages) break;
    }
    if (!found)
      reject('ENROLLMENT_REQUIRED', 'Historical enrollment is required', 403);
    return { batch: b, enrollment: found!, profile: p };
  }
  private async projection(
    tx: ProgressUnit,
    b: BatchRecord,
    e: EnrollmentRecord,
    profileId: string,
    q: Query,
  ) {
    const assignments = await this.assignments(tx, b),
      accounts = await tx.accounts(profileId),
      progress = await tx.progress(profileId, b.id, e.id),
      after = eligibleAfter(b, e);
    if (progress.length > 10000)
      reject('PROGRESS_LIMIT', 'Progress exceeds supported bounds', 422);
    const jobs = (
      await Promise.all(accounts.map((a) => tx.jobs(a.id, b.id)))
    ).flat();
    const all = assignments.map((a) => {
      const account = accounts.find((v) => v.platform === a.platform),
        p = progress.find(
          (v) =>
            v.assignmentId === a.id &&
            v.curriculumRevisionId === b.curriculumRevisionId &&
            v.accountId === account?.id &&
            v.accountRevision === account?.revision,
        ),
        coverage = jobs.some(
          (j) =>
            j.accountId === account?.id &&
            j.accountRevision === account?.revision &&
            j.enrollmentId === e.id &&
            j.curriculumRevisionId === b.curriculumRevisionId &&
            j.coverage === 'COMPLETE' &&
            j.status === 'SUCCEEDED',
        );
      const reason = !after
        ? 'MISSING_ACTIVATION_TIMESTAMP'
        : !this.providers[a.platform].available
          ? 'PROVIDER_UNAVAILABLE'
          : !owned(account, this.now())
            ? 'ACCOUNT_OWNERSHIP_REQUIRED'
            : !p && !coverage
              ? 'HISTORY_NOT_FULLY_CHECKED'
              : null;
      const status = reason
        ? 'VERIFICATION_UNAVAILABLE'
        : (p?.status ?? 'NOT_STARTED');
      return {
        ...a,
        status,
        reason,
        solvedAt: status === 'SOLVED_VERIFIED' ? (p?.solvedAt ?? null) : null,
        firstAttemptAt: reason ? null : (p?.firstAttemptAt ?? null),
        latestEvidenceId: reason ? null : (p?.latestEvidenceId ?? null),
        ownershipStatus: account?.status ?? 'UNLINKED',
        syncStatus: account?.syncStatus ?? 'NEVER_CHECKED',
      };
    });
    const filtered = all.filter(
      (a) =>
        (!q.day || a.dayNumber === q.day) &&
        (!q.platform || a.platform === q.platform) &&
        (!q.status || a.status === q.status) &&
        (!q.verification || a.ownershipStatus === q.verification) &&
        (!q.problemId || a.problemId === q.problemId) &&
        (!q.from ||
          (!!(a.solvedAt ?? a.firstAttemptAt) &&
            (a.solvedAt ?? a.firstAttemptAt)! >= q.from)) &&
        (!q.to ||
          (!!(a.solvedAt ?? a.firstAttemptAt) &&
            (a.solvedAt ?? a.firstAttemptAt)! <= q.to)),
    );
    const metrics = (rows: typeof all) => {
      const solved = rows.filter((r) => r.status === 'SOLVED_VERIFIED').length,
        unavailable = rows.filter(
          (r) => r.status === 'VERIFICATION_UNAVAILABLE',
        ).length;
      return {
        assigned: rows.length,
        solved,
        attempted: rows.filter((r) => r.status === 'ATTEMPTED_VERIFIED').length,
        unavailable,
        verifiedCoverage: rows.length - unavailable,
        completionPercent: rows.length
          ? Math.round((solved / rows.length) * 100)
          : 0,
      };
    };
    return {
      batchId: b.id,
      batchName: b.name,
      course: b.snapshot.title,
      studentProfileId: profileId,
      enrollmentId: e.id,
      eligibleAfter: after,
      summary: metrics(all),
      filteredSummary: metrics(filtered),
      platforms: platforms.map((platform) => ({
        platform,
        ...metrics(all.filter((a) => a.platform === platform)),
      })),
      days: [...new Set(all.map((a) => a.dayNumber))]
        .sort((a, b) => a - b)
        .map((day) => ({
          day,
          ...metrics(all.filter((a) => a.dayNumber === day)),
        })),
      items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      page: q.page,
      pageSize: q.pageSize,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / q.pageSize),
      jobs: jobs.slice(0, 20).map((j) => ({
        id: j.id,
        status: j.status,
        coverage: j.coverage,
        error: j.error ?? null,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
      })),
    };
  }
  async evidence(
    user: string,
    batchId: string,
    assignment: string,
    input: unknown,
  ) {
    const q = querySchema.parse(input);
    await this.repo.ensureReady();
    let profileId: string, e: EnrollmentRecord, b: BatchRecord;
    const u = need(
      await this.repo.read.curriculum.learning.students.admin.user(user),
    );
    if (u.role === 'STUDENT') {
      const current = await this.progressContext(this.repo.read, user, batchId);
      profileId = current.profile.id;
      e = current.enrollment;
      b = current.batch;
    } else {
      b = (
        await this.learning.progressAuthority(
          this.repo.read.curriculum.learning,
          user,
          batchId,
        )
      ).b;
      profileId = need(q.studentProfileId);
      const p = need(
        await this.repo.read.curriculum.learning.students.profile(profileId),
      );
      e = need(
        await this.repo.read.curriculum.learning.current(
          batchId,
          p.rollNumber,
          p.id,
        ),
      );
      await this.progressContext(this.repo.read, p.userId, batchId);
    }
    if (
      !(await this.assignments(this.repo.read, b)).some(
        (a) => a.id === assignment,
      )
    )
      reject('NOT_FOUND', 'Assignment not found', 404);
    const rows = await this.repo.read.evidence(
      profileId,
      b.id,
      assignment,
      e.id,
    );
    return {
      items: rows.map((v) => ({
        id: v.evidenceId,
        platform: v.platform,
        providerSubmissionId: v.id,
        problemId: v.problemId,
        assignmentId: v.assignmentId,
        handle: v.handle,
        verdict: v.verdict,
        language: v.language,
        submittedAt: v.submittedAt,
        fetchedAt: v.fetchedAt,
        sourceUrl: v.sourceUrl,
        sourceType: v.sourceType,
        confidence: v.confidence,
        adapterVersion: v.adapterVersion,
        accountRevision: v.accountRevision,
      })),
    };
  }
  async staffBatches(
    user: string,
    page = 1,
    filters: { collegeId?: string; courseId?: string } = {},
  ) {
    await this.repo.ensureReady();
    const l = this.repo.read.curriculum.learning,
      u = need(await l.students.admin.user(user));
    if (
      !['ADMIN', 'SUPER_ADMIN'].includes(u.role) ||
      u.accountStatus !== 'ACTIVE' ||
      !u.emailVerified
    )
      reject('FORBIDDEN', 'Staff access required', 403);
    const scopes =
      u.role === 'SUPER_ADMIN'
        ? null
        : (await l.students.admin.assignments(user))
            .filter(
              (a) =>
                a.status === 'ACTIVE' &&
                a.permissions.includes('college.view') &&
                a.permissions.includes('progress.view'),
            )
            .map((a) => a.collegeId);
    const rows = await l.batches(
      listSchema.parse({ page, pageSize: 20, ...filters }),
      scopes,
    );
    const items = [];
    for (const b of rows.items) {
      try {
        await this.learning.progressAuthority(l, user, b.id);
        items.push({ id: b.id, name: b.name, course: b.snapshot.title });
      } catch {
        /* Current authority only. */
      }
    }
    return { items, page, totalPages: rows.totalPages };
  }
  async matrix(user: string, batchId: string, input: unknown) {
    const q = querySchema.parse(input);
    await this.repo.ensureReady();
    const tx = this.repo.read,
      b = (
        await this.learning.progressAuthority(
          tx.curriculum.learning,
          user,
          batchId,
        )
      ).b;
    let roster = await tx.curriculum.learning.enrollments(
      b.id,
      listSchema.parse({ page: q.page, pageSize: q.pageSize }),
      false,
    );
    if (q.studentProfileId) {
      const p = need(
        await tx.curriculum.learning.students.profile(q.studentProfileId),
      );
      const e =
        p.collegeId === b.collegeId
          ? await tx.curriculum.learning.current(b.id, p.rollNumber, p.id)
          : null;
      roster = {
        items: e ? [e] : [],
        page: 1,
        pageSize: q.pageSize,
        total: e ? 1 : 0,
        totalPages: e ? 1 : 0,
      };
    }
    const items = [];
    for (const e of roster.items) {
      if (
        e.status !== 'ACTIVE' ||
        !e.studentProfileId ||
        (q.studentProfileId && e.studentProfileId !== q.studentProfileId)
      )
        continue;
      const p = await tx.curriculum.learning.students.profile(
        e.studentProfileId,
      );
      if (!p) continue;
      try {
        await this.progressContext(tx, p.userId, b.id);
      } catch {
        continue;
      }
      items.push({
        id: p.id,
        name: p.fullName,
        rollNumber: p.rollNumber,
        ...(await this.projection(tx, b, e, p.id, {
          ...q,
          page: q.assignmentPage,
          pageSize: 20,
        })),
      });
    }
    return {
      batchId: b.id,
      batchName: b.name,
      items,
      page: roster.page,
      total: roster.total,
      totalPages: roster.totalPages,
      pageSize: q.pageSize,
    };
  }
  async refresh(
    actor: string,
    batchId: string,
    input: unknown,
    request: string,
  ) {
    const d = refreshSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = need(await tx.curriculum.learning.students.admin.user(actor));
      let user = actor;
      if (u.role !== 'STUDENT') {
        await this.learning.progressAuthority(
          tx.curriculum.learning,
          actor,
          batchId,
          true,
        );
        const p = need(
          await tx.curriculum.learning.students.profile(
            need(d.studentProfileId),
          ),
        );
        user = p.userId;
      } else if (d.studentProfileId)
        reject('FORBIDDEN', 'Students may refresh only their own account', 403);
      const current = await this.learning.effectiveIn(
          tx.curriculum.learning,
          user,
          batchId,
          true,
        ),
        account = need(await tx.accountFor(current.profile.id, d.platform));
      if (d.retryJobId) {
        const previous = need(await tx.job(d.retryJobId));
        if (
          previous.batchId !== batchId ||
          previous.accountId !== account.id ||
          previous.accountRevision !== account.revision ||
          previous.enrollmentId !== current.enrollment.id ||
          previous.curriculumRevisionId !== current.batch.curriculumRevisionId
        )
          reject(
            'SYNC_CONTEXT_CHANGED',
            'Sync context changed; review the current account and enrollment',
            409,
          );
        if (!['FAILED', 'PARTIAL'].includes(previous.status))
          reject(
            'SYNC_RETRY_NOT_DUE',
            'Only failed or partial jobs can be manually retried; active jobs retain their backoff',
            409,
          );
        if (Date.parse(previous.nextAt) > this.now().getTime())
          reject(
            'SYNC_RETRY_NOT_DUE',
            'Wait for the scheduled retry window',
            429,
          );
      }
      const after = eligibleAfter(current.batch, current.enrollment);
      if (!owned(account, this.now()))
        reject(
          'OWNERSHIP_REQUIRED',
          'Verify account ownership before requesting sync',
          422,
        );
      if (!this.providers[d.platform].available)
        reject(
          'VERIFICATION_UNAVAILABLE',
          'This provider integration is unavailable',
          503,
        );
      if (!after)
        reject(
          'MISSING_ACTIVATION_TIMESTAMP',
          'Actual Batch and enrollment activation timestamps are required',
          422,
        );
      if (!current.batch.curriculumRevisionId)
        reject(
          'CURRICULUM_REQUIRED',
          'Assign a curriculum before syncing',
          422,
        );
      if (
        !(await tx.lockAccount(account.id, account.revision)) ||
        !(await tx.lockEligibility(current.profile.id, current.enrollment.id))
      )
        reject('STALE_STATE', 'Eligibility changed');
      const now = this.now().toISOString();
      const previous = (await tx.jobs(account.id, batchId)).find(
        (j) =>
          j.enrollmentId === current.enrollment.id &&
          j.accountRevision === account.revision &&
          j.curriculumRevisionId === current.batch.curriculumRevisionId,
      );
      if (
        previous &&
        ['FAILED', 'PARTIAL'].includes(previous.status) &&
        Date.parse(previous.nextAt) > this.now().getTime()
      )
        reject(
          'SYNC_RETRY_NOT_DUE',
          'Wait for the scheduled retry window',
          429,
        );
      const resume =
        previous?.status === 'PARTIAL' && previous.offset > 1
          ? previous.offset
          : 1;
      const job: Job = {
        id: id(),
        accountId: account.id,
        accountRevision: account.revision,
        studentProfileId: current.profile.id,
        userId: user,
        actorId: actor,
        batchId,
        curriculumRevisionId: current.batch.curriculumRevisionId!,
        enrollmentId: current.enrollment.id,
        eligibleAfter: after!,
        status: 'QUEUED',
        active: true,
        offset: resume,
        pages: 0,
        attempts: 0,
        nextAt: now,
        coverage: resume > 1 ? 'PARTIAL' : 'UNKNOWN',
        createdAt: now,
        updatedAt: now,
      };
      const result = await tx.queue(job, now);
      await tx.saveAccount(
        {
          ...account,
          syncStatus: 'QUEUED',
          nextSyncAt: new Date(
            this.now().getTime() + env.CODING_SYNC_INTERVAL_SECONDS * 1000,
          ).toISOString(),
        },
        account.revision,
      );
      await this.audit(
        tx,
        actor,
        'CODING_SYNC_QUEUED',
        'CODING_SYNC',
        result.id,
        request,
        current.batch.collegeId,
        'QUEUED',
      );
      return { id: result.id, status: result.status };
    });
  }
  async retry(
    actor: string,
    batchId: string,
    jobId: string,
    input: unknown,
    request: string,
  ) {
    confirmSchema.pick({ confirmed: true }).parse(input);
    await this.repo.ensureReady();
    const tx = this.repo.read,
      u = need(await tx.curriculum.learning.students.admin.user(actor)),
      job = need(await tx.job(jobId));
    if (u.role === 'STUDENT') {
      await this.student(tx, actor);
      if (job.userId !== actor)
        reject('FORBIDDEN', 'Only your own sync jobs may be retried', 403);
    } else
      await this.learning.progressAuthority(
        tx.curriculum.learning,
        actor,
        batchId,
      );
    if (job.batchId !== batchId)
      reject('FORBIDDEN', 'Job does not belong to this Batch', 403);
    const account = need(await tx.account(job.accountId));
    return this.refresh(
      actor,
      batchId,
      {
        confirmed: true,
        platform: account.platform,
        retryJobId: job.id,
        ...(u.role === 'STUDENT'
          ? {}
          : { studentProfileId: job.studentProfileId }),
      },
      request,
    );
  }
  async refreshBatch(
    actor: string,
    batch: string,
    input: unknown,
    request: string,
  ) {
    const d = refreshSchema
      .omit({ studentProfileId: true })
      .extend({
        page: querySchema.shape.page,
        pageSize: querySchema.shape.pageSize,
      })
      .parse(input);
    await this.repo.ensureReady();
    await this.learning.progressAuthority(
      this.repo.read.curriculum.learning,
      actor,
      batch,
      true,
    );
    const roster = await this.repo.read.curriculum.learning.enrollments(
        batch,
        listSchema.parse({ page: d.page, pageSize: d.pageSize }),
        false,
      ),
      items = [];
    for (const e of roster.items) {
      if (!e.studentProfileId || e.status !== 'ACTIVE') continue;
      try {
        const job = await this.refresh(
          actor,
          batch,
          {
            platform: d.platform,
            studentProfileId: e.studentProfileId,
            confirmed: true,
          },
          request,
        );
        items.push({
          studentProfileId: e.studentProfileId,
          outcome: 'QUEUED',
          jobId: job.id,
        });
      } catch (error) {
        items.push({
          studentProfileId: e.studentProfileId,
          outcome: error instanceof AppError ? error.code : 'SYNC_UNAVAILABLE',
        });
      }
    }
    return { items, page: d.page, totalPages: roster.totalPages };
  }
  async processOne() {
    await this.repo.ensureReady();
    const token = randomUUID(),
      job = await this.repo.claim(this.now().toISOString(), token);
    if (!job) return false;
    let reservation = false;
    let providerCooldown = 3000;
    try {
      const a = need(await this.repo.read.account(job.accountId));
      if (job.attempts > 12)
        reject('RETRY_EXHAUSTED', 'Sync retry budget exhausted');
      await this.validateJob(this.repo.read, job, a, false);
      reservation = await this.repo.reserveProvider(
        this.now().toISOString(),
        token,
      );
      if (!reservation) {
        await this.finishJob(
          job,
          token,
          'RETRY_WAIT',
          'PROVIDER_RATE_LIMITED',
          3000,
        );
        return true;
      }
      const currentRegistration = await need(
        this.providers[a.platform].identity,
      )(a.handle);
      if (
        !a.registrationTimeSeconds ||
        currentRegistration !== a.registrationTimeSeconds
      )
        reject(
          'OWNERSHIP_MISMATCH',
          'The external handle changed; ownership must be verified again',
          403,
        );
      await this.wait(3000);
      const page = await this.providers[a.platform].fetchPage(
        a.handle,
        job.offset,
      );
      await this.repo.transaction(async (tx) => {
        const currentJob = need(await tx.job(job.id));
        if (
          currentJob.leaseToken !== token ||
          currentJob.status !== 'RUNNING' ||
          Date.parse(currentJob.leaseUntil ?? '') <= this.now().getTime()
        )
          reject('LEASE_LOST', 'Sync lease expired');
        const account = need(await tx.account(job.accountId)),
          current = await this.validateJob(tx, job, account, true),
          assignments = await this.assignments(tx, current.batch),
          prior = await tx.progress(
            job.studentProfileId,
            job.batchId,
            job.enrollmentId,
          );
        let recorded = 0,
          processed = 0,
          ingestionLimited = false;
        let submissions = page.submissions.filter(
          (s) =>
            s.handle.toLowerCase() === account.normalizedHandle &&
            s.submittedAt >= job.eligibleAfter &&
            Date.parse(s.submittedAt) <= this.now().getTime() + 60000,
        );
        const assignmentCounts = new Map<string, number>();
        for (const a of assignments)
          if (a.platform === account.platform)
            assignmentCounts.set(
              a.problemKey,
              (assignmentCounts.get(a.problemKey) ?? 0) + 1,
            );
        const compressed =
          submissions.reduce(
            (n, s) => n + (assignmentCounts.get(s.problemKey) ?? 0),
            0,
          ) > 100;
        if (compressed) {
          // Persist the earliest authoritative attempt and acceptance needed for each problem.
          const selected = new Map<string, (typeof submissions)[number]>();
          for (const s of submissions) {
            const key = s.problemKey + ':' + s.accepted,
              old = selected.get(key);
            if (!old || s.submittedAt < old.submittedAt) selected.set(key, s);
          }
          submissions = [...selected.values()].sort(
            (a, b) =>
              a.submittedAt.localeCompare(b.submittedAt) ||
              a.id.localeCompare(b.id),
          );
        }
        evidenceLoop: for (const s of submissions) {
          for (const assignment of assignments.filter(
            (v) =>
              v.platform === account.platform && v.problemKey === s.problemKey,
          )) {
            const old = prior.find(
              (p) =>
                p.assignmentId === assignment.id &&
                p.accountId === account.id &&
                p.accountRevision === account.revision,
            );
            if (
              compressed &&
              old &&
              old.firstAttemptAt <= s.submittedAt &&
              (!s.accepted ||
                (old.status === 'SOLVED_VERIFIED' &&
                  !!old.solvedAt &&
                  old.solvedAt <= s.submittedAt))
            )
              continue;
            if (processed >= 100) {
              ingestionLimited = true;
              break evidenceLoop;
            }
            processed++;
            const evidenceId = digest(
                [
                  account.platform,
                  account.id,
                  job.accountRevision,
                  s.id,
                  s.digest,
                  job.batchId,
                  job.enrollmentId,
                  assignment.id,
                ].join(':'),
              ).slice(0, 24),
              evidence: Evidence = {
                ...s,
                evidenceId,
                platform: account.platform,
                accountId: account.id,
                accountRevision: account.revision,
                studentProfileId: job.studentProfileId,
                batchId: job.batchId,
                curriculumRevisionId: job.curriculumRevisionId,
                enrollmentId: job.enrollmentId,
                assignmentId: assignment.id,
                problemId: assignment.problemId,
                fetchedAt: this.now().toISOString(),
                adapterVersion: this.providers[account.platform].version,
                sourceType: 'OFFICIAL_API',
                confidence: 'TRUSTED',
              };
            if (await tx.insertEvidence(evidence)) recorded++;
            const solved = old?.status === 'SOLVED_VERIFIED' || s.accepted,
              solvedAt = s.accepted
                ? !old?.solvedAt || s.submittedAt < old.solvedAt
                  ? s.submittedAt
                  : old.solvedAt
                : old?.solvedAt;
            const p: Progress = {
              id: digest(
                [
                  job.studentProfileId,
                  job.batchId,
                  job.curriculumRevisionId,
                  job.enrollmentId,
                  assignment.id,
                ].join(':'),
              ).slice(0, 24),
              studentProfileId: job.studentProfileId,
              batchId: job.batchId,
              curriculumRevisionId: job.curriculumRevisionId,
              enrollmentId: job.enrollmentId,
              assignmentId: assignment.id,
              problemId: assignment.problemId,
              platform: account.platform,
              accountId: account.id,
              accountRevision: account.revision,
              status: solved ? 'SOLVED_VERIFIED' : 'ATTEMPTED_VERIFIED',
              firstAttemptAt:
                old && old.firstAttemptAt < s.submittedAt
                  ? old.firstAttemptAt
                  : s.submittedAt,
              ...(solvedAt ? { solvedAt } : {}),
              latestEvidenceId:
                old?.status === 'SOLVED_VERIFIED' && !s.accepted
                  ? old.latestEvidenceId
                  : evidenceId,
              updatedAt: this.now().toISOString(),
            };
            await tx.putProgress(p);
            const index = prior.findIndex(
              (v) => v.assignmentId === p.assignmentId,
            );
            if (index < 0) prior.push(p);
            else prior[index] = p;
          }
        }
        const exhausted = job.pages + 1 >= 5 || job.offset >= 100001,
          more = (ingestionLimited || page.nextOffset !== null) && !exhausted,
          partial =
            page.partial ||
            ingestionLimited ||
            job.coverage === 'PARTIAL' ||
            (exhausted && !page.complete);
        const next: Job = {
          ...job,
          offset: ingestionLimited ? job.offset : (page.nextOffset ?? 1),
          pages: job.pages + 1,
          status: more ? 'RETRY_WAIT' : partial ? 'PARTIAL' : 'SUCCEEDED',
          active: more,
          nextAt: new Date(this.now().getTime() + 3000).toISOString(),
          coverage: partial
            ? 'PARTIAL'
            : page.complete
              ? 'COMPLETE'
              : 'UNKNOWN',
          updatedAt: this.now().toISOString(),
          ...(partial ? { error: 'INCOMPLETE_PROVIDER_HISTORY' } : {}),
        };
        if (!(await tx.saveJob(next, token)))
          reject('LEASE_LOST', 'Sync lease expired');
        await tx.saveAccount(
          {
            ...account,
            syncStatus: more ? 'RUNNING' : partial ? 'PARTIAL' : 'SUCCESS',
            lastError: partial ? 'INCOMPLETE_PROVIDER_HISTORY' : undefined,
            lastCheckedAt: this.now().toISOString(),
            ...(!more && !partial
              ? { lastSuccessAt: this.now().toISOString() }
              : {}),
          },
          account.revision,
        );
        if (!more) {
          await this.audit(
            tx,
            job.actorId,
            'CODING_SYNC_FINISHED',
            'CODING_SYNC',
            job.id,
            'worker-' + job.id,
            current.batch.collegeId,
            next.status,
            recorded,
          );
          if (recorded)
            await this.audit(
              tx,
              job.actorId,
              'CODING_PROGRESS_RECONCILED',
              'CODING_PROGRESS',
              current.batch.id,
              'worker-' + job.id,
              current.batch.collegeId,
              'EVIDENCE_RECONCILED',
              recorded,
            );
        }
      });
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'SYNC_FAILED';
      providerCooldown =
        error instanceof ProviderCooldown
          ? error.retryAfterMs
          : code === 'PROVIDER_RATE_LIMITED'
            ? 60000
            : code.startsWith('PROVIDER_')
              ? 30000
              : 3000;
      const retry =
        [
          'PROVIDER_UNAVAILABLE',
          'PROVIDER_RATE_LIMITED',
          'PROVIDER_RESPONSE_INVALID',
          'STORAGE_UNAVAILABLE',
        ].includes(code) && job.attempts < 5;
      if (reservation) {
        await this.repo.releaseProvider(
          token,
          new Date(this.now().getTime() + providerCooldown).toISOString(),
        );
        reservation = false;
      }
      await this.finishJob(
        job,
        token,
        retry
          ? 'RETRY_WAIT'
          : [
                'OWNERSHIP_REQUIRED',
                'STALE_ELIGIBILITY',
                'FORBIDDEN',
                'ENROLLMENT_REQUIRED',
                'COLLEGE_FORBIDDEN',
                'ACCOUNT_INELIGIBLE',
                'STUDENT_INELIGIBLE',
              ].includes(code)
            ? 'CANCELLED'
            : 'FAILED',
        code,
        Math.min(900000, 15000 * 2 ** Math.min(job.attempts, 6)) +
          Math.floor(Math.random() * 3000),
      );
    } finally {
      if (reservation)
        await this.repo.releaseProvider(
          token,
          new Date(this.now().getTime() + providerCooldown).toISOString(),
        );
    }
    return true;
  }
  private async validateJob(
    tx: ProgressUnit,
    job: Job,
    a: Account,
    lock: boolean,
  ) {
    if (!owned(a, this.now()) || a.revision !== job.accountRevision)
      reject('OWNERSHIP_REQUIRED', 'Account proof is no longer valid', 403);
    if (job.actorId !== job.userId)
      await this.learning.progressAuthority(
        tx.curriculum.learning,
        job.actorId,
        job.batchId,
        lock,
      );
    const current = await this.learning.effectiveIn(
      tx.curriculum.learning,
      job.userId,
      job.batchId,
      lock,
    );
    if (
      current.profile.id !== job.studentProfileId ||
      current.enrollment.id !== job.enrollmentId ||
      current.batch.curriculumRevisionId !== job.curriculumRevisionId ||
      eligibleAfter(current.batch, current.enrollment) !== job.eligibleAfter
    )
      reject('STALE_ELIGIBILITY', 'Sync eligibility changed', 403);
    if (
      lock &&
      (!(await tx.lockAccount(a.id, a.revision)) ||
        !(await tx.lockEligibility(current.profile.id, current.enrollment.id)))
    )
      reject('STALE_ELIGIBILITY', 'Eligibility changed');
    return current;
  }
  private async finishJob(
    job: Job,
    token: string,
    status: Job['status'],
    error: string,
    delay: number,
  ) {
    await this.repo.transaction(async (tx) => {
      const current = await tx.job(job.id);
      if (
        !current ||
        current.leaseToken !== token ||
        current.status !== 'RUNNING'
      )
        return;
      const active = status === 'RETRY_WAIT';
      if (
        !(await tx.saveJob(
          {
            ...current,
            status,
            active,
            error,
            nextAt: new Date(this.now().getTime() + delay).toISOString(),
            updatedAt: this.now().toISOString(),
            coverage: current.pages ? 'PARTIAL' : 'UNKNOWN',
          },
          token,
        ))
      )
        return;
      const a = await tx.account(job.accountId);
      if (
        a &&
        a.revision === job.accountRevision &&
        error === 'OWNERSHIP_MISMATCH'
      ) {
        await tx.saveAccount(
          {
            ...a,
            active: false,
            status: 'REVOKED',
            revision: a.revision + 1,
            lastError: error,
            syncStatus: 'FAILED',
          },
          a.revision,
        );
        await this.audit(
          tx,
          job.userId,
          'CODING_ACCOUNT_REVOKED',
          'CODING_ACCOUNT',
          a.id,
          'worker-' + job.id,
          undefined,
          'EXTERNAL_IDENTITY_CHANGED',
        );
      } else if (a && a.revision === job.accountRevision)
        await tx.saveAccount(
          {
            ...a,
            lastCheckedAt: this.now().toISOString(),
            lastError: error,
            syncStatus:
              error === 'PROVIDER_RATE_LIMITED'
                ? 'RATE_LIMITED'
                : active
                  ? 'QUEUED'
                  : 'FAILED',
          },
          a.revision,
        );
      if (!active)
        await this.audit(
          tx,
          job.actorId,
          'CODING_SYNC_FINISHED',
          'CODING_SYNC',
          job.id,
          'worker-' + job.id,
          undefined,
          status,
        );
    });
  }
  async schedule() {
    const accounts = await this.repo.scheduled(this.now().toISOString(), 10);
    for (const a of accounts) {
      const enrollments =
        await this.repo.read.curriculum.learning.ownEnrollments(
          a.studentProfileId,
          listSchema.parse({ page: 1, pageSize: 20 }),
        );
      for (const e of enrollments.items) {
        if (e.status !== 'ACTIVE') continue;
        try {
          await this.refresh(
            a.userId,
            e.batchId,
            { platform: a.platform, confirmed: true },
            'scheduled-' + randomUUID(),
          );
        } catch {
          /* Per-account cooldown and eligibility apply equally to automatic jobs. */
        }
      }
      await this.repo.transaction(async (tx) => {
        const current = await tx.account(a.id);
        if (current && current.revision === a.revision)
          await tx.saveAccount(
            {
              ...current,
              nextSyncAt: new Date(
                this.now().getTime() + env.CODING_SYNC_INTERVAL_SECONDS * 1000,
              ).toISOString(),
            },
            current.revision,
          );
      });
    }
  }
  async analytics(user: string, batchId: string, input: unknown) {
    const q = querySchema.parse(input);
    await this.repo.ensureReady();
    const tx = this.repo.read,
      b = (
        await this.learning.progressAuthority(
          tx.curriculum.learning,
          user,
          batchId,
        )
      ).b;
    let assignments = (await this.assignments(tx, b)).filter(
      (a) =>
        (!q.platform || q.platform === a.platform) &&
        (!q.day || q.day === a.dayNumber) &&
        (!q.problemId || q.problemId === a.problemId),
    );
    const total = assignments.length;
    assignments = assignments.slice(
      (q.page - 1) * q.pageSize,
      q.page * q.pageSize,
    );
    const counts = new Map(
      assignments.map((a) => [
        a.id,
        {
          ...a,
          eligibleStudents: 0,
          solved: 0,
          attempted: 0,
          unavailable: 0,
          notStarted: 0,
        },
      ]),
    );
    for (let page = 1; page <= 40; page++) {
      const roster = await tx.curriculum.learning.enrollments(
        b.id,
        listSchema.parse({ page, pageSize: 50 }),
        false,
      );
      if (roster.total > 2000)
        reject(
          'REPORT_LIMIT',
          'Problem analytics supports at most 2000 roster members',
          422,
        );
      for (const e of roster.items) {
        if (
          e.status !== 'ACTIVE' ||
          !e.studentProfileId ||
          (q.studentProfileId && e.studentProfileId !== q.studentProfileId)
        )
          continue;
        const p = await tx.curriculum.learning.students.profile(
          e.studentProfileId,
        );
        if (!p) continue;
        try {
          await this.progressContext(tx, p.userId, b.id);
        } catch {
          continue;
        }
        const projection = await this.projection(tx, b, e, p.id, {
          ...q,
          page: 1,
          pageSize: 10000,
        });
        // Fetch just the requested assignment page, independent of the Student list page.
        const accountRows = await tx.accounts(p.id),
          progress = await tx.progress(p.id, b.id, e.id);
        for (const a of assignments) {
          const c = counts.get(a.id)!,
            account = accountRows.find((v) => v.platform === a.platform),
            pr = progress.find(
              (v) =>
                v.assignmentId === a.id &&
                v.accountId === account?.id &&
                v.accountRevision === account?.revision,
            );
          c.eligibleStudents++;
          const matching = projection.items.find((v) => v.id === a.id);
          if (matching?.status === 'SOLVED_VERIFIED') c.solved++;
          else if (matching?.status === 'ATTEMPTED_VERIFIED') c.attempted++;
          else if (matching?.status === 'NOT_STARTED') c.notStarted++;
          else if (
            eligibleAfter(b, e) &&
            owned(account, this.now()) &&
            this.providers[a.platform].available &&
            pr
          ) {
            if (pr.status === 'SOLVED_VERIFIED') c.solved++;
            else c.attempted++;
          } else c.unavailable++;
        }
      }
      if (page >= roster.totalPages) break;
    }
    return {
      items: [...counts.values()],
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.ceil(total / q.pageSize),
    };
  }
  async reportData(
    user: string,
    batchId: string,
    input: unknown,
    unit: ProgressUnit = this.repo.read,
    includeEmpty = false,
  ) {
    const filters = exportFilters.parse(input);
    const q = querySchema.parse(
      Object.fromEntries(
        Object.entries(filters).filter(
          ([key]) =>
            ![
              'collegeId',
              'courseId',
              'rollNumber',
              'studentName',
              'year',
              'search',
            ].includes(key),
        ),
      ),
    );
    await this.repo.ensureReady();
    const tx = unit,
      l = tx.curriculum.learning,
      b = (await this.learning.progressAuthority(l, user, batchId)).b;
    if (
      (filters.collegeId && filters.collegeId !== b.collegeId) ||
      (filters.courseId && filters.courseId !== b.courseId)
    )
      reject(
        'REPORT_SCOPE_MISMATCH',
        'The selected College/Course does not match this Batch',
        403,
      );
    const college = need(await l.students.admin.college(b.collegeId)),
      rows: ReportRow[] = [],
      students: ReportStudent[] = [];
    const selectedAssignments = await this.assignments(tx, b);
    const metadata = new Map(selectedAssignments.map((a) => [a.id, a]));
    for (let page = 1; page <= 40; page++) {
      let roster = await l.enrollments(
        b.id,
        listSchema.parse({ page, pageSize: 50 }),
        false,
      );
      if (q.studentProfileId || filters.rollNumber?.length === 10) {
        let e = null;
        if (q.studentProfileId) {
          const p = await l.students.profile(q.studentProfileId);
          if (p?.collegeId === b.collegeId)
            e = await l.current(b.id, p.rollNumber, p.id);
        } else e = await l.current(b.id, filters.rollNumber!.toUpperCase());
        roster = {
          items: e ? [e] : [],
          total: e ? 1 : 0,
          totalPages: e ? 1 : 0,
          page: 1,
          pageSize: 50,
        };
      }
      if (roster.total > MAX_EXPORT_STUDENTS)
        reject(
          'EXPORT_TOO_LARGE',
          'Roster exceeds 2000 members. Refine to an exact Student or roll number.',
          413,
        );
      for (const e of roster.items) {
        if (e.status !== 'ACTIVE' || !e.studentProfileId) continue;
        const p = await l.students.profile(e.studentProfileId);
        if (
          !p ||
          (filters.rollNumber &&
            !p.rollNumber.includes(filters.rollNumber.toUpperCase())) ||
          (filters.year && p.yearOfStudy !== filters.year) ||
          (filters.search &&
            !(p.rollNumber + ' ' + p.fullName)
              .toLowerCase()
              .includes(filters.search.toLowerCase())) ||
          (filters.studentName &&
            !p.fullName
              .toLocaleLowerCase()
              .includes(filters.studentName.toLocaleLowerCase()))
        )
          continue;
        try {
          const current = await this.progressContext(tx, p.userId, b.id);
          if (current.enrollment.id !== e.id) continue;
        } catch (error) {
          if (error instanceof AppError && [403, 404].includes(error.status))
            continue;
          throw error;
        }
        const projection = await this.projection(tx, b, e, p.id, {
            ...q,
            page: 1,
            pageSize: 10000,
          }),
          accounts = await tx.accounts(p.id);
        const matchedPlatforms = new Set(
          projection.items.map((a) => a.platform),
        );
        const lastSuccess =
          accounts
            .filter((a) => matchedPlatforms.has(a.platform))
            .map((a) => a.lastSuccessAt)
            .filter((v): v is string => !!v)
            .sort()
            .at(-1) ?? null;
        if (
          (q.status ||
            q.platform ||
            q.day ||
            q.problemId ||
            q.verification ||
            q.from ||
            q.to) &&
          !projection.items.length &&
          !includeEmpty
        )
          continue;
        students.push({
          id: p.id,
          roll: p.rollNumber,
          name: p.fullName,
          year: p.yearOfStudy ?? null,
          lastSuccess,
        });
        if (rows.length + projection.items.length > MAX_EXPORT_ROWS)
          reject(
            'EXPORT_TOO_LARGE',
            'More than 20000 matching assignment rows. Refine Learning Day, platform, Student or status filters.',
            413,
          );
        for (const a of projection.items) {
          const account = accounts.find((v) => v.platform === a.platform),
            problem = metadata.get(a.id);
          rows.push({
            studentId: p.id,
            roll: p.rollNumber,
            name: p.fullName,
            year: p.yearOfStudy ?? null,
            college: college.name,
            course: b.snapshot.title,
            batch: b.name,
            assignmentId: a.id,
            day: a.dayNumber,
            problem: a.title,
            platform: a.platform,
            difficulty: problem?.difficulty ?? 'UNKNOWN',
            problemKey: a.problemKey,
            status: a.status,
            verification: a.ownershipStatus,
            acceptedAt: a.solvedAt,
            evidence: a.latestEvidenceId,
            lastSync: account?.lastCheckedAt ?? null,
            lastSuccess: account?.lastSuccessAt ?? null,
          });
        }
      }
      if (page >= roster.totalPages) break;
    }
    return {
      b,
      college,
      rows,
      students,
      assignments: selectedAssignments.filter(
        (a) =>
          (!q.day || a.dayNumber === q.day) &&
          (!q.platform || a.platform === q.platform) &&
          (!q.problemId || a.problemId === q.problemId),
      ),
    };
  }
  async exported(
    user: string,
    batchId: string,
    input: unknown,
    format: 'CSV' | 'XLSX',
    request: string,
    reportType: ReportType = 'STUDENT',
    includeDetails = false,
  ) {
    const { b, college, rows, students } = await this.reportData(
      user,
      batchId,
      input,
    );
    if (reportType === 'DAY' && !exportFilters.parse(input).day)
      reject(
        'DAY_REQUIRED',
        'Choose a Learning Day for a Day-wise report',
        400,
      );
    const result = await buildProgressReport(
      {
        college: college.name,
        course: b.snapshot.title,
        batch: b.name,
        exportedAt: this.now().toISOString(),
        assignedProblems: new Set(rows.map((r) => r.assignmentId)).size,
        students,
        rows,
      },
      reportType,
      format,
      includeDetails,
    );
    await this.repo.transaction(async (unit) => {
      const current = await this.learning.progressAuthority(
        unit.curriculum.learning,
        user,
        batchId,
      );
      if (
        !(await unit.curriculum.learning.students.admin.lockUser(
          user,
          current.u.sessionVersion,
        )) ||
        !(await unit.curriculum.learning.students.lockCollege(
          current.b.collegeId,
        )) ||
        !(await unit.curriculum.learning.lockBatch(batchId))
      )
        reject(
          'REPORT_CHANGED',
          'Authority or Batch changed; regenerate the report',
        );
      if (current.b.curriculumRevisionId !== b.curriculumRevisionId)
        reject(
          'REPORT_CHANGED',
          'Batch curriculum changed; regenerate the report',
        );
      await this.audit(
        unit,
        user,
        'CODING_REPORT_EXPORTED',
        'CODING_PROGRESS',
        batchId,
        request,
        b.collegeId,
        reportType,
        rows.length,
      );
    });
    return { ...result, page: 1, totalPages: 1 };
  }
}
