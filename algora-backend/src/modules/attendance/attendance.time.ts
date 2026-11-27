/**
 * Attendance calendar helpers. Attendance dates are plain calendar dates (`YYYY-MM-DD`) in the session timezone, never
 * instants, so a timezone conversion can never move a record to the previous or next day.
 */
export const DEFAULT_TIMEZONE = process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata';

const parts = (date: Date, tz: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

/** Offset of `tz` at the given instant, in minutes east of UTC. */
function tzOffsetMinutes(date: Date, tz: string) {
  const p = parts(date, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/** Interpret a wall-clock time in `tz` as an instant. */
export function wallTimeToDate(y: number, month: number, d: number, h = 0, mi = 0, s = 0, tz = DEFAULT_TIMEZONE): Date {
  const guess = Date.UTC(y, month - 1, d, h, mi, s);
  let offset = tzOffsetMinutes(new Date(guess), tz);
  offset = tzOffsetMinutes(new Date(guess - offset * 60000), tz);
  return new Date(guess - offset * 60000);
}

/** Today's calendar date in the session timezone (`YYYY-MM-DD`). */
export function todayInTz(tz = DEFAULT_TIMEZONE, now = new Date()): string {
  const p = parts(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Current wall-clock time in the session timezone (`HH:mm`). */
export function nowTimeInTz(tz = DEFAULT_TIMEZONE, now = new Date()): string {
  const p = parts(now, tz);
  return `${p.hour}:${p.minute}`;
}

export const isDateString = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isTimeString = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Start of a calendar date in `tz`. */
export const startOfDate = (date: string, tz = DEFAULT_TIMEZONE) => {
  const [y, m, d] = date.split('-').map(Number);
  return wallTimeToDate(y, m, d, 0, 0, 0, tz);
};
/** End of a calendar date in `tz` (inclusive). */
export const endOfDate = (date: string, tz = DEFAULT_TIMEZONE) => new Date(startOfDate(date, tz).getTime() + 86_400_000 - 1);

/** Add whole days to a calendar date string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Monday-based ISO week containing `date`. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Inclusive list of calendar dates. Bounded by the caller. */
export function dateRange(from: string, to: string, max = 800): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}
