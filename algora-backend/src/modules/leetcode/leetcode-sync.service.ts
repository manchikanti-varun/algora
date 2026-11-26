import type { ClientSession, Types } from 'mongoose';
import { env } from '../../config/env';
import { acquireLease, LeaseLostError, releaseLease, renewLease, withFencedWrite } from '../../lib/lease';
import { Batch, COUNTING_LINK_STATUSES, Enrollment, LeetcodeLink, LeetcodeSyncLog, ObservedSubmission, User } from '../../models';
import { clearBoardCache } from '../progress/progress.service';
import { recordObservations } from './evidence.repository';
import { loadSettings, snapshot } from './integration-settings';
import type { SyncState } from './leetcode.types';
import { fetchAccepted, hasEligibleProvider, probeAccount } from './provider-manager';
import { setProvidersForTests } from './providers/provider.registry';
import type { SubmissionProvider } from './providers/provider.interface';
import { autoAllowedNow, backoffSec, defaultPolicy, nextAutoSyncAt, parseHours, reconciliationDue, termEndInstant, type PolicyConfig } from './sync.policy';

export const WINDOW = 20;
const STUDENT_LEASE_MS = 90_000;
export const STALE_SYNCING_MS = 2 * 60_000;
const SUCCESS_STATES: SyncState[] = ['SYNC_SUCCESS', 'POSSIBLE_EVIDENCE_GAP', 'NO_SUBMISSIONS_OBSERVED'];

