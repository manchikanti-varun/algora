import crypto from 'node:crypto';
/**
 * Pure scheduling policy. No I/O, clock injected, fully unit-tested.
 *
 * Hybrid model:
 *  - A student's next automatic sync is `lastSuccessfulSync + autoIntervalMin`. Only a SUCCESS moves it, whether the
 *    success was automatic or manual. A queued or failed request never moves it.
 *  - A student may ask for a manual update once per `studentCooldownSec`, measured from their last manual REQUEST.
 *    The cooldown is eligibility to queue a request, not a promise that an upstream call happens immediately.
 */
export interface PolicyConfig {
  tzOffsetMin: number;              // offset of the bootcamp timezone from UTC (IST = 330)
  hours: { startMin: number; endMin: number }; // minutes since local midnight
  days: number[];                   // local weekdays 0=Sun
  /** Optional term dates. Date-only values cover whole local days. Outside the term only reconciliation runs. */
  term?: { start: Date | null; end: Date | null };
  /** Automatic interval in bootcamp hours. */
  autoIntervalMin: number;
  /** Reduced automatic interval outside bootcamp hours (inside the term). 0 disables automatic sync outside hours. */
  offHoursIntervalMin: number;
  /** Manual update eligibility, seconds after the previous manual request. */
  studentCooldownSec: number;
}
export const defaultPolicy = (over: Partial<PolicyConfig> = {}): PolicyConfig => ({
  tzOffsetMin: 330, hours: { startMin: 9 * 60 + 30, endMin: 16 * 60 + 30 }, days: [1, 2, 3, 4, 5],
  autoIntervalMin: 30, offHoursIntervalMin: 0, studentCooldownSec: 600, ...over,
});
export function parseHours(s: string): { startMin: number; endMin: number } {
  const [a, b] = s.split('-').map((p) => { const [h, m] = p.split(':').map(Number); return h * 60 + m; });
  return { startMin: a, endMin: b };
}
export function localParts(now: Date, tzOffsetMin: number) {
  const l = new Date(now.getTime() + tzOffsetMin * 60_000);
  return { day: l.getUTCDay(), minutes: l.getUTCHours() * 60 + l.getUTCMinutes() };
}
const DAY_MS = 86_400_000;
const isDateOnly = (d: Date) => d.getTime() % DAY_MS === 0;
/** First instant of the term. A date-only value (UTC midnight) means the start of that day in the bootcamp timezone. */
export const termStartInstant = (c: PolicyConfig): Date | null => {
  const s = c.term?.start;
  return s ? new Date(isDateOnly(s) ? s.getTime() - c.tzOffsetMin * 60_000 : s.getTime()) : null;
};
/** Last instant of the term. A date-only value means the END of that day in the bootcamp timezone. */
export const termEndInstant = (c: PolicyConfig): Date | null => {
  const e = c.term?.end;
  return e ? new Date(isDateOnly(e) ? e.getTime() + DAY_MS - c.tzOffsetMin * 60_000 : e.getTime()) : null;
};
export const inTerm = (now: Date, c: PolicyConfig) => {
  const s = termStartInstant(c), e = termEndInstant(c);
  if (s && now < s) return false;
  if (e && now >= e) return false;
  return true;
};
export const inBootcampHours = (now: Date, c: PolicyConfig) => {
  if (!inTerm(now, c)) return false;
  const { day, minutes } = localParts(now, c.tzOffsetMin);
  return c.days.includes(day) && minutes >= c.hours.startMin && minutes < c.hours.endMin;
};
/** The first instant at or after `from` that is inside bootcamp hours, or null when the term has ended / nothing within 15 days. */
export function nextWindowStart(from: Date, c: PolicyConfig): Date | null {
  if (inBootcampHours(from, c)) return from;
  const tz = c.tzOffsetMin * 60_000;
  const localMidnight = Math.floor((from.getTime() + tz) / DAY_MS) * DAY_MS - tz;
  for (let d = 0; d < 15; d++) {
    const candidate = new Date(localMidnight + d * DAY_MS + c.hours.startMin * 60_000);
    if (candidate < from) continue;
    if (inBootcampHours(candidate, c)) return candidate;
  }
  return null;
}
/** Stable per-student fraction in [0,1): spreads students across the interval without randomness (restart-safe). */
export function jitterFraction(studentId: string): number {
  return crypto.createHash('sha1').update(studentId).digest().readUInt32BE(0) / 0x1_0000_0000;
}
/**
 * When should this student's automatic sync run next?
 * - After a success: lastSuccess + interval. When that lands outside bootcamp hours the reduced off-hours interval applies,
 *   or (when disabled) the next window opening plus a per-student offset, so nobody wakes at the same second.
 * - Never synced: spread across the first interval of the current or next window using a stable per-student offset.
 * Returns null when no further automatic sync is scheduled (term over).
 */
