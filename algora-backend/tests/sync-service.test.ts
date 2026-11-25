import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { acquireLease } from '../src/lib/lease';
import { Batch, Enrollment, JobLease, LeetcodeLink, RateBucket, SolveEvidence, User } from '../src/models';
import { countableEvidence } from '../src/modules/leetcode/evidence.repository';
import { requestSync, runScheduledPass, syncStudent } from '../src/modules/leetcode/leetcode-sync.service';
import { ProviderState } from '../src/models';
import { MockProvider } from '../src/modules/leetcode/providers/mock.provider';
import { setProviderForTests } from '../src/modules/leetcode/providers/provider.registry';
import { login, resetDb, startDb, stopDb, tok, verifiedLink } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
let mock: MockProvider;
beforeEach(async () => {
  await resetDb();
  mock = new MockProvider();
  setProviderForTests(mock);
  (env as any).LEETCODE_SYNC_ENABLED = true;
});
afterEach(() => { (env as any).LEETCODE_SYNC_ENABLED = false; setProviderForTests(undefined); });

let rollSeq = 0;
const MON_10 = new Date('2025-01-06T10:00:00+05:30'); // inside bootcamp hours (IST)
const T = (m: number) => new Date(Date.UTC(2025, 0, 6, 5, 0) + m * 60_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function student(n: string, username = n, linked = true) {
  const u = await User.create({ googleSub: `s-${n}`, email: `${n}@x.com`, role: 'STUDENT', fullName: n, rollNumber: `R${String(++rollSeq).padStart(9, '0')}`, leetcodeUsername: username });
  const link = linked ? await verifiedLink(u._id, username) : null;
  return { u, link };
}

describe('syncStudent with mock provider', () => {
  it('stores evidence tied to the verified link, once per slug; submissionId null; earliest/latest observed', async () => {
    const { u, link } = await student('asha');
    mock.solve('asha', 'two-sum', T(0)); mock.solve('asha', 'two-sum', T(5)); mock.solve('asha', 'valid-parentheses', T(9));
    expect(await syncStudent(String(u._id), 'MANUAL')).toMatchObject({ status: 'SYNC_SUCCESS', newlyVerified: 2 });
    const ev = await SolveEvidence.find({ studentId: u._id });
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.source === 'MOCK_DEV' && e.submissionId === null && String(e.linkId) === String(link!._id))).toBe(true);
    const ts = ev.find((e) => e.slug === 'two-sum')!;
    expect(ts.earliestObservedSolvedAt!.getTime()).toBe(T(0).getTime());
    expect(ts.latestObservedSolvedAt!.getTime()).toBe(T(5).getTime());
    expect((await syncStudent(String(u._id), 'MANUAL')).newlyVerified).toBe(0);
    const again = await SolveEvidence.findOne({ slug: 'two-sum' });
    expect(again!.lastVerifiedAt!.getTime()).toBeGreaterThanOrEqual(again!.firstVerifiedAt!.getTime());
  });

  it('a newly solved problem appears on the next sync', async () => {
    const { u } = await student('asha');
    mock.solve('asha', 'two-sum', T(0)); await syncStudent(String(u._id), 'MANUAL');
    mock.solve('asha', 'add-two-numbers', T(30));
    expect((await syncStudent(String(u._id), 'MANUAL')).newlyVerified).toBe(1);
    expect(await countableEvidence(u._id)).toHaveLength(2);
  });

  it('evidence is permanent: empty window or provider failure never removes it', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0));
    await syncStudent(String(u._id), 'MANUAL');
    mock.windowSize = 0; await syncStudent(String(u._id), 'MANUAL');
    mock.failWith = 'PROVIDER_UNAVAILABLE';
    expect((await syncStudent(String(u._id), 'MANUAL')).status).toBe('PROVIDER_UNAVAILABLE');
    expect(await countableEvidence(u._id)).toHaveLength(1);
  });

  it('possible gap: full window newer than the last sync', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'p0', T(0));
    await syncStudent(String(u._id), 'MANUAL');
    const later = Date.now() + 60_000;
    for (let i = 1; i <= 25; i++) mock.solve('asha', `p${i}`, new Date(later + i * 1000));
    const o = await syncStudent(String(u._id), 'MANUAL');
    expect(o.possibleGap).toBe(true);
    expect(await SolveEvidence.countDocuments({ studentId: u._id })).toBe(21);
  });

  it.each([
    ['UPSTREAM_RATE_LIMITED', 'RATE_LIMITED'], ['PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'], ['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE'],
    ['BAD_RESPONSE', 'PROVIDER_UNAVAILABLE'], ['NOT_FOUND', 'VERIFICATION_UNAVAILABLE'],
  ] as const)('provider error %s -> %s with backoff', async (kind, expected) => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0)); mock.failWith = kind;
    expect((await syncStudent(String(u._id), 'MANUAL')).status).toBe(expected);
    const s = (await User.findById(u._id))!.sync!;
    if (kind !== 'UPSTREAM_RATE_LIMITED') expect(s.consecutiveFailures).toBe(1);
    expect(s.nextEligibleAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('unlinked, pending or revoked accounts are never synced and nothing counts', async () => {
    const a = await student('a', 'a', false);
    const b = await student('b', 'b', false);
    await LeetcodeLink.create({ studentId: b.u._id, username: 'b', usernameNorm: 'b', status: 'PENDING_VERIFICATION', isActive: true, isCurrent: false, isPending: true, challenge: 'x' });
    mock.solve('a', 'two-sum', T(0)); mock.solve('b', 'two-sum', T(0));
    expect((await syncStudent(String(a.u._id), 'MANUAL')).status).toBe('VERIFICATION_UNAVAILABLE');
    expect((await syncStudent(String(b.u._id), 'MANUAL')).status).toBe('VERIFICATION_UNAVAILABLE');
    expect(mock.calls).toBe(0); expect(await SolveEvidence.countDocuments()).toBe(0);
  });

  it('disabled or provider-less: VERIFICATION_UNAVAILABLE, no provider calls, no evidence', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0));
    (env as any).LEETCODE_SYNC_ENABLED = false;
    expect((await syncStudent(String(u._id), 'MANUAL')).status).toBe('VERIFICATION_UNAVAILABLE');
    (env as any).LEETCODE_SYNC_ENABLED = true;
    expect((await syncStudent(String(u._id), 'MANUAL', null)).status).toBe('VERIFICATION_UNAVAILABLE');
    expect(mock.calls).toBe(0); expect(await SolveEvidence.countDocuments()).toBe(0);
  });

  it('open circuit breaker blocks provider calls', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0));
    await ProviderState.create({ _id: 'provider:mock', kind: 'PROVIDER', consecutiveFailures: 5, openedAt: new Date(), openCount: 1 });
    expect((await syncStudent(String(u._id), 'MANUAL')).status).toBe('PROVIDER_UNAVAILABLE');
    expect(mock.calls).toBe(0);
  });

  it('concurrent in-process syncs share one provider call', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0)); mock.latencyMs = 30;
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => syncStudent(String(u._id), 'MANUAL')));
    expect(mock.calls).toBe(1);
    expect(new Set(r.map((x) => x.status))).toEqual(new Set(['SYNC_SUCCESS']));
  });
});

