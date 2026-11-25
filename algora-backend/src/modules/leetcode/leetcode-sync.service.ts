import type { ClientSession, Types } from 'mongoose';
import { env } from '../../config/env';
import { acquireLease, assertLease, LeaseLostError, releaseLease, renewLease, withFencedWrite, withLease, type Lease } from '../../lib/lease';
import { availableTokens } from '../../lib/ratelimit';
import { Batch, COUNTING_LINK_STATUSES, Enrollment, LeetcodeLink, LeetcodeSyncLog, User } from '../../models';
import { clearBoardCache } from '../progress/progress.service';
import { recordObservations } from './evidence.repository';
import { loadSettings, snapshot } from './integration-settings';
import type { SyncState } from './leetcode.types';
import { fetchAccepted, hasEligibleProvider, primaryUpstream, probeAccount, upstreamBucket } from './provider-manager';
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
    term: { start: env.LEETCODE_BOOTCAMP_START ?? null, end: env.LEETCODE_BOOTCAMP_END ?? null },
    studentCooldownSec: s.studentCooldownSec, activeIntervalMin: s.activeIntervalMin, idleIntervalMin: s.idleIntervalMin, offHoursIntervalMin: s.offHoursIntervalMin,
  });
};

type BatchSchedule = { hours?: string | null; days?: string | null; tzOffsetMin?: number | null; termStart?: Date | null; termEnd?: Date | null } | null | undefined;

/** A batch may define its own calendar; unset parts fall back to the server defaults. */
export function policyForSchedule(schedule: BatchSchedule): PolicyConfig {
  const base = policy();
  if (!schedule) return base;
  return {
    ...base,
    ...(schedule.hours ? { hours: parseHours(schedule.hours) } : {}),
    ...(schedule.days ? { days: schedule.days.split(',').map(Number) } : {}),
    ...(schedule.tzOffsetMin != null ? { tzOffsetMin: schedule.tzOffsetMin } : {}),
    ...(schedule.termStart || schedule.termEnd ? { term: { start: schedule.termStart ?? null, end: schedule.termEnd ?? null } } : {}),
  };
}

const inFlight = new Map<string, Promise<SyncOutcome>>();
export interface SyncOutcome { status: SyncState; message?: string; newlyVerified: number; possibleGap: boolean; retryAfterSec?: number; provider?: string; failedOver?: boolean; coverage?: 'FULL' | 'REDUCED' }
type Trigger = 'SCHEDULE' | 'MANUAL' | 'TAB_RETURN';
/** Tests may pass providers directly; production always uses the registry. */
type ProviderArg = SubmissionProvider | SubmissionProvider[] | null | undefined;
const useProviders = (p: ProviderArg) => { if (p !== undefined) setProvidersForTests(p === null ? [] : p); };

