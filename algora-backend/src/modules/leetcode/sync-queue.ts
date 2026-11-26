import type { Types } from 'mongoose';
import { env } from '../../config/env';
import { withLease, type Lease } from '../../lib/lease';
import { availableTokens } from '../../lib/ratelimit';
import { log } from '../../lib/logger';
import { Batch, COUNTING_LINK_STATUSES, Enrollment, LeetcodeLink, LeetcodeSyncJob, User } from '../../models';
import { loadSettings } from './integration-settings';
import { choosePolicy, policy, policyForSchedule, syncStudent, type SyncOutcome, type Trigger } from './leetcode-sync.service';
import { burstOf, hasEligibleProvider, primaryUpstream, upstreamBucket } from './provider-manager';
import { upstreamBlock, getStates } from './provider-health.service';
import { autoAllowedNow, backoffSec, jitterFraction, manualEligibility, minSpacingSec, nextAutoSyncAt, reconciliationDue, type PolicyConfig } from './sync.policy';
import { cancelJobsForStudent } from './sync-jobs';

export { cancelJobsForStudent };

/** A job claim lasts this long and is renewed while the job runs. A crashed worker's job is recovered after it expires. */
export const JOB_LEASE_MS = 90_000;
/** A manual job may overtake automatic ones, but any job waiting longer than this is served first (no starvation). */
export const STARVATION_MS = 5 * 60_000;
const SUCCESS: string[] = ['SYNC_SUCCESS', 'POSSIBLE_EVIDENCE_GAP', 'NO_SUBMISSIONS_OBSERVED', 'SUBMISSIONS_UNAVAILABLE'];
const NON_RETRYABLE: string[] = ['ACCOUNT_NOT_FOUND', 'VERIFICATION_UNAVAILABLE', 'SUBMISSIONS_UNAVAILABLE'];

export interface JobView { id: string; trigger: string; status: string; enqueuedAt: Date; dueAt: Date; runAfter: Date; startedAt: Date | null; attempts: number }
const view = (j: any): JobView => ({ id: String(j._id), trigger: j.trigger, status: j.status, enqueuedAt: j.enqueuedAt, dueAt: j.dueAt, runAfter: j.runAfter, startedAt: j.startedAt ?? null, attempts: j.attempts ?? 0 });

export const activeJob = (studentId: unknown) => LeetcodeSyncJob.findOne({ studentId, status: { $in: ['QUEUED', 'RUNNING'] } }).lean();

/**
 * Queue one synchronization for a student. The partial unique index guarantees a single active job per student across tabs,
 * devices and backend instances: a concurrent duplicate gets the existing job back. A manual request upgrades an existing
 * QUEUED automatic job to MANUAL priority (and pulls its start time forward to `runAfter`) instead of adding a second one.
 */
export async function enqueueSync(
  studentId: unknown, linkId: unknown, trigger: Trigger,
  opts: { now?: Date; runAfter?: Date; dueAt?: Date; requestedBy?: unknown } = {},
): Promise<{ job: JobView; created: boolean }> {
  const now = opts.now ?? new Date();
  const runAfter = opts.runAfter ?? now;
  try {
    const doc = await LeetcodeSyncJob.create({ studentId, linkId, trigger, status: 'QUEUED', runAfter, dueAt: opts.dueAt ?? runAfter, enqueuedAt: now, requestedBy: opts.requestedBy });
    return { job: view(doc), created: true };
  } catch (e: any) {
    if (e?.code !== 11000) throw e;
    if (trigger === 'MANUAL') {
      await LeetcodeSyncJob.updateOne({ studentId, status: 'QUEUED', trigger: { $ne: 'MANUAL' } }, { $set: { trigger: 'MANUAL', requestedBy: opts.requestedBy }, $min: { runAfter } });
    }
    const existing = await activeJob(studentId);
    if (existing) return { job: view(existing), created: false };
    return enqueueSync(studentId, linkId, trigger, opts); // the other job finished in between: try once more
  }
}

export type ManualResult =
  | { kind: 'QUEUED' | 'EXISTING'; job: JobView }
  | { kind: 'COOLDOWN'; retryAfterSec: number; nextEligibleAt: Date }
  | { kind: 'UNAVAILABLE'; reason: 'DISABLED' | 'PAUSED' | 'NO_LINK' };

