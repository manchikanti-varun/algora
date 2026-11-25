import type { Types } from 'mongoose';
import { env } from '../../config/env';
import { acquireLease, assertLease, LeaseLostError, releaseLease, withFencedWrite, withLease, type Lease } from '../../lib/lease';
import { availableTokens } from '../../lib/ratelimit';
import { Batch, Enrollment, LeetcodeLink, LeetcodeSyncLog, User } from '../../models';
import { clearBoardCache } from '../progress/progress.service';
import { recordObservations } from './evidence.repository';
import { loadSettings, snapshot } from './integration-settings';
import type { SyncState } from './leetcode.types';
import { fetchAccepted, hasEligibleProvider, primaryUpstream, upstreamBucket } from './provider-manager';
import { setProvidersForTests } from './providers/provider.registry';
import type { SubmissionProvider } from './providers/provider.interface';
import { backoffSec, cooldownRemainingSec, defaultPolicy, parseHours, selectDue, type PolicyConfig } from './sync.policy';

export const WINDOW = 20;
const STUDENT_LEASE_MS = 90_000;
export const STALE_SYNCING_MS = 2 * 60_000;

/** Effective schedule: environment bootcamp calendar + admin-adjustable intervals and cooldown. */
export const policy = (): PolicyConfig => {
  const s = snapshot();
  return defaultPolicy({
    tzOffsetMin: env.LEETCODE_TZ_OFFSET_MIN, hours: parseHours(env.LEETCODE_BOOTCAMP_HOURS), days: env.LEETCODE_BOOTCAMP_DAYS.split(',').map(Number),
    studentCooldownSec: s.studentCooldownSec, activeIntervalMin: s.activeIntervalMin, idleIntervalMin: s.idleIntervalMin, offHoursIntervalMin: s.offHoursIntervalMin,
  });
};

const inFlight = new Map<string, Promise<SyncOutcome>>();
export interface SyncOutcome { status: SyncState; message?: string; newlyVerified: number; possibleGap: boolean; retryAfterSec?: number; provider?: string; failedOver?: boolean; coverage?: 'FULL' | 'REDUCED' }
type Trigger = 'SCHEDULE' | 'MANUAL' | 'TAB_RETURN';
/** Tests may pass providers directly; production always uses the registry. */
type ProviderArg = SubmissionProvider | SubmissionProvider[] | null | undefined;
const useProviders = (p: ProviderArg) => { if (p !== undefined) setProvidersForTests(p === null ? [] : p); };

async function setState(id: Types.ObjectId | string, patch: Record<string, unknown>) {
  await User.updateOne({ _id: id }, { $set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`sync.${k}`, v])) });
}
const out = (status: SyncState, message: string | undefined, extra: Partial<SyncOutcome> = {}): SyncOutcome => ({ status, message, newlyVerified: 0, possibleGap: false, ...extra });

/**
 * Sync one student through the provider manager (one eligible provider, failover for provider-specific failures only).
 * Manual and scheduled syncs take the SAME per-student lease and write through a fenced transaction. In-process duplicates
 * share one promise. Failures never touch evidence; previously verified progress stays visible.
 */
export function syncStudent(studentId: string, trigger: Trigger, providers?: ProviderArg, now = () => new Date()): Promise<SyncOutcome> {
  useProviders(providers);
  const existing = inFlight.get(studentId);
  if (existing) return existing;
  const p = doSync(studentId, trigger, now).finally(() => inFlight.delete(studentId));
  inFlight.set(studentId, p);
  return p;
}