async function setState(id: Types.ObjectId | string, patch: Record<string, unknown>, session?: ClientSession) {
  await User.updateOne({ _id: id }, { $set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`sync.${k}`, v])) }, { session });
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
  const unavailable = async (message: string) => { await setState(studentId, { status: 'VERIFICATION_UNAVAILABLE', statusDetail: null, lastError: message }); return out('VERIFICATION_UNAVAILABLE', message); };
  const settings = await loadSettings();
  if (!env.LEETCODE_SYNC_ENABLED) return unavailable('Automatic verification is not enabled yet');
  if (settings.paused) { await setState(studentId, { status: 'SYNC_PAUSED' }); return out('SYNC_PAUSED', 'Synchronization is paused by the administrator', { possibleGap: gap }); }
  if (!(await hasEligibleProvider())) return unavailable('Automatic verification is not enabled yet');
  const link = await LeetcodeLink.findOne({ studentId, status: { $in: [...COUNTING_LINK_STATUSES] }, isCurrent: true, consentedAt: { $type: 'date' } }).lean();
  if (!link) return unavailable('Link your LeetCode account first');

  const lease = await acquireLease(`leetcode-student:${studentId}`, STUDENT_LEASE_MS);
  if (!lease) return out('SYNC_PENDING', 'A synchronization for this student is already running', { possibleGap: gap });
  const cancellation = new AbortController();
  let renewing = false;
  const loseLease = () => {
    lease.lost = true;
    cancellation.abort(new LeaseLostError());
  };
  const renewal = setInterval(() => {
    if (renewing || lease.lost) return;
    renewing = true;
    void renewLease(lease, STUDENT_LEASE_MS).then((ok) => {
      if (!ok) loseLease();
    }).catch(loseLease).finally(() => { renewing = false; });
  }, STUDENT_LEASE_MS / 3);
  renewal.unref();
  const startedAt = now();
  const logBase = { runId: `student-${studentId}-${startedAt.getTime()}`, kind: 'STUDENT' as const, studentId, trigger: trigger === 'SCHEDULE' ? 'SCHEDULE' as const : 'MANUAL' as const, fence: lease.fence };
  const writeForCurrentLink = <T>(write: (session: ClientSession | undefined) => Promise<T>) =>
    withFencedWrite(lease, async (session) => {
      const current = await LeetcodeLink.exists({
        _id: link._id, isCurrent: true, status: { $in: [...COUNTING_LINK_STATUSES] }, consentedAt: { $type: 'date' },
      }).session(session ?? null);
      if (!current) throw new LinkChangedError();
      return write(session);
    });
  try {
    await writeForCurrentLink((session) => setState(studentId, { status: 'SYNCING', lastAttemptAt: startedAt }, session));
    const r = await fetchAccepted(link.username, WINDOW, studentId, cancellation.signal);
    if (!r.ok) {
      const retry = r.retryAfterSec;
      const failures = (user.sync?.consecutiveFailures ?? 0) + 1;
      let status: SyncState; let message: string; let wait: number | undefined;
      switch (r.reason) {
        case 'PAUSED': status = 'SYNC_PAUSED'; message = 'Synchronization is paused by the administrator'; break;
        case 'NO_ELIGIBLE_PROVIDER': status = 'VERIFICATION_UNAVAILABLE'; message = 'Automatic verification is not enabled yet'; break;
        case 'GLOBAL_RATE_LIMITED': status = 'RATE_LIMITED'; message = 'Too many requests right now, try again shortly'; break;
        case 'NOT_FOUND': status = 'ACCOUNT_NOT_FOUND'; message = 'LeetCode could not find that username. Check it in your profile.'; wait = 6 * 3600; break;
        case 'UPSTREAM_BLOCKED':
          status = r.error?.kind === 'UPSTREAM_RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE';
          message = r.error?.kind === 'UPSTREAM_ACCESS_DENIED' ? 'LeetCode is restricting access. Synchronization is paused until it clears.' : 'LeetCode is temporarily unavailable. Your verified progress is unchanged.';
          wait = retry; break;
        default: status = 'PROVIDER_UNAVAILABLE'; message = 'Synchronization is temporarily unavailable. Your verified progress is unchanged.'; wait = retry ?? backoffSec(failures, Math.random());
      }
      const countsAsFailure = r.reason === 'ALL_FAILED' || r.reason === 'PROVIDERS_UNAVAILABLE';
      await writeForCurrentLink(async (session) => {
        await setState(studentId, { status, statusDetail: r.error?.kind ?? r.reason, lastError: r.error?.kind ?? r.reason, ...(countsAsFailure ? { consecutiveFailures: failures } : {}), ...(wait ? { nextEligibleAt: new Date(now().getTime() + wait * 1000) } : {}) }, session);
        if (r.attempts.length) await LeetcodeSyncLog.create([{ ...logBase, status: 'FAILED', finishedAt: now(), error: `${r.reason}${r.error ? `:${r.error.kind}` : ''}`, counts: { attempts: r.attempts.length } }], { session });
      });
      return out(status, message, { retryAfterSec: wait ?? retry, possibleGap: gap });
    }
    const res = r.value;
    const provider = r.provider;
    const prevSuccess = user.sync?.lastSuccessAt ?? null;
    const coverage: 'FULL' | 'REDUCED' = res.acceptedOnly ? 'FULL' : 'REDUCED';
    const source = provider.transportKind === 'mock' || provider.id === 'mock' ? 'MOCK_DEV' : 'AUTOMATED_PROVIDER';

    // An empty window is ambiguous, so it is never reported as "synced, zero solved". Probe account existence (cached, and
    // only now) to say what was actually observed. Nothing is ever deleted here.
    if (!res.submissions.length) {
      const probe = await probeAccount(link.username, studentId, cancellation.signal);
      const detail = probe === null ? 'ACCOUNT_PROBE_UNAVAILABLE' : !probe.exists ? 'NO_SUCH_PUBLIC_ACCOUNT' : (probe.calendarTotal ?? 0) > 0 ? 'INCOMPLETE_VISIBILITY' : 'NO_ACCEPTED_SUBMISSIONS';
      const status: SyncState = probe !== null && !probe.exists ? 'ACCOUNT_NOT_FOUND' : probe !== null && (probe.calendarTotal ?? 0) > 0 ? 'SUBMISSIONS_UNAVAILABLE' : 'NO_SUBMISSIONS_OBSERVED';
      const message = status === 'ACCOUNT_NOT_FOUND' ? 'LeetCode could not find that username. Check it in your profile.'
        : status === 'SUBMISSIONS_UNAVAILABLE' ? 'LeetCode shows activity for this account but not its submissions, so Algora cannot verify them right now.'
        : 'No accepted submissions are visible on this account yet.';
      const waitSec = status === 'ACCOUNT_NOT_FOUND' ? 6 * 3600 : status === 'SUBMISSIONS_UNAVAILABLE' ? 3600 : undefined;
      await writeForCurrentLink(async (session) => {
        await setState(studentId, {
          status, statusDetail: detail, consecutiveFailures: 0, possibleGap: gap, lastProvider: provider.id,
          ...(status === 'NO_SUBMISSIONS_OBSERVED' && probe?.exists ? { lastSuccessAt: now() } : {}),
          ...(waitSec ? { nextEligibleAt: new Date(now().getTime() + waitSec * 1000) } : {}),
        }, session);
        await User.updateOne({ _id: studentId }, { $unset: { 'sync.lastError': 1 } }, { session });
        await LeetcodeSyncLog.create([{ ...logBase, status: status === 'ACCOUNT_NOT_FOUND' ? 'FAILED' : 'PARTIAL', finishedAt: now(), provider: provider.id, error: detail, counts: { fetched: 0, newlyVerified: 0, attempts: r.attempts.length } }], { session });
      });
      return { status, message, newlyVerified: 0, possibleGap: gap, provider: provider.id, failedOver: r.failedOver, coverage };
    }

    const full = res.rawCount >= res.limit;
    const possibleGap = !!prevSuccess && full && (res.oldestRawAt === null || res.oldestRawAt > prevSuccess);
    const status: SyncState = possibleGap ? 'POSSIBLE_EVIDENCE_GAP' : 'SYNC_SUCCESS';
    const newly = await writeForCurrentLink(async (session) => {
      const n = await recordObservations({ studentId, linkId: link._id, username: link.username }, res.submissions, { source, provider: provider.id, futureTimestamps: res.stats?.futureTimestamps }, now(), session);
      await User.updateOne({ _id: studentId }, { $set: { 'sync.status': status, 'sync.statusDetail': possibleGap ? 'WINDOW_OVERLAP_MISSED' : null, 'sync.lastSuccessAt': now(), 'sync.consecutiveFailures': 0, 'sync.possibleGap': possibleGap, 'sync.lastProvider': provider.id, 'sync.coverage': coverage }, $unset: { 'sync.lastError': 1, 'sync.nextEligibleAt': 1 } }, { session });
      await LeetcodeSyncLog.create([{ ...logBase, status: possibleGap ? 'PARTIAL' : 'SUCCESS', finishedAt: now(), provider: provider.id, counts: { fetched: res.rawCount, newlyVerified: n, attempts: r.attempts.length } }], { session });
      return n;
    });
    if (newly > 0) clearBoardCache();
    return { status, newlyVerified: newly, possibleGap, provider: provider.id, failedOver: r.failedOver, coverage };
  } catch (e) {
    if (e instanceof LeaseLostError) return out('SYNC_FAILED', 'Synchronization was taken over by another worker; nothing was saved');
    if (e instanceof LinkChangedError) return out('VERIFICATION_UNAVAILABLE', 'Your LeetCode account link changed while this check was running.');
    await writeForCurrentLink((session) => setState(studentId, { status: 'SYNC_FAILED', lastError: String((e as Error)?.message ?? e).slice(0, 200) }, session)).catch(() => {});
    throw e;
  } finally {
    clearInterval(renewal);
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
    {
      _id: studentId,
      $and: [
        { $or: [{ 'sync.lastAttemptAt': null }, { 'sync.lastAttemptAt': { $lte: new Date(now.getTime() - cooldownMs) } }] },
        { $or: [{ 'sync.nextEligibleAt': null }, { 'sync.nextEligibleAt': { $lte: now } }] },
      ],
    },
    { $set: { 'sync.lastAttemptAt': now, 'sync.lastActiveAt': now } },
    { projection: { 'sync.lastAttemptAt': 1 } },
  );
  if (!claimed) {
    await User.updateOne({ _id: studentId }, { $set: { 'sync.lastActiveAt': now } });
    const u = await User.findById(studentId, 'sync').lean();
    const backoff = Math.ceil(((u?.sync?.nextEligibleAt?.getTime() ?? 0) - now.getTime()) / 1000);
    return { accepted: false as const, reason: 'COOLDOWN' as const, retryAfterSec: Math.max(1, backoff, cooldownRemainingSec(u?.sync?.lastAttemptAt, now, policy())) };
  }
  const outcome = await syncStudent(studentId, trigger);
  // Refused before reaching any provider (shared budget, all circuits open, paused, another worker busy): give the cooldown
  // back so the student can retry soon. Only our own claim is undone.
  const neverSent = outcome.status === 'SYNCING' || outcome.status === 'SYNC_PENDING' || outcome.status === 'SYNC_PAUSED' || (outcome.status === 'RATE_LIMITED' && outcome.message?.startsWith('Too many requests'));
  if (neverSent) {
    const prev = claimed.sync?.lastAttemptAt;
    await User.updateOne({ _id: studentId, 'sync.lastAttemptAt': { $gte: now } }, prev ? { $set: { 'sync.lastAttemptAt': prev } } : { $unset: { 'sync.lastAttemptAt': 1 } });
  }
  return { accepted: true as const, outcome };
}

