import { reportMetrics, type ReportRow } from '../coding/reports.js';
import type {
  AttendanceRow,
  RosterRow,
  SessionRecord,
} from '../attendance/contracts.js';
import { followUpPolicy, ratio } from './contracts.js';
export interface AttendanceData {
  sessions: SessionRecord[];
  roster: RosterRow[];
  records: AttendanceRow[];
}
export function attendanceRows(data: AttendanceData, student?: string) {
  const sessions = new Map(data.sessions.map((s) => [s.id, s]));
  const records = new Map(
    data.records.map((r) => [
      r.attendanceSessionId + ':' + r.studentProfileId,
      r,
    ]),
  );
  return data.roster
    .filter((r) => !student || r.studentProfileId === student)
    .flatMap((r) => {
      const s = sessions.get(r.attendanceSessionId);
      if (!s) return [];
      const mark = records.get(s.id + ':' + r.studentProfileId);
      return [
        {
          sessionId: s.id,
          studentId: r.studentProfileId,
          roll: r.rollNumberSnapshot,
          name: r.studentNameSnapshot,
          day: s.dayNumber,
          title: s.dayTitle,
          type: s.sessionType,
          sessionStatus: s.status,
          status: mark?.status ?? 'UNMARKED',
          corrected: mark?.source === 'ADMIN_CORRECTION',
          updatedAt: mark?.updatedAt ?? s.updatedAt,
          official: s.status === 'FINALIZED',
        },
      ];
    });
}
export type Mark = ReturnType<typeof attendanceRows>[number];
export function attendanceMetrics(rows: Mark[]) {
  const official = rows.filter((r) => r.official),
    present = official.filter((r) => r.status === 'PRESENT').length,
    absent = official.filter((r) => r.status === 'ABSENT').length;
  // Every eligible finalized snapshot is an opportunity, including EXCUSED.
  return {
    eligible: official.length,
    present,
    absent,
    excused: official.filter((r) => r.status === 'EXCUSED').length,
    unmarked: official.filter((r) => r.status === 'UNMARKED').length,
    corrected: official.filter((r) => r.corrected).length,
    percentage: ratio(present, official.length),
  };
}
export function reasons(
  input: {
    absent: number;
    coding: ReturnType<typeof reportMetrics>;
    missingAccount: boolean;
    failed: boolean;
    stale?: boolean;
    lastSuccess: string | null;
    pending: boolean;
    missingYear: boolean;
  },
  now: Date,
) {
  const r: string[] = [];
  if (input.absent >= followUpPolicy.repeatedAbsences)
    r.push('REPEATED_ABSENCE');
  if (
    input.coding.assigned >= followUpPolicy.minimumOpportunities &&
    (input.coding.coverage ?? 0) >= followUpPolicy.minimumCoverage &&
    (input.coding.completion ?? 1) < followUpPolicy.lowCompletion
  )
    r.push('LOW_COMPLETION');
  if (input.missingAccount) r.push('ACCOUNT_VERIFICATION');
  if (input.failed) r.push('SYNC_FAILED');
  if (
    input.stale ||
    (input.coding.assigned &&
      input.lastSuccess &&
      now.getTime() - Date.parse(input.lastSuccess) >
        followUpPolicy.staleHours * 3600000)
  )
    r.push('SYNC_STALE');
  if (input.pending) r.push('PENDING_REGISTRATION');
  if (input.missingYear) r.push('MISSING_YEAR');
  return r;
}
export const codingMetrics = (rows: Pick<ReportRow, 'status'>[]) =>
  reportMetrics(rows);
