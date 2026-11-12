// Transactional in-memory fixtures are used only by automated tests.
import { Types } from 'mongoose';
import { TestRepository } from './auth-fixtures.js';
import { AppError } from '../middleware/errors.js';
import type { UserRecord } from '../auth/types.js';
import {
  UniqueConflict,
  type AdminRepository,
  type AdminUnit,
  type AssignmentRecord,
  type AuditInput,
  type AuditRecord,
  type CollegeInput,
  type CollegeRecord,
  type Grant,
  type ListOptions,
  type RequestInput,
  type RequestRecord,
  type RequestStatus,
} from '../administration/contracts.js';
export const newId = () => new Types.ObjectId().toString();
export function testUser(patch: Partial<UserRecord> = {}): UserRecord {
  const id = newId();
  return {
    id,
    googleSubject: 'verified-subject-' + id,
    email: id + '@example.test',
    emailVerified: true,
    displayName: 'Alice Morgan',
    role: 'STUDENT',
    accountStatus: 'PENDING',
    registrationStatus: 'NOT_STARTED',
    sessionVersion: 0,
    lastLoginAt: new Date(),
    ...patch,
  };
}
const copy = <T>(value: T): T => structuredClone(value);
function paginate<T>(items: T[], o: ListOptions) {
  const list = items.filter((item) => {
    const row = item as Record<string, unknown>;
    return (
      (!o.status ||
        row.status === o.status ||
        row.accountStatus === o.status) &&
      (!o.search ||
        [
          row.name,
          row.code,
          row.fullName,
          row.email,
          row.displayName,
          row.username,
          row.actorName,
          row.action,
        ]
          .join(' ')
          .toLowerCase()
          .includes(o.search.toLowerCase()))
    );
  });
  list.sort(
    (a, b) =>
      String((a as Record<string, unknown>)[o.sort] ?? '').localeCompare(
        String((b as Record<string, unknown>)[o.sort] ?? ''),
      ) * (o.direction === 'asc' ? 1 : -1),
  );
  return {
    items: copy(list.slice((o.page - 1) * o.pageSize, o.page * o.pageSize)),
    total: list.length,
    page: o.page,
    pageSize: o.pageSize,
    totalPages: Math.ceil(list.length / o.pageSize),
  };
}
export class TestAdministrationRepository implements AdminRepository {
  available = true;
  failAudit = false;
  colleges = new Map<string, CollegeRecord>();
  requests = new Map<string, RequestRecord>();
  assignments = new Map<string, AssignmentRecord>();
  audits: AuditRecord[] = [];
  private tail: Promise<void> = Promise.resolve();
  constructor(public auth = new TestRepository()) {}
  async ensureReady() {
    if (!this.available)
      throw new AppError(
        503,
        'ADMINISTRATION_UNAVAILABLE',
        'Administration is temporarily unavailable',
      );
  }
  async transaction<T>(work: (tx: AdminUnit) => Promise<T>): Promise<T> {
    await this.ensureReady();
    let release!: () => void;
    const wait = this.tail;
    this.tail = new Promise<void>((r) => {
      release = r;
    });
    await wait;
    const snapshot = copy({
      users: this.auth.users,
      sessions: this.auth.sessions,
      colleges: this.colleges,
      requests: this.requests,
      assignments: this.assignments,
      audits: this.audits,
    });
    try {
      return await work(this.read);
    } catch (error) {
      this.auth.users.clear();
      for (const [id, u] of snapshot.users) this.auth.users.set(id, u);
      this.auth.sessions.clear();
      for (const [id, s] of snapshot.sessions) this.auth.sessions.set(id, s);
      this.colleges = snapshot.colleges;
      this.requests = snapshot.requests;
      this.assignments = snapshot.assignments;
      this.audits = snapshot.audits;
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        'ADMINISTRATION_UNAVAILABLE',
        'Administration is temporarily unavailable',
      );
    } finally {
      release();
    }
  }
  read: AdminUnit = {
    user: async (id) => copy(this.auth.users.get(id) ?? null),
    userBySubject: async (sub) =>
      copy(
        [...this.auth.users.values()].find((u) => u.googleSubject === sub) ??
          null,
      ),
    superAdmin: async () =>
      copy(
        [...this.auth.users.values()].find((u) => u.role === 'SUPER_ADMIN') ??
          null,
      ),
    lockUser: async (id, version) =>
      this.auth.users.get(id)?.sessionVersion === version,
    promote: async (id, subject, username, role, version) => {
      const u = this.auth.users.get(id);
      if (
        !u ||
        u.googleSubject !== subject ||
        u.role !== 'STUDENT' ||
        u.username ||
        u.sessionVersion !== version
      )
        return null;
      if ([...this.auth.users.values()].some((u) => u.username === username))
        throw new UniqueConflict('username');
      if (
        role === 'SUPER_ADMIN' &&
        [...this.auth.users.values()].some((u) => u.role === 'SUPER_ADMIN')
      )
        throw new UniqueConflict('role');
      const next = {
        ...u,
        role,
        username,
        accountStatus: 'ACTIVE' as const,
        sessionVersion: u.sessionVersion + 1,
      };
      this.auth.users.set(id, next);
      return copy(next);
    },
    changeAdmin: async (id, version, status) => {
      const u = this.auth.users.get(id);
      if (!u || u.role !== 'ADMIN' || u.sessionVersion !== version) return null;
      const next = { ...u, accountStatus: status, sessionVersion: version + 1 };
      this.auth.users.set(id, next);
      return copy(next);
    },
    invalidate: async (id, version) => {
      const u = this.auth.users.get(id);
      if (!u || u.sessionVersion !== version) return false;
      u.sessionVersion++;
      return true;
    },
    revokeSessions: async (id) => {
      for (const s of this.auth.sessions.values())
        if (s.userId === id) s.revokedAt = new Date();
    },
    college: async (id) => copy(this.colleges.get(id) ?? null),
    colleges: async (o, eligible) =>
      paginate(
        [...this.colleges.values()].filter(
          (c) => !eligible || c.status === 'ACTIVE',
        ),
        o,
      ),
    insertCollege: async (data, actor) => {
      if ([...this.colleges.values()].some((c) => c.code === data.code))
        throw new UniqueConflict('code');
      if ([...this.colleges.values()].some((c) => c.slug === data.slug))
        throw new UniqueConflict('slug');
      if (
        [...this.colleges.values()].some(
          (c) =>
            [c.name, c.city, c.state, c.country].join('|').toLowerCase() ===
            [data.name, data.city, data.state, data.country]
              .join('|')
              .toLowerCase(),
        )
      )
        throw new UniqueConflict('identityKey');
      const id = newId(),
        now = new Date().toISOString();
      const record = {
        ...data,
        id,
        status: 'ACTIVE' as const,
        revision: 0,
        createdBy: actor,
        updatedBy: actor,
        createdAt: now,
        updatedAt: now,
      };
      this.colleges.set(id, record);
      return copy(record);
    },
    updateCollege: async (id, revision, data, actor) => {
      const c = this.colleges.get(id);
      if (!c || c.revision !== revision) return null;
      if (
        [...this.colleges.values()].some(
          (other) =>
            other.id !== id &&
            ((data.code && data.code === other.code) ||
              (data.slug && data.slug === other.slug)),
        )
      )
        throw new UniqueConflict('code');
      const next = {
        ...c,
        ...data,
        revision: revision + 1,
        updatedBy: actor,
        updatedAt: new Date().toISOString(),
      };
      this.colleges.set(id, next);
      return copy(next);
    },
    request: async (id) => copy(this.requests.get(id) ?? null),
    requests: async (o, user) =>
      paginate(
        [...this.requests.values()].filter(
          (r) => !user || r.requesterUserId === user,
        ),
        o,
      ),
    pendingRequest: async (user) =>
      copy(
        [...this.requests.values()].find(
          (r) => r.requesterUserId === user && r.status === 'PENDING',
        ) ?? null,
      ),
    insertRequest: async (user, data) => {
      if (
        [...this.requests.values()].some(
          (r) => r.requesterUserId === user.id && r.status === 'PENDING',
        )
      )
        throw new UniqueConflict('requesterUserId');
      const now = new Date().toISOString();
      const record: RequestRecord = {
        id: newId(),
        requesterUserId: user.id,
        fullName: data.fullName,
        email: user.email,
        requestedCollegeIds: data.collegeIds,
        reason: data.reason,
        status: 'PENDING',
        reviewNote: '',
        internalNote: '',
        createdAt: now,
        updatedAt: now,
      };
      this.requests.set(record.id, record);
      return copy(record);
    },
    reviewRequest: async (id, status, actor, note, internalNote) => {
      const r = this.requests.get(id);
      if (!r || r.status !== 'PENDING') return null;
      const next = {
        ...r,
        status,
        reviewedBy: actor,
        reviewedAt: new Date().toISOString(),
        reviewNote: note,
        internalNote,
      };
      this.requests.set(id, next);
      return copy(next);
    },
    assignments: async (admin) =>
      copy(
        [...this.assignments.values()].filter((a) => a.adminUserId === admin),
      ),
    putAssignment: async (adminUserId, grant, actor) => {
      const prior = [...this.assignments.values()].find(
        (a) =>
          a.adminUserId === adminUserId &&
          a.collegeId === grant.collegeId &&
          a.status === 'ACTIVE',
      );
      const now = new Date().toISOString();
      const record: AssignmentRecord = {
        id: prior?.id ?? newId(),
        adminUserId,
        collegeId: grant.collegeId,
        permissions: grant.permissions,
        status: 'ACTIVE',
        assignedBy: prior?.assignedBy ?? actor,
        assignedAt: prior?.assignedAt ?? now,
        updatedBy: actor,
        updatedAt: now,
      };
      this.assignments.set(record.id, record);
      return copy(record);
    },
    revokeAssignment: async (id, actor) => {
      const record = this.assignments.get(id);
      if (record) {
        record.status = 'REVOKED';
        record.updatedBy = actor;
      }
    },
    admins: async (o) =>
      paginate(
        [...this.auth.users.values()].filter((u) => u.role === 'ADMIN'),
        o,
      ),
    audit: async (input) => {
      if (this.failAudit) throw Error('private database diagnostic');
      this.audits.push({
        ...copy(input),
        id: newId(),
        createdAt: new Date().toISOString(),
      });
    },
    audits: async (o) =>
      paginate(
        this.audits.filter(
          (a) =>
            (!o.action || a.action === o.action) &&
            (!o.collegeId || a.collegeId === o.collegeId) &&
            (!o.actorUserId || a.actorUserId === o.actorUserId) &&
            (!o.from || a.createdAt >= o.from) &&
            (!o.to || a.createdAt <= o.to),
        ),
        o,
      ),
    overview: async () => ({
      totalColleges: this.colleges.size,
      activeColleges: [...this.colleges.values()].filter(
        (c) => c.status === 'ACTIVE',
      ).length,
      totalAdmins: [...this.auth.users.values()].filter(
        (u) => u.role === 'ADMIN',
      ).length,
      activeAdmins: [...this.auth.users.values()].filter(
        (u) => u.role === 'ADMIN' && u.accountStatus === 'ACTIVE',
      ).length,
      pendingRequests: [...this.requests.values()].filter(
        (r) => r.status === 'PENDING',
      ).length,
      recentActivity: copy(this.audits.slice(-5)),
    }),
  };
}
export const collegeInput: CollegeInput = {
  name: 'Example Institute',
  code: 'EXAMPLE',
  slug: 'example-institute',
  city: 'Example City',
  state: 'Example State',
  country: 'Example Country',
};
export const accessInput = (collegeId: string): RequestInput => ({
  fullName: 'Alice Morgan',
  collegeIds: [collegeId],
  reason:
    'I coordinate the learning community and need to support our college.',
});
export const approvalInput = (
  collegeId: string,
): { assignments: Grant[]; reviewNote: string; internalNote: string } => ({
  assignments: [{ collegeId, permissions: ['college.view'] }],
  reviewNote: 'Your college access has been approved.',
  internalNote: 'Private review fixture',
});
// Keep model/interface imports referenced for strict test linting without exposing fixtures to runtime.
export type FixtureAudit = AuditInput;
export type FixtureRequestStatus = RequestStatus;
