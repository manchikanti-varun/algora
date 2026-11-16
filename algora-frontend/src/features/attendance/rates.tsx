'use client';
export interface RateCounts {
  present: number;
  absent: number;
  excused: number;
  unmarked?: number;
  attendanceRate?: number | null;
  participationRate?: number | null;
}
export function AttendanceRates({
  counts,
  scope = 'Finalized records',
}: {
  counts: RateCounts;
  scope?: string;
}) {
  const eligible =
    counts.present + counts.absent + counts.excused + (counts.unmarked ?? 0);
  const attendance =
    counts.attendanceRate === undefined
      ? eligible
        ? counts.present / eligible
        : null
      : counts.attendanceRate;
  const participation =
    counts.participationRate === undefined
      ? counts.present + counts.absent
        ? counts.present / (counts.present + counts.absent)
        : null
      : counts.participationRate;
  const pct = (n: number | null) =>
    n === null ? 'N/A' : (n * 100).toFixed(2) + '%';
  return (
    <section aria-label="Named attendance rates">
      <h3>{scope}</h3>
      <dl className="attendance-counts">
        <div>
          <dt>Attendance Rate</dt>
          <dd>{pct(attendance)}</dd>
        </div>
        <div>
          <dt>Participation Rate</dt>
          <dd>{pct(participation)}</dd>
        </div>
      </dl>
      <p className="analytics-note">
        Attendance Rate includes all eligible finalized opportunities, including
        EXCUSED and missing marks. Participation Rate uses PRESENT + ABSENT
        only. Unfinalized sessions are excluded; corrections apply to both.
      </p>
    </section>
  );
}