describe('concurrency protection across workers', () => {
  it('manual and scheduled syncs share the per-student lease: a held lease means no provider call and status SYNCING', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0));
    const held = await acquireLease(`leetcode-student:${u._id}`, 60_000); // "another instance" is syncing this student
    expect(held).toBeTruthy();
    expect((await syncStudent(String(u._id), 'MANUAL')).status).toBe('SYNCING');
    expect((await syncStudent(String(u._id), 'SCHEDULE')).status).toBe('SYNCING');
    expect(mock.calls).toBe(0);
  });

  it('a worker whose lease expires mid-sync saves nothing (no inserts, no state)', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0)); mock.latencyMs = 250;
    const p = syncStudent(String(u._id), 'MANUAL');
    await sleep(60);
    // Hostile takeover while the provider call is in flight: expire it and let another worker take the lease.
    await JobLease.updateOne({ _id: `leetcode-student:${u._id}` }, { $set: { expiresAt: new Date(0) } });
    expect(await acquireLease(`leetcode-student:${u._id}`, 60_000)).toBeTruthy();
    const o = await p;
    expect(o.status).toBe('SYNC_FAILED');
    expect(await SolveEvidence.countDocuments()).toBe(0);
    expect((await User.findById(u._id))!.sync!.lastSuccessAt).toBeFalsy();
  });

  it('a link changed while the provider call is in flight discards the result', async () => {
    const { u, link } = await student('asha'); mock.solve('asha', 'two-sum', T(0)); mock.latencyMs = 200;
    const p = syncStudent(String(u._id), 'MANUAL');
    await sleep(60);
    await LeetcodeLink.updateOne({ _id: link!._id }, { $set: { status: 'REVOKED', isActive: false, isCurrent: false } });
    expect((await p).status).toBe('VERIFICATION_UNAVAILABLE');
    expect(await SolveEvidence.countDocuments()).toBe(0);
  });

  it('student-triggered cooldown is claimed atomically: 12 concurrent requests make exactly one provider call', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0)); mock.latencyMs = 40;
    const rs = await Promise.all(Array.from({ length: 12 }, () => requestSync(String(u._id), 'MANUAL')));
    expect(mock.calls).toBe(1);
    expect(rs.filter((r) => r.accepted).length).toBe(1);
    expect(rs.filter((r) => !r.accepted).every((r) => r.accepted === false && r.reason === 'COOLDOWN' && r.retryAfterSec > 0)).toBe(true);
  });

  it('disabled provider: requestSync makes no claim and no provider call, repeatedly', async () => {
    const { u } = await student('asha'); (env as any).LEETCODE_SYNC_ENABLED = false;
    for (let i = 0; i < 3; i++) expect(await requestSync(String(u._id), 'MANUAL')).toMatchObject({ accepted: true, outcome: { status: 'VERIFICATION_UNAVAILABLE' } });
    expect(mock.calls).toBe(0);
    expect((await User.findById(u._id))!.sync!.lastAttemptAt).toBeFalsy();
  });

  it('the global rate limit is a MongoDB bucket: an empty bucket yields RATE_LIMITED with no provider call, regardless of instance', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0));
    await RateBucket.updateOne({ _id: 'upstream:mock-upstream' }, { $set: { tokens: 0, ts: new Date(Date.now() + 60_000) } }, { upsert: true });
    expect((await syncStudent(String(u._id), 'MANUAL')).status).toBe('RATE_LIMITED');
    expect(mock.calls).toBe(0);
  });
});