async function doSync(studentId: string, trigger: Trigger, now: () => Date): Promise<SyncOutcome> {
  const user = await User.findById(studentId).lean();
  if (!user || user.role !== 'STUDENT' || user.status !== 'ACTIVE') return out('SYNC_FAILED', 'Student not found');
  const gap = !!user.sync?.possibleGap;
  const unavailable = async (message: string) => { await setState(studentId, { status: 'VERIFICATION_UNAVAILABLE', lastError: message }); return out('VERIFICATION_UNAVAILABLE', message); };
  const settings = await loadSettings();
  if (!env.LEETCODE_SYNC_ENABLED) return unavailable('Automatic verification is not enabled yet');
  if (settings.paused) { await setState(studentId, { status: 'SYNC_PAUSED' }); return out('SYNC_PAUSED', 'Synchronization is paused by the administrator', { possibleGap: gap }); }
  if (!(await hasEligibleProvider())) return unavailable('Automatic verification is not enabled yet');
  const link = await LeetcodeLink.findOne({ studentId, status: 'VERIFIED', consentedAt: { $exists: true } }).lean();
  if (!link) return unavailable('Link and verify your LeetCode account first');

  const lease = await acquireLease(`leetcode-student:${studentId}`, STUDENT_LEASE_MS);
  if (!lease) return out('SYNCING', 'A synchronization for this student is already running', { possibleGap: gap });
  const startedAt = now();
  const logBase = { runId: `student-${studentId}-${startedAt.getTime()}`, kind: 'STUDENT' as const, studentId, trigger: trigger === 'SCHEDULE' ? 'SCHEDULE' as const : 'MANUAL' as const, fence: lease.fence };
  try {
    await setState(studentId, { status: 'SYNCING', lastAttemptAt: startedAt });
    const r = await fetchAccepted(link.username, WINDOW, studentId);
    if (!r.ok) {
      const retry = r.retryAfterSec;
      const failures = (user.sync?.consecutiveFailures ?? 0) + 1;
      let status: SyncState; let message: string; let wait: number | undefined;
      switch (r.reason) {
        case 'PAUSED': status = 'SYNC_PAUSED'; message = 'Synchronization is paused by the administrator'; break;
        case 'NO_ELIGIBLE_PROVIDER': status = 'VERIFICATION_UNAVAILABLE'; message = 'Automatic verification is not enabled yet'; break;
        case 'GLOBAL_RATE_LIMITED': status = 'RATE_LIMITED'; message = 'Too many requests right now, try again shortly'; break;
        case 'NOT_FOUND': status = 'VERIFICATION_UNAVAILABLE'; message = 'LeetCode username not found. Check your profile.'; wait = 3600; break;
        case 'UPSTREAM_BLOCKED':
          status = r.error?.kind === 'UPSTREAM_RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE';
          message = r.error?.kind === 'UPSTREAM_ACCESS_DENIED' ? 'LeetCode is restricting access. Synchronization is paused until it clears.' : 'LeetCode is temporarily unavailable. Your verified progress is unchanged.';
          wait = retry; break;
        default: status = 'PROVIDER_UNAVAILABLE'; message = 'Synchronization is temporarily unavailable. Your verified progress is unchanged.'; wait = retry ?? backoffSec(failures, Math.random());
      }
      const countsAsFailure = r.reason === 'ALL_FAILED' || r.reason === 'PROVIDERS_UNAVAILABLE' || r.reason === 'NOT_FOUND';
      await setState(studentId, { status, lastError: r.error?.kind ?? r.reason, ...(countsAsFailure ? { consecutiveFailures: failures } : {}), ...(wait ? { nextEligibleAt: new Date(now().getTime() + wait * 1000) } : {}) });
      if (r.attempts.length) await LeetcodeSyncLog.create({ ...logBase, status: 'FAILED', finishedAt: now(), error: `${r.reason}${r.error ? `:${r.error.kind}` : ''}`, counts: { attempts: r.attempts.length } });
      return out(status, message, { retryAfterSec: wait ?? retry, possibleGap: gap });
    }
    const res = r.value;
    const provider = r.provider;
    const prevSuccess = user.sync?.lastSuccessAt ?? null;
    const full = res.rawCount >= res.limit;
    const possibleGap = !!prevSuccess && full && (res.oldestRawAt === null || res.oldestRawAt > prevSuccess);
    const coverage: 'FULL' | 'REDUCED' = res.acceptedOnly ? 'FULL' : 'REDUCED';
    const source = provider.transportKind === 'mock' || provider.id === 'mock' ? 'MOCK_DEV' : 'AUTOMATED_PROVIDER';
    const newly = await withFencedWrite(lease, async (session) => {
      // The link must still be the established one at commit time (it may have changed while we waited on the provider).
      if (!(await LeetcodeLink.exists({ _id: link._id, status: 'VERIFIED' }).session(session ?? null))) throw new LinkChangedError();
      const n = await recordObservations({ studentId, linkId: link._id, username: link.username }, res.submissions, { source, provider: provider.id, futureTimestamps: res.stats?.futureTimestamps }, now(), session);
      await User.updateOne({ _id: studentId }, { $set: { 'sync.status': 'SYNC_SUCCESS', 'sync.lastSuccessAt': now(), 'sync.consecutiveFailures': 0, 'sync.possibleGap': possibleGap, 'sync.lastProvider': provider.id, 'sync.coverage': coverage }, $unset: { 'sync.lastError': 1, 'sync.nextEligibleAt': 1 } }, { session });
      await LeetcodeSyncLog.create([{ ...logBase, status: possibleGap ? 'PARTIAL' : 'SUCCESS', finishedAt: now(), provider: provider.id, counts: { fetched: res.rawCount, newlyVerified: n, attempts: r.attempts.length } }], { session });
      return n;
    });
    if (newly > 0) clearBoardCache();
    return { status: 'SYNC_SUCCESS', newlyVerified: newly, possibleGap, provider: provider.id, failedOver: r.failedOver, coverage };
  } catch (e) {
    if (e instanceof LeaseLostError) return out('SYNC_FAILED', 'Synchronization was taken over by another worker; nothing was saved');
    if (e instanceof LinkChangedError) return unavailable('Your LeetCode account link changed. Verify the new account to continue.');
    await setState(studentId, { status: 'SYNC_FAILED', lastError: String((e as Error)?.message ?? e).slice(0, 200) });
    throw e;
  } finally {
    await releaseLease(lease).catch(() => {});
  }
}
class LinkChangedError extends Error {}