/**
 * Student-requested update. Goes through the SAME persistent queue and the SAME upstream budget as automatic syncs.
 * The cooldown is claimed with ONE atomic update on the user document, so two tabs or instances cannot both pass; a request
 * that finds a queued/running job returns that job and does not consume the cooldown. Reloading a page never calls this.
 */
export async function requestManualSync(studentId: string, now = new Date()): Promise<ManualResult> {
  const settings = await loadSettings();
  if (!env.LEETCODE_SYNC_ENABLED || !(await hasEligibleProvider({ ignorePause: true }))) return { kind: 'UNAVAILABLE', reason: 'DISABLED' };
  if (settings.paused) return { kind: 'UNAVAILABLE', reason: 'PAUSED' };
  const link = await LeetcodeLink.findOne({ studentId, status: { $in: [...COUNTING_LINK_STATUSES] }, isCurrent: true, consentedAt: { $type: 'date' } }, '_id').lean();
  if (!link) return { kind: 'UNAVAILABLE', reason: 'NO_LINK' };
  const pol = policy();
  const existing = await activeJob(studentId);
  if (existing) {
    if (existing.status === 'QUEUED' && existing.trigger !== 'MANUAL') {
      // The student asked: serve them at bounded manual priority, still honouring spacing and backoff.
      const u = await User.findById(studentId, 'sync').lean();
      const e = manualEligibility(u?.sync?.lastManualRequestAt, now, pol);
      if (e.eligible) {
        const claimed = await claimManualCooldown(studentId, now, pol);
        if (claimed) { const r = await enqueueSync(studentId, link._id, 'MANUAL', { now, runAfter: await spacedRunAfter(studentId, now, pol), requestedBy: studentId }); return { kind: 'EXISTING', job: r.job }; }
      }
    }
    return { kind: 'EXISTING', job: view(existing) };
  }
  const claimed = await claimManualCooldown(studentId, now, pol);
  if (!claimed) {
    // Lost a race with another tab/device/instance that has just claimed the cooldown: return ITS job once it exists.
    for (let i = 0; i < 10; i++) {
      const winner = await activeJob(studentId);
      if (winner) return { kind: 'EXISTING', job: view(winner) };
      const recent = (await User.findById(studentId, 'sync.lastManualRequestAt').lean())?.sync?.lastManualRequestAt;
      if (!recent || Math.abs(now.getTime() - recent.getTime()) > 5_000) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const u = await User.findById(studentId, 'sync').lean();
    const cooldown = manualEligibility(u?.sync?.lastManualRequestAt, now, pol);
    const backoffUntil = u?.sync?.nextEligibleAt && u.sync.nextEligibleAt > now ? u.sync.nextEligibleAt : null;
    const next = backoffUntil && (!cooldown.nextEligibleAt || backoffUntil > cooldown.nextEligibleAt) ? backoffUntil : cooldown.nextEligibleAt ?? now;
    return { kind: 'COOLDOWN', nextEligibleAt: next, retryAfterSec: Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000)) };
  }
  const { job, created } = await enqueueSync(studentId, link._id, 'MANUAL', { now, runAfter: await spacedRunAfter(studentId, now, pol), requestedBy: studentId });
  if (!created) await User.updateOne({ _id: studentId, 'sync.lastManualRequestAt': now }, claimed.prev ? { $set: { 'sync.lastManualRequestAt': claimed.prev } } : { $unset: { 'sync.lastManualRequestAt': 1 } }); // lost a race: not charged
  return { kind: created ? 'QUEUED' : 'EXISTING', job };
}

async function claimManualCooldown(studentId: string, now: Date, pol: PolicyConfig): Promise<{ prev: Date | null } | null> {
  const before = await User.findOneAndUpdate(
    {
      _id: studentId, role: 'STUDENT', status: 'ACTIVE',
      $and: [
        { $or: [{ 'sync.lastManualRequestAt': null }, { 'sync.lastManualRequestAt': { $exists: false } }, { 'sync.lastManualRequestAt': { $lte: new Date(now.getTime() - pol.studentCooldownSec * 1000) } }] },
        { $or: [{ 'sync.nextEligibleAt': null }, { 'sync.nextEligibleAt': { $exists: false } }, { 'sync.nextEligibleAt': { $lte: now } }] },
      ],
    },
    { $set: { 'sync.lastManualRequestAt': now } },
    { projection: { 'sync.lastManualRequestAt': 1 } },
  ).lean();
  return before ? { prev: before.sync?.lastManualRequestAt ?? null } : null;
}

