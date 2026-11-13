import mongoose, { type ClientSession } from 'mongoose';
import {
  Course,
  Batch,
  BatchEnrollment,
  EnrollmentHistory,
  EnrollmentImport,
} from '../models/learning.js';
import {
  StudentProfile,
  StudentRollReservation,
} from '../models/student-profile.js';
import {
  MongoStudentUnit,
  studentStorageReady,
} from '../students/repository.js';
import { storageError } from '../administration/repository.js';
import { reconciliationPending } from './markers.js';
import { AppError } from '../middleware/errors.js';
import {
  currentStatuses,
  type LearningRepository,
  type LearningUnit,
  type CourseRecord,
  type BatchRecord,
  type EnrollmentRecord,
  type ImportRecord,
  type HistoryRecord,
  type List,
} from './contracts.js';
let initialized = false;
mongoose.connection.on('disconnected', () => {
  initialized = false;
});
export const learningStorageReady = () => initialized && studentStorageReady();
export async function initializeLearningIndexes() {
  initialized = false;
  await Promise.all(
    [Course, Batch, BatchEnrollment, EnrollmentHistory, EnrollmentImport].map(
      (m) => m.createIndexes(),
    ),
  );
  initialized = true;
}
function record<T>(doc: { toObject(): unknown }): T {
  const raw = JSON.parse(JSON.stringify(doc.toObject())) as Record<
    string,
    unknown
  >;
  const {
    _id,
    __v,
    enrollmentReconciliationPending,
    reconciliationCursor,
    reconciliationToken,
    reconciliationAttempts,
    reconciliationNextAt,
    reconciliationError,
    operationalRevision,
    attendanceRevision,
    ...safe
  } = raw;
  void __v;
  void enrollmentReconciliationPending;
  void reconciliationCursor;
  void reconciliationToken;
  void reconciliationAttempts;
  void reconciliationNextAt;
  void reconciliationError;
  void operationalRevision;
  void attendanceRevision;
  return { ...safe, id: String(_id) } as T;
}
const regex = (v: string) => ({
  $regex: v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  $options: 'i',
});
const page = <T>(items: T[], total: number, o: List) => ({
  items,
  total,
  page: o.page,
  pageSize: o.pageSize,
  totalPages: Math.ceil(total / o.pageSize),
});
export class MongoLearningUnit implements LearningUnit {
  students: MongoStudentUnit;
  constructor(private session: ClientSession | null = null) {
    this.students = new MongoStudentUnit(session);
  }
  private get options() {
    return {
      session: this.session ?? undefined,
      runValidators: true,
      new: true,
    };
  }
  async course(id: string) {
    const d = await Course.findById(id).session(this.session);
    return d ? record<CourseRecord>(d) : null;
  }
  async courses(o: List, colleges: string[] | null, manageable: string[]) {
    const filter = {
      ...(colleges
        ? {
            $or: [
              { scope: 'PLATFORM', status: 'PUBLISHED' },
              { ownerCollegeId: { $in: colleges }, status: 'PUBLISHED' },
              { sharedCollegeIds: { $in: colleges }, status: 'PUBLISHED' },
              { ownerCollegeId: { $in: manageable } },
            ],
          }
        : {}),
      ...(o.collegeId ? { ownerCollegeId: o.collegeId } : {}),
      ...(o.status ? { status: o.status } : {}),
      ...(o.scope ? { scope: o.scope } : {}),
      ...(o.difficulty ? { difficulty: o.difficulty } : {}),
      ...(o.search ? { title: regex(o.search) } : {}),
    };
    const docs = await Course.find(filter)
      .sort({
        [o.sort === 'title' ? 'title' : 'createdAt']:
          o.direction === 'asc' ? 1 : -1,
        _id: 1,
      })
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => record<CourseRecord>(d)),
      await Course.countDocuments(filter).session(this.session),
      o,
    );
  }
  async insertCourse(
    data: Omit<CourseRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const [d] = await Course.create([data], this.options);
    return record<CourseRecord>(d!);
  }
  async updateCourse(
    id: string,
    revision: number,
    patch: Partial<CourseRecord>,
  ) {
    const d = await Course.findOneAndUpdate(
      { _id: id, revision },
      { $set: { ...patch, ...reconciliationPending() }, $inc: { revision: 1 } },
      this.options,
    );
    return d ? record<CourseRecord>(d) : null;
  }
  async batch(id: string) {
    const d = await Batch.findById(id).session(this.session);
    return d ? record<BatchRecord>(d) : null;
  }
  async batches(o: List, colleges: string[] | null) {
    const filter = {
      ...(colleges ? { collegeId: { $in: colleges } } : {}),
      ...(o.collegeId
        ? {
            collegeId:
              colleges && !colleges.includes(o.collegeId)
                ? { $in: [] }
                : o.collegeId,
          }
        : {}),
      ...(o.courseId ? { courseId: o.courseId } : {}),
      ...(o.status ? { status: o.status } : {}),
      ...(o.search ? { name: regex(o.search) } : {}),
    };
    const docs = await Batch.find(filter)
      .sort({
        [['name', 'startDate'].includes(o.sort) ? o.sort : 'createdAt']:
          o.direction === 'asc' ? 1 : -1,
        _id: 1,
      })
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => record<BatchRecord>(d)),
      await Batch.countDocuments(filter).session(this.session),
      o,
    );
  }
  async insertBatch(data: Omit<BatchRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    const [d] = await Batch.create([data], this.options);
    return record<BatchRecord>(d!);
  }
  async updateBatch(id: string, revision: number, patch: Partial<BatchRecord>) {
    const d = await Batch.findOneAndUpdate(
      { _id: id, revision },
      { $set: { ...patch, ...reconciliationPending() }, $inc: { revision: 1 } },
      this.options,
    );
    return d ? record<BatchRecord>(d) : null;
  }
  async lockBatch(id: string) {
    return (
      (
        await Batch.updateOne(
          { _id: id },
          { $inc: { operationalRevision: 1 } },
          this.options,
        )
      ).modifiedCount === 1
    );
  }
  async lockCourse(id: string) {
    return (
      (
        await Course.updateOne(
          { _id: id },
          { $inc: { operationalRevision: 1 } },
          this.options,
        )
      ).modifiedCount === 1
    );
  }
  async prior(batchId: string, rollNumber: string) {
    const d = await BatchEnrollment.findOne({ batchId, rollNumber })
      .sort({ createdAt: -1 })
      .session(this.session);
    return d ? record<EnrollmentRecord>(d) : null;
  }
  async seat(id: string, delta: 1 | -1) {
    const filter =
      delta === 1
        ? {
            _id: id,
            status: { $in: ['DRAFT', 'ACTIVE'] },
            $or: [
              { capacity: null },
              { $expr: { $lt: ['$seatCount', '$capacity'] } },
            ],
          }
        : { _id: id, seatCount: { $gt: 0 } };
    return (
      (
        await Batch.updateOne(
          filter,
          { $inc: { seatCount: delta, operationalRevision: 1 } },
          this.options,
        )
      ).modifiedCount === 1
    );
  }
  async profileByRoll(rollNumber: string) {
    const d = await StudentProfile.findOne({ rollNumber })
      .select('_id')
      .session(this.session);
    return d ? this.students.profile(String(d._id)) : null;
  }
  async enrollment(id: string) {
    const d = await BatchEnrollment.findById(id).session(this.session);
    return d ? record<EnrollmentRecord>(d) : null;
  }
  async current(
    batchId: string,
    rollNumber: string,
    studentProfileId?: string,
  ) {
    const d = await BatchEnrollment.findOne({
      batchId,
      status: { $in: currentStatuses },
      $or: [
        { rollNumber },
        ...(studentProfileId ? [{ studentProfileId }] : []),
      ],
    }).session(this.session);
    return d ? record<EnrollmentRecord>(d) : null;
  }
  async enrollments(batchId: string, o: List, history: boolean) {
    const filter = {
      batchId,
      ...(!history ? { status: { $in: currentStatuses } } : {}),
      ...(o.status
        ? {
            status:
              o.status === 'PENDING'
                ? { $in: ['PENDING_REGISTRATION', 'PENDING_VERIFICATION'] }
                : !history && !currentStatuses.includes(o.status as never)
                  ? { $in: [] }
                  : o.status,
          }
        : {}),
      ...(o.search ? { rollNumber: regex(o.search) } : {}),
    };
    const docs = await BatchEnrollment.find(filter)
      .sort({
        [o.sort === 'rollNumber' ? 'rollNumber' : 'createdAt']:
          o.direction === 'asc' ? 1 : -1,
        _id: 1,
      })
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => record<EnrollmentRecord>(d)),
      await BatchEnrollment.countDocuments(filter).session(this.session),
      o,
    );
  }
  async ownEnrollments(studentProfileId: string, o: List) {
    const filter = { studentProfileId, status: { $in: currentStatuses } };
    const docs = await BatchEnrollment.find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => record<EnrollmentRecord>(d)),
      await BatchEnrollment.countDocuments(filter).session(this.session),
      o,
    );
  }
  async insertEnrollment(
    data: Omit<EnrollmentRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const [d] = await BatchEnrollment.create([data], this.options);
    return record<EnrollmentRecord>(d!);
  }
  async updateEnrollment(
    id: string,
    revision: number,
    patch: Partial<EnrollmentRecord>,
  ) {
    const d = await BatchEnrollment.findOneAndUpdate(
      { _id: id, revision },
      { $set: patch, $inc: { revision: 1 } },
      this.options,
    );
    return d ? record<EnrollmentRecord>(d) : null;
  }
  async history(data: Omit<HistoryRecord, 'id' | 'createdAt'>) {
    await EnrollmentHistory.create([data], this.options);
  }
  async histories(batchId: string, o: List) {
    const docs = await EnrollmentHistory.find({ batchId })
      .sort({ createdAt: -1, _id: 1 })
      .skip((o.page - 1) * o.pageSize)
      .limit(o.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => record<HistoryRecord>(d)),
      await EnrollmentHistory.countDocuments({ batchId }).session(this.session),
      o,
    );
  }
  async importByHash(tokenHash: string) {
    const d = await EnrollmentImport.findOne({ tokenHash }).session(
      this.session,
    );
    return d ? record<ImportRecord>(d) : null;
  }
  async importByKey(actorUserId: string, batchId: string, requestKey: string) {
    const d = await EnrollmentImport.findOne({
      actorUserId,
      batchId,
      requestKey,
    }).session(this.session);
    return d ? record<ImportRecord>(d) : null;
  }
  async insertImport(data: Omit<ImportRecord, 'id' | 'createdAt'>) {
    const [d] = await EnrollmentImport.create([data], this.options);
    return record<ImportRecord>(d!);
  }
  async completeImport(id: string, results: ImportRecord['results']) {
    await EnrollmentImport.updateOne(
      { _id: id, status: 'PREVIEW' },
      { $set: { status: 'COMPLETED', results } },
      this.options,
    );
  }
  async reconciliationRows(kind: string, target: string, cursor: string) {
    let filter: Record<string, unknown> = {};
    if (kind === 'BATCH') filter = { batchId: target };
    else if (kind === 'COLLEGE') filter = { collegeId: target };
    else if (kind === 'COURSE') {
      const batches = await Batch.find({ courseId: target })
        .select('_id')
        .session(this.session);
      filter = { batchId: { $in: batches.map((b) => b._id) } };
    } else {
      const p =
        kind === 'USER'
          ? await this.students.own(target)
          : await this.students.profile(target);
      if (!p) return [];
      const reserved = await StudentRollReservation.find({ profileId: p.id })
        .select('rollNumber')
        .session(this.session);
      filter = {
        $or: [
          { studentProfileId: p.id },
          {
            rollNumber: {
              $in: [p.rollNumber, ...reserved.map((r) => r.rollNumber)],
            },
          },
        ],
      };
    }
    const docs = await BatchEnrollment.find({
      ...filter,
      status: { $in: currentStatuses },
      ...(cursor ? { _id: { $gt: cursor } } : {}),
    })
      .sort({ _id: 1 })
      .limit(50)
      .session(this.session);
    return docs.map((d) => record<EnrollmentRecord>(d));
  }
}
export const mongoLearningRepository: LearningRepository = {
  async ensureReady() {
    if (!learningStorageReady())
      throw new AppError(
        503,
        'LEARNING_UNAVAILABLE',
        'Course and enrollment management is temporarily unavailable',
      );
  },
  read: new MongoLearningUnit(),
  async transaction<T>(work: (tx: LearningUnit) => Promise<T>): Promise<T> {
    await this.ensureReady();
    try {
      return await mongoose.connection.transaction(
        (s) => work(new MongoLearningUnit(s)),
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch (e) {
      return storageError(e);
    }
  },
};