/**
 * Student-triggered sync (button or return-to-tab). The cooldown is claimed with ONE atomic update, so concurrent requests on
 * different instances cannot both pass. A return to the tab is never evidence of a solve.
 */
export async function requestSync(studentId: string, trigger: 'MANUAL' | 'TAB_RETURN', now = new Date(), providers?: ProviderArg) {
  useProviders(providers);
  const s = await loadSettings();
  if (!env.LEETCODE_SYNC_ENABLED || s.paused || !(await hasEligibleProvider())) {
    await User.updateOne({ _id: studentId }, { $set: { 'sync.lastActiveAt': now } });
    const outcome = s.paused && env.LEETCODE_SYNC_ENABLED ? out('SYNC_PAUSED', 'Synchronization is paused by the administrator') : out('VERIFICATION_UNAVAILABLE', 'Automatic verification is not enabled yet');
    return { accepted: true as const, outcome }; // no claim, no provider call
  }
  const cooldownMs = policy().studentCooldownSec * 1000;
  const claimed = await User.findOneAndUpdate(
    { _id: studentId, $or: [{ 'sync.lastAttemptAt': { $exists: false } }, { 'sync.lastAttemptAt': null }, { 'sync.lastAttemptAt': { $lte: new Date(now.getTime() - cooldownMs) } }] },
    { $set: { 'sync.lastAttemptAt': now, 'sync.lastActiveAt': now } },
    { projection: { 'sync.lastAttemptAt': 1 } },
  );
  if (!claimed) {
    await User.updateOne({ _id: studentId }, { $set: { 'sync.lastActiveAt': now } });
    const u = await User.findById(studentId, 'sync').lean();
    return { accepted: false as const, reason: 'COOLDOWN' as const, retryAfterSec: Math.max(1, cooldownRemainingSec(u?.sync?.lastAttemptAt, now, policy())) };
  }
  const outcome = await syncStudent(studentId, trigger);
  // Refused before reaching any provider (shared budget, all circuits open, paused, another worker busy): give the cooldown
  // back so the student can retry soon. Only our own claim is undone.
  const neverSent = outcome.status === 'SYNCING' || outcome.status === 'SYNC_PAUSED' || (outcome.status === 'RATE_LIMITED' && outcome.message?.startsWith('Too many requests'));
  if (neverSent) {
    const prev = claimed.sync?.lastAttemptAt;
    await User.updateOne({ _id: studentId, 'sync.lastAttemptAt': { $gte: now } }, prev ? { $set: { 'sync.lastAttemptAt': prev } } : { $unset: { 'sync.lastAttemptAt': 1 } });
  }
  return { accepted: true as const, outcome };
}

