import crypto from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { JobLease } from '../models';

/**
 * MongoDB-backed distributed lease with fencing. Time comparisons use the DATABASE clock ($$NOW), so instance clock skew
 * cannot extend or shorten a lease. An explicit `now` may be passed for deterministic tests only.
 */
export interface Lease {
  key: string;
  owner: string;
  /** Monotonic fencing token. Increases on every acquisition of this key. */
  fence: number;
  /** Set when a renewal fails. Workers must stop. */
  lost: boolean;
}

export class LeaseLostError extends Error {
  constructor() { super('Lease lost'); }
}

const nowExpr = (now?: Date) => (now ? now : '$$NOW');

/** Atomically take the lease if absent or expired. Returns null when another owner holds a valid lease. */
export async function acquireLease(key: string, ttlMs: number, now?: Date): Promise<Lease | null> {
  const owner = crypto.randomUUID();
  const n = nowExpr(now);
  // $expr is not allowed in an upsert predicate, so make sure the document exists first (idempotent, expired by default)...
  try {
    await JobLease.updateOne({ _id: key }, { $setOnInsert: { owner: '', fence: 0, expiresAt: new Date(0) } }, { upsert: true });
  } catch (e: any) { if (e?.code !== 11000) throw e; }
  // ...then take it with ONE atomic conditional update. Exactly one concurrent caller can match an expired lease.
  const doc = await JobLease.findOneAndUpdate(
    { _id: key, $expr: { $lte: ['$expiresAt', n] } } as Record<string, unknown>,
    [{ $set: { owner, fence: { $add: [{ $ifNull: ['$fence', 0] }, 1] }, expiresAt: { $add: [n, ttlMs] } } }],
    { returnDocument: 'after', updatePipeline: true },
  ).lean();
  return doc && doc.owner === owner ? { key, owner, fence: doc.fence, lost: false } : null;
}

const liveFilter = (l: Lease, now?: Date) => ({ _id: l.key, owner: l.owner, fence: l.fence, $expr: { $gt: ['$expiresAt', nowExpr(now)] } }) as Record<string, unknown>;

/** Extend the lease. Returns false (and marks the lease lost) if it expired or was taken over. */
export async function renewLease(l: Lease, ttlMs: number, now?: Date): Promise<boolean> {
  const r = await JobLease.updateOne(liveFilter(l, now), [{ $set: { expiresAt: { $add: [nowExpr(now), ttlMs] } } }], { updatePipeline: true });
  if (r.modifiedCount !== 1) l.lost = true;
  return r.modifiedCount === 1;
}

export async function releaseLease(l: Lease): Promise<void> {
  await JobLease.updateOne({ _id: l.key, owner: l.owner, fence: l.fence }, { $set: { expiresAt: new Date(0) } });
}

/** Throws LeaseLostError when this worker no longer owns a live lease. */
export async function assertLease(l: Lease, now?: Date): Promise<void> {
  if (l.lost) throw new LeaseLostError();
  if (!(await JobLease.exists(liveFilter(l, now)))) { l.lost = true; throw new LeaseLostError(); }
}

/** Runs `work` while renewing at ttl/3. Renewal failure sets `lease.lost`; workers must check it. Returns null if not acquired. */
export async function withLease<T>(key: string, ttlMs: number, work: (l: Lease) => Promise<T>): Promise<T | null> {
  const lease = await acquireLease(key, ttlMs);
  if (!lease) return null;
  const timer = setInterval(() => void renewLease(lease, ttlMs).catch(() => { lease.lost = true; }), Math.max(1000, ttlMs / 3));
  try {
    return await work(lease);
  } finally {
    clearInterval(timer);
    await releaseLease(lease).catch(() => {});
  }
}

let txSupport: boolean | null = null;
/** True when MongoDB supports multi-document transactions (replica set / Atlas). */
export async function supportsTransactions(): Promise<boolean> {
  if (txSupport !== null) return txSupport;
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    txSupport = !!hello.setName || hello.msg === 'isdbgrid';
  } catch { txSupport = false; }
  return txSupport;
}
export const resetTxSupportCache = () => { txSupport = null; };

/**
 * Fenced write. Inside ONE transaction: (1) write the lease document only if we still own a live lease (this write
 * conflicts with any concurrent takeover, so exactly one side wins), then (2) run `fn`. A worker whose lease expired
 * or was taken over aborts with LeaseLostError and none of its writes land, including inserts of new evidence.
 *
 * Without transactions (standalone dev MongoDB only) it falls back to a best-effort pre-check. Production refuses to
 * enable synchronization on such a deployment (see server.ts).
 */
export async function withFencedWrite<T>(l: Lease, fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!(await supportsTransactions())) {
    await assertLease(l);
    return fn(undefined);
  }
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const r = await JobLease.updateOne(liveFilter(l), { $set: { lastWriteAt: new Date() } }, { session });
      if (r.matchedCount !== 1) { l.lost = true; throw new LeaseLostError(); }
      return fn(session);
    }) as T;
  } finally {
    await session.endSession();
  }
}

/** Run in a transaction when supported, otherwise directly. For multi-document invariants outside leases. */
export async function maybeTransaction<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!(await supportsTransactions())) return fn(undefined);
  const session = await mongoose.startSession();
  try { return (await session.withTransaction(() => fn(session))) as T; } finally { await session.endSession(); }
}