/**
 * Students eligible for automatic sync: enrolled in an ACTIVE batch with a consented, currently linked account.
 * Also returns the batch calendar each student belongs to, so different bootcamps can run different hours.
 */
async function eligibleStudents() {
  const batches = await Batch.find({ status: 'ACTIVE' }, '_id leetcodeSchedule').lean();
  const studentIds = await Enrollment.distinct('studentId', { batchId: { $in: batches.map((b) => b._id) }, status: 'ACTIVE' });
  const linked = await LeetcodeLink.distinct('studentId', { studentId: { $in: studentIds }, status: { $in: [...COUNTING_LINK_STATUSES] }, isCurrent: true, consentedAt: { $type: 'date' } });
  const schedules = new Map<string, BatchSchedule>();
  for (const b of batches) {
    if (!b.leetcodeSchedule || !Object.keys(b.leetcodeSchedule).length) continue;
    const ids = await Enrollment.distinct('studentId', { batchId: b._id, status: 'ACTIVE' });
    for (const id of ids) if (!schedules.has(String(id))) schedules.set(String(id), b.leetcodeSchedule);
  }
  const users = await User.find({ _id: { $in: linked }, status: 'ACTIVE' }, 'sync').lean();
  return { users, schedules };
}

/** Due students right now (used by the scheduler and for the admin queue view). */
export async function dueQueue(now = new Date()) {
  await loadSettings();
  const { users, schedules } = await eligibleStudents();
  const views = users.map((u) => {
    const stale = u.sync?.status === 'SYNCING' && (!u.sync.lastAttemptAt || now.getTime() - u.sync.lastAttemptAt.getTime() > STALE_SYNCING_MS); // crash recovery
    return { id: String(u._id), lastActiveAt: u.sync?.lastActiveAt, lastSuccessAt: u.sync?.lastSuccessAt, lastAttemptAt: stale ? u.sync?.lastSuccessAt : u.sync?.lastAttemptAt, nextEligibleAt: u.sync?.nextEligibleAt, possibleGap: u.sync?.possibleGap, policy: policyForSchedule(schedules.get(String(u._id))) };
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
          if (['SYNC_SUCCESS', 'POSSIBLE_EVIDENCE_GAP', 'NO_SUBMISSIONS_OBSERVED', 'SUBMISSIONS_UNAVAILABLE'].includes(o.status)) done++;
          else if (o.status === 'SYNCING' || o.status === 'SYNC_PENDING') skippedBusy++;
          else failed++;
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
