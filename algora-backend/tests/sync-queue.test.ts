import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { AuditLog, Batch, Enrollment, LeetcodeLink, LeetcodeSyncJob, RateBucket, SolveEvidence, User } from '../src/models';
import { linkAccount, revokeLinks } from '../src/modules/leetcode/links.service';
import { syncStudent } from '../src/modules/leetcode/leetcode-sync.service';
import { claimNextJob, cancelStaleJobs, completeJob, drainOnce, enqueueSync, recoverExpiredJobs, requestManualSync, schedulerTick } from '../src/modules/leetcode/sync-queue';
import { requestStats } from '../src/modules/leetcode/request-stats';
import { MockProvider } from '../src/modules/leetcode/providers/mock.provider';
import { setProviderForTests } from '../src/modules/leetcode/providers/provider.registry';
import { app, login, resetDb, startDb, stopDb, tok, verifiedLink } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
let mock: MockProvider;
const saved = { rate: env.LEETCODE_GLOBAL_RATE_PER_MIN, conc: env.LEETCODE_CONCURRENCY };
beforeEach(async () => {
  await resetDb();
  mock = new MockProvider();
  setProviderForTests(mock);
  (env as any).LEETCODE_SYNC_ENABLED = true;
  (env as any).LEETCODE_GLOBAL_RATE_PER_MIN = 600; // generous: tests that need a tight budget lower it
  (env as any).LEETCODE_CONCURRENCY = 2;
});
afterEach(() => {
  (env as any).LEETCODE_SYNC_ENABLED = false; setProviderForTests(undefined);
  (env as any).LEETCODE_GLOBAL_RATE_PER_MIN = saved.rate; (env as any).LEETCODE_CONCURRENCY = saved.conc;
  (env as any).LEETCODE_BOOTCAMP_START = undefined; (env as any).LEETCODE_BOOTCAMP_END = undefined;
});

let seq = 0;
const ist = (s: string) => new Date(`${s}+05:30`);
const MON = (hhmm: string) => ist(`2026-12-07T${hhmm}:00`); // Monday of the bootcamp
const at = (d: Date) => () => d;
async function student(n: string, linked = true, batch?: any) {
  const u = await User.create({ googleSub: `s-${n}`, email: `${n}@x.com`, role: 'STUDENT', fullName: n, rollNumber: `R${String(++seq).padStart(9, '0')}`, leetcodeUsername: n });
  const link = linked ? await verifiedLink(u._id, n) : null;
  if (batch) await Enrollment.create({ studentId: u._id, batchId: batch._id });
  return { u, id: String(u._id), link };
}
const batch = (over: Record<string, unknown> = {}) => Batch.create({ name: `B${++seq}`, status: 'ACTIVE', createdBy: new mongoose.Types.ObjectId(), ...over });
const jobsOf = (id: string) => LeetcodeSyncJob.find({ studentId: id }).sort({ enqueuedAt: 1 }).lean();
const syncOf = async (id: string) => (await User.findById(id).lean())!.sync!;

