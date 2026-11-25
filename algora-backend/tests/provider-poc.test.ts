import { describe, expect, it } from 'vitest';
import { DirectClient, PocError, type Fetch } from '../scripts/provider-poc/direct';
import { minIntervalMin, requestsPerHour } from '../scripts/provider-poc/capacity';
import { run } from '../scripts/provider-poc/bootcamp-sim';

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Fetch => async () => ({ status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const T = 1_700_000_000;
const kind = (p: Promise<unknown>) => p.then(() => 'OK', (e) => (e instanceof PocError ? e.kind : 'OTHER'));

describe('measurement client parsing (mocked responses shaped like the documented schema; not live data)', () => {
  it('normalises slugs and timestamps; ids only when present; skips malformed rows', async () => {
    const c = new DirectClient(reply(200, { data: { recentAcSubmissionList: [{ id: '7', title: 'Two Sum', titleSlug: 'Two-Sum', timestamp: String(T) }, { titleSlug: 'bad slug!', timestamp: '1' }, { titleSlug: 'x', timestamp: 'abc' }] } }), 'ua');
    const rows = await c.acceptedOnly('u', 20);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ slug: 'two-sum', id: '7' }); expect(rows[0].at!.getTime()).toBe(T * 1000);
    expect(rows[1].at).toBeNull();
  });
  it('invalid user, 429, 403, 503, HTML, GraphQL error', async () => {
    expect(await kind(new DirectClient(reply(200, { errors: [{ message: 'That user does not exist.' }] }), 'ua').acceptedOnly('u', 20))).toBe('NOT_FOUND');
    expect(await kind(new DirectClient(reply(429, 'x'), 'ua').acceptedOnly('u', 20))).toBe('RATE_LIMITED'); // body is irrelevant for 429
    expect(await kind(new DirectClient(reply(429, {}, { 'retry-after': '9' }), 'ua').acceptedOnly('u', 20))).toBe('RATE_LIMITED');
    expect(await kind(new DirectClient(reply(403, {}), 'ua').acceptedOnly('u', 20))).toBe('RATE_LIMITED');
    expect(await kind(new DirectClient(reply(503, 'x'), 'ua').acceptedOnly('u', 20))).toBe('UNAVAILABLE');
    expect(await kind(new DirectClient(reply(200, '<html>'), 'ua').acceptedOnly('u', 20))).toBe('BAD_RESPONSE');
  });
  it('timeout aborts', async () => {
    const hang: Fetch = (_u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    expect(await kind(new DirectClient(hang, 'ua', 30).acceptedOnly('u', 20))).toBe('TIMEOUT');
  });
});

describe('capacity and simulation sanity', () => {
  it('request arithmetic', () => { expect(requestsPerHour(200, 45)).toBe(267); expect(minIntervalMin(200, 120)).toBe(100); });
  it('simulation: accepted-only never captures less than all-status, hourly in-hours sweep is near-complete', () => {
    const rows = run({ students: 40, days: 5, hoursPerDay: 8, sessionsPerDay: [2, 4], sessionHours: [1, 2.5], attemptsPerHour: 12, acceptRate: 0.25, windowSize: 20 }, 7);
    for (const r of rows) expect(parseFloat(r['accepted-only window'])).toBeGreaterThanOrEqual(parseFloat(r['all-status window']));
    expect(parseFloat(rows.find((r) => r.schedule.startsWith('every 60'))!['accepted-only window'])).toBeGreaterThan(98);
  });
});