/** Shared spacing: no attempt (any trigger) starts sooner than the minimum spacing after this student's previous attempt. */
async function spacedRunAfter(studentId: string, now: Date, pol: PolicyConfig): Promise<Date> {
  const u = await User.findById(studentId, 'sync.lastAttemptAt').lean();
  const last = u?.sync?.lastAttemptAt;
  const earliest = last ? new Date(last.getTime() + minSpacingSec(pol) * 1000) : now;
  return earliest > now ? earliest : now;
}

/**
 * Claim the next due job atomically. Order: (1) anything that has waited past STARVATION_MS, oldest first, so manual
 * priority can never starve automatic jobs; (2) manual jobs; (3) automatic and reconciliation jobs. Each step is one
 * findOneAndUpdate, so two instances can never claim the same job. Claiming bumps `fence`.
 */
export async function claimNextJob(now = new Date()) {
  // Cheap read first: an idle worker polling every few seconds must not issue write commands that match nothing.
  if (!(await LeetcodeSyncJob.exists({ status: 'QUEUED', runAfter: { $lte: now } }))) return null;
  const base = { status: 'QUEUED', runAfter: { $lte: now } };
  const set = { $set: { status: 'RUNNING', startedAt: now, leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS) }, $inc: { fence: 1 } };
  const steps = [
    { ...base, dueAt: { $lte: new Date(now.getTime() - STARVATION_MS) } },
    { ...base, trigger: 'MANUAL' },
    base,
  ];
  for (const q of steps) {
    const job = await LeetcodeSyncJob.findOneAndUpdate(q, set, { sort: { dueAt: 1, _id: 1 }, returnDocument: 'after' }).lean();
    if (job) return job;
  }
  return null;
}

/** Finish a job. Fenced: a worker whose job was recovered, re-claimed or cancelled changes nothing. */
export async function completeJob(job: { _id: unknown; fence?: number | null }, outcome: SyncOutcome, now = new Date()): Promise<'SUCCEEDED' | 'REQUEUED' | 'FAILED' | 'IGNORED'> {
  const fenced = { _id: job._id, fence: job.fence, status: 'RUNNING' };
  const result = { status: outcome.status, newlyVerified: outcome.newlyVerified, possibleGap: outcome.possibleGap, message: outcome.message?.slice(0, 200) };
  if (SUCCESS.includes(outcome.status)) {
    const r = await LeetcodeSyncJob.updateOne(fenced, { $set: { status: 'SUCCEEDED', finishedAt: now, result }, $unset: { leaseExpiresAt: 1 } });
    return r.modifiedCount ? 'SUCCEEDED' : 'IGNORED';
  }
  const cur = await LeetcodeSyncJob.findOne(fenced, 'attempts maxAttempts').lean();
  if (!cur) return 'IGNORED';
  const retryable = !NON_RETRYABLE.includes(outcome.status);
  const counts = !outcome.deferred; // budget / pause / busy deferrals are not failures and do not use attempts
  const attempts = (cur.attempts ?? 0) + (counts ? 1 : 0);
  if (!retryable || attempts >= (cur.maxAttempts ?? 4)) {
    const r = await LeetcodeSyncJob.updateOne(fenced, { $set: { status: 'FAILED', finishedAt: now, attempts, result: { ...result, error: outcome.status } }, $unset: { leaseExpiresAt: 1 } });
    return r.modifiedCount ? 'FAILED' : 'IGNORED';
  }
  const waitSec = outcome.retryAfterSec ?? backoffSec(attempts, Math.random());
  const r = await LeetcodeSyncJob.updateOne(fenced, { $set: { status: 'QUEUED', attempts, runAfter: new Date(now.getTime() + Math.min(waitSec, 3600) * 1000), result: { ...result, error: outcome.status } }, $unset: { leaseExpiresAt: 1, startedAt: 1 } });
  return r.modifiedCount ? 'REQUEUED' : 'IGNORED';
}

/** Run one claimed job: sync the student, renewing the job lease, then complete it. Never throws. */
export async function runJob(job: any, now = () => new Date()): Promise<SyncOutcome | null> {
  const renew = setInterval(() => { void LeetcodeSyncJob.updateOne({ _id: job._id, fence: job.fence, status: 'RUNNING' }, { $set: { leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS) } }).catch(() => {}); }, JOB_LEASE_MS / 3);
  renew.unref();
  try {
    const o = await syncStudent(String(job.studentId), job.trigger, undefined, now, { linkId: job.linkId ? String(job.linkId) : undefined });
    await completeJob(job, o, now());
    return o;
  } catch (e) {
    log.error('sync job failed', { error: e, studentId: String(job.studentId) });
    await completeJob(job, { status: 'SYNC_FAILED', newlyVerified: 0, possibleGap: false }, now()).catch(() => {});
    return null;
  } finally { clearInterval(renew); }
}