describe('automatic scheduling', () => {
  it('queues only eligible students, once each, even when enrolled in several batches', async () => {
    const b1 = await batch(), b2 = await batch(), archived = await batch({ status: 'ARCHIVED' });
    const ok = await student('ok', true, b1); await Enrollment.create({ studentId: ok.u._id, batchId: b2._id });
    await student('unlinked', false, b1);
    const noConsent = await student('noconsent', true, b1); await LeetcodeLink.updateOne({ studentId: noConsent.u._id }, { $unset: { consentedAt: 1 } });
    const suspended = await student('suspended', true, b1); await User.updateOne({ _id: suspended.u._id }, { $set: { status: 'SUSPENDED' } });
    const unenrolled = await student('unenrolled', true, b1); await Enrollment.updateOne({ studentId: unenrolled.u._id }, { $set: { status: 'REMOVED' } });
    await student('archivedonly', true, archived);
    await student('nobatch', true);
    const r = await schedulerTick(MON('10:00'));
    expect(r.enqueued).toBe(1);
    expect((await LeetcodeSyncJob.find().lean()).map((j) => String(j.studentId))).toEqual([ok.id]);
    expect((await schedulerTick(MON('10:00'))).enqueued).toBe(0); // idempotent: no duplicate while a job is active
  });
  it('does nothing outside bootcamp hours, on weekends, or when disabled or paused', async () => {
    const b = await batch(); await student('a', true, b);
    for (const t of [MON('09:00'), MON('16:45'), ist('2026-12-12T11:00:00') /* Saturday */]) expect((await schedulerTick(t)).enqueued).toBe(0);
    (env as any).LEETCODE_SYNC_ENABLED = false;
    expect(await schedulerTick(MON('10:00'))).toMatchObject({ skipped: 'DISABLED' });
  });
  it('after a success the next automatic sync is exactly 30 minutes later; a failure does not move it', async () => {
    const b = await batch(); const s = await student('asha', true, b); mock.solve('asha', 'two-sum', MON('09:00'));
    await schedulerTick(MON('10:00')); await drainOnce(at(MON('10:00')));
    let st = await syncOf(s.id);
    expect(st.lastSuccessAt).toEqual(MON('10:00')); expect(st.nextAutoSyncAt).toEqual(MON('10:30'));
    // not due at 10:29
    expect((await schedulerTick(MON('10:29'))).enqueued).toBe(0);
    // due at 10:30, but the provider is down: the sync fails and lastSuccessAt / nextAutoSyncAt stay
    mock.failWith = 'PROVIDER_UNAVAILABLE';
    expect((await schedulerTick(MON('10:30'))).enqueued).toBe(1); await drainOnce(at(MON('10:30')));
    st = await syncOf(s.id);
    expect(st.lastSuccessAt).toEqual(MON('10:00')); expect(st.nextAutoSyncAt).toEqual(MON('10:30'));
    const job = (await jobsOf(s.id)).at(-1)!;
    expect(job.status).toBe('QUEUED'); expect(job.attempts).toBe(1); expect(job.runAfter.getTime()).toBeGreaterThan(MON('10:30').getTime()); // retry with backoff
  });
  it('spreads the first synchronization of many students across the interval instead of one burst', async () => {
    const b = await batch();
    for (let i = 0; i < 60; i++) await student(`u${i}`, true, b);
    const open = MON('09:30');
    const first = await schedulerTick(open);
    const q1 = first.enqueued!;
    expect(q1).toBeLessThan(10); // only those whose slot is now
    let total = q1;
    for (let m = 5; m <= 30; m += 5) { await LeetcodeSyncJob.deleteMany({}); total += (await schedulerTick(new Date(open.getTime() + m * 60_000))).enqueued!; }
    expect(total).toBeGreaterThan(40); // the rest arrive over the following minutes
  });
  it('final reconciliation runs once after the term ends, then never again', async () => {
    (env as any).LEETCODE_BOOTCAMP_START = new Date('2026-12-07'); (env as any).LEETCODE_BOOTCAMP_END = new Date('2026-12-11');
    const b = await batch(); const s = await student('asha', true, b); mock.solve('asha', 'two-sum', MON('09:00'));
    const after = ist('2026-12-12T01:00:00');
    expect((await schedulerTick(after)).enqueued).toBe(1);
    expect((await LeetcodeSyncJob.findOne().lean())!.trigger).toBe('RECONCILIATION');
    await drainOnce(at(after));
    expect((await syncOf(s.id)).reconciledForTermEnd).toEqual(ist('2026-12-12T00:00:00'));
    expect((await schedulerTick(new Date(after.getTime() + 3600_000))).enqueued).toBe(0);
    expect(await SolveEvidence.countDocuments()).toBe(1);
  });
});

