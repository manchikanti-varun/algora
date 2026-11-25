import { describe, expect, it } from 'vitest';
import { backoffSec, cooldownRemainingSec, defaultPolicy, dueAt, inBootcampHours, selectDue } from '../src/modules/leetcode/sync.policy';
import { breakerState, pauseMs, shouldOpen } from '../src/modules/leetcode/circuit-breaker';

const cfg = defaultPolicy(); // IST, 09:00-18:00, Mon-Sat
// IST = UTC+5:30. 2025-01-06 is a Monday.
const ist = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00+05:30`);
const MON_10 = ist('2025-01-06', '10:00'), MON_20 = ist('2025-01-06', '20:00'), SUN_11 = ist('2025-01-05', '11:00');
const mAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);

describe('bootcamp hours', () => {
  it('inside / outside / weekday', () => {
    expect(inBootcampHours(MON_10, cfg)).toBe(true);
    expect(inBootcampHours(MON_20, cfg)).toBe(false);
    expect(inBootcampHours(SUN_11, cfg)).toBe(false);
    expect(inBootcampHours(ist('2025-01-06', '18:00'), cfg)).toBe(false);
    expect(inBootcampHours(ist('2025-01-06', '09:00'), cfg)).toBe(true);
  });
});

describe('dueAt / selectDue', () => {
  it('active students every 15 min, idle hourly, in hours', () => {
    const active = { id: 'a', lastActiveAt: mAgo(MON_10, 5), lastAttemptAt: mAgo(MON_10, 14) };
    const idle = { id: 'i', lastActiveAt: mAgo(MON_10, 300), lastAttemptAt: mAgo(MON_10, 14) };
    expect(selectDue([active, idle], MON_10, cfg, 10)).toEqual([]);
    expect(selectDue([{ ...active, lastAttemptAt: mAgo(MON_10, 16) }, { ...idle, lastAttemptAt: mAgo(MON_10, 16) }], MON_10, cfg, 10).map((s) => s.id)).toEqual(['a']);
    expect(selectDue([{ ...idle, lastAttemptAt: mAgo(MON_10, 61) }], MON_10, cfg, 10).map((s) => s.id)).toEqual(['i']);
  });
  it('reduced frequency outside hours, and nobody who has been quiet for 24h', () => {
    const recent = { id: 'r', lastActiveAt: mAgo(MON_20, 120), lastAttemptAt: mAgo(MON_20, 100) };
    const quiet = { id: 'q', lastActiveAt: mAgo(MON_20, 3000), lastAttemptAt: mAgo(MON_20, 3000) };
    expect(selectDue([recent, quiet], MON_20, cfg, 10)).toEqual([]);
    expect(selectDue([{ ...recent, lastAttemptAt: mAgo(MON_20, 241) }, quiet], MON_20, cfg, 10).map((s) => s.id)).toEqual(['r']);
    expect(dueAt(quiet, MON_20, cfg)).toBeNull();
  });
  it('possible-gap students are prioritised and resynced after 5 min; priority order and cap', () => {
    const gap = { id: 'g', possibleGap: true, lastAttemptAt: mAgo(MON_10, 6), lastSuccessAt: mAgo(MON_10, 6) };
    const act = { id: 'a', lastActiveAt: mAgo(MON_10, 1), lastAttemptAt: mAgo(MON_10, 30), lastSuccessAt: mAgo(MON_10, 30) };
    const old = { id: 'o', lastAttemptAt: mAgo(MON_10, 600), lastSuccessAt: mAgo(MON_10, 600) };
    expect(selectDue([old, act, gap], MON_10, cfg, 10).map((s) => s.id)).toEqual(['g', 'a', 'o']);
    expect(selectDue([old, act, gap], MON_10, cfg, 2).map((s) => s.id)).toEqual(['g', 'a']);
  });
  it('never-synced students are due; backoff window is respected', () => {
    expect(selectDue([{ id: 'n' }], MON_10, cfg, 5)).toHaveLength(1);
    const blocked = { id: 'b', lastAttemptAt: mAgo(MON_10, 600), nextEligibleAt: new Date(MON_10.getTime() + 60_000) };
    expect(selectDue([blocked], MON_10, cfg, 5)).toEqual([]);
  });
});

describe('cooldown, backoff, breaker', () => {
  it('cooldown', () => {
    expect(cooldownRemainingSec(null, MON_10, cfg)).toBe(0);
    expect(cooldownRemainingSec(mAgo(MON_10, 2), MON_10, cfg)).toBe(180);
    expect(cooldownRemainingSec(mAgo(MON_10, 6), MON_10, cfg)).toBe(0);
  });
  it('exponential backoff, capped, jittered within +-25%', () => {
    expect([1, 2, 3, 4].map((n) => backoffSec(n, 0.5))).toEqual([60, 120, 240, 480]);
    expect(backoffSec(20, 0.5)).toBe(1800);
    expect(backoffSec(1, 0)).toBe(45); expect(backoffSec(1, 1)).toBe(75);
  });
  it('circuit breaker (pure): opens at threshold, half-opens after the pause, a failed probe re-opens with a longer pause', () => {
    const c = { threshold: 5, baseOpenMs: 1000, maxOpenMs: 8000 };
    expect(shouldOpen({ consecutiveFailures: 3, openCount: 0 }, c)).toBe(false);
    expect(shouldOpen({ consecutiveFailures: 4, openCount: 0 }, c)).toBe(true);
    const open1 = { consecutiveFailures: 5, openedAt: new Date(0), openCount: 1 };
    expect(breakerState(open1, c, 500)).toBe('OPEN'); expect(breakerState(open1, c, 1000)).toBe('HALF_OPEN');
    expect(shouldOpen(open1, c, 1000)).toBe(true); // failed probe
    expect(pauseMs({ ...open1, openCount: 2 }, c)).toBe(2000); expect(pauseMs({ ...open1, openCount: 9 }, c)).toBe(8000);
    expect(breakerState({ consecutiveFailures: 0, openCount: 0 }, c)).toBe('CLOSED');
  });

});