/** Crash recovery: RUNNING jobs whose lease expired go back to the queue (or fail once attempts are used up). */
export async function recoverExpiredJobs(now = new Date()): Promise<number> {
  const expired = await LeetcodeSyncJob.find({ status: 'RUNNING', leaseExpiresAt: { $lt: now } }, '_id fence attempts maxAttempts').lean();
  let n = 0;
  for (const j of expired) {
    const attempts = (j.attempts ?? 0) + 1;
    const exhausted = attempts >= (j.maxAttempts ?? 4);
    const r = await LeetcodeSyncJob.updateOne({ _id: j._id, fence: j.fence, status: 'RUNNING' },
      exhausted ? { $set: { status: 'FAILED', finishedAt: now, attempts, result: { error: 'WORKER_LOST' } } } : { $set: { status: 'QUEUED', attempts, runAfter: now }, $unset: { leaseExpiresAt: 1, startedAt: 1 } });
    n += r.modifiedCount;
  }
  return n;
}

/** Outdated queued jobs are cancelled, not run: the scheduler re-queues whoever is still due. Prevents a stale backlog. */
export async function cancelStaleJobs(now = new Date(), maxAgeMin = Math.max(60, policy().autoIntervalMin * 2)): Promise<number> {
  const r = await LeetcodeSyncJob.updateMany({ status: 'QUEUED', enqueuedAt: { $lt: new Date(now.getTime() - maxAgeMin * 60_000) } }, { $set: { status: 'CANCELLED', cancelReason: 'STALE', finishedAt: now } });
  return r.modifiedCount;
}

/**
 * Students who are eligible for automatic sync, each with the calendars of their ACTIVE batches. A student enrolled in many
 * batches or courses appears ONCE, so one profile request updates every assigned problem.
 */
export async function eligibleStudents() {
  const batches = await Batch.find({ status: 'ACTIVE' }, '_id leetcodeSchedule').lean();
  const byBatch = new Map(batches.map((b) => [String(b._id), b.leetcodeSchedule && Object.keys(b.leetcodeSchedule).length ? policyForSchedule(b.leetcodeSchedule) : policy()]));
  const enrollments = await Enrollment.find({ batchId: { $in: batches.map((b) => b._id) }, status: 'ACTIVE' }, 'studentId batchId').lean();
  const policies = new Map<string, PolicyConfig[]>();
  for (const e of enrollments) {
    const list = policies.get(String(e.studentId)) ?? [];
    const p = byBatch.get(String(e.batchId));
    if (p && !list.includes(p)) list.push(p);
    policies.set(String(e.studentId), list);
  }
  const ids = [...policies.keys()];
  const links = await LeetcodeLink.find({ studentId: { $in: ids }, status: { $in: [...COUNTING_LINK_STATUSES] }, isCurrent: true, consentedAt: { $type: 'date' } }, 'studentId').lean();
  const linkOf = new Map(links.map((l) => [String(l.studentId), l._id as Types.ObjectId]));
  const users = await User.find({ _id: { $in: [...linkOf.keys()] }, role: 'STUDENT', status: 'ACTIVE' }, 'sync').lean();
  return users.map((u) => ({ user: u, linkId: linkOf.get(String(u._id))!, policies: policies.get(String(u._id)) ?? [policy()] }));
}

export interface TickResult { skipped?: string; eligible?: number; enqueued?: number; recovered?: number; cancelled?: number }

/**
 * One scheduler pass, under a distributed lease so only one instance enqueues at a time. It enqueues each due student once
 * (never an uncontrolled backlog: one active job per student, outdated jobs cancelled) and does NOT send any request itself:
 * workers drain the queue at the shared request budget. Due time is the student's nextAutoSyncAt (30 min after the last
 * SUCCESS), so manual successes push it out and failures do not.
 */
