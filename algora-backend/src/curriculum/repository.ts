import mongoose, { type ClientSession } from 'mongoose';
import {
  CurriculumRevision,
  LearningDay,
  PublishedLearningDay,
  CodingProblem,
  EditorialRevision,
  BatchCurriculumAssignmentHistory,
  CurriculumReleaseControl,
} from '../models/curriculum.js';
import { BatchEnrollment, Batch } from '../models/learning.js';
import {
  MongoLearningUnit,
  learningStorageReady,
} from '../learning/repository.js';
import { storageError } from '../administration/repository.js';
import { AppError } from '../middleware/errors.js';
import type { Snapshot, BatchRecord } from '../learning/contracts.js';
import type {
  CurriculumRepository,
  CurriculumUnit,
  RevisionRecord,
  DayRecord,
  DayInput,
  FrozenDay,
  ProblemRecord,
  EditorialRecord,
  ReleaseRecord,
  AssignmentHistory,
  Query,
} from './contracts.js';
let initialized = false;
mongoose.connection.on('disconnected', () => {
  initialized = false;
});
export const curriculumStorageReady = () =>
  initialized && learningStorageReady();
export async function initializeCurriculumIndexes() {
  initialized = false;
  for (const m of [
    CurriculumRevision,
    LearningDay,
    PublishedLearningDay,
    CodingProblem,
    EditorialRevision,
    BatchCurriculumAssignmentHistory,
    CurriculumReleaseControl,
  ])
    await m.createIndexes();
  initialized = true;
}
const dto = <T>(d: { toObject(): unknown }): T => {
  const { _id, __v, ...data } = JSON.parse(
    JSON.stringify(d.toObject()),
  ) as Record<string, unknown>;
  void __v;
  return { ...data, id: String(_id) } as T;
};
const page = <T>(items: T[], total: number, q: Query) => ({
  items,
  total,
  page: q.page,
  pageSize: q.pageSize,
  totalPages: Math.ceil(total / q.pageSize),
});
const search = (v: string) => ({
  $regex: v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  $options: 'i',
});
export class MongoCurriculumUnit implements CurriculumUnit {
  learning: MongoLearningUnit;
  constructor(private session: ClientSession | null = null) {
    this.learning = new MongoLearningUnit(session);
  }
  private get options() {
    return {
      session: this.session ?? undefined,
      runValidators: true,
      new: true,
    };
  }
  async revisions(courseId: string, q: Query, publishedOnly = false) {
    const filter = {
      courseId,
      ...(publishedOnly
        ? { status: 'PUBLISHED' }
        : q.status
          ? { status: q.status }
          : {}),
    };
    const docs = await CurriculumRevision.find(filter)
      .sort({ revisionNumber: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => dto<RevisionRecord>(d)),
      await CurriculumRevision.countDocuments(filter).session(this.session),
      q,
    );
  }
  async revision(id: string) {
    const d = await CurriculumRevision.findById(id).session(this.session);
    return d ? dto<RevisionRecord>(d) : null;
  }
  async nextRevision(courseId: string) {
    return (
      ((
        await CurriculumRevision.findOne({ courseId })
          .sort({ revisionNumber: -1 })
          .session(this.session)
      )?.revisionNumber ?? 0) + 1
    );
  }
  async insertRevision(
    data: Omit<RevisionRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const [d] = await CurriculumRevision.create([data], this.options);
    return dto<RevisionRecord>(d!);
  }
  async touchDraft(id: string, revision: number) {
    return (
      (
        await CurriculumRevision.updateOne(
          { _id: id, status: 'DRAFT', revision },
          { $inc: { revision: 1 } },
          this.options,
        )
      ).modifiedCount === 1
    );
  }
  private async draft(id: string) {
    if (
      !(await CurriculumRevision.exists({ _id: id, status: 'DRAFT' }).session(
        this.session,
      ))
    )
      throw new AppError(
        409,
        'IMMUTABLE_CONTENT',
        'Only draft revisions may be written',
      );
  }
  async publishRevision(
    id: string,
    revision: number,
    actor: string,
    courseSnapshot: Snapshot,
    dayCount: number,
  ) {
    return (
      (
        await CurriculumRevision.updateOne(
          { _id: id, status: 'DRAFT', revision },
          {
            $set: {
              status: 'PUBLISHED',
              publishedBy: actor,
              publishedAt: new Date(),
              courseSnapshot,
              dayCount,
            },
            $inc: { revision: 1 },
          },
          this.options,
        )
      ).modifiedCount === 1
    );
  }
  async days(curriculumRevisionId: string, q: Query) {
    const filter = {
      curriculumRevisionId,
      ...(q.search ? { title: search(q.search) } : {}),
    };
    const docs = await LearningDay.find(filter)
      .sort({ dayNumber: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => dto<DayRecord>(d)),
      await LearningDay.countDocuments(filter).session(this.session),
      q,
    );
  }
  async allDays(curriculumRevisionId: string) {
    return (
      await LearningDay.find({ curriculumRevisionId })
        .sort({ dayNumber: 1 })
        .session(this.session)
    ).map((d) => dto<DayRecord>(d));
  }
  async day(id: string) {
    const d = await LearningDay.findById(id).session(this.session);
    return d ? dto<DayRecord>(d) : null;
  }
  async insertDay(data: Omit<DayRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    await this.draft(data.curriculumRevisionId);
    const [d] = await LearningDay.create([data], this.options);
    return dto<DayRecord>(d!);
  }
  async updateDay(
    id: string,
    curriculumRevisionId: string,
    data: Omit<DayInput, 'expectedRevision'>,
    updatedBy: string,
  ) {
    await this.draft(curriculumRevisionId);
    const d = await LearningDay.findOneAndUpdate(
      { _id: id, curriculumRevisionId },
      { $set: { ...data, updatedBy } },
      this.options,
    );
    return d ? dto<DayRecord>(d) : null;
  }
  async removeDay(id: string, curriculumRevisionId: string) {
    await this.draft(curriculumRevisionId);
    await LearningDay.deleteOne(
      { _id: id, curriculumRevisionId },
      this.options,
    );
  }
  async reorder(curriculumRevisionId: string, ids: string[]) {
    await this.draft(curriculumRevisionId);
    const days = await this.allDays(curriculumRevisionId),
      occupied = new Set(days.map((d) => d.dayNumber)),
      temporary: number[] = [];
    let candidate = ids.length + 1;
    while (temporary.length < ids.length) {
      if (!occupied.has(candidate)) temporary.push(candidate);
      candidate++;
    }
    for (let i = 0; i < ids.length; i++)
      await LearningDay.updateOne(
        { _id: ids[i], curriculumRevisionId },
        { $set: { dayNumber: temporary[i] } },
        this.options,
      );
    for (let i = 0; i < ids.length; i++)
      await LearningDay.updateOne(
        { _id: ids[i], curriculumRevisionId },
        { $set: { dayNumber: i + 1 } },
        this.options,
      );
  }
  async freezeDay(curriculumRevisionId: string, data: FrozenDay) {
    await this.draft(curriculumRevisionId);
    await PublishedLearningDay.create(
      [
        {
          curriculumRevisionId,
          courseId: data.courseId,
          dayNumber: data.dayNumber,
          dayId: data.id,
          data,
        },
      ],
      this.options,
    );
  }
  async frozenDays(curriculumRevisionId: string, q: Query) {
    const filter = { curriculumRevisionId };
    const docs = await PublishedLearningDay.find(filter)
      .sort({ dayNumber: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => d.data as FrozenDay),
      await PublishedLearningDay.countDocuments(filter).session(this.session),
      q,
    );
  }
  async frozenDay(curriculumRevisionId: string, dayNumber: number) {
    const d = await PublishedLearningDay.findOne({
      curriculumRevisionId,
      dayNumber,
    }).session(this.session);
    return d ? (d.data as FrozenDay) : null;
  }
  async allFrozenDays(curriculumRevisionId: string) {
    return (
      await PublishedLearningDay.find({ curriculumRevisionId })
        .sort({ dayNumber: 1 })
        .session(this.session)
    ).map((d) => d.data as FrozenDay);
  }
  async problems(q: Query) {
    const filter = {
      ...(q.platform ? { platform: q.platform } : {}),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(q.search
        ? { $or: [{ title: search(q.search) }, { topics: search(q.search) }] }
        : {}),
    };
    const docs = await CodingProblem.find(filter)
      .sort({ title: 1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => dto<ProblemRecord>(d)),
      await CodingProblem.countDocuments(filter).session(this.session),
      q,
    );
  }
  async problem(id: string) {
    const d = await CodingProblem.findById(id).session(this.session);
    return d ? dto<ProblemRecord>(d) : null;
  }
  async insertProblem(
    data: Omit<ProblemRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const [d] = await CodingProblem.create([data], this.options);
    return dto<ProblemRecord>(d!);
  }
  async updateProblem(
    id: string,
    revision: number,
    patch: Partial<ProblemRecord>,
  ) {
    const d = await CodingProblem.findOneAndUpdate(
      { _id: id, revision },
      { $set: patch, $inc: { revision: 1 } },
      this.options,
    );
    return d ? dto<ProblemRecord>(d) : null;
  }
  async lockProblem(id: string) {
    return (
      (
        await CodingProblem.updateOne(
          { _id: id },
          { $inc: { operationalRevision: 1 } },
          this.options,
        )
      ).modifiedCount === 1
    );
  }
  async editorials(problemId: string, q: Query, owners: string[] | null) {
    const filter = {
      problemId,
      ...(owners
        ? {
            $or: [
              { ownerCollegeId: { $in: owners } },
              { ownerCollegeId: null, status: 'PUBLISHED' },
            ],
          }
        : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const docs = await EditorialRevision.find(filter)
      .sort({ versionNumber: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => dto<EditorialRecord>(d)),
      await EditorialRevision.countDocuments(filter).session(this.session),
      q,
    );
  }
  async editorial(id: string) {
    const d = await EditorialRevision.findById(id).session(this.session);
    return d ? dto<EditorialRecord>(d) : null;
  }
  async nextEditorial(problemId: string) {
    return (
      ((
        await EditorialRevision.findOne({ problemId })
          .sort({ versionNumber: -1 })
          .session(this.session)
      )?.versionNumber ?? 0) + 1
    );
  }
  async insertEditorial(
    data: Omit<EditorialRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const [d] = await EditorialRevision.create([data], this.options);
    return dto<EditorialRecord>(d!);
  }
  async updateEditorial(
    id: string,
    revision: number,
    body: EditorialRecord['body'],
  ) {
    const d = await EditorialRevision.findOneAndUpdate(
      { _id: id, status: 'DRAFT', revision },
      { $set: { body }, $inc: { revision: 1 } },
      this.options,
    );
    return d ? dto<EditorialRecord>(d) : null;
  }
  async publishEditorial(id: string, revision: number, publishedBy: string) {
    const d = await EditorialRevision.findOneAndUpdate(
      { _id: id, status: 'DRAFT', revision },
      {
        $set: { status: 'PUBLISHED', publishedBy, publishedAt: new Date() },
        $inc: { revision: 1 },
      },
      this.options,
    );
    return d ? dto<EditorialRecord>(d) : null;
  }
  async releases(batchId: string, curriculumRevisionId: string) {
    return (
      await CurriculumReleaseControl.find({
        batchId,
        curriculumRevisionId,
      }).session(this.session)
    ).map((d) => dto<ReleaseRecord>(d));
  }
  async putRelease(
    batchId: string,
    curriculumRevisionId: string,
    dayId: string,
    revision: number,
    restricted: boolean,
    reason: string,
    updatedBy: string,
  ) {
    if (revision === 0) {
      const existing = await CurriculumReleaseControl.findOne({
        batchId,
        curriculumRevisionId,
        dayId,
      }).session(this.session);
      if (!existing) {
        const [d] = await CurriculumReleaseControl.create(
          [
            {
              batchId,
              curriculumRevisionId,
              dayId,
              revision: 1,
              restricted,
              reason,
              updatedBy,
            },
          ],
          this.options,
        );
        return dto<ReleaseRecord>(d!);
      }
    }
    const d = await CurriculumReleaseControl.findOneAndUpdate(
      { batchId, curriculumRevisionId, dayId, revision },
      { $set: { restricted, reason, updatedBy }, $inc: { revision: 1 } },
      this.options,
    );
    return d ? dto<ReleaseRecord>(d) : null;
  }
  async assignmentHistory(batchId: string, q: Query) {
    const docs = await BatchCurriculumAssignmentHistory.find({ batchId })
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .session(this.session);
    return page(
      docs.map((d) => dto<AssignmentHistory>(d)),
      await BatchCurriculumAssignmentHistory.countDocuments({
        batchId,
      }).session(this.session),
      q,
    );
  }
  async insertAssignmentHistory(
    data: Omit<AssignmentHistory, 'id' | 'createdAt'>,
  ) {
    await BatchCurriculumAssignmentHistory.create([data], this.options);
  }
  async studentBatches(userId: string, courseId: string, q: Query) {
    const p = await this.learning.students.own(userId);
    if (!p) return page<BatchRecord>([], 0, q);
    const links = await BatchEnrollment.find({
      studentProfileId: p.id,
      status: 'ACTIVE',
      rollNumber: p.rollNumber,
      collegeId: p.collegeId,
    })
      .select('batchId')
      .session(this.session);
    const filter = {
      _id: { $in: links.map((e) => e.batchId) },
      courseId,
      status: 'ACTIVE',
    };
    const docs = await Batch.find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .select('_id')
      .session(this.session);
    const items: BatchRecord[] = [];
    for (const d of docs) {
      const b = await this.learning.batch(String(d._id));
      if (b) items.push(b);
    }
    return page(
      items,
      await Batch.countDocuments(filter).session(this.session),
      q,
    );
  }
}
export const mongoCurriculumRepository: CurriculumRepository = {
  async ensureReady() {
    if (!curriculumStorageReady())
      throw new AppError(
        503,
        'CURRICULUM_UNAVAILABLE',
        'Curriculum management is temporarily unavailable',
      );
  },
  read: new MongoCurriculumUnit(),
  async transaction<T>(work: (tx: CurriculumUnit) => Promise<T>): Promise<T> {
    await this.ensureReady();
    try {
      return await mongoose.connection.transaction(
        (s) => work(new MongoCurriculumUnit(s)),
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch (e) {
      return storageError(e);
    }
  },
};