describe('HTTP: student-triggered sync', () => {
  it('request-sync works, then cooldown 429; staff cannot call it; activity recorded; health is admin only', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0));
    const s = await login(tok('s-asha', 'asha@x.com', 'asha'));
    const r1 = await s.call('post', '/leetcode/request-sync', { reason: 'TAB_RETURN' });
    expect(r1.status).toBe(200);
    expect(r1.body.outcome).toMatchObject({ status: 'SYNC_SUCCESS', newlyVerified: 1 });
    const r2 = await s.call('post', '/leetcode/request-sync', {});
    expect(r2.status).toBe(429); expect(r2.body.reason).toBe('COOLDOWN'); expect(r2.body.retryAfterSec).toBeGreaterThan(0);
    expect(mock.calls).toBe(1);
    expect((await User.findById(u._id))!.sync!.lastActiveAt).toBeTruthy();
    const st = (await s.call('get', '/leetcode/sync-status')).body;
    expect(st).toMatchObject({ status: 'SYNC_SUCCESS', syncEnabled: true, cooldownRemainingSec: expect.any(Number) });
    expect(st.link.state).toBe('VERIFIED');
    const admin = await login(tok('sub-admin', 'admin@example.com', 'Admin'));
    expect((await admin.call('post', '/leetcode/request-sync', {})).status).toBe(403);
    expect((await s.call('get', '/leetcode/health')).status).toBe(403);
    expect((await admin.call('get', '/leetcode/health')).body.provider).toBe('mock');
  });
  it('a stuck SYNCING status (crashed worker) is reported as failed instead of syncing forever', async () => {
    const { u } = await student('asha');
    await User.updateOne({ _id: u._id }, { $set: { 'sync.status': 'SYNCING', 'sync.lastAttemptAt': new Date(Date.now() - 10 * 60_000) } });
    const s = await login(tok('s-asha', 'asha@x.com', 'asha'));
    expect((await s.call('get', '/leetcode/sync-status')).body.status).toBe('SYNC_FAILED');
  });
});

