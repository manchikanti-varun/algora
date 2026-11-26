import type { ClientSession } from 'mongoose';
import { LeetcodeSyncJob } from '../../models';
/**
 * Cancel a student's queued or running synchronization (account changed or unlinked, student suspended). Kept in its own
 * module so account linking can call it without importing the scheduler. A RUNNING job stops writing: its completion is
 * fenced by status, and the sync service re-checks that the link is still current inside every write transaction.
 */
export async function cancelJobsForStudent(studentId: unknown, reason: string, session?: ClientSession | null): Promise<number> {
  const r = await LeetcodeSyncJob.updateMany(
    { studentId, status: { $in: ['QUEUED', 'RUNNING'] } },
    { $set: { status: 'CANCELLED', cancelReason: reason, finishedAt: new Date() } },
    session ? { session } : {},
  );
  return r.modifiedCount;
}