/** Effective schedule: environment bootcamp calendar + runtime-adjustable interval, off-hours interval and manual cooldown. */
export const policy = (): PolicyConfig => {
  const s = snapshot();
  return defaultPolicy({
    tzOffsetMin: env.LEETCODE_TZ_OFFSET_MIN, hours: parseHours(env.LEETCODE_BOOTCAMP_HOURS), days: env.LEETCODE_BOOTCAMP_DAYS.split(',').map(Number),
    term: { start: env.LEETCODE_BOOTCAMP_START ?? null, end: env.LEETCODE_BOOTCAMP_END ?? null },
    studentCooldownSec: s.studentCooldownSec, autoIntervalMin: s.autoIntervalMin, offHoursIntervalMin: s.offHoursIntervalMin,
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
export interface SyncOutcome { status: SyncState; message?: string; newlyVerified: number; possibleGap: boolean; retryAfterSec?: number; /** Nothing was sent upstream (budget, pause, busy). The job should be retried later without counting a failure. */ deferred?: boolean; provider?: string; failedOver?: boolean; coverage?: 'FULL' | 'REDUCED' }
export type Trigger = 'SCHEDULE' | 'MANUAL' | 'RECONCILIATION';
export interface SyncOptions { /** The link the job was queued for. When it is no longer the current link nothing is requested or written. */ linkId?: string }
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
export function syncStudent(studentId: string, trigger: Trigger, providers?: ProviderArg, now = () => new Date(), opts: SyncOptions = {}): Promise<SyncOutcome> {
  useProviders(providers);
  const existing = inFlight.get(studentId);
  if (existing) return existing;
  const p = doSync(studentId, trigger, now, opts).finally(() => inFlight.delete(studentId));
  inFlight.set(studentId, p);
  return p;
}

async function doSync(studentId: string, trigger: Trigger, now: () => Date, opts: SyncOptions): Promise<SyncOutcome> {
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
  if (opts.linkId && String(link._id) !== opts.linkId) return out('VERIFICATION_UNAVAILABLE', 'Your LeetCode account link changed. This request was dropped.', { possibleGap: gap }); // stale job: no request, no write

  const lease = await acquireLease(`leetcode-student:${studentId}`, STUDENT_LEASE_MS);
  if (!lease) return out('SYNC_PENDING', 'A synchronization for this student is already running', { possibleGap: gap, deferred: true });
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
  const logBase = { runId: `student-${studentId}-${startedAt.getTime()}`, kind: 'STUDENT' as const, studentId, trigger, fence: lease.fence };
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
      let status: SyncState; let message: string; let wait: number | undefined; let deferred = false;
      switch (r.reason) {
        case 'PAUSED': status = 'SYNC_PAUSED'; message = 'Synchronization is paused by the administrator'; deferred = true; break;
        case 'NO_ELIGIBLE_PROVIDER': status = 'VERIFICATION_UNAVAILABLE'; message = 'Automatic verification is not enabled yet'; break;
        case 'GLOBAL_RATE_LIMITED': status = 'RATE_LIMITED'; message = 'Too many requests right now, try again shortly'; deferred = true; break;
        case 'NOT_FOUND': status = 'ACCOUNT_NOT_FOUND'; message = 'LeetCode could not find that username. Check it in your profile.'; wait = 6 * 3600; break;
        case 'UPSTREAM_BLOCKED':
          status = r.error?.kind === 'UPSTREAM_RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE';
          message = r.error?.kind === 'UPSTREAM_ACCESS_DENIED' ? 'LeetCode is restricting access. Synchronization is paused until it clears.' : 'LeetCode is temporarily unavailable. Your verified progress is unchanged.';
          wait = retry; break;
        default: status = 'PROVIDER_UNAVAILABLE'; message = 'Synchronization is temporarily unavailable. Your verified progress is unchanged.'; wait = retry ?? backoffSec(failures, Math.random());
      }
      const countsAsFailure = r.reason === 'ALL_FAILED' || r.reason === 'PROVIDERS_UNAVAILABLE';
      await writeForCurrentLink(async (session) => {
        await setState(studentId, { status, statusDetail: r.error?.kind ?? r.reason, lastError: r.error?.kind ?? r.reason, ...(deferred ? { lastAttemptAt: user.sync?.lastAttemptAt ?? null } : {}), ...(countsAsFailure ? { consecutiveFailures: failures } : {}), ...(wait ? { nextEligibleAt: new Date(now().getTime() + wait * 1000) } : {}) }, session);
        if (r.attempts.length) await LeetcodeSyncLog.create([{ ...logBase, status: 'FAILED', finishedAt: now(), error: `${r.reason}${r.error ? `:${r.error.kind}` : ''}`, counts: { attempts: r.attempts.length } }], { session });
      });
      return out(status, message, { retryAfterSec: wait ?? retry, possibleGap: gap, deferred });
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
      // Only a confirmed-existing account with no accepted submissions is a (empty) success that moves the timer.
      const okEmpty = status === 'NO_SUBMISSIONS_OBSERVED' && !!probe?.exists;
      const ok = okEmpty ? await successFields(studentId, trigger, now()) : null;
      await writeForCurrentLink(async (session) => {
        await setState(studentId, {
          status, statusDetail: detail, consecutiveFailures: 0, possibleGap: gap, lastProvider: provider.id,
          ...(waitSec ? { nextEligibleAt: new Date(now().getTime() + waitSec * 1000) } : {}),
        }, session);
        await User.updateOne({ _id: studentId }, { $set: ok?.set ?? {}, $unset: { 'sync.lastError': 1, ...(ok?.unset ?? {}) } }, { session });
        await LeetcodeSyncLog.create([{ ...logBase, status: status === 'ACCOUNT_NOT_FOUND' ? 'FAILED' : 'PARTIAL', finishedAt: now(), provider: provider.id, error: detail, counts: { fetched: 0, newlyVerified: 0, attempts: r.attempts.length } }], { session });
      });
      return { status, message, newlyVerified: 0, possibleGap: gap, provider: provider.id, failedOver: r.failedOver, coverage };
    }

    const full = res.rawCount >= res.limit;
    // Possible evidence gap: a FULL window cannot show what happened before it. It is suspicious only when the window shows no
    // sign of overlapping what we saw before: every row is newer than the previous successful sync, or (no timestamps) none of
    // the submission ids was ever observed. A full window alone proves nothing, and a gap is never "filled in".
    const ids = res.submissions.map((x) => x.submissionId).filter((x): x is string => !!x);
    const knownIds = full && prevSuccess && ids.length
      ? await ObservedSubmission.countDocuments({ linkId: link._id, submissionId: { $in: ids } })
      : 0;
    const timeNoOverlap = res.oldestRawAt === null ? null : res.oldestRawAt > prevSuccess!; // every row newer than the last successful sync
    const idOverlap = ids.length ? knownIds > 0 : null; // at least one submission id was seen before
    const noOverlap = (timeNoOverlap ?? true) && idOverlap !== true;
    const possibleGap = !!prevSuccess && full && noOverlap;
    const status: SyncState = possibleGap ? 'POSSIBLE_EVIDENCE_GAP' : 'SYNC_SUCCESS';
    const ok = await successFields(studentId, trigger, now());
    const newly = await writeForCurrentLink(async (session) => {
      const n = await recordObservations({ studentId, linkId: link._id, username: link.username }, res.submissions, { source, provider: provider.id, futureTimestamps: res.stats?.futureTimestamps }, now(), session);
      await User.updateOne({ _id: studentId }, { $set: { 'sync.status': status, 'sync.statusDetail': possibleGap ? 'WINDOW_OVERLAP_MISSED' : null, ...ok.set, 'sync.consecutiveFailures': 0, 'sync.possibleGap': possibleGap, ...(possibleGap ? { 'sync.lastGapAt': now() } : {}), 'sync.lastProvider': provider.id, 'sync.coverage': coverage }, $unset: { 'sync.lastError': 1, 'sync.nextEligibleAt': 1, ...ok.unset } }, { session });
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

/** Pick the calendar that applies right now: one that currently allows automatic sync, else the first. */
export function choosePolicy(list: PolicyConfig[], now: Date): PolicyConfig {
  return list.find((p) => autoAllowedNow(now, p)) ?? list[0] ?? policy();
}
/** Calendars of every ACTIVE batch the student is actively enrolled in (a batch without its own schedule uses the server default). */
export async function policiesForStudent(studentId: string): Promise<PolicyConfig[]> {
  const batchIds = await Enrollment.distinct('batchId', { studentId, status: 'ACTIVE' });
  const batches = await Batch.find({ _id: { $in: batchIds }, status: 'ACTIVE' }, 'leetcodeSchedule').lean();
  const list = batches.map((b) => policyForSchedule(b.leetcodeSchedule && Object.keys(b.leetcodeSchedule).length ? b.leetcodeSchedule : undefined));
  return list.length ? list : [policy()];
}
export const policyForStudent = async (studentId: string, now = new Date()) => choosePolicy(await policiesForStudent(studentId), now);

/** Fields that mark a successful synchronization and place the next automatic one 30 minutes (configurable) later. */
async function successFields(studentId: string, trigger: Trigger, at: Date) {
  const pol = await policyForStudent(studentId, at);
  const next = nextAutoSyncAt(studentId, at, at, pol);
  const end = termEndInstant(pol);
  const set: Record<string, unknown> = { 'sync.lastSuccessAt': at };
  const unset: Record<string, 1> = {};
  if (next) set['sync.nextAutoSyncAt'] = next; else unset['sync.nextAutoSyncAt'] = 1;
  if (trigger === 'RECONCILIATION' && end) set['sync.reconciledForTermEnd'] = end;
  else if (trigger !== 'RECONCILIATION' && end && reconciliationDue(at, pol, null)) set['sync.reconciledForTermEnd'] = end; // any success after the term ended is a final reconciliation
  return { set, unset };
}
