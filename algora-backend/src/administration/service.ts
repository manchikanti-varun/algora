import { AppError } from '../middleware/errors.js';
import type { UserRecord, Role } from '../auth/types.js';
import { normalizeName, isValidUsername } from '../utils/usernames.js';
import {
  scopedCollege,
  UniqueConflict,
  adminProfile,
  ownRequest,
  pageDefaults,
  approveSchema,
  assignmentsSchema,
  collegeInputSchema,
  collegePatchSchema,
  collegeStatusSchema,
  requestInputSchema,
  rejectSchema,
  adminStatusSchema,
  type AdminRepository,
  type AdminUnit,
  type Grant,
  type CollegeRecord,
  type Permission,
  type AuditInput,
  type ListOptions,
} from './contracts.js';
import type { z } from 'zod';
const fail = (code: string, message: string, status = 409): never => {
  throw new AppError(status, code, message);
};
const needed = <T>(record: T | null): T =>
  record ?? fail('NOT_FOUND', 'Record not found', 404);
export function privilegedUsername(
  role: 'ADMIN' | 'SUPER_ADMIN',
  fullName: string,
  attempt = 1,
) {
  const base = normalizeName(fullName)
    .replace(/[^a-z]/g, '')
    .slice(0, 60);
  if (base.length < 2)
    fail(
      'NAME_REQUIRES_REVIEW',
      'A name with at least two supported letters is required',
      400,
    );
  if (attempt < 1 || attempt > 8)
    fail('USERNAME_UNAVAILABLE', 'A username could not be allocated safely');
  return (
    (role === 'ADMIN' ? 'ad-' : 'sa-') +
    base +
    (role === 'ADMIN' && attempt > 1 ? attempt : '')
  );
}
export class AdministrationService {
  constructor(private repo: AdminRepository) {}
  private async actor(tx: AdminUnit, id: string, roles: Role[], lock = false) {
    const user = needed(await tx.user(id));
    if (
      !user.emailVerified ||
      ['SUSPENDED', 'ARCHIVED'].includes(user.accountStatus)
    )
      fail('ACCOUNT_SUSPENDED', 'This account is not eligible', 403);
    if (!roles.includes(user.role))
      fail('FORBIDDEN', 'You do not have permission', 403);
    if (user.role !== 'STUDENT' && user.accountStatus !== 'ACTIVE')
      fail('ACCOUNT_PENDING', 'Account is not active', 403);
    if (lock && !(await tx.lockUser(id, user.sessionVersion)))
      fail('STALE_STATE', 'Account changed; refresh and retry');
    return user;
  }
  private async readActor(id: string, roles: Role[]) {
    await this.repo.ensureReady();
    return this.actor(this.repo.read, id, roles);
  }
  private audit(
    tx: AdminUnit,
    actor: UserRecord,
    requestId: string,
    input: Omit<AuditInput, 'actorUserId' | 'actorName' | 'requestId'>,
  ) {
    return tx.audit({
      ...input,
      actorUserId: actor.id,
      actorName: actor.displayName,
      requestId,
    });
  }
  private async eligible(tx: AdminUnit, ids: string[]) {
    for (const id of ids) {
      const record = needed(await tx.college(id));
      if (record.status !== 'ACTIVE')
        fail('COLLEGE_UNAVAILABLE', 'Selected colleges must be active', 400);
    }
  }
  async provision(subject: string, confirmed: boolean, requestId: string) {
    if (!confirmed || !subject.trim())
      fail(
        'PROVISIONING_CONFIRMATION_REQUIRED',
        'Explicit identity configuration and operator confirmation are required',
        400,
      );
    return this.repo.transaction(async (tx) => {
      const user = needed(await tx.userBySubject(subject));
      if (user.googleSubject !== subject || !user.emailVerified)
        fail(
          'IDENTITY_UNVERIFIED',
          'An existing verified Google identity is required',
          403,
        );
      const owner = await tx.superAdmin();
      if (owner) {
        if (owner.id !== user.id)
          fail('SUPER_ADMIN_EXISTS', 'A different Super Admin already exists');
        if (
          owner.accountStatus !== 'ACTIVE' ||
          !owner.username ||
          !isValidUsername(owner.username, 'SUPER_ADMIN')
        )
          fail(
            'OWNER_RECOVERY_REQUIRED',
            'Existing owner requires the separate recovery procedure',
          );
        return { user: adminProfile(owner), provisioned: false };
      }
      if (
        user.role !== 'STUDENT' ||
        user.username ||
        ['SUSPENDED', 'ARCHIVED'].includes(user.accountStatus)
      )
        fail(
          'AMBIGUOUS_IDENTITY',
          'Identity is not eligible for automatic provisioning',
        );
      if (!(await tx.lockUser(user.id, user.sessionVersion)))
        fail('STALE_STATE', 'Identity changed; retry safely');
      const promoted = needed(
        await tx.promote(
          user.id,
          subject,
          privilegedUsername('SUPER_ADMIN', user.displayName),
          'SUPER_ADMIN',
          user.sessionVersion,
        ),
      );
      await tx.revokeSessions(user.id);
      await this.audit(tx, promoted, requestId, {
        action: 'SUPER_ADMIN_PROVISIONED',
        targetType: 'USER',
        targetId: user.id,
        metadata: { before: user.role, after: 'SUPER_ADMIN' },
      });
      return { user: adminProfile(promoted), provisioned: true };
    });
  }
  async colleges(actorId: string, o: ListOptions) {
    await this.readActor(actorId, ['SUPER_ADMIN']);
    return this.repo.read.colleges(o);
  }
  async college(actorId: string, id: string) {
    await this.readActor(actorId, ['SUPER_ADMIN']);
    return needed(await this.repo.read.college(id));
  }
  async createCollege(actorId: string, input: unknown, requestId: string) {
    const data = collegeInputSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const actor = await this.actor(tx, actorId, ['SUPER_ADMIN'], true);
      const record = await tx.insertCollege(data, actor.id);
      await this.audit(tx, actor, requestId, {
        action: 'COLLEGE_CREATED',
        targetType: 'COLLEGE',
        targetId: record.id,
        collegeId: record.id,
        metadata: { after: record.status },
      });
      return record;
    });
  }
  async updateCollege(
    actorId: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    const { expectedRevision, ...patch } = collegePatchSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const actor = await this.actor(tx, actorId, ['SUPER_ADMIN'], true);
      const current = needed(await tx.college(id));
      if (current.status === 'ARCHIVED')
        fail('COLLEGE_ARCHIVED', 'Archived college details are preserved');
      const updated = await tx.updateCollege(
        id,
        expectedRevision,
        patch,
        actor.id,
      );
      if (!updated) fail('STALE_STATE', 'College changed; refresh and retry');
      await this.audit(tx, actor, requestId, {
        action: 'COLLEGE_UPDATED',
        targetType: 'COLLEGE',
        targetId: id,
        collegeId: id,
        metadata: {
          count: Object.keys(patch).length,
          before: JSON.stringify(
            Object.fromEntries(
              (Object.keys(patch) as (keyof CollegeRecord)[]).map((key) => [
                key,
                current[key],
              ]),
            ),
          ).slice(0, 1000),
          after: JSON.stringify(
            Object.fromEntries(
              (Object.keys(patch) as (keyof CollegeRecord)[]).map((key) => [
                key,
                updated![key],
              ]),
            ),
          ).slice(0, 1000),
        },
      });
      return updated!;
    });
  }
  async collegeStatus(
    actorId: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    const data = collegeStatusSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const actor = await this.actor(tx, actorId, ['SUPER_ADMIN'], true);
      const current = needed(await tx.college(id));
      if (current.revision !== data.expectedRevision)
        fail('STALE_STATE', 'College changed; refresh and retry');
      if (current.status === data.status) return current;
      if (current.status === 'ARCHIVED')
        fail('INVALID_TRANSITION', 'Archived colleges cannot be reactivated');
      const updated = needed(
        await tx.updateCollege(
          id,
          data.expectedRevision,
          { status: data.status },
          actor.id,
        ),
      );
      await this.audit(tx, actor, requestId, {
        action: 'COLLEGE_STATUS_CHANGED',
        targetType: 'COLLEGE',
        targetId: id,
        collegeId: id,
        metadata: { before: current.status, after: data.status },
      });
      return updated;
    });
  }
  async eligibleColleges(actorId: string, o: ListOptions) {
    await this.readActor(actorId, ['STUDENT']);
    const page = await this.repo.read.colleges(o, true);
    return {
      ...page,
      items: page.items.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        city: c.city,
        state: c.state,
        country: c.country,
      })),
    };
  }
  async submit(actorId: string, input: unknown, requestId: string) {
    const data = requestInputSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const actor = await this.actor(tx, actorId, ['STUDENT'], true);
      if (await tx.pendingRequest(actor.id))
        fail('REQUEST_PENDING', 'You already have a pending request');
      await this.eligible(tx, data.collegeIds);
      const record = await tx.insertRequest(actor, data);
      await this.audit(tx, actor, requestId, {
        action: 'ADMIN_REQUEST_SUBMITTED',
        targetType: 'ADMIN_REQUEST',
        targetId: record.id,
        metadata: { count: data.collegeIds.length },
      });
      return ownRequest(record);
    });
  }
  async ownRequests(actorId: string, o: ListOptions) {
    await this.readActor(actorId, ['STUDENT', 'ADMIN']);
    const page = await this.repo.read.requests(o, actorId);
    return {
      ...page,
      items: page.items.map(ownRequest),
      pending: !!(await this.repo.read.pendingRequest(actorId)),
    };
  }
  async cancel(actorId: string, id: string, requestId: string) {
    return this.repo.transaction(async (tx) => {
      const actor = await this.actor(tx, actorId, ['STUDENT'], true);
      const record = needed(await tx.request(id));
      if (record.requesterUserId !== actor.id)
        fail('NOT_FOUND', 'Request not found', 404);
      if (record.status === 'CANCELLED') return ownRequest(record);
      if (record.status !== 'PENDING')
        fail('REQUEST_REVIEWED', 'Only pending requests can be cancelled');
      const cancelled = needed(
        await tx.reviewRequest(id, 'CANCELLED', actor.id, '', ''),
      );
      await this.audit(tx, actor, requestId, {
        action: 'ADMIN_REQUEST_CANCELLED',
        targetType: 'ADMIN_REQUEST',
        targetId: id,
        metadata: { before: 'PENDING', after: 'CANCELLED' },
      });
      return ownRequest(cancelled);
    });
  }
  async requests(actorId: string, o: ListOptions) {
    await this.readActor(actorId, ['SUPER_ADMIN']);
    return this.repo.read.requests(o);
  }
  async request(actorId: string, id: string) {
    await this.readActor(actorId, ['SUPER_ADMIN']);
    const record = needed(await this.repo.read.request(id));
    const colleges: CollegeRecord[] = [];
    for (const collegeId of record.requestedCollegeIds) {
      const c = await this.repo.read.college(collegeId);
      if (c) colleges.push(c);
    }
    return { ...record, colleges };
  }
  async approve(
    actorId: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    const data = approveSchema.parse(input);
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        return await this.repo.transaction(async (tx) => {
          const actor = await this.actor(tx, actorId, ['SUPER_ADMIN'], true);
          const request = needed(await tx.request(id));
          if (request.status !== 'PENDING')
            fail('REQUEST_REVIEWED', 'This request has already been reviewed');
          const user = needed(await tx.user(request.requesterUserId));
          if (
            user.role !== 'STUDENT' ||
            !user.googleSubject ||
            !user.emailVerified ||
            user.username ||
            ['SUSPENDED', 'ARCHIVED'].includes(user.accountStatus)
          )
            fail(
              'REQUESTER_INELIGIBLE',
              'The existing verified identity is not eligible for promotion',
            );
          if (
            data.assignments.some(
              (g) => !request.requestedCollegeIds.includes(g.collegeId),
            )
          )
            fail(
              'INVALID_ASSIGNMENT',
              'Approval must use requested colleges',
              400,
            );
          await this.eligible(
            tx,
            data.assignments.map((g) => g.collegeId),
          );
          const username = privilegedUsername(
            'ADMIN',
            request.fullName,
            attempt,
          );
          const promoted = needed(
            await tx.promote(
              user.id,
              user.googleSubject,
              username,
              'ADMIN',
              user.sessionVersion,
            ),
          );
          await this.replaceAssignments(
            tx,
            actor,
            promoted.id,
            data.assignments,
            requestId,
          );
          const approved = needed(
            await tx.reviewRequest(
              id,
              'APPROVED',
              actor.id,
              data.reviewNote,
              data.internalNote,
            ),
          );
          await tx.revokeSessions(user.id);
          await this.audit(tx, actor, requestId, {
            action: 'ADMIN_ROLE_GRANTED',
            targetType: 'USER',
            targetId: user.id,
            metadata: { before: user.role, after: 'ADMIN' },
          });
          await this.audit(tx, actor, requestId, {
            action: 'ADMIN_REQUEST_APPROVED',
            targetType: 'ADMIN_REQUEST',
            targetId: id,
            metadata: {
              before: 'PENDING',
              after: 'APPROVED',
              count: data.assignments.length,
            },
          });
          return { request: approved, admin: adminProfile(promoted) };
        });
      } catch (error) {
        if (
          error instanceof UniqueConflict &&
          error.field === 'username' &&
          attempt < 8
        )
          continue;
        throw error;
      }
    }
    return fail('USERNAME_UNAVAILABLE', 'Unable to allocate a username safely');
  }
  async reject(actorId: string, id: string, input: unknown, requestId: string) {
    const data = rejectSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const actor = await this.actor(tx, actorId, ['SUPER_ADMIN'], true);
      const record = needed(await tx.request(id));
      if (record.status !== 'PENDING')
        fail('REQUEST_REVIEWED', 'This request has already been reviewed');
      const reviewed = needed(
        await tx.reviewRequest(
          id,
          'REJECTED',
          actor.id,
          data.reviewNote,
          data.internalNote,
        ),
      );
      await this.audit(tx, actor, requestId, {
        action: 'ADMIN_REQUEST_REJECTED',
        targetType: 'ADMIN_REQUEST',
        targetId: id,
        metadata: { before: 'PENDING', after: 'REJECTED' },
      });
      return reviewed;
    });
  }
  async admins(actorId: string, o: ListOptions) {
    await this.readActor(actorId, ['SUPER_ADMIN']);
    const page = await this.repo.read.admins(o);
    return { ...page, items: page.items.map(adminProfile) };
  }
  async admin(actorId: string, id: string) {
    await this.readActor(actorId, ['SUPER_ADMIN']);
    const user = needed(await this.repo.read.user(id));
    if (user.role !== 'ADMIN') fail('NOT_FOUND', 'Admin not found', 404);
    const assignments = await this.repo.read.assignments(id);
    const result = [];
    for (const record of assignments) {
      const college = await this.repo.read.college(record.collegeId);
      result.push({ ...record, college });
    }
    return { user: adminProfile(user), assignments: result };
  }
  private async replaceAssignments(
    tx: AdminUnit,
    actor: UserRecord,
    adminId: string,
    grants: Grant[],
    requestId: string,
  ) {
    const existing = await tx.assignments(adminId);
    for (const record of existing.filter(
      (a) =>
        a.status === 'ACTIVE' &&
        !grants.some((g) => g.collegeId === a.collegeId),
    )) {
      await tx.revokeAssignment(record.id, actor.id);
      await this.audit(tx, actor, requestId, {
        action: 'COLLEGE_ACCESS_REVOKED',
        targetType: 'ASSIGNMENT',
        targetId: record.id,
        collegeId: record.collegeId,
        metadata: { before: 'ACTIVE', after: 'REVOKED' },
      });
    }
    for (const grant of grants) {
      const previous = existing.find(
        (a) => a.status === 'ACTIVE' && a.collegeId === grant.collegeId,
      );
      const next = await tx.putAssignment(adminId, grant, actor.id);
      await this.audit(tx, actor, requestId, {
        action: previous ? 'ADMIN_PERMISSIONS_UPDATED' : 'COLLEGE_ASSIGNED',
        targetType: 'ASSIGNMENT',
        targetId: next.id,
        collegeId: grant.collegeId,
        metadata: {
          permissions: grant.permissions,
          ...(previous ? { previousPermissions: previous.permissions } : {}),
        },
      });
    }
  }
  async assignments(
    actorId: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    const data = assignmentsSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const actor = await this.actor(tx, actorId, ['SUPER_ADMIN'], true);
      const user = needed(await tx.user(id));
      if (
        user.role !== 'ADMIN' ||
        !['ACTIVE', 'SUSPENDED'].includes(user.accountStatus)
      )
        fail(
          'ADMIN_INELIGIBLE',
          'Admin is not eligible for assignment changes',
        );
      if (user.sessionVersion !== data.expectedRevision)
        fail('STALE_STATE', 'Admin changed; refresh and retry');
      await this.eligible(
        tx,
        data.assignments.map((g) => g.collegeId),
      );
      await this.replaceAssignments(tx, actor, id, data.assignments, requestId);
      if (!(await tx.invalidate(id, data.expectedRevision)))
        fail('STALE_STATE', 'Admin changed; refresh and retry');
      await tx.revokeSessions(id);
      return { updated: true };
    });
  }
  async adminStatus(
    actorId: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    const data = adminStatusSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const actor = await this.actor(tx, actorId, ['SUPER_ADMIN'], true);
      const user = needed(await tx.user(id));
      if (
        user.role !== 'ADMIN' ||
        !['ACTIVE', 'SUSPENDED'].includes(user.accountStatus)
      )
        fail(
          'ADMIN_INELIGIBLE',
          'Only active or suspended Admins can be managed',
        );
      if (user.sessionVersion !== data.expectedRevision)
        fail('STALE_STATE', 'Admin changed; refresh and retry');
      if (user.accountStatus === data.status) return adminProfile(user);
      if (data.status === 'ACTIVE') {
        const current = (await tx.assignments(id)).filter(
          (a) => a.status === 'ACTIVE',
        );
        if (!current.length)
          fail(
            'ASSIGNMENT_REQUIRED',
            'Assign active college access before reactivation',
          );
        await this.eligible(
          tx,
          current.map((g) => g.collegeId),
        );
        if (current.some((g) => !g.permissions.includes('college.view')))
          fail('PERMISSION_REQUIRED', 'College view permission is required');
      }
      const changed = needed(
        await tx.changeAdmin(id, data.expectedRevision, data.status),
      );
      await tx.revokeSessions(id);
      await this.audit(tx, actor, requestId, {
        action:
          data.status === 'SUSPENDED' ? 'ADMIN_SUSPENDED' : 'ADMIN_REACTIVATED',
        targetType: 'USER',
        targetId: id,
        metadata: { before: user.accountStatus, after: data.status },
      });
      return adminProfile(changed);
    });
  }
  async ownAdmin(actorId: string) {
    const user = await this.readActor(actorId, ['ADMIN']);
    return { user: adminProfile(user) };
  }
  async authorizedCollege(
    actorId: string,
    id: string,
    permission: Permission,
    mutation = false,
  ) {
    await this.repo.ensureReady();
    const actor = await this.actor(this.repo.read, actorId, [
      'ADMIN',
      'SUPER_ADMIN',
    ]);
    const college = needed(await this.repo.read.college(id));
    if (college.status !== 'ACTIVE')
      fail(
        'COLLEGE_UNAVAILABLE',
        mutation
          ? 'Inactive colleges cannot be mutated'
          : 'College access is unavailable',
        403,
      );
    if (actor.role === 'SUPER_ADMIN') return college;
    const grant = (await this.repo.read.assignments(actor.id)).find(
      (g) => g.status === 'ACTIVE' && g.collegeId === id,
    );
    if (!grant || !grant.permissions.includes(permission))
      fail(
        'COLLEGE_FORBIDDEN',
        'College access or required permission is unavailable',
        403,
      );
    return college;
  }
  async ownColleges(actorId: string) {
    await this.readActor(actorId, ['ADMIN']);
    const assignments = await this.repo.read.assignments(actorId);
    const items = [];
    for (const grant of assignments) {
      if (
        grant.status !== 'ACTIVE' ||
        !grant.permissions.includes('college.view')
      )
        continue;
      const college = await this.repo.read.college(grant.collegeId);
      if (college?.status === 'ACTIVE')
        items.push({
          ...scopedCollege(college),
          permissions: grant.permissions,
          accessStatus: grant.status,
        });
    }
    return { items, unavailableAssignments: assignments.length - items.length };
  }
  async audits(actorId: string, o: ListOptions) {
    await this.readActor(actorId, ['SUPER_ADMIN']);
    return this.repo.read.audits(o);
  }
  async overview(actorId: string) {
    await this.readActor(actorId, ['SUPER_ADMIN']);
    return this.repo.read.overview();
  }
}
export type ApprovalInput = z.infer<typeof approveSchema>;
export { pageDefaults };
