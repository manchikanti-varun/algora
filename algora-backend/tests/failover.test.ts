import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { EvidenceConflict, ProviderEvent, ProviderState, RateBucket, SolveEvidence, User } from '../src/models';
import { countableEvidence } from '../src/modules/leetcode/evidence.repository';
import { invalidateSettings, saveSettings } from '../src/modules/leetcode/integration-settings';
import { requestSync, syncStudent } from '../src/modules/leetcode/leetcode-sync.service';
import { fetchAccepted } from '../src/modules/leetcode/provider-manager';
import { AlfaProvider } from '../src/modules/leetcode/providers/alfa.provider';
import { DirectProvider } from '../src/modules/leetcode/providers/direct.provider';
import { LeetCodeQueryProvider, type LeetCodeQueryClient } from '../src/modules/leetcode/providers/leetcode-query.provider';
import { MockProvider } from '../src/modules/leetcode/providers/mock.provider';
import { setProvidersForTests } from '../src/modules/leetcode/providers/provider.registry';
import type { HttpRequest, HttpTransport } from '../src/modules/leetcode/providers/transport';
import { login, resetDb, startDb, stopDb, tok, verifiedLink } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
afterEach(() => { setProvidersForTests(undefined); (env as any).LEETCODE_SYNC_ENABLED = false; });

const T = 1_700_000_000; // seconds
const ok = () => ({ authorized: true });
let seq = 0;
async function student(username = 'asha') {
  const u = await User.create({ googleSub: `s${++seq}`, email: `s${seq}@x.com`, role: 'STUDENT', fullName: `S ${seq}`, rollNumber: `F${String(seq).padStart(9, '0')}`, leetcodeUsername: username });
  const link = await verifiedLink(u._id, username);
  return { u, link, id: String(u._id) };
}
/** Three mock providers that share the LeetCode upstream, like the real ones. */
function trio() {
  const mk = (id: string) => { const m = new MockProvider(id); m.capabilities = { ...m.capabilities, upstream: 'leetcode-graphql', reachesUpstreamDirectly: id !== 'alfa' }; return m; };
  const d = mk('direct'), a = mk('alfa'), q = mk('leetcode-query');
  setProvidersForTests([d, a, q]);
  return { d, a, q };
}
const solveAll = (ps: MockProvider[], user: string, slug: string, at = new Date(T * 1000), id: string | null = null) => ps.forEach((p) => p.solve(user, slug, at, slug, id));
const events = (type: string) => ProviderEvent.find({ type } as Record<string, unknown>).lean();
const state = (id: string) => ProviderState.findById(`provider:${id}`).lean();

