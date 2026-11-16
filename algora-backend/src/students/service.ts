import { AppError } from '../middleware/errors.js';
import type { UserRecord, Role } from '../auth/types.js';
import {
  pageDefaults,
  type Permission,
  type AuditAction,
} from '../administration/contracts.js';
import {
  registerSchema,
  editSchema,
  correctionSchema,
  verificationSchema,
  reviewSchema,
  rotateSchema,
  rollSchema,
  studentUsername,
  safeProfile,
  departments,
  type StudentRepository,
  type StudentUnit,
  type StudentProfileRecord,
  type StudentList,
} from './contracts.js';
import { QrVault } from './crypto.js';
const fail = (code: string, message: string, status = 409): never => {
  throw new AppError(status, code, message);
};
const need = <T>(v: T | null): T =>
  v ?? fail('NOT_FOUND', 'Record not found', 404);
export class StudentService {
  constructor(
    private repo: StudentRepository,
    private vault = new QrVault(),
  ) {}
  private async actor(
    tx: StudentUnit,
    id: string,
    roles: Role[],
    lock = false,
  ) {
    const u = need(await tx.admin.user(id));
    if (!u.emailVerified || ['SUSPENDED', 'ARCHIVED'].includes(u.accountStatus))
      fail('ACCOUNT_SUSPENDED', 'Account is unavailable', 403);
    if (!roles.includes(u.role))
      fail('FORBIDDEN', 'Access is not allowed', 403);
    if (u.role !== 'STUDENT' && u.accountStatus !== 'ACTIVE')
      fail('ACCOUNT_PENDING', 'Account is not active', 403);
    if (lock && !(await tx.admin.lockUser(id, u.sessionVersion)))
      fail('STALE_STATE', 'Account changed; refresh and retry');
    return u;
  }
  private async activeCollege(tx: StudentUnit, id: string, lock = false) {
    const c = need(await tx.admin.college(id));
    if (c.status !== 'ACTIVE' || (lock && !(await tx.lockCollege(id))))
      fail('COLLEGE_UNAVAILABLE', 'College must be active', 403);
    return c;
  }
  private async scope(tx: StudentUnit, u: UserRecord, permission: Permission) {
    if (u.role === 'SUPER_ADMIN') return null;
    const ids: string[] = [];
    for (const a of await tx.admin.assignments(u.id)) {
      if (
        a.status === 'ACTIVE' &&
        a.permissions.includes(permission) &&
        (await tx.admin.college(a.collegeId))?.status === 'ACTIVE'
      )
        ids.push(a.collegeId);
    }
    return ids;
  }
  private async authorize(
    tx: StudentUnit,
    u: UserRecord,
    collegeId: string,
    permission: Permission,
    lock = false,
  ) {
    const scope = await this.scope(tx, u, permission);
    if (scope && !scope.includes(collegeId))
      fail(
        'COLLEGE_FORBIDDEN',
        'College access or permission unavailable',
        403,
      );
    await this.activeCollege(tx, collegeId, lock);
  }
  private async audit(
    tx: StudentUnit,
    u: UserRecord,
    action: AuditAction,
    p: StudentProfileRecord,
    requestId: string,
    before?: string,
    after?: string,
  ) {
    await tx.admin.audit({
      actorUserId: u.id,
      actorName: u.displayName,
      action,
      targetType: 'STUDENT_PROFILE',
      targetId: p.id,
      collegeId: p.collegeId,
      metadata: { before, after },
      requestId,
    });
  }
  private async own(tx: StudentUnit, userId: string) {
    return need(await tx.own(userId));
  }
  async options(id: string, o: StudentList) {
    await this.repo.ensureReady();
    await this.actor(this.repo.read, id, ['STUDENT']);
    const colleges = await this.repo.read.admin.colleges(
      { ...pageDefaults, ...o, sort: 'name', direction: 'asc' },
      true,
    );
    return {
      colleges: {
        ...colleges,
        items: colleges.items.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
        })),
      },
      departments,
      qrIssuanceAvailable: this.vault.available(),
    };
  }
  async availability(id: string, roll: unknown) {
    const value = rollSchema.parse(roll);
    await this.repo.ensureReady();
    await this.actor(this.repo.read, id, ['STUDENT']);
    return {
      rollNumber: value,
      available: !(await this.repo.read.rollOwner(value)),
    };
  }
  async register(id: string, input: unknown, requestId: string) {
    const { confirmed, ...data } = registerSchema.parse(input);
    void confirmed;
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, ['STUDENT'], true);
      if (u.username)
        fail(
          'LEGACY_IDENTITY_REVIEW',
          'Existing username requires an audited migration',
        );
      if (await tx.own(id))
        fail('ALREADY_REGISTERED', 'Student registration is already complete');
      await this.activeCollege(tx, data.collegeId, true);
      if (await tx.rollOwner(data.rollNumber))
        fail('ROLL_UNAVAILABLE', 'This roll number is unavailable');
      const p = await tx.insert({
        ...data,
        userId: id,
        studentUsername: studentUsername(data.rollNumber, data.fullName),
        verificationStatus: 'PENDING_VERIFICATION',
        qrCredentialVersion: 0,
        revision: 0,
      });
      await tx.reserveRoll(p.rollNumber, p.id);
      let result = p;
      if (this.vault.available()) {
        const c = this.vault.issue(p.id, 1);
        await tx.putCredential(c);
        result = need(
          await tx.update(p.id, p.revision, { qrCredentialVersion: 1 }),
        );
        await this.audit(tx, u, 'STUDENT_QR_ISSUED', result, requestId);
      }
      await tx.registration(id, 'PENDING_VERIFICATION');
      await this.audit(
        tx,
        u,
        'STUDENT_REGISTERED',
        result,
        requestId,
        undefined,
        'PENDING_VERIFICATION',
      );
      return safeProfile(result);
    });
  }
  async me(id: string) {
    await this.repo.ensureReady();
    const u = await this.actor(this.repo.read, id, ['STUDENT']);
    const p = await this.own(this.repo.read, id);
    const c = await this.repo.read.admin.college(p.collegeId);
    return {
      profile: safeProfile(p),
      email: u.email,
      college: c ? { id: c.id, name: c.name, status: c.status } : null,
      qrIssuanceAvailable: this.vault.available(),
    };
  }
  async edit(id: string, input: unknown, requestId: string) {
    const { expectedRevision, ...data } = editSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, ['STUDENT'], true);
      const p = await this.own(tx, id);
      if (p.revision !== expectedRevision)
        fail('STALE_STATE', 'Profile changed; refresh and retry');
      const next = need(await tx.update(p.id, expectedRevision, data));
      await this.audit(
        tx,
        u,
        'STUDENT_PROFILE_UPDATED',
        next,
        requestId,
        undefined,
        'Contact or coding profile fields updated',
      );
      return safeProfile(next);
    });
  }
  async qr(id: string) {
    await this.repo.ensureReady();
    await this.actor(this.repo.read, id, ['STUDENT']);
    const p = await this.own(this.repo.read, id);
    const c =
      (await this.repo.read.credential(p.id)) ??
      fail(
        'QR_NOT_ISSUED',
        'QR is not issued; configure encryption and explicitly issue it',
        503,
      );
    if (c.version !== p.qrCredentialVersion)
      fail('QR_UNAVAILABLE', 'Credential state is unavailable', 503);
    return { token: this.vault.reveal(c), version: c.version };
  }
  async rotate(id: string, input: unknown, requestId: string) {
    const data = rotateSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, ['STUDENT'], true);
      const p = await this.own(tx, id);
      if (p.qrCredentialVersion !== data.expectedVersion)
        fail('STALE_STATE', 'QR changed; refresh before retrying');
      const version = p.qrCredentialVersion + 1;
      const c = this.vault.issue(p.id, version);
      const next = need(
        await tx.update(p.id, p.revision, { qrCredentialVersion: version }),
      );
      await tx.putCredential(c);
      await this.audit(
        tx,
        u,
        p.qrCredentialVersion ? 'STUDENT_QR_ROTATED' : 'STUDENT_QR_ISSUED',
        next,
        requestId,
        String(p.qrCredentialVersion),
        String(version),
      );
      return { version };
    });
  }
  async requestCorrection(id: string, input: unknown, requestId: string) {
    const d = correctionSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, ['STUDENT'], true);
      const p = await this.own(tx, id);
      if (p.revision !== d.expectedRevision)
        fail('STALE_STATE', 'Profile changed; refresh and retry');
      if (await tx.pendingCorrection(p.id))
        fail(
          'CORRECTION_PENDING',
          'Cancel or await the existing pending correction',
        );
      if (
        Object.entries(d.requestedChanges).every(
          ([key, value]) => p[key as keyof StudentProfileRecord] === value,
        )
      )
        fail('NO_CHANGES', 'Request must change an identity field', 400);
      if (d.requestedChanges.collegeId)
        await this.activeCollege(tx, d.requestedChanges.collegeId, true);
      const c = await tx.insertCorrection({
        studentProfileId: p.id,
        requesterUserId: id,
        sourceCollegeId: p.collegeId,
        requestedChanges: d.requestedChanges,
        reason: d.reason,
        profileRevision: p.revision,
        status: 'PENDING',
        reviewNote: '',
      });
      await this.audit(tx, u, 'STUDENT_CORRECTION_REQUESTED', p, requestId);
      return c;
    });
  }
  async ownCorrections(id: string, o: StudentList) {
    await this.repo.ensureReady();
    await this.actor(this.repo.read, id, ['STUDENT']);
    return this.repo.read.corrections(o, null, id);
  }
  async cancel(id: string, request: string, requestId: string) {
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, ['STUDENT'], true);
      const c = need(await tx.correction(request));
      if (c.requesterUserId !== id) fail('NOT_FOUND', 'Request not found', 404);
      if (c.status === 'CANCELLED') return c;
      if (c.status !== 'PENDING')
        fail('REQUEST_REVIEWED', 'Request is already reviewed');
      const next = need(await tx.reviewCorrection(c.id, 'CANCELLED', id, ''));
      await this.audit(
        tx,
        u,
        'STUDENT_CORRECTION_CANCELLED',
        need(await tx.profile(c.studentProfileId)),
        requestId,
      );
      return next;
    });
  }
  async directory(id: string, o: StudentList) {
    await this.repo.ensureReady();
    const u = await this.actor(this.repo.read, id, ['ADMIN', 'SUPER_ADMIN']);
    const scope = await this.scope(this.repo.read, u, 'student.view');
    const page = await this.repo.read.profiles(o, scope);
    const items = [];
    for (const p of page.items)
      items.push({
        ...safeProfile(p),
        collegeName: (await this.repo.read.admin.college(p.collegeId))?.name,
      });
    return { ...page, items };
  }
  async detail(id: string, studentId: string) {
    await this.repo.ensureReady();
    const tx = this.repo.read;
    const u = await this.actor(tx, id, ['ADMIN', 'SUPER_ADMIN']);
    const p = need(await tx.profile(studentId));
    if (u.role !== 'SUPER_ADMIN')
      await this.authorize(tx, u, p.collegeId, 'student.view');
    const scope = await this.scope(tx, u, 'student.verify');
    const college = await tx.admin.college(p.collegeId);
    const canVerify =
      u.id !== p.userId &&
      (scope === null || scope.includes(p.collegeId)) &&
      college?.status === 'ACTIVE';
    return {
      profile: safeProfile(p),
      canVerify,
      college: college
        ? { id: college.id, name: college.name, status: college.status }
        : null,
      ...(canVerify ? { verificationEvidence: p.verificationEvidence } : {}),
      email: (await tx.admin.user(p.userId))?.email,
    };
  }
  async verify(
    id: string,
    studentId: string,
    input: unknown,
    reject: boolean,
    requestId: string,
  ) {
    const data = reject
      ? reviewSchema.parse(input)
      : verificationSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, ['ADMIN', 'SUPER_ADMIN'], true);
      const p = need(await tx.profile(studentId));
      if (u.id === p.userId)
        fail(
          'SELF_REVIEW_FORBIDDEN',
          'A separate authorized reviewer must verify your identity',
          403,
        );
      await this.authorize(tx, u, p.collegeId, 'student.verify', true);
      const target = await this.actor(
        tx,
        p.userId,
        ['STUDENT', 'ADMIN', 'SUPER_ADMIN'],
        true,
      );
      void target;
      if (p.revision !== data.expectedRevision)
        fail('STALE_STATE', 'Profile changed; refresh and retry');
      if (p.verificationStatus === 'VERIFIED')
        fail(
          'ALREADY_VERIFIED',
          'Verified identity requires correction review before changes',
        );
      const status = reject ? 'REJECTED' : 'VERIFIED';
      const next = need(
        await tx.update(p.id, data.expectedRevision, {
          verificationStatus: status,
          verifiedBy: u.id,
          verifiedAt: new Date().toISOString(),
          verificationMethod: reject ? undefined : 'AUTHORIZED_MANUAL',
          verificationEvidence:
            'evidenceReference' in data ? data.evidenceReference : undefined,
          verificationNote: 'reviewNote' in data ? data.reviewNote : '',
        }),
      );
      await tx.registration(
        p.userId,
        reject ? 'PENDING_VERIFICATION' : 'VERIFIED',
      );
      await this.audit(
        tx,
        u,
        reject ? 'STUDENT_VERIFICATION_REJECTED' : 'STUDENT_VERIFIED',
        next,
        requestId,
        p.verificationStatus,
        status,
      );
      return safeProfile(next);
    });
  }
  async corrections(id: string, o: StudentList) {
    await this.repo.ensureReady();
    const u = await this.actor(this.repo.read, id, ['ADMIN', 'SUPER_ADMIN']);
    return this.repo.read.corrections(
      o,
      await this.scope(this.repo.read, u, 'student.verify'),
    );
  }
  async review(
    id: string,
    request: string,
    input: unknown,
    approve: boolean,
    requestId: string,
  ) {
    const d = reviewSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const u = await this.actor(tx, id, ['ADMIN', 'SUPER_ADMIN'], true);
      const c = need(await tx.correction(request));
      if (c.status !== 'PENDING')
        fail('REQUEST_REVIEWED', 'Request already reviewed');
      const p = need(await tx.profile(c.studentProfileId));
      if (u.id === p.userId)
        fail(
          'SELF_REVIEW_FORBIDDEN',
          'A separate authorized reviewer must review your correction',
          403,
        );
      await this.authorize(tx, u, p.collegeId, 'student.verify', true);
      if (c.sourceCollegeId !== p.collegeId)
        fail('STALE_STATE', 'College changed; submit a new request');
      if (p.revision !== d.expectedRevision)
        fail('STALE_STATE', 'Profile changed; refresh and review again');
      await this.actor(tx, p.userId, ['STUDENT', 'ADMIN', 'SUPER_ADMIN'], true);
      let next = p;
      if (approve) {
        const changes = Object.fromEntries(
          Object.entries(c.requestedChanges).filter(
            ([key, value]) => p[key as keyof StudentProfileRecord] !== value,
          ),
        ) as typeof c.requestedChanges;
        if (changes.collegeId && changes.collegeId !== p.collegeId) {
          if (u.role !== 'SUPER_ADMIN')
            fail(
              'TRANSFER_REQUIRES_SUPER_ADMIN',
              'College transfers require Super Admin review',
              403,
            );
          await this.activeCollege(tx, changes.collegeId, true);
        }
        if (changes.rollNumber && changes.rollNumber !== p.rollNumber) {
          const owner = await tx.rollOwner(changes.rollNumber);
          if (owner && owner !== p.id)
            fail('ROLL_UNAVAILABLE', 'Requested roll number is unavailable');
          await tx.reserveRoll(changes.rollNumber, p.id);
        }
        const yearOnly = Object.keys(changes).every(
          (key) => key === 'yearOfStudy',
        );
        next = need(
          await tx.update(p.id, p.revision, {
            ...changes,
            ...(!yearOnly
              ? {
                  verificationStatus: 'PENDING_VERIFICATION',
                  verifiedBy: undefined,
                  verifiedAt: undefined,
                  verificationMethod: undefined,
                  verificationEvidence: undefined,
                  verificationNote: '',
                }
              : {}),
          }),
        );
        if (!yearOnly) await tx.registration(p.userId, 'PENDING_VERIFICATION');
        await this.audit(
          tx,
          u,
          'STUDENT_IDENTITY_CORRECTED',
          next,
          requestId,
          JSON.stringify(
            Object.fromEntries(
              Object.keys(changes).map((key) => [
                key,
                p[key as keyof StudentProfileRecord],
              ]),
            ),
          ),
          JSON.stringify({
            ...Object.fromEntries(
              Object.keys(changes).map((key) => [
                key,
                next[key as keyof StudentProfileRecord],
              ]),
            ),
            verificationStatus: next.verificationStatus,
          }),
        );
      }
      const result = need(
        await tx.reviewCorrection(
          c.id,
          approve ? 'APPROVED' : 'REJECTED',
          u.id,
          d.reviewNote,
        ),
      );
      await this.audit(
        tx,
        u,
        approve ? 'STUDENT_CORRECTION_APPROVED' : 'STUDENT_CORRECTION_REJECTED',
        next,
        requestId,
      );
      return result;
    });
  }
}
