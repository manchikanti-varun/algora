import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { User } from '../models/user.js';
import { College } from '../models/college.js';
import { StudentProfile } from '../models/student-profile.js';
import { Course, Batch } from '../models/learning.js';
import { AuditLog } from '../models/audit-log.js';
import {
  learningStorageReady,
  MongoLearningUnit,
  mongoLearningRepository,
} from './repository.js';
import { LearningService } from './service.js';
import { reconciliationPending } from './markers.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errors.js';
interface Marker {
  reconciliationToken: string;
  enrollmentReconciliationPending: boolean;
  reconciliationCursor: string;
  reconciliationAttempts: number;
  reconciliationNextAt: Date;
  reconciliationError: string;
}
const models = {
  USER: User,
  PROFILE: StudentProfile,
  COLLEGE: College,
  COURSE: Course,
  BATCH: Batch,
} as unknown as Record<
  'USER' | 'PROFILE' | 'COLLEGE' | 'COURSE' | 'BATCH',
  mongoose.Model<Marker>
>;
export async function runReconciliationPass() {
  if (!learningStorageReady()) return;
  const service = new LearningService(mongoLearningRepository);
  for (const [kind, model] of Object.entries(models)) {
    const job = await model
      .findOne({
        enrollmentReconciliationPending: true,
        reconciliationAttempts: { $lt: 8 },
        reconciliationNextAt: { $lte: new Date() },
      })
      .select('_id reconciliationToken')
      .lean();
    if (!job) continue;
    try {
      await mongoose.connection.transaction(
        async (session) => {
          const current = await model.findById(job._id).session(session).lean();
          if (!current?.enrollmentReconciliationPending) return;
          const tx = new MongoLearningUnit(session),
            rows = await tx.reconciliationRows(
              kind,
              String(job._id),
              current.reconciliationCursor ?? '',
            );
          await service.reconcileRows(tx, rows, 'reconcile-' + randomUUID());
          await model.updateOne(
            { _id: job._id },
            {
              $set: {
                enrollmentReconciliationPending: rows.length === 50,
                reconciliationCursor: rows.length === 50 ? rows.at(-1)!.id : '',
                reconciliationAttempts: 0,
                reconciliationNextAt: new Date(0),
                reconciliationError: '',
              },
            },
            { session },
          );
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch {
      const existing = await model
        .findById(job._id)
        .select('reconciliationAttempts')
        .lean();
      const attempts = (existing?.reconciliationAttempts ?? 0) + 1;
      await model.updateOne(
        { _id: job._id, reconciliationToken: job.reconciliationToken },
        {
          $set: {
            reconciliationAttempts: attempts,
            reconciliationError:
              'Reconciliation failed; administrative retry or database repair required',
            reconciliationNextAt: new Date(
              Date.now() + Math.min(300000, 5000 * 2 ** Math.min(attempts, 6)),
            ),
          },
        },
      );
      logger.warn({ kind, attempts }, 'Enrollment reconciliation deferred');
    }
  }
}
export function startReconciliationWorker() {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runReconciliationPass()
      .catch(() => logger.warn('Reconciliation pass unavailable'))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
export async function reconciliationStatus() {
  const queues = [];
  for (const [kind, model] of Object.entries(models)) {
    const pending = await model.countDocuments({
        enrollmentReconciliationPending: true,
      }),
      failed = await model
        .find({
          enrollmentReconciliationPending: true,
          reconciliationAttempts: { $gte: 8 },
        })
        .select('_id reconciliationAttempts reconciliationError')
        .limit(20)
        .lean();
    queues.push({
      kind,
      pending,
      failed: failed.map((d) => ({
        targetId: String(d._id),
        attempts: d.reconciliationAttempts,
        message: d.reconciliationError,
      })),
    });
  }
  return { queues };
}
export async function retryReconciliation(
  kind: keyof typeof models,
  targetId: string,
  actorUserId: string,
  requestId: string,
) {
  await mongoose.connection.transaction(
    async (session) => {
      const actor = await User.findById(actorUserId).session(session);
      if (
        !actor ||
        actor.role !== 'SUPER_ADMIN' ||
        actor.accountStatus !== 'ACTIVE' ||
        !actor.emailVerified
      )
        throw new AppError(
          403,
          'FORBIDDEN',
          'Active Super Admin access required',
        );
      await User.updateOne(
        { _id: actorUserId, sessionVersion: actor.sessionVersion },
        { $inc: { administrativeRevision: 1 } },
        { session },
      );
      const result = await models[kind].updateOne(
        { _id: targetId },
        { $set: reconciliationPending() },
        { session },
      );
      if (!result.matchedCount)
        throw new AppError(404, 'NOT_FOUND', 'Reconciliation source not found');
      await AuditLog.create(
        [
          {
            actorUserId,
            actorName: actor?.displayName ?? 'Super Admin',
            action: 'ENROLLMENT_RECONCILIATION_RETRIED',
            targetType: 'RECONCILIATION',
            targetId,
            metadata: { after: kind },
            requestId,
          },
        ],
        { session },
      );
    },
    { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
  );
  return { queued: true };
}
