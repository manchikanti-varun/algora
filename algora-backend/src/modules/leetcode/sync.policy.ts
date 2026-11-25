/** Pure scheduling policy. No I/O, clock injected, fully unit-tested. */

export interface PolicyConfig {
  tzOffsetMin: number;              // offset of the bootcamp timezone from UTC (IST = 330)
  hours: { startMin: number; endMin: number }; // minutes since local midnight
  days: number[];                   // local weekdays 0=Sun
  activeWindowMin: number;          // student counts as "active" if seen within this window
  activeIntervalMin: number;        // in-hours, active student
  idleIntervalMin: number;          // in-hours, not active
  offHoursIntervalMin: number;      // outside hours, only for students active in the last 24h
  gapIntervalMin: number;           // when the previous sync may have lost submissions
  studentCooldownSec: number;
}

export const defaultPolicy = (over: Partial<PolicyConfig> = {}): PolicyConfig => ({
  tzOffsetMin: 330, hours: { startMin: 9 * 60, endMin: 18 * 60 }, days: [1, 2, 3, 4, 5, 6],
  activeWindowMin: 60, activeIntervalMin: 15, idleIntervalMin: 60, offHoursIntervalMin: 240, gapIntervalMin: 5, studentCooldownSec: 300, ...over,
});

export function parseHours(s: string): { startMin: number; endMin: number } {
  const [a, b] = s.split('-').map((p) => { const [h, m] = p.split(':').map(Number); return h * 60 + m; });
  return { startMin: a, endMin: b };
}

export function localParts(now: Date, tzOffsetMin: number) {
  const l = new Date(now.getTime() + tzOffsetMin * 60_000);
  return { day: l.getUTCDay(), minutes: l.getUTCHours() * 60 + l.getUTCMinutes() };
}
export const inBootcampHours = (now: Date, c: PolicyConfig) => {
  const { day, minutes } = localParts(now, c.tzOffsetMin);
  return c.days.includes(day) && minutes >= c.hours.startMin && minutes < c.hours.endMin;
};

export interface StudentSyncView {
  id: string;
  lastActiveAt?: Date | null;
  lastSuccessAt?: Date | null;
  lastAttemptAt?: Date | null;
  nextEligibleAt?: Date | null; // set by backoff / retry-after
  possibleGap?: boolean;
}

const mins = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 60_000;

/** The wall-clock time at which this student next becomes due, or null if they should not be scheduled. */
export function dueAt(s: StudentSyncView, now: Date, c: PolicyConfig): Date | null {
  const inH = inBootcampHours(now, c);
  const active = !!s.lastActiveAt && mins(now, s.lastActiveAt) <= c.activeWindowMin;
  let interval: number;
  if (s.possibleGap) interval = c.gapIntervalMin;
  else if (inH) interval = active ? c.activeIntervalMin : c.idleIntervalMin;
  else if (s.lastActiveAt && mins(now, s.lastActiveAt) <= 24 * 60) interval = c.offHoursIntervalMin;
  else return null; // quiet: wake only when the student shows up
  const base = s.lastAttemptAt ?? s.lastSuccessAt;
  const due = base ? new Date(base.getTime() + interval * 60_000) : new Date(0);
  return s.nextEligibleAt && s.nextEligibleAt > due ? s.nextEligibleAt : due;
}

/** Due students ordered: possible-gap first, then active, then least recently synced. Capped by `max`. */
export function selectDue(students: StudentSyncView[], now: Date, c: PolicyConfig, max: number): StudentSyncView[] {
  const rank = (s: StudentSyncView) => (s.possibleGap ? 0 : s.lastActiveAt && mins(now, s.lastActiveAt) <= c.activeWindowMin ? 1 : 2);
  return students
    .filter((s) => { const d = dueAt(s, now, c); return d !== null && d <= now; })
    .sort((a, b) => rank(a) - rank(b) || (a.lastSuccessAt?.getTime() ?? 0) - (b.lastSuccessAt?.getTime() ?? 0) || a.id.localeCompare(b.id))
    .slice(0, max);
}

/** Student-triggered sync is allowed once the cooldown since the last attempt has passed. */
export function cooldownRemainingSec(lastAttemptAt: Date | null | undefined, now: Date, c: PolicyConfig): number {
  if (!lastAttemptAt) return 0;
  return Math.max(0, Math.ceil(c.studentCooldownSec - (now.getTime() - lastAttemptAt.getTime()) / 1000));
}

/** Exponential backoff with deterministic jitter input in [0,1). */
export function backoffSec(consecutiveFailures: number, jitter = 0.5, baseSec = 60, maxSec = 1800): number {
  const raw = Math.min(maxSec, baseSec * 2 ** Math.max(0, consecutiveFailures - 1));
  return Math.round(raw * (0.75 + 0.5 * jitter));
}

