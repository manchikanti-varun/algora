/**
 * SIMULATION, not measurement. Every parameter below is an ASSUMPTION about student behaviour, not data.
 * Question: for a 5-day bootcamp, what share of first-time accepted problems is ever seen by a
 * "last 20 submissions" window, for (a) all-status list vs (b) accepted-only list, under different sync schedules?
 * Also counts provider requests for the same schedules.
 */
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const poisson = (r: () => number, lambda: number) => { let L = Math.exp(-lambda), k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };

interface Params { students: number; days: number; hoursPerDay: number; sessionsPerDay: [number, number]; sessionHours: [number, number]; attemptsPerHour: number; acceptRate: number; windowSize: number; }
export const DEFAULTS: Params = { students: 200, days: 5, hoursPerDay: 8, sessionsPerDay: [2, 4], sessionHours: [1, 2.5], attemptsPerHour: 4, acceptRate: 0.4, windowSize: 20 };

type Sub = { t: number; accepted: boolean; slug: string };
function genStudent(p: Params, r: () => number): Sub[] {
  const subs: Sub[] = []; let next = 0;
  for (let d = 0; d < p.days; d++) {
    const n = p.sessionsPerDay[0] + Math.floor(r() * (p.sessionsPerDay[1] - p.sessionsPerDay[0] + 1));
    for (let s = 0; s < n; s++) {
      const dur = p.sessionHours[0] + r() * (p.sessionHours[1] - p.sessionHours[0]);
      const start = d * 24 + 9 + r() * (p.hoursPerDay - dur);
      const attempts = poisson(r, dur * p.attemptsPerHour);
      for (let a = 0; a < attempts; a++) {
        const ok = r() < p.acceptRate;
        subs.push({ t: start + r() * dur, accepted: ok, slug: ok ? `p${next++}` : 'x' });
      }
    }
  }
  return subs.sort((a, b) => a.t - b.t);
}

/** syncTimes: hours (absolute) at which this student is synced. */
function coverage(subs: Sub[], syncTimes: number[], acceptedOnly: boolean, W: number) {
  const seen = new Set<string>(); let total = 0;
  for (const s of subs) if (s.accepted) total++;
  for (const T of syncTimes) {
    const upto = subs.filter((s) => s.t <= T && (!acceptedOnly || s.accepted));
    for (const s of upto.slice(-W)) if (s.accepted) seen.add(s.slug);
  }
  return { seen: seen.size, total };
}

export type Schedule = { name: string; times: (subs: Sub[], p: Params) => number[]; requestsPerStudent?: number };
const inHours = (p: Params, stepMin: number) => { const out: number[] = []; for (let d = 0; d < p.days; d++) for (let h = 9; h <= 9 + p.hoursPerDay; h += stepMin / 60) out.push(d * 24 + h); return out; };
const endOfDay = (p: Params) => Array.from({ length: p.days }, (_, d) => d * 24 + 23);
export const schedules: Schedule[] = [
  { name: 'once per day (end of day)', times: (_s, p) => endOfDay(p) },
  { name: 'every 60 min in bootcamp hours', times: (_s, p) => [...inHours(p, 60), ...endOfDay(p)] },
  { name: 'every 30 min in bootcamp hours', times: (_s, p) => [...inHours(p, 30), ...endOfDay(p)] },
  { name: 'every 15 min in bootcamp hours', times: (_s, p) => [...inHours(p, 15), ...endOfDay(p)] },
  // Student-triggered on return from LeetCode: a sync 2 min after a submission, at most once per 5 min cooldown.
  // Safety sweep: hourly, but only for students active (any submission, which Algora observes as tab/dashboard activity) in the previous hour.
  // Plus one end-of-day sweep for everybody.
  { name: 'activity-based: tab-return sync (5 min cooldown) + hourly sweep of active students + end of day', times: (subs, p) => {
      const out = [...endOfDay(p)]; let last = -1e9;
      for (const s of subs) { const t = s.t + 2 / 60; if (t - last >= 5 / 60) { out.push(t); last = t; } }
      for (const h of inHours(p, 60)) if (subs.some((s) => s.t > h - 1 && s.t <= h)) out.push(h);
      return out; } },
  // AS IMPLEMENTED (src/modules/leetcode/sync.policy.ts + requestSync): in bootcamp hours, students active within the last
  // 60 min are synced every 15 min and others every 60 min; tab-return/manual syncs at most once per 300 s cooldown;
  // outside hours, students active in the last 24 h every 240 min. "Active" = the student had a submission (which in the
  // app corresponds to Algora seeing them on the dashboard/tab) within the previous hour.
  { name: 'IMPLEMENTED policy: 15 min active / 60 min idle in hours, tab-return (300 s cooldown), 240 min off-hours', times: (subs, p) => {
      const out: number[] = []; let last = -1e9;
      for (const s of subs) { const t = s.t + 2 / 60; if (t - last >= 5 / 60) { out.push(t); last = t; } } // tab return about 2 min after a submission
      const all = [...out];
      for (let d = 0; d < p.days; d++) for (let m = 0; m < 24 * 60; m += 15) {
        const T = d * 24 + m / 60; const inH = m / 60 >= 9 && m / 60 < 9 + p.hoursPerDay;
        const lastSub = subs.filter((s) => s.t <= T).at(-1)?.t ?? -1e9;
        const lastSync = Math.max(-1e9, ...all.filter((x) => x <= T));
        const active = T - lastSub <= 1;
        const interval = inH ? (active ? 0.25 : 1) : T - lastSub <= 24 ? 4 : Infinity;
        if (T - lastSync >= interval) all.push(T);
      }
      return all; } },
];

export function run(p: Params = DEFAULTS, seed = 42) {
  const r = rng(seed); const students = Array.from({ length: p.students }, () => genStudent(p, r));
  return schedules.map((sc) => {
    let allSeen = 0, acSeen = 0, total = 0, reqs = 0;
    for (const subs of students) {
      const times = sc.times(subs, p).sort((a, b) => a - b); reqs += times.length;
      const a = coverage(subs, times, false, p.windowSize), b = coverage(subs, times, true, p.windowSize);
      allSeen += a.seen; acSeen += b.seen; total += a.total;
    }
    return { schedule: sc.name, 'all-status window': `${((allSeen / total) * 100).toFixed(2)}%`, 'accepted-only window': `${((acSeen / total) * 100).toFixed(2)}%`, 'requests / 5 days': reqs, 'avg req / hour (in-hours)': +(reqs / (p.days * p.hoursPerDay)).toFixed(0) };
  });
}
if (process.argv[1]?.endsWith('bootcamp-sim.ts')) {
  console.log('ASSUMPTIONS', DEFAULTS);
  console.table(run());
  console.log('\nStress: heavy grinders (12 attempts/hour, 25% accept rate)');
  console.table(run({ ...DEFAULTS, attemptsPerHour: 12, acceptRate: 0.25 }));
}
