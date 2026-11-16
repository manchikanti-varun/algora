import { reconciliationPending } from '../learning/markers.js';
import mongoose, { type ClientSession } from 'mongoose';
import { User } from '../models/user.js';
import { Session } from '../models/session.js';
import { College, type CollegeDocument } from '../models/college.js';
import {
  AdminAccessRequest,
  type RequestDocument,
} from '../models/admin-access-request.js';
import {
  AdminCollegeAssignment,
  type AssignmentDocument,
} from '../models/admin-college-assignment.js';
import { AuditLog, type AuditDocument } from '../models/audit-log.js';
import { authStorageReady, userRecord } from '../auth/repository.js';
import { AppError } from '../middleware/errors.js';
import type { UserRecord } from '../auth/types.js';
import {
  UniqueConflict,
  type AdminRepository,
  type AdminUnit,
  type ListOptions,
  type CollegeInput,
  type CollegeRecord,
  type RequestRecord,
  type AssignmentRecord,
  type AuditRecord,
  type Grant,
  type RequestInput,
  type RequestStatus,
  type AuditInput,
} from './contracts.js';
let initialized = false;
mongoose.connection.on('disconnected', () => {
  initialized = false;
});
export const adminStorageReady = () => initialized && authStorageReady();
export async function initializeAdminIndexes() {
  initialized = false;
  await Promise.all([
    College.createIndexes(),
    AdminAccessRequest.createIndexes(),
    AdminCollegeAssignment.createIndexes(),
    AuditLog.createIndexes(),
  ]);
  initialized = true;
}
const page = <T>(items: T[], total: number, o: ListOptions) => ({
  items,
  total,
  page: o.page,
  pageSize: o.pageSize,
  totalPages: Math.ceil(total / o.pageSize),
});
const order = (o: ListOptions) => ({
  [o.sort]: o.direction === 'asc' ? (1 as const) : (-1 as const),
  _id: o.direction === 'asc' ? (1 as const) : (-1 as const),
});
function search(fields: string[], value: string) {
  if (!value) return {};
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    $or: fields.map((field) => ({
      [field]: { $regex: escaped, $options: 'i' },
    })),
  };
}
const identityKey = (
  data: Pick<CollegeInput, 'name' | 'city' | 'state' | 'country'>,
) =>
  [data.name, data.city, data.state, data.country]
    .map((v) => v.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
function college(doc: CollegeDocument): CollegeRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    code: doc.code,
    slug: doc.slug,
    city: doc.city,
    state: doc.state,
    country: doc.country,
    status: doc.status,
    revision: doc.revision,
    createdBy: doc.createdBy.toString(),
    updatedBy: doc.updatedBy.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
function request(doc: RequestDocument): RequestRecord {
  return {
    id: doc._id.toString(),
    requesterUserId: doc.requesterUserId.toString(),
    fullName: doc.fullName,
    email: doc.email,
    requestedCollegeIds: doc.requestedCollegeIds.map(String),
    reason: doc.reason,
    status: doc.status,
    reviewedBy: doc.reviewedBy?.toString(),
    reviewedAt: doc.reviewedAt?.toISOString(),
    reviewNote: doc.reviewNote,
    internalNote: doc.internalNote,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
function assignment(doc: AssignmentDocument): AssignmentRecord {
  return {
    id: doc._id.toString(),
    adminUserId: doc.adminUserId.toString(),
    collegeId: doc.collegeId.toString(),
    permissions: doc.permissions,
    status: doc.status,
    assignedBy: doc.assignedBy.toString(),
    assignedAt: doc.assignedAt.toISOString(),
    updatedBy: doc.updatedBy.toString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
function audit(doc: AuditDocument): AuditRecord {
  return {
    id: doc._id.toString(),
    actorUserId: doc.actorUserId.toString(),
    actorName: doc.actorName,
    action: doc.action,
    targetType: doc.targetType,
    targetId: doc.targetId.toString(),
    collegeId: doc.collegeId?.toString(),
    metadata: {
      before: doc.metadata?.before ?? undefined,
      after: doc.metadata?.after ?? undefined,
      count: doc.metadata?.count ?? undefined,
      permissions: doc.metadata?.permissions ?? undefined,
      previousPermissions: doc.metadata?.previousPermissions ?? undefined,
    },
    requestId: doc.requestId,
    createdAt: doc.createdAt!.toISOString(),
  };
}
export class MongoAdminUnit implements AdminUnit {
  constructor(private session: ClientSession | null = null) {}
  async user(id: string) {
    const doc = await User.findById(id).session(this.session);
    return doc ? userRecord(doc) : null;
  }
  async userBySubject(googleSubject: string) {
    const doc = await User.findOne({ googleSubject }).session(this.session);
    return doc ? userRecord(doc) : null;
  }
  async superAdmin() {
    const doc = await User.findOne({ role: 'SUPER_ADMIN' }).session(
      this.session,
    );
    return doc ? userRecord(doc) : null;
  }
  async lockUser(id: string, version: number) {
    return (
      (
        await User.updateOne(
          { _id: id, sessionVersion: version },
          { $inc: { administrativeRevision: 1 } },
          { session: this.session ?? undefined },
        )
      ).modifiedCount === 1
    );
  }
  async promote(
    id: string,
    subject: string,
    username: string,
    role: 'ADMIN' | 'SUPER_ADMIN',
    version: number,
  ) {
    const doc = await User.findOneAndUpdate(
      {
        _id: id,
        googleSubject: subject,
        emailVerified: true,
        role: 'STUDENT',
        accountStatus: { $in: ['PENDING', 'ACTIVE'] },
        sessionVersion: version,
        username: { $exists: false },
      },
      {
        $set: {
          role,
          username,
          accountStatus: 'ACTIVE',
          ...reconciliationPending(),
        },
        $inc: { sessionVersion: 1 },
      },
      {
        new: true,
        runValidators: true,
        overwriteImmutable: true,
        session: this.session ?? undefined,
      },
    );
    return doc ? userRecord(doc) : null;
  }
  async changeAdmin(
    id: string,
    version: number,
    status: 'ACTIVE' | 'SUSPENDED',
  ) {
    const doc = await User.findOneAndUpdate(
      {
        _id: id,
        role: 'ADMIN',
        sessionVersion: version,
        accountStatus: { $in: ['ACTIVE', 'SUSPENDED'] },
      },
      {
        $set: { accountStatus: status, ...reconciliationPending() },
        $inc: { sessionVersion: 1 },
      },
      { new: true, runValidators: true, session: this.session ?? undefined },
    );
    return doc ? userRecord(doc) : null;
  }
  async invalidate(id: string, version: number) {
    return (
      (
        await User.updateOne(
          { _id: id, role: 'ADMIN', sessionVersion: version },
          { $inc: { sessionVersion: 1 } },
          { session: this.session ?? undefined },
        )
      ).modifiedCount === 1
    );
  }
  async revokeSessions(userId: string) {
    await Session.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { session: this.session ?? undefined },
    );
  }
  async college(id: string) {
    const doc = await College.findById(id).session(this.session);
    return doc ? college(doc) : null;
  }
  async colleges(o: ListOptions, eligibleOnly = false) {
    const filter = {
      ...search(['name', 'code', 'city'], o.search),
      ...(eligibleOnly
        ? { status: 'ACTIVE' }
        : o.status
          ? { status: o.status }
          : {}),
    };
    const directory = College.find(filter).sort({ ...order(o), _id: 1 });
    if (eligibleOnly) directory.collation({ locale: 'en', strength: 2 });
    const docs = await directory
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    const total = await College.countDocuments(filter).session(this.session);
    return page(docs.map(college), total, o);
  }
  async insertCollege(data: CollegeInput, actor: string) {
    const [doc] = await College.create(
      [
        {
          ...data,
          identityKey: identityKey(data),
          createdBy: actor,
          updatedBy: actor,
        },
      ],
      { session: this.session ?? undefined },
    );
    return college(doc!);
  }
  async updateCollege(
    id: string,
    revision: number,
    data: Partial<CollegeInput> & { status?: CollegeRecord['status'] },
    actor: string,
  ) {
    const existing = await this.college(id);
    if (!existing) return null;
    const combined = { ...existing, ...data };
    const doc = await College.findOneAndUpdate(
      { _id: id, revision },
      {
        $set: {
          ...data,
          identityKey: identityKey(combined),
          updatedBy: actor,
          ...reconciliationPending(),
        },
        $inc: { revision: 1 },
      },
      { new: true, runValidators: true, session: this.session ?? undefined },
    );
    return doc ? college(doc) : null;
  }
  async request(id: string) {
    const doc = await AdminAccessRequest.findById(id).session(this.session);
    return doc ? request(doc) : null;
  }
  async requests(o: ListOptions, requester?: string) {
    const filter = {
      ...search(['fullName', 'email'], o.search),
      ...(o.status ? { status: o.status } : {}),
      ...(requester ? { requesterUserId: requester } : {}),
    };
    const docs = await AdminAccessRequest.find(filter)
      .sort(order(o))
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    const total = await AdminAccessRequest.countDocuments(filter).session(
      this.session,
    );
    return page(docs.map(request), total, o);
  }
  async pendingRequest(requesterUserId: string) {
    const doc = await AdminAccessRequest.findOne({
      requesterUserId,
      status: 'PENDING',
    }).session(this.session);
    return doc ? request(doc) : null;
  }
  async insertRequest(user: UserRecord, data: RequestInput) {
    const [doc] = await AdminAccessRequest.create(
      [
        {
          requesterUserId: user.id,
          fullName: data.fullName,
          email: user.email,
          requestedCollegeIds: data.collegeIds,
          reason: data.reason,
        },
      ],
      { session: this.session ?? undefined },
    );
    return request(doc!);
  }
  async reviewRequest(
    id: string,
    status: Exclude<RequestStatus, 'PENDING'>,
    actor: string,
    note: string,
    internalNote: string,
  ) {
    const doc = await AdminAccessRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING' },
      {
        $set: {
          status,
          reviewedBy: actor,
          reviewedAt: new Date(),
          reviewNote: note,
          internalNote,
        },
      },
      { new: true, runValidators: true, session: this.session ?? undefined },
    );
    return doc ? request(doc) : null;
  }
  async assignments(adminUserId: string) {
    return (
      await AdminCollegeAssignment.find({ adminUserId })
        .sort({ assignedAt: 1 })
        .session(this.session)
    ).map(assignment);
  }
  async putAssignment(adminUserId: string, grant: Grant, actor: string) {
    const doc = await AdminCollegeAssignment.findOneAndUpdate(
      { adminUserId, collegeId: grant.collegeId, status: 'ACTIVE' },
      {
        $set: { permissions: grant.permissions, updatedBy: actor },
        $setOnInsert: { assignedBy: actor, assignedAt: new Date() },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        session: this.session ?? undefined,
      },
    );
    return assignment(doc);
  }
  async revokeAssignment(id: string, actor: string) {
    await AdminCollegeAssignment.updateOne(
      { _id: id, status: 'ACTIVE' },
      { $set: { status: 'REVOKED', updatedBy: actor } },
      { session: this.session ?? undefined },
    );
  }
  async admins(o: ListOptions) {
    const filter = {
      role: 'ADMIN',
      ...search(['displayName', 'email', 'username'], o.search),
      ...(o.status ? { accountStatus: o.status } : {}),
    };
    const docs = await User.find(filter)
      .sort(order(o))
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    const total = await User.countDocuments(filter).session(this.session);
    return page(docs.map(userRecord), total, o);
  }
  async audit(input: AuditInput) {
    await AuditLog.create([input], { session: this.session ?? undefined });
  }
  async audits(o: ListOptions) {
    const filter = {
      ...search(['actorName', 'action'], o.search),
      ...(o.action ? { action: o.action } : {}),
      ...(o.collegeId ? { collegeId: o.collegeId } : {}),
      ...(o.actorUserId ? { actorUserId: o.actorUserId } : {}),
      ...(o.from || o.to
        ? {
            createdAt: {
              ...(o.from ? { $gte: new Date(o.from) } : {}),
              ...(o.to ? { $lte: new Date(o.to) } : {}),
            },
          }
        : {}),
    };
    const docs = await AuditLog.find(filter)
      .sort(order(o))
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    const total = await AuditLog.countDocuments(filter).session(this.session);
    return page(docs.map(audit), total, o);
  }
  async overview() {
    const totalColleges = await College.countDocuments().session(this.session);
    const activeColleges = await College.countDocuments({
      status: 'ACTIVE',
    }).session(this.session);
    const totalAdmins = await User.countDocuments({ role: 'ADMIN' }).session(
      this.session,
    );
    const activeAdmins = await User.countDocuments({
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    }).session(this.session);
    const pendingRequests = await AdminAccessRequest.countDocuments({
      status: 'PENDING',
    }).session(this.session);
    const recentActivity = (
      await AuditLog.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .session(this.session)
    ).map(audit);
    return {
      totalColleges,
      activeColleges,
      totalAdmins,
      activeAdmins,
      pendingRequests,
      recentActivity,
    };
  }
}
export function storageError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const failure = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
  };
  if (failure?.code === 11000)
    throw new UniqueConflict(
      Object.keys(failure.keyPattern ?? {})[0] ?? 'record',
    );
  throw new AppError(
    503,
    'ADMINISTRATION_UNAVAILABLE',
    'Administration is temporarily unavailable',
  );
}
export const mongoAdminRepository: AdminRepository = {
  async ensureReady() {
    if (!adminStorageReady())
      throw new AppError(
        503,
        'ADMINISTRATION_UNAVAILABLE',
        'Administration is temporarily unavailable',
      );
  },
  read: new MongoAdminUnit(),
  async transaction<T>(work: (unit: AdminUnit) => Promise<T>): Promise<T> {
    await this.ensureReady();
    try {
      return await mongoose.connection.transaction(
        (session) => work(new MongoAdminUnit(session)),
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch (error) {
      return storageError(error);
    }
  },
};