export async function schedulerTick(now = new Date()): Promise<TickResult> {
  const s = await loadSettings();
  if (!env.LEETCODE_SYNC_ENABLED || s.paused || !(await hasEligibleProvider())) return { skipped: s.paused ? 'PAUSED' : 'DISABLED' };
  const res = await withLease('leetcode-scheduler', 60_000, async (_l: Lease) => {
    const recovered = await recoverExpiredJobs(now);
    const cancelled = await cancelStaleJobs(now);
    const up = (await primaryUpstream()) ?? 'leetcode-graphql';
    if (upstreamBlock(await getStates(), up)) return { skipped: 'UPSTREAM_BLOCKED', recovered, cancelled };
    const all = await eligibleStudents();
    const active = new Set((await LeetcodeSyncJob.find({ status: { $in: ['QUEUED', 'RUNNING'] } }, 'studentId').lean()).map((j) => String(j.studentId)));
    const docs: Record<string, unknown>[] = [];
    for (const { user, linkId, policies } of all) {
      const id = String(user._id);
      if (active.has(id)) continue;
      const pol = choosePolicy(policies, now);
      const sync = user.sync;
      if (sync?.nextEligibleAt && sync.nextEligibleAt > now) continue; // retry/backoff window
      const lastAttempt = sync?.lastAttemptAt;
      if (lastAttempt && now.getTime() - lastAttempt.getTime() < minSpacingSec(pol) * 1000) continue; // shared spacing with manual
      if (lastAttempt && (sync?.consecutiveFailures ?? 0) > 0 && now.getTime() - lastAttempt.getTime() < backoffSec(sync!.consecutiveFailures!, jitterFraction(id)) * 1000) continue; // failed syncs back off, never retry at once
      const recon = reconciliationDue(now, pol, sync?.reconciledForTermEnd);
      let trigger: Trigger | null = null; let due: Date | null = null;
      if (recon) { trigger = 'RECONCILIATION'; due = recon; }
      else if (autoAllowedNow(now, pol)) {
        due = sync?.nextAutoSyncAt ?? nextAutoSyncAt(id, sync?.lastSuccessAt, now, pol);
        if (due && due <= now) trigger = 'SCHEDULE';
      }
      if (!trigger || !due) continue;
      docs.push({ studentId: user._id, linkId, trigger, status: 'QUEUED', runAfter: now, dueAt: due, enqueuedAt: now });
    }
    let enqueued = 0;
    if (docs.length) {
      try { await LeetcodeSyncJob.insertMany(docs, { ordered: false }); enqueued = docs.length; }
      catch (e: any) { // a duplicate (a manual request won the race) is expected, not an error
        if (e?.code !== 11000 && !e?.writeErrors) throw e;
        enqueued = e.insertedDocs?.length ?? docs.length - (e.writeErrors?.length ?? 0);
      }
    }
    return { eligible: all.length, enqueued, recovered, cancelled };
  });
  return res ?? { skipped: 'LEASE_HELD' };
}

/**
 * Worker step: claim and run jobs while there is concurrency and shared request budget. Budget is checked before claiming so
 * nothing is claimed that could not send; the real token is taken inside the provider manager for every upstream request.
 * Returns how many jobs it started.
 */
export async function workerStep(inFlight: Set<Promise<unknown>>, now = () => new Date()): Promise<number> {
  const s = await loadSettings();
  if (!env.LEETCODE_SYNC_ENABLED || s.paused || !(await hasEligibleProvider())) return 0;
  if (!(await LeetcodeSyncJob.exists({ status: 'QUEUED', runAfter: { $lte: now() } }))) return 0; // nothing due: no further queries
  const up = (await primaryUpstream()) ?? 'leetcode-graphql';
  if (upstreamBlock(await getStates(), up)) return 0;
  let started = 0;
  while (inFlight.size < s.concurrency) {
    if ((await LeetcodeSyncJob.countDocuments({ status: 'RUNNING' })) >= s.concurrency) break; // concurrency is global, not per instance
    if ((await availableTokens(upstreamBucket(up), s.ratePerMin, burstOf(s.ratePerMin))) < 1) break;
    const job = await claimNextJob(now());
    if (!job) break;
    const p: Promise<unknown> = runJob(job, now).finally(() => inFlight.delete(p));
    inFlight.add(p);
    started++;
  }
  return started;
}

/** Test and simulation helper: drain until nothing more can start right now. */
export async function drainOnce(now = () => new Date()) {
  const inFlight = new Set<Promise<unknown>>();
  let total = 0, n = 0;
  do { n = await workerStep(inFlight, now); total += n; await Promise.all([...inFlight]); } while (n > 0);
  return total;
}