export function nextAutoSyncAt(studentId: string, lastSuccessAt: Date | null | undefined, now: Date, c: PolicyConfig): Date | null {
  const spreadMs = Math.max(0, Math.min(c.autoIntervalMin, 60) * 60_000 - 1);
  const offset = Math.floor(jitterFraction(studentId) * spreadMs);
  if (!lastSuccessAt) {
    const open = nextWindowStart(now, c);
    if (!open) return c.offHoursIntervalMin > 0 && inTerm(now, c) ? now : null;
    if (open > now) return new Date(open.getTime() + offset);
    // inside the window: the student's slot within the current interval cycle, or now if that slot has already passed
    const windowOpen = new Date(now.getTime() - minutesIntoWindow(now, c) * 60_000);
    const slot = new Date(windowOpen.getTime() + offset);
    return slot > now ? slot : now;
  }
  const candidate = new Date(lastSuccessAt.getTime() + c.autoIntervalMin * 60_000);
  if (inBootcampHours(candidate, c)) return candidate;
  if (!inTerm(candidate, c)) return null;
  if (c.offHoursIntervalMin > 0) return new Date(lastSuccessAt.getTime() + Math.max(c.autoIntervalMin, c.offHoursIntervalMin) * 60_000);
  const open = nextWindowStart(candidate, c);
  return open ? new Date(open.getTime() + offset) : null;
}
const minutesIntoWindow = (now: Date, c: PolicyConfig) => localParts(now, c.tzOffsetMin).minutes - c.hours.startMin;
/** May an automatic sync be queued at this instant at all? */
export const autoAllowedNow = (now: Date, c: PolicyConfig) => inTerm(now, c) && (inBootcampHours(now, c) || c.offHoursIntervalMin > 0);
/**
 * Final reconciliation: once the term has ended, one more sync per student for a bounded period.
 * Returns the term-end instant the reconciliation belongs to, or null when none is due.
 */
export function reconciliationDue(now: Date, c: PolicyConfig, reconciledForTermEnd: Date | null | undefined, graceDays = 3): Date | null {
  const end = termEndInstant(c);
  if (!end || now < end || now.getTime() > end.getTime() + graceDays * DAY_MS) return null;
  return reconciledForTermEnd && reconciledForTermEnd.getTime() === end.getTime() ? null : end;
}
export interface ManualEligibility { eligible: boolean; nextEligibleAt: Date | null; remainingSec: number }
/** Manual eligibility from the last manual REQUEST only (not from automatic attempts, not from success). */
export function manualEligibility(lastManualRequestAt: Date | null | undefined, now: Date, c: PolicyConfig): ManualEligibility {
  if (!lastManualRequestAt) return { eligible: true, nextEligibleAt: null, remainingSec: 0 };
  const next = new Date(lastManualRequestAt.getTime() + c.studentCooldownSec * 1000);
  const remainingSec = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000));
  return { eligible: remainingSec === 0, nextEligibleAt: next, remainingSec };
}
/** Shared minimum spacing between ANY two attempts for one student (automatic or manual): half the manual cooldown. */
export const minSpacingSec = (c: PolicyConfig) => Math.floor(c.studentCooldownSec / 2);
/** Exponential backoff with deterministic jitter input in [0,1). */
export function backoffSec(consecutiveFailures: number, jitter = 0.5, baseSec = 60, maxSec = 1800): number {
  const raw = Math.min(maxSec, baseSec * 2 ** Math.max(0, consecutiveFailures - 1));
  return Math.round(raw * (0.75 + 0.5 * jitter));
}
