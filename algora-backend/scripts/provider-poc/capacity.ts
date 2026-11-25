/** Pure request-volume model. Assumes one provider call per student per sync (acSubmission only). */
export const STUDENTS = [200, 500, 1000, 5000, 10000];
export const INTERVALS_MIN = [5, 15, 30, 45];

export function requestsPerHour(students: number, intervalMin: number) { return Math.ceil((students * 60) / intervalMin); }
/** Wall-clock for one full pass given a sustained request budget per hour. */
export function passMinutes(students: number, budgetPerHour: number) { return (students / budgetPerHour) * 60; }
/** Smallest interval (min) that keeps `students` within `budgetPerHour`. */
export function minIntervalMin(students: number, budgetPerHour: number) { return (students * 60) / budgetPerHour; }

export function table(budgetPerHour: number) {
  return STUDENTS.map((s) => ({
    students: s,
    ...Object.fromEntries(INTERVALS_MIN.map((i) => [`req/h @${i}m`, requestsPerHour(s, i)])),
    [`min interval @${budgetPerHour}/h (min)`]: Math.ceil(minIntervalMin(s, budgetPerHour)),
  }));
}
if (process.argv[1]?.endsWith('capacity.ts')) {
  console.log('Hosted Alfa advertised budget: 120 req/h (shared per IP behind its proxy)');
  console.table(table(120));
  console.log('A self-hosted instance has no such cap; the real limit is then LeetCode itself (unpublished).');
}