/** Fake LeetCode GraphQL endpoint for the real DirectProvider. */
function fakeLeetCode(handler: (body: any, req: HttpRequest) => { status: number; body: unknown; headers?: Record<string, string> }): HttpTransport & { calls: number } {
  const t: any = { kind: 'mock', calls: 0, send: async (req: HttpRequest) => {
    t.calls++;
    if (req.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const r = handler(req.body ? JSON.parse(req.body) : null, req);
    if (r.status === -1) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { status: r.status, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, text: async () => text };
  } };
  return t;
}
const acRows = (rows: { id?: string; slug: string; ts: number }[]) => ({ data: { recentAcSubmissionList: rows.map((r) => ({ id: r.id, title: r.slug, titleSlug: r.slug, timestamp: String(r.ts) })) } });

beforeEach(async () => {
  await resetDb();
  (env as any).LEETCODE_SYNC_ENABLED = true;
  (env as any).LEETCODE_ALFA_RATE_PER_MIN = 60; // scenarios below are about failover, not Alfa's small default budget
  invalidateSettings();
});

describe('failover scenarios (mock providers sharing one upstream)', () => {
  it('1. primary succeeds: only the primary is called', async () => {
    const { d, a, q } = trio(); const s = await student(); solveAll([d, a, q], 'asha', 'two-sum');
    const o = await syncStudent(s.id, 'MANUAL');
    expect(o).toMatchObject({ status: 'SYNC_SUCCESS', provider: 'direct', failedOver: false, newlyVerified: 1 });
    expect([d.calls, a.calls, q.calls]).toEqual([1, 0, 0]);
  });

  it('2. primary has a provider-specific failure, secondary succeeds; failover is recorded', async () => {
    const { d, a, q } = trio(); const s = await student(); solveAll([d, a, q], 'asha', 'two-sum');
    d.failWith = 'PROVIDER_UNAVAILABLE';
    const o = await syncStudent(s.id, 'MANUAL');
    expect(o).toMatchObject({ status: 'SYNC_SUCCESS', provider: 'alfa', failedOver: true });
    expect([d.calls, a.calls, q.calls]).toEqual([1, 1, 0]);
    expect((await events('FAILOVER'))[0]).toMatchObject({ provider: 'direct', toProvider: 'alfa', kind: 'PROVIDER_UNAVAILABLE' });
    expect((await SolveEvidence.findOne())!.providers).toEqual(['alfa']);
  });

  it('3. primary and secondary fail independently, tertiary succeeds', async () => {
    const { d, a, q } = trio(); const s = await student(); solveAll([d, a, q], 'asha', 'two-sum');
    d.failWith = 'BAD_RESPONSE'; a.failWith = 'CONFIG_ERROR';
    expect(await syncStudent(s.id, 'MANUAL')).toMatchObject({ status: 'SYNC_SUCCESS', provider: 'leetcode-query' });
    expect([d.calls, a.calls, q.calls]).toEqual([1, 1, 1]);
  });

  it('4 + 18. all providers fail: clear status, no evidence lost, progress still counted, ALL_FAILED recorded', async () => {
    const { d, a, q } = trio(); const s = await student(); solveAll([d, a, q], 'asha', 'two-sum');
    await syncStudent(s.id, 'MANUAL');
    expect(await countableEvidence(s.u._id)).toHaveLength(1);
    d.failWith = 'PROVIDER_UNAVAILABLE'; a.failWith = 'PROVIDER_TIMEOUT'; q.failWith = 'CLIENT_ERROR';
    const o = await syncStudent(s.id, 'MANUAL');
    expect(o.status).toBe('PROVIDER_UNAVAILABLE');
    expect(o.message).toMatch(/verified progress is unchanged/);
    expect(await countableEvidence(s.u._id)).toHaveLength(1);
    expect(await events('ALL_FAILED')).toHaveLength(1);
    expect((await User.findById(s.u._id))!.sync!.lastSuccessAt).toBeTruthy(); // last success kept
  });

  it('5 + 14. circuit opens at the threshold, open provider is skipped without a call, then recovers via one half-open probe and becomes preferred again', async () => {
    const { d, a, q } = trio(); const s = await student(); solveAll([d, a, q], 'asha', 'two-sum');
    d.failWith = 'PROVIDER_UNAVAILABLE';
    for (let i = 0; i < env.LEETCODE_PROVIDER_FAILURE_THRESHOLD; i++) await fetchAccepted('asha', 20);
    expect((await state('direct'))!.openedAt).toBeTruthy();
    expect(await events('CIRCUIT_OPEN')).toHaveLength(1);
    const before = d.calls;
    expect((await fetchAccepted('asha', 20)) as any).toMatchObject({ ok: true, provider: { id: 'alfa' } });
    expect(d.calls).toBe(before); // skipped while open
    // pause elapses
    await ProviderState.updateOne({ _id: 'provider:direct' }, { $set: { openedAt: new Date(Date.now() - 10 * 60_000) } });
    d.failWith = null;
    // concurrent requests: exactly one is the probe
    const rs = await Promise.all([1, 2, 3].map(() => fetchAccepted('asha', 20)));
    expect(d.calls - before).toBe(1);
    expect(rs.filter((r) => r.ok && r.provider.id === 'direct')).toHaveLength(1);
    expect((await state('direct'))!.openedAt).toBeNull();
    expect(await events('CIRCUIT_CLOSED')).toHaveLength(1);
    expect(((await syncStudent(s.id, 'MANUAL')) as any).provider).toBe('direct'); // preferred provider restored
  });

  it('a failed half-open probe re-opens the circuit with a longer pause (no flapping)', async () => {
    const { d } = trio(); d.solve('asha', 'x');
    await ProviderState.create({ _id: 'provider:direct', kind: 'PROVIDER', consecutiveFailures: 5, openedAt: new Date(Date.now() - 10 * 60_000), openCount: 1 });
    d.failWith = 'PROVIDER_UNAVAILABLE';
    await fetchAccepted('asha', 20);
    const st = (await state('direct'))!;
    expect(st.openCount).toBe(2);
    expect(Date.now() - new Date(st.openedAt!).getTime()).toBeLessThan(5000);
  });

  it('10. empty submission list is a success, not a failure or failover', async () => {
    const { d, a } = trio(); const s = await student(); d.solve('asha', 'x'); d.windowSize = 0;
    expect(await syncStudent(s.id, 'MANUAL')).toMatchObject({ status: 'SYNC_SUCCESS', newlyVerified: 0, provider: 'direct' });
    expect(a.calls).toBe(0);
  });

  it('11. provider-specific rate limit (its own limiter) fails over and the provider sits out until Retry-After', async () => {
    const { d, a, q } = trio(); const s = await student(); solveAll([d, a, q], 'asha', 'two-sum');
    await saveSettings({ paused: false, disabled: [], providerRatePerMin: {}, priority: ['alfa', 'direct', 'leetcode-query'] }, null);
    a.failWith = 'PROVIDER_RATE_LIMITED'; a.retryAfterSec = 600;
    expect((await syncStudent(s.id, 'MANUAL')).provider).toBe('direct');
    const st = (await state('alfa'))!;
    expect(new Date(st.rateLimitedUntil!).getTime()).toBeGreaterThan(Date.now() + 500_000);
    expect(st.consecutiveFailures ?? 0).toBe(0); // a rate limit is not a breaker failure
    a.failWith = null; const calls = a.calls;
    await fetchAccepted('asha', 20);
    expect(a.calls).toBe(calls); // still sitting out
  });

  it('11b. a provider with no budget left is skipped (token refunded to the shared budget), next provider serves', async () => {
    const { d, a } = trio(); d.solve('asha', 'x'); a.solve('asha', 'x');
    await RateBucket.collection.insertOne({ _id: 'provider:direct' as any, tokens: 0, ts: new Date(Date.now() + 60_000) });

    const r: any = await fetchAccepted('asha', 20);
    expect(r).toMatchObject({ ok: true, provider: { id: 'alfa' } });
    expect(r.attempts[0]).toMatchObject({ provider: 'direct', outcome: 'SKIPPED', reason: 'PROVIDER_BUDGET' });
    expect(d.calls).toBe(0);
    // one shared token consumed (by alfa), the one taken for direct was refunded
    const after = (await RateBucket.findById('upstream:leetcode-graphql').lean())!.tokens!;
    expect(after).toBeGreaterThanOrEqual(Math.max(5, env.LEETCODE_GLOBAL_RATE_PER_MIN) - 1 - 0.01);
  });

  it('12. shared LeetCode rate limit: no failover, every provider respects it, Retry-After honoured', async () => {
    const { d, a, q } = trio(); const s1 = await student('one'); const s2 = await student('two');
    solveAll([d, a, q], 'one', 'x'); solveAll([d, a, q], 'two', 'x');
    d.failWith = 'UPSTREAM_RATE_LIMITED'; d.retryAfterSec = 120;
    const o = await syncStudent(s1.id, 'MANUAL');
    expect(o.status).toBe('RATE_LIMITED');
    expect([d.calls, a.calls, q.calls]).toEqual([1, 0, 0]);
    const up = (await ProviderState.findById('upstream:leetcode-graphql').lean())!;
    expect(new Date(up.blockedUntil!).getTime() - Date.now()).toBeGreaterThan(100_000);
    d.failWith = null;
    expect((await syncStudent(s2.id, 'MANUAL')).status).toBe('RATE_LIMITED'); // blocked for everyone, zero calls
    expect([d.calls, a.calls, q.calls]).toEqual([1, 0, 0]);
  });

  it('12b. shared Algora budget exhausted: RATE_LIMITED without trying other providers', async () => {
    const { d, a } = trio(); const s = await student(); d.solve('asha', 'x'); a.solve('asha', 'x');
    await RateBucket.collection.insertOne({ _id: 'upstream:leetcode-graphql' as any, tokens: 0, ts: new Date(Date.now() + 60_000) });
    expect((await syncStudent(s.id, 'MANUAL')).status).toBe('RATE_LIMITED');
    expect(d.calls + a.calls).toBe(0);
  });

  it('13. LeetCode access denied: 30-minute block for all providers, no failover', async () => {
    const { d, a, q } = trio(); const s = await student(); solveAll([d, a, q], 'asha', 'x');
    d.failWith = 'UPSTREAM_ACCESS_DENIED';
    const o = await syncStudent(s.id, 'MANUAL');
    expect(o.status).toBe('PROVIDER_UNAVAILABLE'); expect(o.message).toMatch(/restricting access/);
    expect(a.calls + q.calls).toBe(0);
    const up = (await ProviderState.findById('upstream:leetcode-graphql').lean())!;
    expect(new Date(up.blockedUntil!).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(await events('UPSTREAM_BLOCK')).toHaveLength(1);
  });

  it('network failures from two different direct-upstream providers within 2 min mark LeetCode unreachable (no third request)', async () => {
    const { d, a, q } = trio(); q.solve('asha', 'x');
    await saveSettings({ paused: false, disabled: [], providerRatePerMin: {}, priority: ['direct', 'leetcode-query', 'alfa'] }, null);
    d.failWith = 'PROVIDER_UNAVAILABLE'; q.failWith = 'PROVIDER_UNAVAILABLE';
    const r: any = await fetchAccepted('asha', 20);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('UPSTREAM_BLOCKED');
    expect(a.calls).toBe(0);
  });

  it('15. concurrent syncs for one student, even during failover, make one provider round', async () => {
    const { d, a } = trio(); const s = await student(); d.solve('asha', 'x'); a.solve('asha', 'x'); d.failWith = 'PROVIDER_UNAVAILABLE'; a.latencyMs = 40;
    await Promise.all(Array.from({ length: 6 }, () => syncStudent(s.id, 'MANUAL')));
    expect([d.calls, a.calls]).toEqual([1, 1]);
    const rs = await Promise.all(Array.from({ length: 8 }, () => requestSync(s.id, 'MANUAL', new Date(Date.now() + 10 * 60_000))));
    expect(rs.filter((r) => r.accepted).length).toBe(1);
  });

  it('16. provider health is shared: a circuit opened by one instance is honoured by another (state lives in MongoDB)', async () => {
    const { d, a } = trio(); d.solve('asha', 'x'); a.solve('asha', 'x');
    // "instance B" opened the breaker
    await ProviderState.create({ _id: 'provider:direct', kind: 'PROVIDER', consecutiveFailures: 5, openedAt: new Date(), openCount: 1 });
    const r: any = await fetchAccepted('asha', 20);
    expect(r.provider.id).toBe('alfa'); expect(d.calls).toBe(0);
  });

  it('17 + 8. overlapping results through different providers: one row per problem, points unchanged by switching', async () => {
    const { d, a } = trio(); const s = await student();
    d.solve('asha', 'two-sum'); d.solve('asha', 'three-sum');
    a.solve('asha', 'three-sum'); a.solve('asha', 'valid-anagram');
    await syncStudent(s.id, 'MANUAL');
    d.failWith = 'PROVIDER_UNAVAILABLE';
    await User.updateOne({ _id: s.u._id }, { $unset: { 'sync.lastAttemptAt': 1 } });
    expect((await syncStudent(s.id, 'MANUAL')).provider).toBe('alfa');
    const ev = await SolveEvidence.find({ studentId: s.u._id }).lean();
    expect(ev.map((e) => e.slug).sort()).toEqual(['three-sum', 'two-sum', 'valid-anagram']);
    expect(ev.find((e) => e.slug === 'three-sum')!.providers.sort()).toEqual(['alfa', 'direct']);
    const counted = await countableEvidence(s.u._id);
    expect(counted).toHaveLength(3); // each problem once
  });

  it('20. unauthorised providers are never selected; with none authorised, verification is unavailable and nothing is called', async () => {
    const d = new MockProvider('direct', false), a = new MockProvider('alfa');
    d.solve('asha', 'x'); a.solve('asha', 'x');
    setProvidersForTests([d, a]);
    const s = await student();
    expect((await syncStudent(s.id, 'MANUAL')).provider).toBe('alfa');
    expect(d.calls).toBe(0);
    a.setAuthorized(false);
    await User.updateOne({ _id: s.u._id }, { $unset: { 'sync.lastAttemptAt': 1 } });
    expect((await syncStudent(s.id, 'MANUAL')).status).toBe('VERIFICATION_UNAVAILABLE');
    expect(d.calls + a.calls).toBe(1);
  });

  it('22. all-status provider: reduced coverage reported, gap detection uses the raw window', async () => {
    const q = new MockProvider('leetcode-query'); q.capabilities = { ...q.capabilities, acceptedOnly: false, upstream: 'leetcode-graphql' };
    setProvidersForTests([q]); const s = await student(); q.solve('asha', 'x');
    const o = await syncStudent(s.id, 'MANUAL');
    expect(o).toMatchObject({ status: 'SYNC_SUCCESS', coverage: 'REDUCED' });
    expect((await User.findById(s.u._id))!.sync!.coverage).toBe('REDUCED');
    const c = await login(tok(`s${seq}`, `s${seq}@x.com`));
    expect((await c.call('get', '/leetcode/sync-status')).body.coverage).toBe('REDUCED');
  });

  it('21. mock evidence never enters production', async () => {
    (env as any).isProd = true;
    try {
      expect(() => setProvidersForTests([new MockProvider()])).toThrow();
      const { recordObservations } = await import('../src/modules/leetcode/evidence.repository.js');
      await expect(recordObservations({ studentId: new mongoose.Types.ObjectId(), linkId: new mongoose.Types.ObjectId(), username: 'a' }, [{ submissionId: null, username: 'a', problemTitle: 't', problemSlug: 's', status: 'ACCEPTED', submittedAt: null, provider: 'mock' }], { source: 'MOCK_DEV', provider: 'mock' }, new Date())).rejects.toThrow();
    } finally { (env as any).isProd = false; }
  });

  it('student responses never reveal provider names or failover details', async () => {
    const { d, a } = trio(); await student(); d.solve('asha', 'x'); a.solve('asha', 'x'); d.failWith = 'PROVIDER_UNAVAILABLE';
    const c = await login(tok(`s${seq}`, `s${seq}@x.com`));
    const r = await c.call('post', '/leetcode/request-sync', {});
    expect(r.body.outcome.status).toBe('SYNC_SUCCESS');
    expect(JSON.stringify(r.body)).not.toMatch(/alfa|direct|failedOver|leetcode-query/);
  });
});

describe('real adapters on mock transports', () => {
  it('2/6. Direct gets malformed data -> BAD_RESPONSE -> Alfa adapter serves; evidence from Alfa', async () => {
    const lc = fakeLeetCode(() => ({ status: 200, body: { data: { recentAcSubmissionList: 'oops' } } }));
    const alfaT = fakeLeetCode(() => ({ status: 200, body: { count: 1, submission: [{ title: 'Two Sum', titleSlug: 'two-sum', timestamp: String(T), statusDisplay: 'Accepted', lang: 'java' }] } }));
    setProvidersForTests([new DirectProvider(lc, ok, 'ua'), new AlfaProvider(alfaT, 'https://alfa.test', ok, 'ua', 300)]);
    const s = await student();
    expect(await syncStudent(s.id, 'MANUAL')).toMatchObject({ status: 'SYNC_SUCCESS', provider: 'alfa', failedOver: true });
    const e = (await SolveEvidence.findOne().lean())!;
    expect(e).toMatchObject({ slug: 'two-sum', provider: 'alfa', submissionId: null, source: 'MOCK_DEV' });
    expect(e.earliestObservedSolvedAt!.getTime()).toBe(T * 1000);
  });

  it('Direct: HTTP 429 with Retry-After blocks the upstream; Alfa is not called', async () => {
    const lc = fakeLeetCode(() => ({ status: 429, body: 'slow down', headers: { 'retry-after': '90' } }));
    const alfaT = fakeLeetCode(() => ({ status: 200, body: { count: 0, submission: [] } }));
    setProvidersForTests([new DirectProvider(lc, ok, 'ua'), new AlfaProvider(alfaT, 'https://alfa.test', ok, 'ua')]);
    const s = await student();
    expect((await syncStudent(s.id, 'MANUAL')).status).toBe('RATE_LIMITED');
    expect(alfaT.calls).toBe(0);
    const up = (await ProviderState.findById('upstream:leetcode-graphql').lean())!;
    expect(Math.round((new Date(up.blockedUntil!).getTime() - Date.now()) / 1000)).toBeGreaterThan(80);
  });

  it('Direct: CAPTCHA/challenge page -> UPSTREAM_ACCESS_DENIED', async () => {
    const lc = fakeLeetCode(() => ({ status: 403, body: '<html><title>Just a moment...</title>cf-chl</html>' }));
    setProvidersForTests([new DirectProvider(lc, ok, 'ua'), new AlfaProvider(fakeLeetCode(() => ({ status: 200, body: {} })), 'https://alfa.test', ok, 'ua')]);
    const s = await student();
    const o = await syncStudent(s.id, 'MANUAL');
    expect(o.message).toMatch(/restricting access/);
    expect((await ProviderState.findById('upstream:leetcode-graphql').lean())!.blockedReason).toBe('UPSTREAM_ACCESS_DENIED');
  });

  it('Alfa relays a LeetCode block as plain text in HTTP 200 -> treated as an upstream restriction (no circumvention)', async () => {
    const alfaT = fakeLeetCode(() => ({ status: 200, body: "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON" }));
    const lq = new MockProvider('leetcode-query'); lq.capabilities = { ...lq.capabilities, upstream: 'leetcode-graphql' }; lq.solve('asha', 'x');
    setProvidersForTests([new AlfaProvider(alfaT, 'https://alfa.test', ok, 'ua'), lq]);
    const s = await student();
    expect((await syncStudent(s.id, 'MANUAL')).status).toBe('PROVIDER_UNAVAILABLE');
    expect(lq.calls).toBe(0);
  });

  it('Alfa: its own 429 is provider-specific (failover), GraphQL "user does not exist" in HTTP 200 is NOT_FOUND (no failover)', async () => {
    const lq = new MockProvider('leetcode-query'); lq.capabilities = { ...lq.capabilities, upstream: 'leetcode-graphql' }; lq.solve('asha', 'x');
    setProvidersForTests([new AlfaProvider(fakeLeetCode(() => ({ status: 429, body: 'Too many request from this IP, try again in 1 hour' })), 'https://alfa.test', ok, 'ua'), lq]);
    const s = await student();
    expect((await syncStudent(s.id, 'MANUAL')).provider).toBe('leetcode-query');
    const lq2 = new MockProvider('leetcode-query'); lq2.capabilities = { ...lq2.capabilities, upstream: 'leetcode-graphql' }; lq2.solve('asha', 'x');
    setProvidersForTests([new AlfaProvider(fakeLeetCode(() => ({ status: 200, body: { errors: [{ message: 'That user does not exist.' }] } })), 'https://alfa.test', ok, 'ua'), lq2]);
    await ProviderState.deleteMany({});
    const s2 = await student('ghost');
    expect((await syncStudent(s2.id, 'MANUAL')).status).toBe('VERIFICATION_UNAVAILABLE');
    expect(lq2.calls).toBe(0);
  });

  it('Direct: timeout aborts and fails over; connection refused on two direct providers blocks the upstream', async () => {
    (env as any).LEETCODE_PROVIDER_TIMEOUT_MS = 1000; invalidateSettings();
    try {
      const slow: HttpTransport = { kind: 'mock', send: (r) => new Promise((_, rej) => r.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) };
      const alfa = new AlfaProvider(fakeLeetCode(() => ({ status: 200, body: { count: 1, submission: [{ title: 'x', titleSlug: 'x', timestamp: String(T), statusDisplay: 'Accepted' }] } })), 'https://alfa.test', ok, 'ua');
      setProvidersForTests([new DirectProvider(slow, ok, 'ua'), alfa]);
      const s = await student();
      const t0 = Date.now();
      expect((await syncStudent(s.id, 'MANUAL')).provider).toBe('alfa');
      expect(Date.now() - t0).toBeLessThan(3000);
      expect((await state('direct'))!.lastErrorKind).toBe('PROVIDER_TIMEOUT');
    } finally { (env as any).LEETCODE_PROVIDER_TIMEOUT_MS = 10_000; invalidateSettings(); }
  });

  it('7 + 9. duplicates collapse; conflicting timestamps and slugs for the same submission id are recorded and not used', async () => {
    let phase = 0;
    const lc = fakeLeetCode(() => phase === 0
      ? { status: 200, body: acRows([{ id: '101', slug: 'two-sum', ts: T }, { id: '101', slug: 'two-sum', ts: T }, { id: '102', slug: 'two-sum', ts: T + 60 }]) }
      : { status: 200, body: acRows([{ id: '101', slug: 'two-sum', ts: T + 3600 }, { id: '102', slug: 'three-sum', ts: T + 60 }]) });
    setProvidersForTests([new DirectProvider(lc, ok, 'ua')]);
    const s = await student();
    expect((await syncStudent(s.id, 'MANUAL')).newlyVerified).toBe(1);
    expect(await SolveEvidence.countDocuments()).toBe(1);
    phase = 1;
    await User.updateOne({ _id: s.u._id }, { $unset: { 'sync.lastAttemptAt': 1 } });
    expect((await syncStudent(s.id, 'MANUAL')).newlyVerified).toBe(0); // three-sum NOT awarded: id 102 was two-sum
    const c = await EvidenceConflict.find().lean();
    expect(c.map((x) => x.type).sort()).toEqual(['SUBMISSION_SLUG_MISMATCH', 'TIMESTAMP_MISMATCH']);
    const e = (await SolveEvidence.findOne({ slug: 'two-sum' }).lean())!;
    expect(e.latestObservedSolvedAt!.getTime()).toBe((T + 60) * 1000); // conflicting +1h timestamp not used
    expect(await SolveEvidence.exists({ slug: 'three-sum' })).toBeNull();
  });

  it('future timestamps are dropped to null and recorded', async () => {
    const lc = fakeLeetCode(() => ({ status: 200, body: acRows([{ id: '9', slug: 'two-sum', ts: Math.floor(Date.now() / 1000) + 86400 }]) }));
    setProvidersForTests([new DirectProvider(lc, ok, 'ua')]);
    const s = await student();
    await syncStudent(s.id, 'MANUAL');
    expect((await SolveEvidence.findOne().lean())!.earliestObservedSolvedAt).toBeUndefined();
    expect((await EvidenceConflict.findOne().lean())!.type).toBe('FUTURE_TIMESTAMP');
  });

  it('LeetCode Query adapter: accepted mode uses the accepted-only query; all-status mode filters and reports reduced coverage', async () => {
    const queries: string[] = [];
    const client: LeetCodeQueryClient = {
      graphql: async (q) => { queries.push(q.query); return { data: { recentAcSubmissionList: [{ id: '5', title: 'Two Sum', titleSlug: 'two-sum', timestamp: String(T) }] } }; },
      recent_submissions: async () => [
        { title: 'Two Sum', titleSlug: 'two-sum', timestamp: String(T), statusDisplay: 'Wrong Answer' },
        { title: 'Two Sum', titleSlug: 'two-sum', timestamp: String(T + 5), statusDisplay: 'Accepted' },
        { title: '3Sum', titleSlug: '3sum', timestamp: String(T + 9), statusDisplay: 'Time Limit Exceeded' },
      ],
      user: async () => ({ matchedUser: { profile: { aboutMe: 'hi algora-verify-x' } } }),
    };
    const acc = new LeetCodeQueryProvider(async () => client, ok, 'mock', 'accepted');
    const r1 = await acc.fetchAccepted('asha', 20, new AbortController().signal);
    expect(queries[0]).toContain('recentAcSubmissionList');
    expect(r1).toMatchObject({ acceptedOnly: true, rawCount: 1 }); expect(r1.submissions[0].submissionId).toBe('5');
    const all = new LeetCodeQueryProvider(async () => client, ok, 'mock', 'all-status');
    const r2 = await all.fetchAccepted('asha', 20, new AbortController().signal);
    expect(r2).toMatchObject({ acceptedOnly: false, rawCount: 3 });
    expect(r2.submissions.map((s) => s.problemSlug)).toEqual(['two-sum']);
    expect(all.capabilities.acceptedOnly).toBe(false);
    expect(await acc.fetchProfileText('asha', new AbortController().signal)).toContain('algora-verify-x');
    const failing = new LeetCodeQueryProvider(async () => ({ ...client, graphql: async () => { throw new Error('HTTP 429 Too Many Requests: slow'); } }), ok, 'mock');
    await expect(failing.fetchAccepted('a', 20, new AbortController().signal)).rejects.toMatchObject({ kind: 'UPSTREAM_RATE_LIMITED' });
  });
});

describe('Super Admin integration controls', () => {
  it('overview, settings bounded by environment, pause, priority, health check, events', async () => {
    const { d, a } = trio(); d.solve('hc_user', 'x'); a.solve('hc_user', 'x');
    const admin = await login(tok('sub-admin', 'admin@example.com', 'Admin'));
    const o = (await admin.call('get', '/leetcode/integration')).body;
    expect(o).toMatchObject({ overall: 'HEALTHY', selectedProvider: 'direct', priority: ['direct', 'alfa', 'leetcode-query'] });
    expect(o.providers).toHaveLength(3);
    expect(JSON.stringify(o)).not.toMatch(/PERMISSION_REF|https:\/\//);
    // cannot exceed ceilings, cannot name unknown providers
    expect((await admin.call('put', '/leetcode/integration/settings', { ratePerMin: env.LEETCODE_GLOBAL_RATE_PER_MIN + 1 })).status).toBe(400);
    expect((await admin.call('put', '/leetcode/integration/settings', { disabled: ['nope'] })).status).toBe(400);
    // reorder + disable
    expect((await admin.call('put', '/leetcode/integration/settings', { priority: ['alfa', 'direct', 'leetcode-query'], disabled: ['leetcode-query'] })).status).toBe(200);
    const o2 = (await admin.call('get', '/leetcode/integration')).body;
    expect(o2.selectedProvider).toBe('alfa');
    expect(o2.providers.find((p: any) => p.id === 'leetcode-query').status).toBe('DISABLED');
    // pause: students get SYNC_PAUSED and no calls
    await admin.call('put', '/leetcode/integration/settings', { paused: true });
    const s = await student();
    const r = await requestSync(s.id, 'MANUAL');
    expect(r).toMatchObject({ accepted: true, outcome: { status: 'SYNC_PAUSED' } });
    expect((await admin.call('get', '/leetcode/integration')).body.settings.disabled).toEqual(['leetcode-query']); // pause did not reset other settings
    const sv = (await (await login(tok(`s${seq}`, `s${seq}@x.com`))).call('get', '/leetcode/sync-status')).body;
    expect(sv).toMatchObject({ syncEnabled: true, paused: true }); // students see 'paused', not 'unavailable'
    expect(d.calls + a.calls).toBe(0);
    await admin.call('put', '/leetcode/integration/settings', { paused: false });
    // health check (consenting account configured)
    (env as any).LEETCODE_HEALTHCHECK_USERNAME = 'hc_user';
    try {
      const h = (await admin.call('post', '/leetcode/integration/health-check', {})).body;
      expect(h.results.map((x: any) => x.result)).toEqual(['OK', 'OK', 'SKIPPED_NOT_ELIGIBLE']);
    } finally { delete (env as any).LEETCODE_HEALTHCHECK_USERNAME; }
    expect((await admin.call('get', '/leetcode/integration/events?type=HEALTH_CHECK')).body.total).toBe(1);
    const t = await login(tok(`s${seq}`, `s${seq}@x.com`));
    expect((await t.call('get', '/leetcode/integration')).status).toBe(403);
  });

  it('an admin cannot enable a provider the environment did not enable', async () => {
    (env as any).LEETCODE_ALFA_ENABLED = false;
    setProvidersForTests(undefined);
    const admin = await login(tok('sub-admin', 'admin@example.com', 'Admin'));
    await admin.call('put', '/leetcode/integration/settings', { disabled: [] });
    const o = (await admin.call('get', '/leetcode/integration')).body;
    const alfa = o.providers.find((p: any) => p.id === 'alfa');
    expect(alfa.envEnabled).toBe(false);
    expect(['DISABLED', 'ACCESS_NOT_AUTHORIZED']).toContain(alfa.status);
    expect(o.providers.find((p: any) => p.id === 'direct').status).toBe('ACCESS_NOT_AUTHORIZED'); // no LEETCODE_PERMISSION_REF in tests
  });
});

describe('consent and withdrawal', () => {
  it('linking requires consent; withdrawal deletes LeetCode-derived data', async () => {
    const { d } = trio(); const s = await student(); d.solve('asha', 'x');
    await syncStudent(s.id, 'MANUAL');
    const c = await login(tok(`s${seq}`, `s${seq}@x.com`));
    expect((await c.call('post', '/student/leetcode/link', { username: 'other_name' })).status).toBe(400);
    expect((await c.call('delete', '/student/leetcode/data', { confirm: 'nope' })).status).toBe(400);
    const r = await c.call('delete', '/student/leetcode/data', { confirm: 'DELETE' });
    expect(r.body).toMatchObject({ ok: true, evidence: 1 });
    expect(await SolveEvidence.countDocuments({ studentId: s.u._id })).toBe(0);
    expect(r.body.link.state).toBe('REVOKED');
  });
});

describe('shared budget accounting', () => {
  it('a request that never left the server (connection refused) returns its shared token, so failover still works when the budget is tight', async () => {
    const lc = fakeLeetCode(() => ({ status: -1, body: '' })); // ECONNREFUSED
    const alfaT = fakeLeetCode(() => ({ status: 200, body: { count: 0, submission: [] } }));
    setProvidersForTests([new DirectProvider(lc, ok, 'ua'), new AlfaProvider(alfaT, 'https://alfa.test', ok, 'ua')]);
    (env as any).LEETCODE_GLOBAL_RATE_PER_MIN = 1; invalidateSettings(); // ~0 refill during the test
    await RateBucket.collection.insertOne({ _id: 'upstream:leetcode-graphql' as any, tokens: 1, ts: new Date() });
    let r: any;
    try { r = await fetchAccepted('asha', 20); } finally { (env as any).LEETCODE_GLOBAL_RATE_PER_MIN = 20; invalidateSettings(); }
    expect(r).toMatchObject({ ok: true, provider: { id: 'alfa' }, failedOver: true });
    expect(lc.calls).toBe(1); expect(alfaT.calls).toBe(1);
  });
});
