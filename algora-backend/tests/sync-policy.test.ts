import { describe, expect, it } from 'vitest';
import { autoAllowedNow, backoffSec, defaultPolicy, inBootcampHours, jitterFraction, manualEligibility, minSpacingSec, nextAutoSyncAt, nextWindowStart, parseHours, reconciliationDue, termEndInstant } from '../src/modules/leetcode/sync.policy';
const c = defaultPolicy({ term: { start: new Date('2026-12-07'), end: new Date('2026-12-11') } }); // IST 09:30-16:30 Mon-Fri, interval 30
const ist = (s: string) => new Date(`${s}+05:30`);
describe('calendar', () => {
  it('parses hours and treats date-only term bounds as whole local days', () => {
    expect(parseHours('09:30-16:30')).toEqual({ startMin: 570, endMin: 990 });
    expect(termEndInstant(c)!.toISOString()).toBe(ist('2026-12-12T00:00:00').toISOString());
  });
  it('is active only Mon-Fri 09:30-16:30 IST inside the term', () => {
    expect(inBootcampHours(ist('2026-12-07T09:29:00'), c)).toBe(false);
    expect(inBootcampHours(ist('2026-12-07T09:30:00'), c)).toBe(true);
    expect(inBootcampHours(ist('2026-12-11T16:29:00'), c)).toBe(true);
    expect(inBootcampHours(ist('2026-12-11T16:30:00'), c)).toBe(false);
    expect(inBootcampHours(ist('2026-12-06T11:00:00'), c)).toBe(false); // before term (Sunday)
    expect(inBootcampHours(ist('2026-12-14T11:00:00'), c)).toBe(false); // after term
  });
  it('nothing is hardcoded to December 2026: another term and weekday set work', () => {
    const other = defaultPolicy({ days: [6], hours: { startMin: 600, endMin: 660 }, term: { start: new Date('2027-03-01'), end: new Date('2027-03-31') } });
    expect(inBootcampHours(ist('2027-03-06T10:30:00'), other)).toBe(true);
    expect(inBootcampHours(ist('2026-12-07T10:30:00'), other)).toBe(false);
  });
  it('next window start skips nights and weekends', () => {
    expect(nextWindowStart(ist('2026-12-07T18:00:00'), c)!.toISOString()).toBe(ist('2026-12-08T09:30:00').toISOString());
    expect(nextWindowStart(ist('2026-12-11T18:00:00'), c)).toBeNull(); // term over
  });
});
describe('hybrid automatic schedule', () => {
  it('after a success the next automatic sync is 30 minutes later', () => {
    const t = ist('2026-12-07T09:30:00');
    expect(nextAutoSyncAt('s1', t, t, c)!.toISOString()).toBe(ist('2026-12-07T10:00:00').toISOString());
  });
  it('spec example: a manual success at 09:40 moves the next automatic sync from 10:00 to 10:10, and a second one at 09:50 to 10:20', () => {
    expect(nextAutoSyncAt('s1', ist('2026-12-07T09:40:00'), ist('2026-12-07T09:40:00'), c)!.toISOString()).toBe(ist('2026-12-07T10:10:00').toISOString());
    expect(nextAutoSyncAt('s1', ist('2026-12-07T09:50:00'), ist('2026-12-07T09:50:00'), c)!.toISOString()).toBe(ist('2026-12-07T10:20:00').toISOString());
  });
  it('a success near closing time schedules the next window open plus a per-student offset, never a burst', () => {
    const t = ist('2026-12-07T16:20:00');
    const a = nextAutoSyncAt('student-a', t, t, c)!, b = nextAutoSyncAt('student-b', t, t, c)!;
    const open = ist('2026-12-08T09:30:00').getTime();
    for (const x of [a, b]) { expect(x.getTime()).toBeGreaterThanOrEqual(open); expect(x.getTime()).toBeLessThan(open + 30 * 60_000); }
    expect(a.getTime()).not.toBe(b.getTime());
  });
  it('the last day ends the schedule (final reconciliation covers the rest)', () => {
    const t = ist('2026-12-11T16:20:00');
    expect(nextAutoSyncAt('s', t, t, c)).toBeNull();
  });
  it('never-synced students are spread across the first interval, deterministically', () => {
    const now = ist('2026-12-07T09:30:00');
    const times = Array.from({ length: 200 }, (_, i) => nextAutoSyncAt(`id-${i}`, null, now, c)!.getTime());
    const spread = times.map((x) => Math.floor((x - now.getTime()) / 60_000));
    for (let m = 0; m < 30; m += 5) expect(spread.filter((x) => x >= m && x < m + 5).length).toBeGreaterThan(10); // every 5-minute slice is used
    expect(nextAutoSyncAt('id-1', null, now, c)!.getTime()).toBe(times[1]); // restart-safe
    expect(jitterFraction('x')).toBeGreaterThanOrEqual(0);
  });
  it('off-hours: disabled by default, or a reduced interval when configured', () => {
    expect(autoAllowedNow(ist('2026-12-07T20:00:00'), c)).toBe(false);
    const reduced = defaultPolicy({ ...c, offHoursIntervalMin: 120 });
    expect(autoAllowedNow(ist('2026-12-07T20:00:00'), reduced)).toBe(true);
    const t = ist('2026-12-07T16:00:00');
    expect(nextAutoSyncAt('s', t, t, reduced)!.toISOString()).toBe(ist('2026-12-07T18:00:00').toISOString());
  });
});
describe('manual cooldown', () => {
  it('is 10 minutes from the last manual REQUEST', () => {
    const t = ist('2026-12-07T09:40:00');
    expect(manualEligibility(null, t, c)).toMatchObject({ eligible: true, remainingSec: 0 });
    expect(manualEligibility(t, ist('2026-12-07T09:45:00'), c)).toMatchObject({ eligible: false, remainingSec: 300 });
    expect(manualEligibility(t, ist('2026-12-07T09:50:00'), c).eligible).toBe(true);
    expect(manualEligibility(t, ist('2026-12-07T09:41:18'), c).remainingSec).toBe(522);
  });
  it('shared spacing between any two attempts is half the cooldown', () => { expect(minSpacingSec(c)).toBe(300); });
});
describe('final reconciliation', () => {
  it('is due once after the term ends, for a bounded grace period', () => {
    expect(reconciliationDue(ist('2026-12-11T20:00:00'), c, null)).toBeNull(); // term still running until midnight
    const end = termEndInstant(c)!;
    expect(reconciliationDue(new Date(end.getTime() + 60_000), c, null)!.getTime()).toBe(end.getTime());
    expect(reconciliationDue(new Date(end.getTime() + 60_000), c, end)).toBeNull(); // done
    expect(reconciliationDue(new Date(end.getTime() + 10 * 86_400_000), c, null)).toBeNull(); // grace over
  });
});
describe('backoff', () => {
  it('grows exponentially with jitter and is capped', () => {
    expect(backoffSec(1, 0.5)).toBe(60); expect(backoffSec(3, 0.5)).toBe(240); expect(backoffSec(20, 0.5)).toBe(1800);
    expect(backoffSec(2, 0)).toBeLessThan(backoffSec(2, 1));
  });
});
