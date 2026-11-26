import type { ClientSession } from 'mongoose';
import { RollLock } from '../../models';

/** Call within the same transaction as the user or reservation mutation. */
export async function lockRolls(rolls: string[], session?: ClientSession) {
  if (!session) return;
  for (const roll of [...new Set(rolls)].sort()) {
    await RollLock.updateOne({ _id: roll }, { $inc: { revision: 1 } }, { upsert: true, session });
  }
}
