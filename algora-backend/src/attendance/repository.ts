import mongoose, { type ClientSession } from 'mongoose';
import {
  AttendanceSession,
  AttendanceRecord,
  AttendanceRosterSnapshot,
  AttendanceHistory,
} from '../models/attendance.js';
import { StudentQrCredential } from '../models/student-qr-credential.js';
import { StudentProfile } from '../models/student-profile.js';
import { BatchEnrollment } from '../models/learning.js';
import {
  MongoCurriculumUnit,
  curriculumStorageReady,
} from '../curriculum/repository.js';
import { storageError } from '../administration/repository.js';
import { AppError } from '../middleware/errors.js';
import {
  MAX_ROSTER,
  MAX_REPORT_SESSIONS,
  type AttendanceRepository,
  type AttendanceUnit,
  type SessionRecord,
  type RosterRow,
  type AttendanceRow,
  type History,
  type List,
  type Candidate,
} from './contracts.js';
let initialized = false;
mongoose.connection.on('disconnected', () => {
  initialized = false;
});
export const attendanceStorageReady = () =>
  initialized && curriculumStorageReady();
export async function initializeAttendanceIndexes() {
  initialized = false;
  for (const m of [
    AttendanceSession,
    AttendanceRecord,
    AttendanceRosterSnapshot,
    AttendanceHistory,
  ])
    await m.createIndexes();
  initialized = true;
}
const dto = <T>(d: { toObject(): unknown }): T => {
  const { _id, __v, operationalRevision, ...rest } = JSON.parse(
    JSON.stringify(d.toObject()),
  );
  void __v;
  void operationalRevision;
  return { ...rest, id: String(_id) } as T;
};
const bounded = <T>(rows: T[], max: number) => {
  if (rows.length > max)
    throw new AppError(
      413,
      'ATTENDANCE_LIMIT',
      'Narrow filters or reduce the roster before proceeding',
    );
  return rows;
};
const page = <T>(items: T[], total: number, o: List) => ({
  items,
  total,
  page: o.page,
  pageSize: o.pageSize,
  totalPages: Math.ceil(total / o.pageSize),
});
export class MongoAttendanceUnit implements AttendanceUnit {
  curriculum: MongoCurriculumUnit;
  constructor(private sessionContext: ClientSession | null = null) {
    this.curriculum = new MongoCurriculumUnit(sessionContext);
  }
  private get options() {
    return {
      session: this.sessionContext ?? undefined,
      new: true,
      runValidators: true,
    };
  }
  private filter(batchId: string, o: List) {
    return {
      batchId,
      ...(o.dayId ? { learningDayId: o.dayId } : {}),
      ...(o.sessionType ? { sessionType: o.sessionType } : {}),
      ...(o.status ? { status: o.status } : {}),
      ...(o.from || o.to
        ? {
            createdAt: {
              ...(o.from ? { $gte: new Date(o.from) } : {}),
              ...(o.to ? { $lte: new Date(o.to) } : {}),
            },
          }
        : {}),
    };
  }
  async sessions(batchId: string, o: List) {
    const f = this.filter(batchId, o);
    return page(
      (
        await AttendanceSession.find(f)
          .sort({ dayNumber: 1, sessionType: 1 })
          .skip((o.page - 1) * o.pageSize)
          .limit(o.pageSize)
          .session(this.sessionContext)
      ).map((d) => dto<SessionRecord>(d)),
      await AttendanceSession.countDocuments(f).session(this.sessionContext),
      o,
    );
  }
  async session(id: string) {
    const d = await AttendanceSession.findById(id).session(this.sessionContext);
    return d ? dto<SessionRecord>(d) : null;
  }
  async insertSession(
    data: Omit<SessionRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const [d] = await AttendanceSession.create([data], this.options);
    return dto<SessionRecord>(d!);
  }
  async changeSession(
    id: string,
    revision: number,
    status: SessionRecord['status'],
    patch: Partial<SessionRecord>,
  ) {
    const d = await AttendanceSession.findOneAndUpdate(
      { _id: id, revision, status },
      { $set: patch, $inc: { revision: 1, operationalRevision: 1 } },
      this.options,
    );
    return d ? dto<SessionRecord>(d) : null;
  }
  async lockSession(
    id: string,
    revision: number,
    status: SessionRecord['status'],
  ) {
    return (
      (
        await AttendanceSession.updateOne(
          { _id: id, revision, status },
          { $inc: { operationalRevision: 1 } },
          this.options,
        )
      ).modifiedCount === 1
    );
  }
  async roster(attendanceSessionId: string) {
    return bounded(
      (
        await AttendanceRosterSnapshot.find({ attendanceSessionId })
          .sort({ rollNumberSnapshot: 1 })
          .limit(MAX_ROSTER + 1)
          .session(this.sessionContext)
      ).map((d) => dto<RosterRow>(d)),
      MAX_ROSTER,
    );
  }
  async addRoster(rows: Omit<RosterRow, 'id' | 'createdAt'>[]) {
    if (rows.length) await AttendanceRosterSnapshot.create(rows, this.options);
  }
  async records(attendanceSessionId: string) {
    return bounded(
      (
        await AttendanceRecord.find({ attendanceSessionId })
          .limit(MAX_ROSTER + 1)
          .session(this.sessionContext)
      ).map((d) => dto<AttendanceRow>(d)),
      MAX_ROSTER,
    );
  }
  async ownRecord(attendanceSessionId: string, studentProfileId: string) {
    const d = await AttendanceRecord.findOne({
      attendanceSessionId,
      studentProfileId,
    }).session(this.sessionContext);
    return d ? dto<AttendanceRow>(d) : null;
  }
  async record(id: string) {
    const d = await AttendanceRecord.findById(id).session(this.sessionContext);
    return d ? dto<AttendanceRow>(d) : null;
  }
  async insertRecord(data: Omit<AttendanceRow, 'id' | 'updatedAt'>) {
    const [d] = await AttendanceRecord.create([data], this.options);
    return dto<AttendanceRow>(d!);
  }
  async updateRecord(
    id: string,
    revision: number,
    patch: Pick<AttendanceRow, 'status' | 'source' | 'updatedBy'>,
  ) {
    const old = await this.record(id);
    if (!old) return null;
    const d = await AttendanceRecord.findOneAndUpdate(
      { _id: id, revision, attendanceSessionId: old.attendanceSessionId },
      { $set: patch, $inc: { revision: 1 } },
      this.options,
    );
    return d ? dto<AttendanceRow>(d) : null;
  }
  async history(attendanceSessionId: string, o: List) {
    return page(
      (
        await AttendanceHistory.find({ attendanceSessionId })
          .sort({ createdAt: -1, _id: -1 })
          .skip((o.page - 1) * o.pageSize)
          .limit(o.pageSize)
          .session(this.sessionContext)
      ).map((d) => dto<History>(d)),
      await AttendanceHistory.countDocuments({ attendanceSessionId }).session(
        this.sessionContext,
      ),
      o,
    );
  }
  async addHistory(data: Omit<History, 'id' | 'createdAt'>) {
    await AttendanceHistory.create([data], this.options);
  }
  async candidates(batchId: string) {
    const es = bounded(
      await BatchEnrollment.find({ batchId, status: 'ACTIVE' })
        .sort({ _id: 1 })
        .limit(MAX_ROSTER + 1)
        .select('_id')
        .session(this.sessionContext),
      MAX_ROSTER,
    );
    const result: Candidate[] = [];
    for (const e of es) {
      const enrollment = await this.curriculum.learning.enrollment(
        String(e._id),
      );
      if (!enrollment?.studentProfileId) continue;
      const profile = await this.curriculum.learning.students.profile(
        enrollment.studentProfileId,
      );
      if (profile) result.push({ enrollment, profile });
    }
    return result;
  }
  async credentialByHash(tokenHash: string) {
    const c = await StudentQrCredential.findOne({ tokenHash })
      .select('profileId version tokenHash')
      .session(this.sessionContext);
    return c
      ? {
          profileId: String(c.profileId),
          version: c.version,
          tokenHash: c.tokenHash,
        }
      : null;
  }
  async lockIdentity(
    p: Candidate['profile'],
    e: Candidate['enrollment'],
    hash?: string,
  ) {
    const profile = await StudentProfile.updateOne(
      {
        _id: p.id,
        revision: p.revision,
        qrCredentialVersion: p.qrCredentialVersion,
        verificationStatus: 'VERIFIED',
      },
      { $inc: { attendanceRevision: 1 } },
      this.options,
    );
    if (profile.modifiedCount !== 1) return false;
    const enrollment = await BatchEnrollment.updateOne(
      {
        _id: e.id,
        revision: e.revision,
        status: 'ACTIVE',
        studentProfileId: p.id,
        rollNumber: p.rollNumber,
        collegeId: p.collegeId,
      },
      { $inc: { attendanceRevision: 1 } },
      this.options,
    );
    if (enrollment.modifiedCount !== 1) return false;
    if (hash)
      return (
        (
          await StudentQrCredential.updateOne(
            {
              profileId: p.id,
              version: p.qrCredentialVersion,
              tokenHash: hash,
            },
            { $inc: { attendanceRevision: 1 } },
            this.options,
          )
        ).modifiedCount === 1
      );
    return true;
  }
  async reportSessions(batch: string, o: List) {
    return bounded(
      (
        await AttendanceSession.find(this.filter(batch, o))
          .sort({ dayNumber: 1, sessionType: 1 })
          .limit(MAX_REPORT_SESSIONS + 1)
          .session(this.sessionContext)
      ).map((d) => dto<SessionRecord>(d)),
      MAX_REPORT_SESSIONS,
    );
  }
  async ownBatches(profile: string, o: List) {
    const rows = await AttendanceRosterSnapshot.aggregate<{
      items: {
        _id: mongoose.Types.ObjectId;
        name: string;
        college: string;
        course: string;
      }[];
      total: { value: number }[];
    }>([
      { $match: { studentProfileId: new mongoose.Types.ObjectId(profile) } },
      {
        $lookup: {
          from: AttendanceSession.collection.name,
          localField: 'attendanceSessionId',
          foreignField: '_id',
          as: 'session',
        },
      },
      { $unwind: '$session' },
      {
        $group: {
          _id: '$session.batchId',
          name: { $first: '$session.batchName' },
          college: { $first: '$session.collegeName' },
          course: { $first: '$session.courseTitle' },
        },
      },
      { $sort: { name: 1, _id: 1 } },
      {
        $facet: {
          items: [{ $skip: (o.page - 1) * o.pageSize }, { $limit: o.pageSize }],
          total: [{ $count: 'value' }],
        },
      },
    ]).session(this.sessionContext);
    const result = rows[0];
    return page(
      (result?.items ?? []).map((r) => ({
        id: String(r._id),
        name: r.name,
        college: r.college,
        course: r.course,
      })),
      result?.total[0]?.value ?? 0,
      o,
    );
  }
  async ownSessions(batchId: string, studentProfileId: string, o: List) {
    const rows = await AttendanceSession.aggregate<{
      items: Record<string, unknown>[];
      total: { value: number }[];
    }>([
      { $match: this.filter(batchId, o) },
      {
        $lookup: {
          from: AttendanceRosterSnapshot.collection.name,
          let: { session: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$attendanceSessionId', '$$session'] },
                    {
                      $eq: [
                        '$studentProfileId',
                        new mongoose.Types.ObjectId(studentProfileId),
                      ],
                    },
                  ],
                },
              },
            },
            { $project: { _id: 1 } },
            { $limit: 1 },
          ],
          as: 'ownRoster',
        },
      },
      { $match: { 'ownRoster.0': { $exists: true } } },
      { $sort: { dayNumber: 1, sessionType: 1, _id: 1 } },
      { $project: { ownRoster: 0 } },
      {
        $facet: {
          items: [{ $skip: (o.page - 1) * o.pageSize }, { $limit: o.pageSize }],
          total: [{ $count: 'value' }],
        },
      },
    ]).session(this.sessionContext);
    const data = rows[0];
    return page(
      (data?.items ?? []).map((d) => dto<SessionRecord>({ toObject: () => d })),
      data?.total[0]?.value ?? 0,
      o,
    );
  }
}
export const mongoAttendanceRepository: AttendanceRepository = {
  async ensureReady() {
    if (!attendanceStorageReady())
      throw new AppError(
        503,
        'ATTENDANCE_UNAVAILABLE',
        'Attendance storage is unavailable',
      );
  },
  read: new MongoAttendanceUnit(),
  async transaction<T>(work: (tx: AttendanceUnit) => Promise<T>): Promise<T> {
    await this.ensureReady();
    try {
      return await mongoose.connection.transaction(
        (s) => work(new MongoAttendanceUnit(s)),
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch (e) {
      return storageError(e);
    }
  },
};
