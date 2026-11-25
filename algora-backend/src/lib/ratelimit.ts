import { RateBucket } from '../models';

/**
 * Global token bucket stored in MongoDB so the limit holds across every backend instance.
 * One atomic pipeline update refills by elapsed DB time, then takes a token only if one is available.
 */
export async function takeToken(key: string, perMin: number, burst: number): Promise<boolean> {
  const doc = await RateBucket.findOneAndUpdate(
    { _id: key },
    [
      { $set: { tokens: { $ifNull: ['$tokens', burst] }, ts: { $ifNull: ['$ts', '$$NOW'] } } },
      { $set: { refilled: { $min: [burst, { $add: ['$tokens', { $multiply: [{ $divide: [{ $subtract: ['$$NOW', '$ts'] }, 60_000] }, perMin] }] }] } } },
      { $set: { granted: { $gte: ['$refilled', 1] }, tokens: { $cond: [{ $gte: ['$refilled', 1] }, { $subtract: ['$refilled', 1] }, '$refilled'] }, ts: '$$NOW' } },
      { $unset: 'refilled' },
    ],
    { upsert: true, returnDocument: 'after', updatePipeline: true },
  ).lean<{ granted: boolean }>();
  return !!doc?.granted;
}

/** Approximate tokens available now (read-only, for budgeting a scheduler pass). */
export async function availableTokens(key: string, perMin: number, burst: number): Promise<number> {
  const d = await RateBucket.findById(key).lean<{ tokens: number; ts: Date }>();
  if (!d) return burst;
  return Math.floor(Math.min(burst, d.tokens + ((Date.now() - d.ts.getTime()) / 60_000) * perMin));
}

/** Give back a token taken for a request that was never sent (e.g. a later budget check failed). */
export async function refundToken(key: string, burst: number): Promise<void> {
  await RateBucket.updateOne({ _id: key }, [{ $set: { tokens: { $min: [burst, { $add: [{ $ifNull: ['$tokens', 0] }, 1] }] } } }], { updatePipeline: true });
}