describe('manual synchronization', () => {
  it('queues instead of calling out; duplicate requests return the same job; one provider call in total', async () => {
    const s = await student('asha'); mock.solve('asha', 'two-sum', MON('09:00'));
    const rs = await Promise.all(Array.from({ length: 12 }, () => requestManualSync(s.id, MON('09:40'))));
    expect(rs.filter((r) => r.kind === 'QUEUED')).toHaveLength(1);
    expect(new Set(rs.map((r: any) => r.job.id)).size).toBe(1);
    expect(mock.calls).toBe(0); // nothing was sent by merely requesting
    expect(await LeetcodeSyncJob.countDocuments()).toBe(1);
    await drainOnce(at(MON('09:40')));
    expect(mock.calls).toBe(1);
  });
  it('a request while an automatic job is queued upgrades that job, it does not create a second one or a duplicate request', async () => {
    const b = await batch(); const s = await student('asha', true, b); mock.solve('asha', 'two-sum', MON('09:00'));
    await schedulerTick(MON('10:00'));
    const r = await requestManualSync(s.id, MON('10:00'));
    expect(r.kind).toBe('EXISTING');
    await drainOnce(at(MON('10:00')));
    expect(mock.calls).toBe(1);
    const jobs = await jobsOf(s.id); expect(jobs).toHaveLength(1); expect(jobs[0].trigger).toBe('MANUAL'); expect(jobs[0].status).toBe('SUCCEEDED');
  });
  it('spec example: 09:30 auto, 09:40 manual (next auto 10:10), 09:50 manual again (next auto 10:20)', async () => {
    const b = await batch(); const s = await student('asha', true, b); mock.solve('asha', 'two-sum', MON('09:00'));
    await syncStudent(s.id, 'SCHEDULE', undefined, at(MON('09:30'))); // 09:30 automatic success
    expect((await syncOf(s.id)).nextAutoSyncAt).toEqual(MON('10:00'));
    expect((await requestManualSync(s.id, MON('09:40'))).kind).toBe('QUEUED');
    expect((await syncOf(s.id)).nextAutoSyncAt).toEqual(MON('10:00')); // queued does not reset the timer
    await drainOnce(at(MON('09:40')));
    expect((await syncOf(s.id)).lastSuccessAt).toEqual(MON('09:40'));
    expect((await syncOf(s.id)).nextAutoSyncAt).toEqual(MON('10:10'));
    expect((await requestManualSync(s.id, MON('09:45')))).toMatchObject({ kind: 'COOLDOWN', retryAfterSec: 300 });
    expect((await requestManualSync(s.id, MON('09:50'))).kind).toBe('QUEUED');
    await drainOnce(at(MON('09:50')));
    expect((await syncOf(s.id)).nextAutoSyncAt).toEqual(MON('10:20'));
    expect((await schedulerTick(MON('10:10'))).enqueued).toBe(0); // the old 10:10 automatic slot no longer exists
  });
  it('the cooldown is 10 minutes and comes from the server timestamp, shown by sync-status', async () => {
    const s = await student('asha'); mock.solve('asha', 'two-sum', MON('09:00'));
    await requestManualSync(s.id, new Date(Date.now() - 4 * 60_000)); await drainOnce();
    const c = await login(tok('s-asha', 'asha@x.com', 'asha'));
    const v = (await c.call('get', '/leetcode/sync-status')).body;
    expect(v.cooldownRemainingSec).toBeGreaterThan(5 * 60 - 5); expect(v.cooldownRemainingSec).toBeLessThanOrEqual(6 * 60);
    expect(v.nextManualAt).toBeTruthy(); expect(v.canRequest).toBe(false); expect(v.serverTime).toBeTruthy();
  });
  it('a failed sync does not allow an immediate re-request and is retried with backoff, not at once', async () => {
    const s = await student('asha'); mock.solve('asha', 'two-sum', MON('09:00')); mock.failWith = 'PROVIDER_UNAVAILABLE';
    await requestManualSync(s.id, MON('09:40')); await drainOnce(at(MON('09:40')));
    expect(mock.calls).toBe(1); // one attempt, retry is scheduled for later
    expect((await requestManualSync(s.id, MON('09:41'))).kind).toBe('EXISTING');
    await drainOnce(at(MON('09:41'))); expect(mock.calls).toBe(1);
    const st = await syncOf(s.id); expect(st.lastSuccessAt).toBeFalsy(); expect(st.consecutiveFailures).toBe(1);
  });
  it('retry exhaustion ends in FAILED, and the student keeps previously verified progress', async () => {
    const s = await student('asha'); mock.solve('asha', 'two-sum', MON('09:00'));
    await requestManualSync(s.id, MON('09:00')); await drainOnce(at(MON('09:00')));
    mock.failWith = 'PROVIDER_UNAVAILABLE';
    let t = 9 * 60 + 30;
    for (let i = 0; i < 6; i++) { await LeetcodeSyncJob.updateMany({ status: 'QUEUED' }, { $set: { runAfter: new Date(0) } }); await User.updateOne({ _id: s.id }, { $unset: { 'sync.nextEligibleAt': 1 } }); await requestManualSync(s.id, MON(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)); await drainOnce(at(MON('11:00'))); t += 11; }
    const failed = await LeetcodeSyncJob.find({ status: 'FAILED' }).lean();
    expect(failed.length).toBeGreaterThan(0); expect(failed[0].attempts).toBe(4);
    expect(await SolveEvidence.countDocuments({ studentId: s.id })).toBe(1);
  });
  it('works outside the bootcamp term, hours and weekdays (manual sync is not calendar-gated)', async () => {
    (env as any).LEETCODE_BOOTCAMP_START = new Date('2026-12-07'); (env as any).LEETCODE_BOOTCAMP_END = new Date('2026-12-11');
    const b = await batch(); const s = await student('asha', true, b); mock.solve('asha', 'two-sum', MON('09:00'));
    for (const t of [ist('2026-11-26T21:00:00') /* before term, night */, ist('2026-12-12T11:00:00') /* Saturday */, ist('2027-01-20T10:00:00') /* after term */]) {
      expect((await schedulerTick(t)).enqueued ?? 0).toBeLessThanOrEqual(1); // at most the one-off reconciliation
      await LeetcodeSyncJob.deleteMany({});
      await User.updateOne({ _id: s.id }, { $unset: { 'sync.lastManualRequestAt': 1, 'sync.lastAttemptAt': 1 } });
      expect((await requestManualSync(s.id, t)).kind).toBe('QUEUED');
      await drainOnce(at(t));
      expect((await syncOf(s.id)).lastSuccessAt).toEqual(t);
    }
    expect(await SolveEvidence.countDocuments({ studentId: s.id })).toBe(1);
  });
  it('is unavailable (no job, no request) when the integration is disabled, paused or the student has no link', async () => {
    const s = await student('asha'); const nolink = await student('nolink', false);
    expect(await requestManualSync(nolink.id, MON('10:00'))).toMatchObject({ kind: 'UNAVAILABLE', reason: 'NO_LINK' });
    (env as any).LEETCODE_SYNC_ENABLED = false;
    expect(await requestManualSync(s.id, MON('10:00'))).toMatchObject({ kind: 'UNAVAILABLE', reason: 'DISABLED' });
    expect(await LeetcodeSyncJob.countDocuments()).toBe(0); expect(mock.calls).toBe(0);
  });
});

