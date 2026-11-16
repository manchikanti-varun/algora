export interface FinalizedCounts {
  present: number;
  absent: number;
  excused: number;
  unmarked: number;
}
export function finalizedRates(counts: FinalizedCounts) {
  const eligible =
    counts.present + counts.absent + counts.excused + counts.unmarked;
  const participation = counts.present + counts.absent;
  return {
    ...counts,
    eligible,
    attendanceRate: eligible ? counts.present / eligible : null,
    participationRate: participation ? counts.present / participation : null,
  };
}
export const asPercent = (fraction: number | null) =>
  fraction === null ? null : Math.round(fraction * 10000) / 100;
