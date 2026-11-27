/** Attendance types shared by the management and student interfaces. */

export type SessionType = 'MORNING' | 'AFTERNOON';
export type SessionStatus = 'DRAFT' | 'FINALIZED' | 'CANCELLED';
export type AttendanceStatus = 'PRESENT' | 'ABSENT';

export const sessionLabel = (t: SessionType | string) => (t === 'MORNING' ? 'Morning' : 'Afternoon');
export const sessionShort = (t: SessionType | string) => (t === 'MORNING' ? 'M' : 'A');
export const attendanceStatusLabel = (s: AttendanceStatus | string) => (s === 'PRESENT' ? 'Present' : 'Absent');

/** Today's calendar date in the browser's local timezone (`YYYY-MM-DD`). */
export const localToday = () => new Date().toLocaleDateString('en-CA');
/** Current local wall-clock time (`HH:mm`). */
export const localNowTime = () => new Date().toTimeString().slice(0, 5);
/** A calendar date string rendered without a timezone shift. */
export const fmtAttendanceDate = (d?: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtAttendanceDateShort = (d?: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
export const attendancePct = (v: number | null | undefined) => (v === null || v === undefined ? 'Not recorded' : `${Math.round(v * 10) / 10}%`);

export interface RosterStudent {
  studentId: string; enrollmentId: string; rollNumber: string; name: string; collegeId: string | null; collegeName: string | null;
}
export interface PresentEntry extends RosterStudent { status: 'PRESENT'; scanAt: string | null }
export type ClassifiedResult = 'PRESENT' | 'DUPLICATE' | 'UNKNOWN' | 'INVALID' | 'OUT_OF_BATCH' | 'NOT_ELIGIBLE';
export interface ClassifiedRow {
  line: number; raw: string; rollNumber: string; result: ClassifiedResult; message: string; scanAt: string | null;
}
export interface AttendanceCounts {
  totalRows: number; present: number; absent: number; duplicates: number; unknown: number;
  invalid: number; outOfBatch: number; notEligible: number; invalidTimestamps: number;
}
export interface PreviewResult {
  batch: { _id: string; name: string };
  attendanceDate: string; sessionType: SessionType; attendanceTime: string | null;
  rosterCount: number; pendingCount: number;
  present: PresentEntry[]; absent: RosterStudent[]; rows: ClassifiedRow[]; counts: AttendanceCounts;
  uploadSummary: Record<string, number>;
  columns: { header: string[] | null; columns: { index: number; label: string; kind: 'roll' | 'time' | 'other' }[] };
  existingSession: { _id: string; status: SessionStatus } | null;
}

export interface SessionSummary {
  _id: string; batchId: string; batchName?: string; attendanceDate: string; sessionType: SessionType;
  attendanceTime: string; timezone: string; status: SessionStatus; eligibleCount: number; presentCount: number;
  absentCount: number; percentage: number | null; notes?: string | null; revision?: number;
  createdBy?: string | null; finalizedBy?: string | null; finalizedAt?: string | null; createdAt?: string; updatedAt?: string;
  uploadSummary?: Record<string, number> | null;
}
export interface SessionRecord {
  _id: string; studentId: string; rollNumber: string; studentName: string; collegeId: string | null; college: string | null;
  status: AttendanceStatus; scanAt: string | null; markingSource: string;
  corrections: { from: string | null; to: string | null; fromScanAt: string | null; toScanAt: string | null; at: string; reason: string | null; source: string | null }[];
}
export interface SessionDetail {
  session: SessionSummary & { batchStatus: string | null; cancelledBy: string | null; cancelledAt: string | null; cancellationReason: string | null };
  records: SessionRecord[];
  correctionHistory: { studentId: string; rollNumber: string; studentName: string | null; from: string | null; to: string | null; at: string; reason: string | null; source: string | null }[];
  canCorrect: boolean;
}

export interface StudentAttendance {
  student: { _id: string; fullName: string; rollNumber: string; college: string | null; collegeId: string | null; batches: { batchId: string; name: string }[] };
  summary: {
    eligible: number; present: number; absent: number; percentage: number | null;
    morning: { eligible: number; present: number; percentage: number | null };
    afternoon: { eligible: number; present: number; percentage: number | null };
  };
  daily: { date: string; morning: AttendanceStatus | null; afternoon: AttendanceStatus | null }[];
  history: { attendanceDate: string; sessionType: SessionType; status: AttendanceStatus; scanAt: string | null; batchId: string; rollNumber: string; studentName: string | null; college: string | null; markingSource: string }[];
}

export interface LowAttendanceRow {
  studentId: string; batchId: string; batch: string; rollNumber: string; name: string; college: string | null;
  eligible: number; present: number; absent: number; percentage: number;
}

export interface BatchAttendanceRow {
  batchId: string; name: string; status: string; students: number; eligible: number; present: number; absent: number;
  sessions: number; percentage: number | null; hasData: boolean;
  morning: { eligible: number; present: number; absent: number; sessions: number; percentage: number | null };
  afternoon: { eligible: number; present: number; absent: number; sessions: number; percentage: number | null };
}

export interface DailyRow {
  date: string;
  morning: { eligible: number; present: number; absent: number; sessions: number } | null;
  afternoon: { eligible: number; present: number; absent: number; sessions: number } | null;
  morningPct: number | null; afternoonPct: number | null;
  overall: { eligible: number; present: number; absent: number; percentage: number | null };
}

/** A date presets helper for the attendance filters. */
export function datePreset(kind: 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth'): { from: string; to: string } {
  const today = localToday();
  const shift = (d: string, days: number) => {
    const t = new Date(`${d}T00:00:00`); t.setDate(t.getDate() + days); return t.toLocaleDateString('en-CA');
  };
  const weekStart = (d: string) => shift(d, -((new Date(`${d}T00:00:00`).getDay() + 6) % 7));
  if (kind === 'today') return { from: today, to: today };
  if (kind === 'yesterday') return { from: shift(today, -1), to: shift(today, -1) };
  if (kind === 'thisWeek') { const from = weekStart(today); return { from, to: shift(from, 6) }; }
  if (kind === 'lastWeek') { const from = shift(weekStart(today), -7); return { from, to: shift(from, 6) }; }
  if (kind === 'thisMonth') { const from = `${today.slice(0, 7)}-01`; const d = new Date(`${today.slice(0, 7)}-01T00:00:00`); d.setMonth(d.getMonth() + 1); d.setDate(0); return { from, to: d.toLocaleDateString('en-CA') }; }
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00`); d.setMonth(d.getMonth() - 1);
  const from = d.toLocaleDateString('en-CA').slice(0, 7) + '-01';
  const end = new Date(`${from.slice(0, 7)}-01T00:00:00`); end.setMonth(end.getMonth() + 1); end.setDate(0);
  return { from, to: end.toLocaleDateString('en-CA') };
}