/** Students eligible for automatic sync: enrolled in an ACTIVE batch with a consented, VERIFIED link. */
async function eligibleStudents() {
  const batchIds = (await Batch.find({ status: 'ACTIVE' }, '_id').lean()).map((b) => b._id);
  const studentIds = await Enrollment.distinct('studentId', { batchId: { $in: batchIds }, status: 'ACTIVE' });
  const linked = await LeetcodeLink.distinct('studentId', { studentId: { $in: studentIds }, status: 'VERIFIED', consentedAt: { $exists: true } });
  return User.find({ _id: { $in: linked }, status: 'ACTIVE' }, 'sync').lean();
}

/** Due students right now (used by the scheduler and for the admin queue view). */
export async function dueQueue(now = new Date()) {
  await loadSettings();
  const users = await eligibleStudents();
  const views = users.map((u) => {
    const stale = u.sync?.status === 'SYNCING' && (!u.sync.lastAttemptAt || now.getTime() - u.sync.lastAttemptAt.getTime() > STALE_SYNCING_MS); // crash recovery
    return { id: String(u._id), lastActiveAt: u.sync?.lastActiveAt, lastSuccessAt: u.sync?.lastSuccessAt, lastAttemptAt: stale ? u.sync?.lastSuccessAt : u.sync?.lastAttemptAt, nextEligibleAt: u.sync?.nextEligibleAt, possibleGap: u.sync?.possibleGap };
  });
  return { eligible: users.length, due: selectDue(views, now, policy(), Number.MAX_SAFE_INTEGER), syncing: users.filter((u) => u.sync?.status === 'SYNCING').length };
}

/** One scheduler pass under a fenced lease. */
export async function runScheduledPass(now = new Date(), providers?: ProviderArg, hooks: { inside?: (phase: 'start' | 'end', fence: number) => Promise<void> } = {}) {
  useProviders(providers);
  const s = await loadSettings();
  if (!env.LEETCODE_SYNC_ENABLED || !(await hasEligibleProvider())) return { skipped: s.paused ? 'PAUSED' as const : 'DISABLED' as const };
  const res = await withLease('leetcode-sync-pass', 120_000, async (pass: Lease) => {
    await hooks.inside?.('start', pass.fence);
    try {
      const { due: all } = await dueQueue(now);
      // Budget: the shared upstream bucket of the highest-priority upstream (all current providers share leetcode-graphql).
      const up = (await primaryUpstream()) ?? 'leetcode-graphql';
      const budget = Math.min(await availableTokens(upstreamBucket(up), s.ratePerMin, Math.max(5, s.ratePerMin)), 200);
      const due = all.slice(0, budget);
      let done = 0, failed = 0, skippedBusy = 0, i = 0, stopReason: string | null = null;
      const worker = async () => {
        while (i < due.length && !stopReason) {
          if (pass.lost) return;
          const st = due[i++];
          try { await assertLease(pass); } catch { return; }
          const o = await syncStudent(st.id, 'SCHEDULE');
          if (o.status === 'SYNC_SUCCESS') done++; else if (o.status === 'SYNCING') skippedBusy++; else failed++;
          // Shared budget exhausted, LeetCode restricting/unavailable, or every provider down: stop the whole pass.
          if (o.status === 'RATE_LIMITED' || o.status === 'PROVIDER_UNAVAILABLE' || o.status === 'SYNC_PAUSED') stopReason = o.status;
        }
      };
      await Promise.all(Array.from({ length: env.LEETCODE_CONCURRENCY }, worker));
      if (!pass.lost) await LeetcodeSyncLog.create({ runId: `job-${pass.fence}`, kind: 'JOB', status: failed ? 'PARTIAL' : 'SUCCESS', trigger: 'SCHEDULE', fence: pass.fence, finishedAt: new Date(), counts: { due: all.length, attempted: Math.min(i, due.length), done, failed, skippedBusy } });
      return { due: due.length, queued: all.length, done, failed, skippedBusy, fence: pass.fence, lost: pass.lost, stopReason };
    } finally { await hooks.inside?.('end', pass.fence); }
  }).catch((e) => { if (e instanceof LeaseLostError) return { lostLease: true as const }; throw e; });
  return res ?? { skipped: 'LEASE_HELD' as const };
}