describe('shared request budget and fairness', () => {
  it('never executes more upstream requests than the budget allows; the rest wait queued (no growth, no failures)', async () => {
    (env as any).LEETCODE_GLOBAL_RATE_PER_MIN = 10; // burst = 2
    for (let i = 0; i < 8; i++) { const s = await student(`u${i}`); mock.solve(`u${i}`, 'two-sum', MON('09:00')); await requestManualSync(s.id, MON('10:00')); }
    await drainOnce(at(MON('10:00')));
    expect(mock.calls).toBe(2);
    expect(await LeetcodeSyncJob.countDocuments({ status: 'QUEUED' })).toBe(6);
    expect(await LeetcodeSyncJob.countDocuments({ status: 'FAILED' })).toBe(0);
    await drainOnce(at(MON('10:00'))); expect(mock.calls).toBe(2); // still bounded
  });
  it('a bucket emptied by retries and probes also blocks workers (budget is shared, not per feature)', async () => {
    const s = await student('asha'); mock.solve('asha', 'two-sum', MON('09:00'));
    await RateBucket.updateOne({ _id: 'upstream:mock-upstream' }, { $set: { tokens: 0, ts: new Date(Date.now() + 60_000) } }, { upsert: true });
    await requestManualSync(s.id, MON('10:00')); await drainOnce(at(MON('10:00')));
    expect(mock.calls).toBe(0);
    expect((await jobsOf(s.id))[0].status).toBe('QUEUED');
  });
  it('a manual job goes first, but any job waiting more than 5 minutes is served before it', async () => {
    const a = await student('a'), b = await student('b');
    await enqueueSync(a.id, a.link!._id, 'SCHEDULE', { now: MON('10:00'), dueAt: MON('09:50') });
    await enqueueSync(b.id, b.link!._id, 'MANUAL', { now: MON('10:00') });
    expect(String((await claimNextJob(MON('10:00')))!.studentId)).toBe(a.id); // starved one first (10 min late)
    await LeetcodeSyncJob.deleteMany({});
    await enqueueSync(a.id, a.link!._id, 'SCHEDULE', { now: MON('10:00'), dueAt: MON('09:58') });
    await enqueueSync(b.id, b.link!._id, 'MANUAL', { now: MON('10:00') });
    expect(String((await claimNextJob(MON('10:00')))!.studentId)).toBe(b.id);
  });
  it('one student can have only one active job (database guarantee)', async () => {
    const a = await student('a');
    await Promise.all(Array.from({ length: 10 }, () => enqueueSync(a.id, a.link!._id, 'SCHEDULE', { now: MON('10:00') })));
    expect(await LeetcodeSyncJob.countDocuments({ studentId: a.id })).toBe(1);
  });
  it('jobs are claimed exactly once by competing workers', async () => {
    for (let i = 0; i < 10; i++) { const s = await student(`u${i}`); await enqueueSync(s.id, s.link!._id, 'SCHEDULE', { now: MON('10:00') }); }
    const claimed = await Promise.all(Array.from({ length: 25 }, () => claimNextJob(MON('10:00'))));
    const ids = claimed.filter(Boolean).map((j) => String(j!._id));
    expect(ids).toHaveLength(10); expect(new Set(ids).size).toBe(10);
  });
});

