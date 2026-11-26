import { maybeTransaction } from '../../lib/lease';
import { lockRolls } from './roll-lock';
import type { Types } from 'mongoose';
import { randomToken, sha256 } from '../../lib/normalize';
import { Enrollment, PendingEnrollment, User } from '../../models';

export type EnrollOutcome =
  | { rollNumber: string; result: 'ENROLLED' | 'ALREADY_ENROLLED' | 'REACTIVATED' }
  | { rollNumber: string; result: 'PENDING'; claimCode: string };

/**
 * Enroll by roll number. Registered student -> enrollment (idempotent, reactivates removed ones).
 * Unknown roll number -> pending enrollment with a one-time claim code (code is only ever returned here;
 * calling again rotates it). Never matches on roll number alone at registration time.
 */
export async function enrollByRoll(batchId: Types.ObjectId, rollNumber: string, actorId: Types.ObjectId, email?: string): Promise<EnrollOutcome> {
  return maybeTransaction(async (session) => {
    await lockRolls([rollNumber], session);
    const student = await User.findOne({ role: 'STUDENT', rollNumber, status: { $ne: 'REVOKED' } }, '_id').session(session ?? null).lean();
    if (student) {
      const r = await Enrollment.updateOne(
        { studentId: student._id, batchId },
        { $setOnInsert: { enrolledAt: new Date(), enrolledBy: actorId, status: 'ACTIVE' } },
        { upsert: true, session },
      );
      if (r.upsertedCount) return { rollNumber, result: 'ENROLLED' };
      const re = await Enrollment.updateOne({ studentId: student._id, batchId, status: 'REMOVED' }, { $set: { status: 'ACTIVE', enrolledAt: new Date(), enrolledBy: actorId }, $unset: { removedAt: 1 } }, { session });
      return { rollNumber, result: re.modifiedCount ? 'REACTIVATED' : 'ALREADY_ENROLLED' };
    }
    const claimCode = randomToken(9);
    await PendingEnrollment.updateOne(
      { batchId, rollNumber, status: 'PENDING' },
      { $set: { claimCodeHash: sha256(claimCode), email: email?.toLowerCase() || undefined, createdBy: actorId } },
      { upsert: true, session },
    );
    return { rollNumber, result: 'PENDING', claimCode };
  });
}
