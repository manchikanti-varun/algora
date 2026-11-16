import mongoose, { type ClientSession } from 'mongoose';
import {
  StudentCodingAccount as Accounts,
  CodingOAuthState as States,
  CodingSyncJob as Jobs,
  StudentProblemProgress as ProgressModel,
  SubmissionEvidence as EvidenceModel,
  CodingProviderControl as Control,
  codingModels,
} from '../models/coding.js';
import { StudentProfile } from '../models/student-profile.js';
import { BatchEnrollment } from '../models/learning.js';
import {
  MongoCurriculumUnit,
  curriculumStorageReady,
} from '../curriculum/repository.js';
import { AppError } from '../middleware/errors.js';
import { storageError } from '../administration/repository.js';
import type {
  Account,
  OAuthState,
  Job,
  Progress,
  Evidence,
  ProgressUnit,
  ProgressRepository,
  Platform,
} from './contracts.js';
let initialized = false;
mongoose.connection.on('disconnected', () => {
  initialized = false;
});
export const codingStorageReady = () => initialized && curriculumStorageReady();
export async function initializeCodingIndexes() {
  initialized = false;
  for (const m of codingModels) await m.createIndexes();
  await Control.updateOne(
    { _id: 'codeforces' },
    { $setOnInsert: { nextAllowedAt: new Date(0).toISOString() } },
    { upsert: true },
  );
  await Control.updateOne(
    { _id: 'queue' },
    { $setOnInsert: { revision: 0 } },
    { upsert: true },
  );
  initialized = true;
}
const dto = <T>(doc: { toObject(): unknown }): T => {
  const { _id, __v, ...data } = JSON.parse(
    JSON.stringify(doc.toObject()),
  ) as Record<string, unknown>;
  void __v;
  return { ...data, id: String(_id) } as T;
};
const data = <T extends { id: string }>(v: T) => {
  const { id, ...rest } = v;
  void id;
  return rest;
};
export class MongoProgressUnit implements ProgressUnit {
  curriculum: MongoCurriculumUnit;
  constructor(private session: ClientSession | null = null) {
    this.curriculum = new MongoCurriculumUnit(session);
  }
  async accounts(profile: string) {
    return (
      await Accounts.find({ studentProfileId: profile }).session(this.session)
    ).map((d) => dto<Account>(d));
  }
  async account(id: string) {
    const d = await Accounts.findById(id).session(this.session);
    return d ? dto<Account>(d) : null;
  }
  async accountFor(profile: string, platform: Platform) {
    const d = await Accounts.findOne({
      studentProfileId: profile,
      platform,
    }).session(this.session);
    return d ? dto<Account>(d) : null;
  }
  async saveAccount(value: Account, expected: number | null) {
    if (expected === null) {
      const [d] = await Accounts.create([{ _id: value.id, ...data(value) }], {
        session: this.session ?? undefined,
      });
      return dto<Account>(d!);
    }
    const d = await Accounts.findOneAndUpdate(
      { _id: value.id, revision: expected },
      {
        $set: Object.fromEntries(
          Object.entries(data(value)).filter(([, v]) => v !== undefined),
        ),
        $unset: Object.fromEntries(
          [
            'subject',
            'registrationTimeSeconds',
            'verifiedAt',
            'proofExpiresAt',
            'proofDigest',
            'lastError',
            'lastCheckedAt',
            'lastSuccessAt',
          ]
            .filter(
              (key) =>
                (value as unknown as Record<string, unknown>)[key] ===
                undefined,
            )
            .map((key) => [key, 1]),
        ),
      },
      { session: this.session ?? undefined, new: true, runValidators: true },
    );
    if (!d) throw new AppError(409, 'STALE_STATE', 'Coding account changed');
    return dto<Account>(d);
  }
  async lockAccount(id: string, revision: number) {
    return !!(await Accounts.findOneAndUpdate(
      { _id: id, revision },
      { $inc: { operationalRevision: 1 } },
      { session: this.session ?? undefined },
    ));
  }
  async insertOAuth(value: OAuthState) {
    await States.create([{ _id: value.id, ...data(value) }], {
      session: this.session ?? undefined,
    });
  }
  async consumeOAuth(
    stateHash: string,
    userId: string,
    sessionHash: string,
    now: string,
  ) {
    const d = await States.findOneAndDelete({
      stateHash,
      userId,
      sessionHash,
      expiresAt: { $gt: new Date(now) },
    }).session(this.session);
    return d ? dto<OAuthState>(d) : null;
  }
  async jobs(accountId: string, batchId?: string) {
    return (
      await Jobs.find({ accountId, ...(batchId ? { batchId } : {}) })
        .sort({ createdAt: -1 })
        .limit(20)
        .session(this.session)
    ).map((d) => dto<Job>(d));
  }
  async job(id: string) {
    const d = await Jobs.findById(id).session(this.session);
    return d ? dto<Job>(d) : null;
  }
  async queue(value: Job, now: string) {
    await Control.updateOne(
      { _id: 'queue' },
      { $inc: { revision: 1 } },
      { session: this.session ?? undefined },
    );
    const active = await Jobs.findOne({
      accountId: value.accountId,
      batchId: value.batchId,
      active: true,
    }).session(this.session);
    if (active) return dto<Job>(active);
    const recent = await Jobs.exists({
      accountId: value.accountId,
      batchId: value.batchId,
      createdAt: { $gt: new Date(new Date(now).getTime() - 60000) },
    }).session(this.session);
    if (recent)
      throw new AppError(
        429,
        'SYNC_COOLDOWN',
        'Wait before refreshing this account again',
      );
    if (
      (await Jobs.countDocuments({ active: true }).session(this.session)) >=
      1000
    )
      throw new AppError(429, 'SYNC_QUEUE_FULL', 'Sync queue is busy');
    const [d] = await Jobs.create([{ _id: value.id, ...data(value) }], {
      session: this.session ?? undefined,
    });
    return dto<Job>(d!);
  }
  async saveJob(value: Job, token: string) {
    return !!(await Jobs.findOneAndUpdate(
      {
        _id: value.id,
        active: true,
        status: 'RUNNING',
        leaseToken: token,
        leaseUntil: { $gt: new Date().toISOString() },
      },
      { $set: data(value) },
      { session: this.session ?? undefined, new: true, runValidators: true },
    ));
  }
  async progress(
    studentProfileId: string,
    batchId: string,
    enrollmentId: string,
  ) {
    return (
      await ProgressModel.find({ studentProfileId, batchId, enrollmentId })
        .limit(10001)
        .session(this.session)
    ).map((d) => dto<Progress>(d));
  }
  async putProgress(value: Progress) {
    await ProgressModel.updateOne(
      { _id: value.id },
      { $set: data(value) },
      { upsert: true, session: this.session ?? undefined, runValidators: true },
    );
  }
  async insertEvidence(value: Evidence) {
    const { _id, ...rest } = { _id: value.evidenceId, ...value };
    const result = await EvidenceModel.updateOne(
      { _id },
      { $setOnInsert: rest },
      { upsert: true, session: this.session ?? undefined, runValidators: true },
    );
    return result.upsertedCount === 1;
  }
  async evidence(
    studentProfileId: string,
    batchId: string,
    assignmentId: string,
    enrollmentId: string,
  ) {
    const rows = await EvidenceModel.find({
      studentProfileId,
      batchId,
      assignmentId,
      enrollmentId,
    })
      .sort({ submittedAt: -1 })
      .limit(100)
      .session(this.session);
    return rows.map((d) => {
      const value = JSON.parse(JSON.stringify(d.toObject())) as Evidence & {
        _id?: unknown;
        __v?: unknown;
      };
      delete value._id;
      delete value.__v;
      return value;
    });
  }
  async lockEligibility(profile: string, enrollment: string) {
    const p = await StudentProfile.updateOne(
      { _id: profile },
      { $inc: { attendanceRevision: 1 } },
      { session: this.session ?? undefined },
    );
    const e = await BatchEnrollment.updateOne(
      { _id: enrollment, status: 'ACTIVE' },
      { $inc: { attendanceRevision: 1 } },
      { session: this.session ?? undefined },
    );
    return p.matchedCount === 1 && e.matchedCount === 1;
  }
}
export const mongoProgressRepository: ProgressRepository = {
  read: new MongoProgressUnit(),
  async ensureReady() {
    if (!codingStorageReady())
      throw new AppError(
        503,
        'STORAGE_UNAVAILABLE',
        'Coding progress storage is unavailable',
      );
  },
  async transaction<T>(work: (tx: ProgressUnit) => Promise<T>) {
    await this.ensureReady();
    try {
      return await mongoose.connection.transaction(
        (s) => work(new MongoProgressUnit(s)),
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch (e) {
      return storageError(e);
    }
  },
  async claim(now, token) {
    const d = await Jobs.findOneAndUpdate(
      {
        active: true,
        $or: [
          { status: { $in: ['QUEUED', 'RETRY_WAIT'] }, nextAt: { $lte: now } },
          { status: 'RUNNING', leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          status: 'RUNNING',
          leaseToken: token,
          leaseUntil: new Date(new Date(now).getTime() + 60000).toISOString(),
        },
        $inc: { attempts: 1 },
      },
      { sort: { nextAt: 1 }, new: true },
    );
    return d ? dto<Job>(d) : null;
  },
  async reserveProvider(_now, token) {
    return !!(await Control.findOneAndUpdate(
      {
        _id: 'codeforces',
        $expr: {
          $and: [
            { $lte: [{ $ifNull: ['$nextAllowedAt', new Date(0)] }, '$$NOW'] },
            { $lte: [{ $ifNull: ['$leaseUntil', new Date(0)] }, '$$NOW'] },
          ],
        },
      },
      [
        {
          $set: {
            token,
            leaseUntil: {
              $dateAdd: {
                startDate: '$$NOW',
                unit: 'millisecond',
                amount: 30000,
              },
            },
            nextAllowedAt: {
              $dateAdd: {
                startDate: '$$NOW',
                unit: 'millisecond',
                amount: 3000,
              },
            },
          },
        },
      ],
      { new: true },
    ));
  },
  async releaseProvider(token, until) {
    const delay = Math.max(
      3000,
      Math.min(900000, Date.parse(until) - Date.now()),
    );
    await Control.updateOne({ _id: 'codeforces', token }, [
      {
        $set: {
          nextAllowedAt: {
            $dateAdd: {
              startDate: '$$NOW',
              unit: 'millisecond',
              amount: delay,
            },
          },
          leaseUntil: new Date(0),
        },
      },
      { $unset: 'token' },
    ]);
  },
  async scheduled(now, limit) {
    return (
      await Accounts.find({
        active: true,
        status: 'VERIFIED',
        platform: 'CODEFORCES',
        nextSyncAt: { $lte: now },
      })
        .sort({ nextSyncAt: 1 })
        .limit(limit)
    ).map((d) => dto<Account>(d));
  },
};