describe('recovery, cancellation and fencing', () => {
  it('a crashed worker\'s job is recovered after its lease expires, and the old worker cannot complete it', async () => {
    const a = await student('a'); mock.solve('a', 'p', MON('09:00'));
    await enqueueSync(a.id, a.link!._id, 'SCHEDULE', { now: MON('10:00') });
    const claimed = (await claimNextJob(MON('10:00')))!;
    expect(await recoverExpiredJobs(MON('10:00'))).toBe(0); // lease still valid
    expect(await recoverExpiredJobs(MON('10:05'))).toBe(1);
    const requeued = (await jobsOf(a.id))[0]; expect(requeued.status).toBe('QUEUED');
    const reclaimed = (await claimNextJob(MON('10:05')))!; expect(reclaimed.fence).toBeGreaterThan(claimed.fence);
    expect(await completeJob(claimed, { status: 'SYNC_SUCCESS', newlyVerified: 0, possibleGap: false }, MON('10:06'))).toBe('IGNORED'); // stale fence
    expect((await jobsOf(a.id))[0].status).toBe('RUNNING');
  });
  it('outdated queued jobs are cancelled instead of building a backlog', async () => {
    const a = await student('a'); await enqueueSync(a.id, a.link!._id, 'SCHEDULE', { now: MON('09:00') });
    expect(await cancelStaleJobs(MON('12:00'))).toBe(1);
    expect((await jobsOf(a.id))[0]).toMatchObject({ status: 'CANCELLED', cancelReason: 'STALE' });
  });
  it('changing or unlinking the account cancels queued jobs and a stale job cannot write evidence for the new account', async () => {
    const s = await student('old'); mock.solve('old', 'two-sum', MON('09:00')); mock.solve('new', 'valid-parentheses', MON('09:00'));
    await requestManualSync(s.id, MON('10:00'));
    const job = (await jobsOf(s.id))[0];
    await linkAccount(s.id, 'new');
    expect((await jobsOf(s.id))[0].status).toBe('CANCELLED');
    // a worker that claimed the old job before the change must not request or write anything
    const o = await syncStudent(s.id, 'MANUAL', undefined, at(MON('10:00')), { linkId: String(job.linkId) });
    expect(o.status).toBe('VERIFICATION_UNAVAILABLE'); expect(mock.calls).toBe(0);
    expect(await SolveEvidence.countDocuments()).toBe(0);
  });
  it('unlinking cancels queued jobs and keeps the audit trail of the ended link', async () => {
    const s = await student('asha'); await requestManualSync(s.id, MON('10:00'));
    await revokeLinks(s.id, 'STUDENT_UNLINKED');
    expect((await jobsOf(s.id))[0].status).toBe('CANCELLED');
    expect(await LeetcodeLink.countDocuments({ studentId: s.id, status: 'REVOKED' })).toBe(1);
  });
});

