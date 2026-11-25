import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { acquireLease, assertLease, LeaseLostError, releaseLease, renewLease, withFencedWrite, withLease } from '../src/lib/lease';
import { availableTokens, takeToken } from '../src/lib/ratelimit';
import { JobLease, SolveEvidence } from '../src/models';
import { countableEvidence, recordObservations } from '../src/modules/leetcode/evidence.repository';
import { evidenceFor, resetDb, startDb, stopDb, verifiedLink } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);
const T0 = new Date('2025-01-01T00:00:00Z');
const plus = (ms: number) => new Date(T0.getTime() + ms);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('lease (server clock)', () => {
  it('only one of many concurrent acquirers wins', async () => {
    const r = await Promise.all(Array.from({ length: 20 }, () => acquireLease('sync', 60_000)));
    expect(r.filter(Boolean)).toHaveLength(1);
  });
  it('cannot be taken while valid, can after expiry, fence increases', async () => {
    const a = (await acquireLease('k', 1000, T0))!;
    expect(await acquireLease('k', 1000, plus(500))).toBeNull();
    const b = (await acquireLease('k', 1000, plus(1500)))!;
    expect(b.fence).toBeGreaterThan(a.fence);
  });
  it('renewal extends; fails after expiry or takeover and marks the lease lost', async () => {
    const a = (await acquireLease('k', 1000, T0))!;
    expect(await renewLease(a, 1000, plus(900))).toBe(true);
    expect(await acquireLease('k', 1000, plus(1500))).toBeNull();
    const b = (await acquireLease('k', 1000, plus(2500)))!;
    expect(await renewLease(a, 1000, plus(2600))).toBe(false);
    expect(a.lost).toBe(true);
    expect(await renewLease(b, 1000, plus(2600))).toBe(true);
  });
  it('real-time expiry uses the database clock; assertLease throws for a stale worker', async () => {
    const a = (await acquireLease('k', 50))!;
    await sleep(120);
    const b = (await acquireLease('k', 5000))!;
    await expect(assertLease(a)).rejects.toBeInstanceOf(LeaseLostError);
    await expect(assertLease(b)).resolves.toBeUndefined();
    await releaseLease(b);
    expect(await acquireLease('k', 5000)).toBeTruthy();
  });
  it('withLease: skips when held; renewal failure flips lost so workers stop', async () => {
    let ran = 0;
    const [x, y] = await Promise.all([
      withLease('j', 5000, async () => { ran++; await sleep(100); return 1; }),
      withLease('j', 5000, async () => { ran++; return 2; }),
    ]);
    expect([x, y].filter((v) => v !== null)).toHaveLength(1);
    expect(ran).toBe(1);
    const lostSeen = await withLease('j2', 1500, async (l) => {
      await JobLease.updateOne({ _id: 'j2' }, { $set: { owner: 'someone-else', fence: l.fence + 1 } }); // hostile takeover
      await sleep(1700); // renewal timer fires at ttl/3 clamped to >= 1s
      return l.lost;
    });
    expect(lostSeen).toBe(true);
  });
});

describe('fenced writes (transactions)', () => {
  const sid = new mongoose.Types.ObjectId();
  const sub = (slug: string, at = T0) => ({ submissionId: null, username: 'asha', problemTitle: slug, problemSlug: slug, status: 'ACCEPTED' as const, submittedAt: at, provider: 'mock' });

  it('an expired worker cannot INSERT new evidence after losing its lease', async () => {
    const link = await verifiedLink(sid, 'asha');
    const old = (await acquireLease('student', 50))!;
    await sleep(120);
    const fresh = (await acquireLease('student', 5000))!;
    await expect(withFencedWrite(old, (s) => recordObservations({ studentId: sid, linkId: link._id, username: 'asha' }, [sub('two-sum')], { source: 'MOCK_DEV', provider: 'mock' }, new Date(), s))).rejects.toBeInstanceOf(LeaseLostError);
    expect(await SolveEvidence.countDocuments()).toBe(0);
    await withFencedWrite(fresh, (s) => recordObservations({ studentId: sid, linkId: link._id, username: 'asha' }, [sub('two-sum')], { source: 'MOCK_DEV', provider: 'mock' }, new Date(), s));
    expect(await SolveEvidence.countDocuments()).toBe(1);
  });

  it('an expired worker cannot UPDATE evidence a newer worker has not touched', async () => {
    const link = await verifiedLink(sid, 'asha');
    await evidenceFor(sid, link, 'two-sum', { title: 'original' });
    const old = (await acquireLease('student', 50))!;
    await sleep(120);
    await acquireLease('student', 5000); // newer worker owns the lease but has not written yet
    await expect(withFencedWrite(old, (s) => recordObservations({ studentId: sid, linkId: link._id, username: 'asha' }, [{ ...sub('two-sum'), problemTitle: 'STALE' }], { source: 'MOCK_DEV', provider: 'mock' }, new Date(), s))).rejects.toBeInstanceOf(LeaseLostError);
    expect((await SolveEvidence.findOne())!.title).toBe('original');
  });

  it('a takeover racing with a write: exactly one side wins and the loser leaves nothing behind', async () => {
    const link = await verifiedLink(sid, 'asha');
    for (let i = 0; i < 15; i++) {
      await mongoose.connection.collection('job_leases').deleteMany({});
      await SolveEvidence.deleteMany({});
      const a = (await acquireLease('race', 40))!;
      await sleep(70); // a is now expired
      const [w, b] = await Promise.allSettled([
        withFencedWrite(a, (s) => recordObservations({ studentId: sid, linkId: link._id, username: 'asha' }, [sub('p')], { source: 'MOCK_DEV', provider: 'mock' }, new Date(), s)),
        acquireLease('race', 5000),
      ]);
      expect(w.status).toBe('rejected'); // an expired lease can never write, whoever is faster
      expect(b.status === 'fulfilled' && b.value).toBeTruthy();
      expect(await SolveEvidence.countDocuments()).toBe(0);
    }
  });

  it('evidence is idempotent and monotonic: earliest/latest observed, first/last verified, no duplicates', async () => {
    const link = await verifiedLink(sid, 'asha');
    const l = (await acquireLease('s', 60_000))!;
    const rec = (subs: any[], now: Date) => withFencedWrite(l, (s) => recordObservations({ studentId: sid, linkId: link._id, username: 'asha' }, subs, { source: 'MOCK_DEV', provider: 'mock' }, now, s));
    expect(await rec([sub('two-sum', plus(5000)), sub('two-sum', plus(9000))], plus(10_000))).toBe(1);
    expect(await rec([sub('two-sum', plus(1000))], plus(20_000))).toBe(0); // older sighting moves "earliest" outward
    const d = (await SolveEvidence.find())[0];
    expect(await SolveEvidence.countDocuments()).toBe(1);
    expect(d.earliestObservedSolvedAt!.getTime()).toBe(plus(1000).getTime());
    expect(d.latestObservedSolvedAt!.getTime()).toBe(plus(9000).getTime());
    expect(d.firstVerifiedAt!.getTime()).toBe(plus(10_000).getTime()); // never moves
    expect(d.lastVerifiedAt!.getTime()).toBe(plus(20_000).getTime());
    expect((d.observedAt as unknown as Date[]).map((x) => x.getTime()).sort()).toEqual([plus(1000), plus(5000), plus(9000)].map((x) => x.getTime()));
    expect(d.submissionId).toBeNull();
  });
});

