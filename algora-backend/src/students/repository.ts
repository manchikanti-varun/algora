import { reconciliationPending } from '../learning/markers.js';
import mongoose, { type ClientSession } from 'mongoose';
import {
  MongoAdminUnit,
  adminStorageReady,
  storageError,
} from '../administration/repository.js';
import {
  StudentProfile,
  StudentRollReservation,
} from '../models/student-profile.js';
import { StudentQrCredential } from '../models/student-qr-credential.js';
import { StudentProfileCorrectionRequest } from '../models/student-profile-correction-request.js';
import { User } from '../models/user.js';
import { College } from '../models/college.js';
import { AppError } from '../middleware/errors.js';
import type {
  StudentUnit,
  StudentRepository,
  StudentProfileRecord,
  StudentList,
  Credential,
  CorrectionRecord,
} from './contracts.js';
let initialized = false;
mongoose.connection.on('disconnected', () => {
  initialized = false;
});
export const studentStorageReady = () => initialized && adminStorageReady();
export async function initializeStudentIndexes() {
  initialized = false;
  await Promise.all([
    StudentProfile.createIndexes(),
    StudentRollReservation.createIndexes(),
    StudentQrCredential.createIndexes(),
    StudentProfileCorrectionRequest.createIndexes(),
  ]);
  initialized = true;
}
function profile(d: InstanceType<typeof StudentProfile>): StudentProfileRecord {
  return {
    id: String(d._id),
    userId: String(d.userId),
    fullName: d.fullName,
    rollNumber: d.rollNumber,
    studentUsername: d.studentUsername,
    phoneNumber: d.phoneNumber,
    collegeId: String(d.collegeId),
    department: d.department,
    yearOfStudy: d.yearOfStudy ?? undefined,
    leetCodeUsername: d.leetCodeUsername,
    codeforcesUsername: d.codeforcesUsername,
    codechefUsername: d.codechefUsername,
    verificationStatus: d.verificationStatus,
    verifiedBy: d.verifiedBy?.toString(),
    verifiedAt: d.verifiedAt?.toISOString(),
    verificationMethod: d.verificationMethod ?? undefined,
    verificationEvidence: d.verificationEvidence ?? undefined,
    verificationNote: d.verificationNote ?? undefined,
    qrCredentialVersion: d.qrCredentialVersion,
    revision: d.revision,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
function correction(
  d: InstanceType<typeof StudentProfileCorrectionRequest>,
): CorrectionRecord {
  const c = d.requestedChanges;
  return {
    id: String(d._id),
    studentProfileId: String(d.studentProfileId),
    requesterUserId: String(d.requesterUserId),
    sourceCollegeId: String(d.sourceCollegeId),
    requestedChanges: {
      ...(c.fullName != null ? { fullName: c.fullName } : {}),
      ...(c.rollNumber != null ? { rollNumber: c.rollNumber } : {}),
      ...(c.collegeId ? { collegeId: String(c.collegeId) } : {}),
      ...(c.department != null ? { department: c.department } : {}),
      ...(c.yearOfStudy != null ? { yearOfStudy: c.yearOfStudy } : {}),
    },
    reason: d.reason,
    status: d.status,
    profileRevision: d.profileRevision,
    reviewedBy: d.reviewedBy?.toString(),
    reviewedAt: d.reviewedAt?.toISOString(),
    reviewNote: d.reviewNote,
    createdAt: d.createdAt.toISOString(),
  };
}
export class MongoStudentUnit implements StudentUnit {
  admin: MongoAdminUnit;
  constructor(private session: ClientSession | null = null) {
    this.admin = new MongoAdminUnit(session);
  }
  async profile(id: string) {
    const d = await StudentProfile.findById(id).session(this.session);
    return d ? profile(d) : null;
  }
  async own(userId: string) {
    const d = await StudentProfile.findOne({ userId }).session(this.session);
    return d ? profile(d) : null;
  }
  async profiles(o: StudentList, scope: string[] | null) {
    const filter = {
      ...(scope ? { collegeId: { $in: scope } } : {}),
      ...(o.collegeId
        ? {
            collegeId:
              scope && !scope.includes(o.collegeId) ? { $in: [] } : o.collegeId,
          }
        : {}),
      ...(o.status ? { verificationStatus: o.status } : {}),
      ...(o.search
        ? {
            $or: ['rollNumber', 'fullName'].map((f) => ({
              [f]: {
                $regex: o.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                $options: 'i',
              },
            })),
          }
        : {}),
    };
    const docs = await StudentProfile.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    const total = await StudentProfile.countDocuments(filter).session(
      this.session,
    );
    return {
      items: docs.map(profile),
      total,
      page: o.page,
      pageSize: o.pageSize,
      totalPages: Math.ceil(total / o.pageSize),
    };
  }
  async insert(
    data: Omit<StudentProfileRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const [d] = await StudentProfile.create(
      [{ ...data, ...reconciliationPending() }],
      {
        session: this.session ?? undefined,
      },
    );
    return profile(d!);
  }
  async update(
    id: string,
    revision: number,
    patch: Partial<StudentProfileRecord>,
  ) {
    const d = await StudentProfile.findOneAndUpdate(
      { _id: id, revision },
      {
        $set: {
          ...(Object.keys(patch).some((key) => key !== 'yearOfStudy')
            ? reconciliationPending()
            : {}),
          ...Object.fromEntries(
            Object.entries(patch).filter(([, v]) => v !== undefined),
          ),
        },
        $unset: Object.fromEntries(
          Object.entries(patch)
            .filter(([, v]) => v === undefined)
            .map(([k]) => [k, 1]),
        ),
        $inc: { revision: 1 },
      },
      { new: true, runValidators: true, session: this.session ?? undefined },
    );
    return d ? profile(d) : null;
  }
  async registration(
    userId: string,
    status: 'PENDING_VERIFICATION' | 'VERIFIED',
  ) {
    await User.updateOne(
      { _id: userId, role: 'STUDENT', accountStatus: 'PENDING' },
      { $set: { accountStatus: 'ACTIVE' } },
      { session: this.session ?? undefined },
    );
    await User.updateOne(
      { _id: userId },
      {
        $set: { registrationStatus: status, ...reconciliationPending() },
        $inc: { administrativeRevision: 1 },
      },
      { session: this.session ?? undefined },
    );
  }
  async lockCollege(id: string) {
    return (
      (
        await College.updateOne(
          { _id: id, status: 'ACTIVE' },
          { $inc: { operationalRevision: 1 } },
          { session: this.session ?? undefined },
        )
      ).modifiedCount === 1
    );
  }
  async reserveRoll(rollNumber: string, profileId: string) {
    await StudentRollReservation.updateOne(
      { rollNumber, profileId },
      { $setOnInsert: { rollNumber, profileId } },
      { upsert: true, runValidators: true, session: this.session ?? undefined },
    );
  }
  async rollOwner(rollNumber: string) {
    const d = await StudentRollReservation.findOne({ rollNumber }).session(
      this.session,
    );
    return d ? String(d.profileId) : null;
  }
  async credential(profileId: string) {
    const d = await StudentQrCredential.findOne({ profileId }).session(
      this.session,
    );
    return d
      ? {
          profileId: String(d.profileId),
          version: d.version,
          tokenHash: d.tokenHash,
          ciphertext: d.ciphertext,
          nonce: d.nonce,
          tag: d.tag,
          keyId: d.keyId,
        }
      : null;
  }
  async putCredential(c: Credential) {
    await StudentQrCredential.updateOne(
      { profileId: c.profileId },
      { $set: c },
      { upsert: true, runValidators: true, session: this.session ?? undefined },
    );
  }
  async correction(id: string) {
    const d = await StudentProfileCorrectionRequest.findById(id).session(
      this.session,
    );
    return d ? correction(d) : null;
  }
  async corrections(o: StudentList, scope: string[] | null, ownId?: string) {
    const filter = {
      ...(ownId ? { requesterUserId: ownId } : {}),
      ...(scope ? { sourceCollegeId: { $in: scope } } : {}),
      ...(o.collegeId
        ? {
            sourceCollegeId:
              scope && !scope.includes(o.collegeId) ? { $in: [] } : o.collegeId,
          }
        : {}),
    };
    const docs = await StudentProfileCorrectionRequest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    const total = await StudentProfileCorrectionRequest.countDocuments(
      filter,
    ).session(this.session);
    return {
      items: docs.map(correction),
      total,
      page: o.page,
      pageSize: o.pageSize,
      totalPages: Math.ceil(total / o.pageSize),
    };
  }
  async pendingCorrection(studentProfileId: string) {
    const d = await StudentProfileCorrectionRequest.findOne({
      studentProfileId,
      status: 'PENDING',
    }).session(this.session);
    return d ? correction(d) : null;
  }
  async insertCorrection(data: Omit<CorrectionRecord, 'id' | 'createdAt'>) {
    const [d] = await StudentProfileCorrectionRequest.create([data], {
      session: this.session ?? undefined,
    });
    return correction(d!);
  }
  async reviewCorrection(
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    actor: string,
    note: string,
  ) {
    const d = await StudentProfileCorrectionRequest.findOneAndUpdate(
      { _id: id, status: 'PENDING' },
      {
        $set: {
          status,
          reviewedBy: actor,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      },
      { new: true, runValidators: true, session: this.session ?? undefined },
    );
    return d ? correction(d) : null;
  }
}
export const mongoStudentRepository: StudentRepository = {
  async ensureReady() {
    if (!studentStorageReady())
      throw new AppError(
        503,
        'STUDENTS_UNAVAILABLE',
        'Student management is temporarily unavailable',
      );
  },
  read: new MongoStudentUnit(),
  async transaction<T>(work: (tx: StudentUnit) => Promise<T>): Promise<T> {
    await this.ensureReady();
    try {
      return await mongoose.connection.transaction(
        (s) => work(new MongoStudentUnit(s)),
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch (e) {
      return storageError(e);
    }
  },
};