describe('evidence window', () => {
  const sync = (id: string, t: Date) => syncStudent(id, 'MANUAL', undefined, at(t));
  it('flags a possible gap only when a FULL window shows no overlap with what was seen before', async () => {
    const s = await student('asha'); mock.solve('asha', 'p0', MON('09:00'));
    await sync(s.id, MON('09:10'));
    for (let i = 1; i <= 22; i++) mock.solve('asha', `q${i}`, new Date(MON('09:20').getTime() + i * 1000)); // all newer than the last sync
    const o = await sync(s.id, MON('09:30'));
    expect(o.status).toBe('POSSIBLE_EVIDENCE_GAP'); expect((await syncOf(s.id)).lastGapAt).toBeTruthy();
    expect(await SolveEvidence.countDocuments({ studentId: s.id })).toBe(21); // nothing invented, nothing lost
  });
  it('a full window that reaches back before the previous sync is not a gap', async () => {
    const s = await student('asha');
    for (let i = 0; i < 10; i++) mock.solve('asha', `old${i}`, new Date(MON('09:00').getTime() + i * 1000));
    await sync(s.id, MON('09:10'));
    for (let i = 0; i < 10; i++) mock.solve('asha', `new${i}`, new Date(MON('09:20').getTime() + i * 1000)); // 20 rows: 10 older than the last sync
    const o = await sync(s.id, MON('09:30'));
    expect(o.status).toBe('SYNC_SUCCESS'); expect(o.possibleGap).toBe(false);
  });
  it('a window that is not full is never a gap, and a full first sync has nothing to compare with', async () => {
    const s = await student('asha');
    for (let i = 0; i < 20; i++) mock.solve('asha', `p${i}`, new Date(MON('09:00').getTime() + i * 1000));
    expect((await sync(s.id, MON('09:10'))).status).toBe('SYNC_SUCCESS');
    mock.solve('asha', 'fresh', MON('09:20'));
    expect((await sync(s.id, MON('09:30'))).status).toBe('SYNC_SUCCESS');
  });
  it('evidence accumulates across windows and survives disappearing from the recent 20; duplicates never add points', async () => {
    const s = await student('asha');
    for (const p of ['a', 'b', 'c']) mock.solve('asha', p, MON('09:00'));
    await sync(s.id, MON('09:10'));
    mock.clearAccepted('asha');
    for (const p of ['d', 'e', 'f', 'g']) mock.solve('asha', p, MON('09:20'));
    for (let i = 0; i < 5; i++) mock.solve('asha', 'a', new Date(MON('09:21').getTime() + i)); // repeated accepted submissions of an old problem
    await sync(s.id, MON('09:30'));
    const slugs = (await SolveEvidence.find({ studentId: s.id }).lean()).map((e) => e.slug).sort();
    expect(slugs).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(await SolveEvidence.countDocuments({ studentId: s.id, slug: 'a' })).toBe(1);
    const a = await SolveEvidence.findOne({ studentId: s.id, slug: 'a' }).lean();
    expect(a!.earliestObservedSolvedAt!.getTime()).toBe(MON('09:00').getTime()); expect(a!.latestObservedSolvedAt!.getTime()).toBeGreaterThan(MON('09:20').getTime());
  });
  it('a submission without timestamp or id still verifies the problem once', async () => {
    const s = await student('asha');
    mock.solve('asha', 'two-sum', null as any); mock.solve('asha', 'two-sum', null as any);
    await sync(s.id, MON('09:10'));
    expect(await SolveEvidence.countDocuments({ studentId: s.id })).toBe(1);
  });
});