describe('scheduled pass', () => {
  async function seed(n: number) {
    const b = await Batch.create({ name: 'B', status: 'ACTIVE', createdBy: new mongoose.Types.ObjectId() });
    for (let i = 0; i < n; i++) { const { u } = await student(`s${i}`); await Enrollment.create({ studentId: u._id, batchId: b._id }); mock.solve(`s${i}`, 'two-sum', T(i)); }
  }
  it('syncs due students within the global token budget and bounded concurrency', async () => {
    await seed(12);
    await RateBucket.updateOne({ _id: 'upstream:mock-upstream' }, { $set: { tokens: 8, ts: new Date() } }, { upsert: true });
    mock.latencyMs = 10;
    const r: any = await runScheduledPass(MON_10, mock);
    expect(r.due).toBeLessThanOrEqual(9); expect(r.done).toBeGreaterThanOrEqual(7);
    expect(await SolveEvidence.countDocuments()).toBe(r.done);
  });
  it('only one pass at a time; a pass leaves the fence on its lease; per-student leases prevent double work', async () => {
    await seed(3);
    const held = await acquireLease('leetcode-sync-pass', 60_000);
    expect(await runScheduledPass(MON_10, mock)).toEqual({ skipped: 'LEASE_HELD' });
    await JobLease.updateOne({ _id: 'leetcode-sync-pass' }, { $set: { expiresAt: new Date(0) } });
    const r: any = await runScheduledPass(MON_10, mock);
    expect(r.fence).toBeGreaterThan(held!.fence);
    expect(r.done).toBe(3);
  });
  it('skips students whose ownership is not verified', async () => {
    const b = await Batch.create({ name: 'B', status: 'ACTIVE', createdBy: new mongoose.Types.ObjectId() });
    const a = await student('a', 'a', false); const c = await student('c');
    for (const x of [a, c]) await Enrollment.create({ studentId: x.u._id, batchId: b._id });
    mock.solve('a', 'p', T(0)); mock.solve('c', 'p', T(0));
    const r: any = await runScheduledPass(MON_10, mock);
    expect(r.due).toBe(1); expect(mock.calls).toBe(1);
  });
  it('does nothing when disabled or without provider', async () => {
    await seed(2); (env as any).LEETCODE_SYNC_ENABLED = false;
    expect(await runScheduledPass(MON_10, mock)).toEqual({ skipped: 'DISABLED' });
    (env as any).LEETCODE_SYNC_ENABLED = true;
    expect(await runScheduledPass(MON_10, null)).toEqual({ skipped: 'DISABLED' });
  });
  it('a provider outage stops the pass early', async () => {
    await seed(10); mock.failWith = 'PROVIDER_UNAVAILABLE';
    const r: any = await runScheduledPass(MON_10, mock);
    expect(mock.calls).toBeLessThanOrEqual(env.LEETCODE_CONCURRENCY + 1); // pass stops once every provider is down
    expect(await SolveEvidence.countDocuments()).toBe(0); expect(r.failed).toBeGreaterThan(0);
  });
  it('crash recovery: a student stuck in SYNCING with an old attempt becomes due again', async () => {
    await seed(1);
    const u = (await User.findOne({ role: 'STUDENT' }))!;
    await User.updateOne({ _id: u._id }, { $set: { 'sync.status': 'SYNCING', 'sync.lastAttemptAt': new Date(MON_10.getTime() - 10 * 60_000), 'sync.lastActiveAt': new Date(MON_10.getTime() - 60_000) } });
    const r: any = await runScheduledPass(MON_10, mock);
    expect(r.done).toBe(1);
  });
});

describe('cooldown is returned when the request never reached the provider', () => {
  it('rate-limited request does not lock the student out', async () => {
    const { u } = await student('asha'); mock.solve('asha', 'two-sum', T(0));
    await RateBucket.updateOne({ _id: 'upstream:mock-upstream' }, { $set: { tokens: 0, ts: new Date(Date.now() + 60_000) } }, { upsert: true });
    const r = await requestSync(String(u._id), 'MANUAL');
    expect(r).toMatchObject({ accepted: true, outcome: { status: 'RATE_LIMITED' } });
    expect((await User.findById(u._id))!.sync!.lastAttemptAt).toBeFalsy();
    await RateBucket.deleteMany({});
    expect((await requestSync(String(u._id), 'MANUAL'))).toMatchObject({ accepted: true, outcome: { status: 'SYNC_SUCCESS' } });
  });
});
