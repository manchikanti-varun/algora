import { notFound, forbidden } from '../lib/errors';
import { Batch, TrainerBatchAssignment, type UserDoc } from '../models';

export const canManageCourses = (u: UserDoc) => u.role === 'SUPER_ADMIN' || (u.role === 'TRAINER' && !!u.canManageCourses);

export async function trainerBatchIds(u: UserDoc) {
  const rows = await TrainerBatchAssignment.find({ trainerId: u._id, status: 'ACTIVE' }, 'batchId').lean();
  return rows.map((r) => r.batchId);
}

/**
 * Resource-level authorization. Unauthorised and missing batches are indistinguishable (404) to avoid IDOR probing.
 */
export async function loadBatchFor(u: UserDoc, batchId: string, opts: { writable?: boolean } = {}) {
  const batch = await Batch.findById(batchId);
  if (!batch) throw notFound('Batch not found');
  if (u.role !== 'SUPER_ADMIN') {
    const ok = u.role === 'TRAINER' && (await TrainerBatchAssignment.exists({ trainerId: u._id, batchId, status: 'ACTIVE' }));
    if (!ok) throw notFound('Batch not found');
  }
  if (opts.writable && batch.status === 'ARCHIVED') throw forbidden('Batch is archived', 'BATCH_ARCHIVED');
  return batch;
}