describe('HTTP access control and dashboards', () => {
  it('request-sync queues for the authenticated student only (no student id is accepted), returns 202 and a job; refresh does not call out', async () => {
    const a = await student('asha'); const b = await student('ben');
    const c = await login(tok('s-asha', 'asha@x.com', 'asha'));
    const r = await c.call('post', '/leetcode/request-sync', { studentId: b.id });
    expect(r.status).toBe(202); expect(r.body.job.status).toBe('QUEUED'); expect(r.body.sync.status).toBe('QUEUED'); expect(r.body.sync.canRequest).toBe(false);
    expect(await jobsOf(a.id)).toHaveLength(1); expect(await jobsOf(b.id)).toHaveLength(0);
    for (let i = 0; i < 5; i++) await c.call('get', '/leetcode/sync-status');
    expect(mock.calls).toBe(0);
    expect((await c.call('post', '/leetcode/request-sync', {})).body.created).toBe(false);
    await drainOnce();
    expect((await c.call('get', '/leetcode/sync-status')).body.status).not.toBe('QUEUED');
  });
  it('rejects unauthenticated, wrong-role and CSRF-less requests', async () => {
    await student('asha');
    expect((await request(app).post('/api/v1/leetcode/request-sync').set('Origin', 'http://localhost:3000').send({})).status).toBe(401);
    const c = await login(tok('s-asha', 'asha@x.com', 'asha'));
    const noCsrf = await request(app).post('/api/v1/leetcode/request-sync').set('Origin', 'http://localhost:3000').set('Cookie', c.cookie!).send({});
    expect(noCsrf.status).toBe(403);
    const admin = await login(tok('sub-admin', 'admin@example.com', 'Admin'));
    expect((await admin.call('post', '/leetcode/request-sync', {})).status).toBe(403);
  });
  it('integration dashboard exposes real queue and request metrics; settings are admin-only, validated against ceilings and audited', async () => {
    const b = await batch(); const s = await student('asha', true, b); mock.solve('asha', 'two-sum', MON('09:00'));
    await requestManualSync(s.id, MON('10:00')); await drainOnce(at(MON('10:00')));
    const admin = await login(tok('sub-admin', 'admin@example.com', 'Admin'));
    const o = (await admin.call('get', '/leetcode/integration')).body;
    expect(o.queue).toMatchObject({ eligibleStudents: 1, queueDepth: 0, activeJobs: 0, succeeded24h: 1 });
    expect(o.upstream.requests.today).toBeGreaterThanOrEqual(1);
    expect(o.settings.effective).toMatchObject({ studentCooldownSec: 600, autoIntervalMin: expect.any(Number), concurrency: 2 });
    expect(JSON.stringify(o)).not.toMatch(/LEETCODE_ACCESS_REF|password|secret/i);
    const stud = await login(tok('s-asha', 'asha@x.com', 'asha'));
    expect((await stud.call('put', '/leetcode/integration/settings', { paused: true })).status).toBe(403);
    expect((await stud.call('get', '/leetcode/integration/jobs')).status).toBe(403);
    expect((await admin.call('put', '/leetcode/integration/settings', { concurrency: 9 })).status).toBe(400);
    expect((await admin.call('put', '/leetcode/integration/settings', { autoIntervalMin: 2 })).status).toBe(400);
    expect((await admin.call('put', '/leetcode/integration/settings', { autoIntervalMin: 20, studentCooldownSec: 300, concurrency: 1 })).status).toBe(200);
    expect((await admin.call('get', '/leetcode/integration')).body.settings.effective).toMatchObject({ autoIntervalMin: 20, studentCooldownSec: 300, concurrency: 1 });
    expect((await admin.call('put', '/leetcode/integration/settings', { autoIntervalMin: null, studentCooldownSec: null, concurrency: null })).status).toBe(200);
    expect((await admin.call('get', '/leetcode/integration')).body.settings.effective).toMatchObject({ autoIntervalMin: 30, studentCooldownSec: 600, concurrency: 2 }); // back to environment defaults
    expect(await AuditLog.countDocuments({ action: 'integration.settings' })).toBe(2);
    expect((await admin.call('get', '/leetcode/integration/jobs?status=FAILED')).status).toBe(200);
    expect((await admin.call('get', '/leetcode/integration/gaps')).status).toBe(200);
    expect((await requestStats()).today).toBeGreaterThanOrEqual(1);
  });
});