describe('legacy and mock rows never block real evidence', () => {
  const sid = new mongoose.Types.ObjectId();
  it('automated evidence for the exact same student, username and slug as legacy and mock rows is recorded, and only it counts in production', async () => {
    const link = await verifiedLink(sid, 'asha');
    const base = { studentId: sid, slug: 'two-sum', leetcodeUsername: 'asha', status: 'VERIFIED' as const };
    await SolveEvidence.create({ ...base, source: 'TRAINER_ATTESTATION' }); // legacy, no linkId
    await SolveEvidence.create({ ...base, source: 'STUDENT_SELF_REPORT' });
    await SolveEvidence.create({ ...base, source: 'MOCK_DEV', linkId: link._id });
    const l = (await acquireLease('s', 60_000))!;
    const n = await withFencedWrite(l, (s) => recordObservations({ studentId: sid, linkId: link._id, username: 'asha' }, [{ submissionId: null, username: 'asha', problemTitle: 'Two Sum', problemSlug: 'two-sum', status: 'ACCEPTED', submittedAt: T0, provider: 'direct' }], { source: 'AUTOMATED_PROVIDER', provider: 'leetcode-ac' }, new Date(), s));
    expect(n).toBe(1);
    expect(await SolveEvidence.countDocuments()).toBe(4); // nothing was deleted or overwritten
    const { env } = await import('../src/config/env.js');
    (env as any).isProd = true;
    try {
      const counted = await countableEvidence(sid);
      expect(counted).toHaveLength(1);
      expect(counted[0].source).toBe('AUTOMATED_PROVIDER');
    } finally { (env as any).isProd = false; }
    expect((await countableEvidence(sid)).map((e) => e.source).sort()).toEqual(['AUTOMATED_PROVIDER', 'MOCK_DEV']);
  });
  it('legacy rows never count even outside production', async () => {
    const link = await verifiedLink(sid, 'asha');
    await SolveEvidence.create({ studentId: sid, linkId: link._id, slug: 'a', leetcodeUsername: 'asha', status: 'VERIFIED', source: 'TRAINER_ATTESTATION' });
    expect(await countableEvidence(sid)).toHaveLength(0);
  });
  it('MOCK_DEV writes are refused in production', async () => {
    const { env } = await import('../src/config/env.js');
    (env as any).isProd = true;
    try { await expect(recordObservations({ studentId: sid, linkId: sid, username: 'a' }, [{ submissionId: null, username: 'a', problemTitle: 't', problemSlug: 's', status: 'ACCEPTED', submittedAt: null, provider: 'mock' }], { source: 'MOCK_DEV', provider: 'mock' }, new Date())).rejects.toThrow(); }
    finally { (env as any).isProd = false; }
  });
});

describe('global rate limit (MongoDB bucket)', () => {
  it('grants at most `burst` tokens under heavy concurrency, then refills with DB time', async () => {
    const r = await Promise.all(Array.from({ length: 60 }, () => takeToken('t', 600, 10)));
    expect(r.filter(Boolean)).toHaveLength(10);
    expect(await takeToken('t', 600, 10)).toBe(false);
    await sleep(350); // 600/min = 10/s -> about 3 tokens
    const more = await Promise.all(Array.from({ length: 10 }, () => takeToken('t', 600, 10)));
    const n = more.filter(Boolean).length;
    expect(n).toBeGreaterThanOrEqual(2); expect(n).toBeLessThanOrEqual(5);
    expect(await availableTokens('fresh', 60, 7)).toBe(7);
  });
});
