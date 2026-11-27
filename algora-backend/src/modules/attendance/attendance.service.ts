import type { Request } from 'express';
import { Types, type ClientSession } from 'mongoose';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { maybeTransaction } from '../../lib/lease';
import { AttendanceRecord, AttendanceSession, Batch, Enrollment, User, type UserDoc } from '../../models';
import { loadBatchFor, trainerBatchIds } from '../access';
import { audit } from '../audit/audit';
import {
  isValidRoll, normalizeAttendanceRoll, parseAttendanceCsv, parseScanTime, resolveColumns, type ColumnResolution,
} from './attendance.csv';
import { eligibleRoster, type RosterStudent } from './attendance.roster';
import { DEFAULT_TIMEZONE, isDateString, isTimeString, todayInTz } from './attendance.time';

export type RowResult = 'PRESENT' | 'DUPLICATE' | 'UNKNOWN' | 'INVALID' | 'OUT_OF_BATCH' | 'NOT_ELIGIBLE';
export type SessionType = 'MORNING' | 'AFTERNOON';

export interface ClassifiedRow { line: number; raw: string; rollNumber: string; result: RowResult; message: string; scanAt: string | null }
export interface RosterEntry { studentId: string; enrollmentId: string; rollNumber: string; name: string; collegeId: string | null; collegeName: string | null }
export interface PresentStudent extends RosterEntry { status: 'PRESENT'; scanAt: string | null }

export interface Classification {
  roster: RosterEntry[];
  pendingCount: number;
  rows: ClassifiedRow[];
  present: PresentStudent[];
  absent: RosterEntry[];
  columns: ColumnResolution;
  counts: {
    totalRows: number; present: number; absent: number; duplicates: number; unknown: number;
    invalid: number; outOfBatch: number; notEligible: number; invalidTimestamps: number;
  };
  uploadSummary: Record<string, number>;
}

export const percent = (present: number, eligible: number): number | null =>
  eligible > 0 ? Math.round((present / eligible) * 1000) / 10 : null;

export function assertAttendanceDate(date: string, tz = DEFAULT_TIMEZONE) {
  if (!isDateString(date)) throw badRequest('Choose a valid attendance date.');
  if (date > todayInTz(tz)) throw badRequest('Attendance cannot be recorded for a future date.');
}

const emptyClassification = (roster: RosterEntry[], pendingCount: number, columns: ColumnResolution): Classification => ({
  roster, pendingCount, rows: [], present: [], absent: [...roster], columns,
  counts: { totalRows: 0, present: 0, absent: roster.length, duplicates: 0, unknown: 0, invalid: 0, outOfBatch: 0, notEligible: 0, invalidTimestamps: 0 },
  uploadSummary: {},
});

/**
 * Classify an uploaded scanner CSV against the eligible roster for the selected batch and date. Never creates or
 * modifies enrollments or students, and never uses fuzzy matching.
 */
export async function classifyCsv(input: {
  batchId: string; attendanceDate: string; csv: string; timezone?: string;
  columnMap?: { rollColumn?: number | null; timestampColumn?: number | null };
}): Promise<Classification> {
  const tz = input.timezone || DEFAULT_TIMEZONE;
  const parsed = parseAttendanceCsv(input.csv);
  const columns = resolveColumns(parsed, input.columnMap);
  const { roster, pendingCount } = await eligibleRoster(input.batchId, input.attendanceDate, tz);
  if (columns.ambiguous) {
    throw badRequest('We could not identify the roll-number column. Choose which column contains the scanned roll numbers.', {
      code: 'COLUMN_MAPPING_REQUIRED', columns: columns.columns, header: columns.header,
    });
  }
  const rollIndex = columns.rollIndex!;
  const timeIndex = columns.timeIndex;
  const rosterByRoll = new Map(roster.map((r) => [r.rollNumber, r]));
  const present = new Map<string, PresentStudent>();
  const rows: ClassifiedRow[] = [];
  const seen = new Map<string, ClassifiedRow>();
  const unmatched: { row: ClassifiedRow; roll: string }[] = [];
  const counts = emptyClassification(roster, pendingCount, columns).counts;
  counts.totalRows = parsed.rows.length;

  const scanOf = (raw: string | undefined) => {
    if (!raw?.trim()) return { scanAt: null, invalid: false };
    const d = parseScanTime(raw, tz);
    return { scanAt: d ? d.toISOString() : null, invalid: !d };
  };

  for (const raw of parsed.rows) {
    const rawValue = raw.cells[rollIndex] ?? '';
    const roll = normalizeAttendanceRoll(rawValue);
    const scan = scanOf(timeIndex !== undefined && timeIndex !== null ? raw.cells[timeIndex] : undefined);
    if (scan.invalid) counts.invalidTimestamps++;
    const row: ClassifiedRow = { line: raw.line, raw: rawValue.trim(), rollNumber: roll, result: 'INVALID', message: '', scanAt: scan.scanAt };
    if (!roll) { row.message = 'Empty roll number.'; rows.push(row); counts.invalid++; continue; }
    if (!isValidRoll(roll)) { row.message = 'Not a valid 10-character roll number.'; rows.push(row); counts.invalid++; continue; }
    const first = seen.get(roll);
    if (first) {
      row.result = 'DUPLICATE';
      row.message = `Already scanned on line ${first.line}.`;
      rows.push(row);
      counts.duplicates++;
      const matched = rosterByRoll.get(roll);
      const current = matched && present.get(matched.studentId);
      // Keep the earliest valid scan for the student.
      if (current && scan.scanAt && (!current.scanAt || scan.scanAt < current.scanAt)) current.scanAt = scan.scanAt;
      continue;
    }
    seen.set(roll, row);
    const student = rosterByRoll.get(roll);
    if (student) {
      row.result = 'PRESENT';
      row.message = scan.invalid ? 'Scan time was not recognised; the row still counts as present.' : '';
      rows.push(row);
      present.set(student.studentId, { ...student, status: 'PRESENT', scanAt: scan.scanAt });
      continue;
    }
    rows.push(row);
    unmatched.push({ row, roll });
  }

  if (unmatched.length) {
    const rolls = [...new Set(unmatched.map((u) => u.roll))];
    const users = await User.find({ role: 'STUDENT', rollNumber: { $in: rolls } }, 'rollNumber status').lean();
    const userByRoll = new Map(users.map((u) => [u.rollNumber!, u]));
    const enrollments = await Enrollment.find(
      { studentId: { $in: users.map((u) => u._id) }, batchId: input.batchId },
      'studentId status enrolledAt removedAt',
    ).lean();
    const enrollmentByStudent = new Map(enrollments.map((e) => [String(e.studentId), e]));
    for (const { row, roll } of unmatched) {
      const user = userByRoll.get(roll);
      if (!user) { row.result = 'UNKNOWN'; row.message = 'No registered student has this roll number.'; counts.unknown++; continue; }
      if (user.status !== 'ACTIVE') { row.result = 'NOT_ELIGIBLE'; row.message = 'This student account is not active.'; counts.notEligible++; continue; }
      const enrollment = enrollmentByStudent.get(String(user._id));
      if (!enrollment) { row.result = 'OUT_OF_BATCH'; row.message = 'This student is not enrolled in the selected batch.'; counts.outOfBatch++; continue; }
      row.result = 'NOT_ELIGIBLE';
      row.message = enrollment.status === 'REMOVED'
        ? 'This student was not enrolled on the attendance date.'
        : 'This student was not eligible on the attendance date.';
      counts.notEligible++;
    }
  }

  counts.present = present.size;
  counts.absent = Math.max(0, roster.length - present.size);
  const presentList = roster.filter((r) => present.has(r.studentId)).map((r) => present.get(r.studentId)!);
  return {
    roster, pendingCount, rows, present: presentList, absent: roster.filter((r) => !present.has(r.studentId)), columns, counts,
    uploadSummary: {
      totalRows: counts.totalRows, uniqueValid: counts.present, duplicateScans: counts.duplicates,
      unknownRollNumbers: counts.unknown, invalidRollNumbers: counts.invalid, outOfBatch: counts.outOfBatch,
      notEligible: counts.notEligible, invalidTimestamps: counts.invalidTimestamps,
    },
  };
}

interface RecordInput {
  sessionId: Types.ObjectId; batchId: Types.ObjectId; attendanceDate: string; sessionType: SessionType;
  sessionStatus: 'DRAFT' | 'FINALIZED'; roster: RosterEntry[]; present: PresentStudent[]; userId?: Types.ObjectId;
  markingSource?: 'CSV_SCAN' | 'IMPORT_ADD' | 'IMPORT_REPLACE';
}

function buildRecords(args: RecordInput) {
  const present = new Map(args.present.map((p) => [p.studentId, p]));
  return args.roster.map((r) => {
    const p = present.get(r.studentId);
    return {
      sessionId: args.sessionId, studentId: new Types.ObjectId(r.studentId), batchId: args.batchId,
      enrollmentId: r.enrollmentId ? new Types.ObjectId(r.enrollmentId) : undefined,
      rollNumber: r.rollNumber, studentName: r.name,
      collegeId: r.collegeId ? new Types.ObjectId(r.collegeId) : undefined, collegeName: r.collegeName ?? undefined,
      attendanceDate: args.attendanceDate, sessionType: args.sessionType, sessionStatus: args.sessionStatus,
      status: p ? 'PRESENT' : 'ABSENT', scanAt: p?.scanAt ? new Date(p.scanAt) : undefined,
      markingSource: args.markingSource ?? 'CSV_SCAN', recordedBy: args.userId,
    };
  });
}

async function countsFromRecords(sessionId: Types.ObjectId, tx?: ClientSession) {
  const [row] = await AttendanceRecord.aggregate([
    { $match: { sessionId } },
    { $group: { _id: null, eligible: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } } } },
  ]).session(tx ?? null);
  const eligible = row?.eligible ?? 0;
  const present = row?.present ?? 0;
  return { eligible, present, absent: Math.max(0, eligible - present) };
}

export interface SessionInput {
  batchId: string; attendanceDate: string; sessionType: SessionType; attendanceTime: string;
  timezone?: string; notes?: string; csv?: string; columnMap?: { rollColumn?: number | null; timestampColumn?: number | null };
  finalize?: boolean;
}

/** Create a draft (or finalize immediately after review). One live session per batch + date + type. */
export async function createAttendanceSession(req: Request, user: UserDoc, input: SessionInput) {
  const tz = input.timezone || DEFAULT_TIMEZONE;
  assertAttendanceDate(input.attendanceDate, tz);
  if (!isTimeString(input.attendanceTime)) throw badRequest('Enter the attendance time as HH:mm.');
  const batch = await loadBatchFor(user, input.batchId, { writable: true });
  const existing = await AttendanceSession.findOne({ batchId: batch._id, attendanceDate: input.attendanceDate, sessionType: input.sessionType, isActive: true }, '_id status').lean();
  if (existing) {
    throw conflict('Attendance has already been recorded for this session. Open the existing session instead.', 'ATTENDANCE_EXISTS');
  }
  const classification = input.csv?.trim()
    ? await classifyCsv({ batchId: String(batch._id), attendanceDate: input.attendanceDate, csv: input.csv, timezone: tz, columnMap: input.columnMap })
    : emptyClassification((await eligibleRoster(String(batch._id), input.attendanceDate, tz)).roster, 0, { rollIndex: 0, timeIndex: null, ambiguous: false, header: null, columns: [] });
  if (!classification.roster.length) throw badRequest('No student is eligible for attendance in this batch on the selected date.');

  const sessionId = new Types.ObjectId();
  const status = input.finalize ? 'FINALIZED' : 'DRAFT';
  const presentCount = classification.present.length;
  const recordCount = classification.roster.length;
  const doc = {
    _id: sessionId, batchId: batch._id, batchName: batch.name, attendanceDate: input.attendanceDate,
    sessionType: input.sessionType, attendanceTime: input.attendanceTime, timezone: tz, status,
    isActive: true, eligibleCount: recordCount, presentCount, absentCount: recordCount - presentCount,
    roster: classification.roster, uploadSummary: classification.uploadSummary, notes: input.notes?.trim() || undefined,
    createdBy: user._id, ...(input.finalize ? { finalizedBy: user._id, finalizedAt: new Date() } : {}),
  };
  const records = buildRecords({
    sessionId, batchId: batch._id, attendanceDate: input.attendanceDate, sessionType: input.sessionType,
    sessionStatus: status, roster: classification.roster, present: classification.present, userId: user._id,
  });
  try {
    await maybeTransaction(async (session) => {
      await AttendanceSession.create([doc as any], { session });
      if (records.length) await AttendanceRecord.insertMany(records, { session, ordered: false });
    });
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('Attendance has already been recorded for this session.', 'ATTENDANCE_EXISTS');
    throw e;
  }
  await audit(req, 'attendance.session.create', { type: 'AttendanceSession', id: sessionId }, {
    batchId: String(batch._id), date: input.attendanceDate, sessionType: input.sessionType, status, uploadSummary: classification.uploadSummary,
  });
  if (input.finalize) {
    await audit(req, 'attendance.session.finalize', { type: 'AttendanceSession', id: sessionId }, {
      present: presentCount, absent: recordCount - presentCount, eligible: recordCount,
    });
  }
  return getSessionDetail(user, String(sessionId));
}

/** Re-validate the eligible roster before finalizing. Any change since the draft blocks finalization. */
async function assertRosterUnchanged(session: { batchId: Types.ObjectId; attendanceDate: string; timezone?: string | null; roster: { studentId: Types.ObjectId; rollNumber: string }[] }) {
  const { roster } = await eligibleRoster(String(session.batchId), session.attendanceDate, session.timezone || DEFAULT_TIMEZONE);
  const before = new Set(session.roster.map((r) => String(r.studentId)));
  const after = new Set(roster.map((r) => r.studentId));
  const added = roster.filter((r) => !before.has(r.studentId)).map((r) => ({ studentId: r.studentId, rollNumber: r.rollNumber }));
  const removed = session.roster.filter((r) => !after.has(String(r.studentId))).map((r) => ({ studentId: String(r.studentId), rollNumber: r.rollNumber }));
  if (added.length || removed.length) {
    throw new AppError(409, 'ROSTER_CHANGED', 'The eligible student roster changed since this draft was created. Review the attendance again before finalizing.', { added, removed });
  }
}

export async function finalizeAttendanceSession(req: Request, user: UserDoc, sessionId: string) {
  const id = new Types.ObjectId(sessionId);
  const session = await AttendanceSession.findById(id);
  if (!session) throw notFound('Attendance session not found');
  await loadBatchFor(user, String(session.batchId), { writable: true });
  if (session.status === 'FINALIZED') throw conflict('Attendance is already finalized.', 'ALREADY_FINALIZED');
  if (session.status === 'CANCELLED') throw conflict('This attendance session was cancelled.', 'SESSION_CANCELLED');
  await assertRosterUnchanged(session);
  const counts = await countsFromRecords(id);
  await maybeTransaction(async (tx) => {
    // Claim the draft atomically. A concurrent finalizer (or a transaction retry after losing a write conflict) matches
    // nothing here and must not report success.
    const claimed = await AttendanceSession.findOneAndUpdate({ _id: id, status: 'DRAFT' }, {
      $set: { status: 'FINALIZED', finalizedBy: user._id, finalizedAt: new Date(), eligibleCount: counts.eligible, presentCount: counts.present, absentCount: counts.absent },
    }, { session: tx, returnDocument: 'after' });
    if (!claimed) throw conflict('Attendance is already finalized.', 'ALREADY_FINALIZED');
    await AttendanceRecord.updateMany({ sessionId: id }, { $set: { sessionStatus: 'FINALIZED' } }, { session: tx });
  });
  await audit(req, 'attendance.session.finalize', { type: 'AttendanceSession', id }, { ...counts });
  return getSessionDetail(user, sessionId);
}

export async function updateDraftSession(req: Request, user: UserDoc, sessionId: string, input: {
  attendanceTime?: string; notes?: string; csv?: string; columnMap?: { rollColumn?: number | null; timestampColumn?: number | null };
}) {
  const id = new Types.ObjectId(sessionId);
  const session = await AttendanceSession.findById(id);
  if (!session) throw notFound('Attendance session not found');
  await loadBatchFor(user, String(session.batchId), { writable: true });
  if (session.status !== 'DRAFT') throw conflict('Only draft attendance can be edited. Use a correction for finalized attendance.', 'NOT_DRAFT');
  if (input.attendanceTime !== undefined && !isTimeString(input.attendanceTime)) throw badRequest('Enter the attendance time as HH:mm.');
  let classification: Classification | null = null;
  if (input.csv?.trim()) {
    classification = await classifyCsv({
      batchId: String(session.batchId), attendanceDate: session.attendanceDate, csv: input.csv,
      timezone: session.timezone || DEFAULT_TIMEZONE, columnMap: input.columnMap,
    });
  }
  await maybeTransaction(async (tx) => {
    const $set: Record<string, unknown> = {};
    if (input.attendanceTime !== undefined) $set.attendanceTime = input.attendanceTime;
    if (input.notes !== undefined) $set.notes = input.notes.trim() || undefined;
    if (classification) {
      $set.roster = classification.roster;
      $set.uploadSummary = classification.uploadSummary;
      $set.eligibleCount = classification.roster.length;
      $set.presentCount = classification.present.length;
      $set.absentCount = classification.roster.length - classification.present.length;
      await AttendanceRecord.deleteMany({ sessionId: id }, { session: tx });
      const records = buildRecords({
        sessionId: id, batchId: session.batchId, attendanceDate: session.attendanceDate, sessionType: session.sessionType,
        sessionStatus: 'DRAFT', roster: classification.roster, present: classification.present, userId: user._id,
      });
      if (records.length) await AttendanceRecord.insertMany(records, { session: tx, ordered: false });
    }
    if (Object.keys($set).length) await AttendanceSession.updateOne({ _id: id }, { $set }, { session: tx });
  });
  await audit(req, 'attendance.session.update', { type: 'AttendanceSession', id }, { replacedCsv: !!classification, uploadSummary: classification?.uploadSummary });
  return getSessionDetail(user, sessionId);
}

/** Add scanned roll numbers to an existing session, or replace its roster from a corrected CSV. */
export async function importSessionScans(req: Request, user: UserDoc, sessionId: string, input: {
  csv: string; mode: 'ADD' | 'REPLACE'; reason?: string; columnMap?: { rollColumn?: number | null; timestampColumn?: number | null };
}) {
  const id = new Types.ObjectId(sessionId);
  const session = await AttendanceSession.findById(id);
  if (!session) throw notFound('Attendance session not found');
  await loadBatchFor(user, String(session.batchId), { writable: true });
  if (session.status === 'CANCELLED') throw conflict('This attendance session was cancelled.', 'SESSION_CANCELLED');
  const reason = input.reason?.trim();
  if (session.status === 'FINALIZED' && (!reason || reason.length < 3)) throw badRequest('Add a reason for changing finalized attendance.');
  const classification = await classifyCsv({
    batchId: String(session.batchId), attendanceDate: session.attendanceDate, csv: input.csv,
    timezone: session.timezone || DEFAULT_TIMEZONE, columnMap: input.columnMap,
  });
  const sessionRoster = new Map(session.roster.map((r) => [String(r.studentId), r]));
  let added = 0, promoted = 0, replaced = 0, skipped = 0;

  await maybeTransaction(async (tx) => {
    if (input.mode === 'REPLACE') {
      await AttendanceRecord.deleteMany({ sessionId: id }, { session: tx });
      const records = buildRecords({
        sessionId: id, batchId: session.batchId, attendanceDate: session.attendanceDate, sessionType: session.sessionType,
        sessionStatus: session.status === 'FINALIZED' ? 'FINALIZED' : 'DRAFT', roster: classification.roster,
        present: classification.present, userId: user._id, markingSource: 'IMPORT_REPLACE',
      });
      if (records.length) await AttendanceRecord.insertMany(records, { session: tx, ordered: false });
      replaced = records.filter((r) => r.status === 'PRESENT').length;
      await AttendanceSession.updateOne({ _id: id }, {
        $set: { roster: classification.roster, uploadSummary: classification.uploadSummary, eligibleCount: classification.roster.length },
        $inc: { revision: 1 },
      }, { session: tx });
    } else {
      const existing = await AttendanceRecord.find({ sessionId: id }, 'studentId status scanAt').session(tx ?? null).lean();
      const byStudent = new Map(existing.map((r) => [String(r.studentId), r]));
      for (const p of classification.present) {
        const rosterEntry = sessionRoster.get(p.studentId);
        if (!rosterEntry) { skipped++; continue; }
        const record = byStudent.get(p.studentId);
        const scanAt = p.scanAt ? new Date(p.scanAt) : new Date();
        if (!record) {
          await AttendanceRecord.create([{
            sessionId: id, studentId: new Types.ObjectId(p.studentId), batchId: session.batchId, enrollmentId: new Types.ObjectId(p.enrollmentId),
            rollNumber: p.rollNumber, studentName: p.name, collegeId: p.collegeId ? new Types.ObjectId(p.collegeId) : undefined, collegeName: p.collegeName ?? undefined,
            attendanceDate: session.attendanceDate, sessionType: session.sessionType,
            sessionStatus: session.status === 'FINALIZED' ? 'FINALIZED' : 'DRAFT', status: 'PRESENT', scanAt,
            markingSource: 'IMPORT_ADD', recordedBy: user._id,
          }], { session: tx });
          added++;
        } else if (record.status === 'ABSENT') {
          await AttendanceRecord.updateOne({ _id: record._id }, {
            $set: { status: 'PRESENT', scanAt, markingSource: 'IMPORT_ADD', correctedBy: user._id, correctedAt: new Date(), correctionReason: reason },
            $push: { corrections: { from: 'ABSENT', to: 'PRESENT', toScanAt: scanAt, by: user._id, at: new Date(), reason, source: 'IMPORT_ADD' } },
          }, { session: tx });
          promoted++;
        } else if (!record.scanAt || scanAt < record.scanAt) {
          await AttendanceRecord.updateOne({ _id: record._id }, {
            $set: { scanAt, correctedBy: user._id, correctedAt: new Date(), correctionReason: reason },
            $push: { corrections: { from: 'PRESENT', to: 'PRESENT', fromScanAt: record.scanAt, toScanAt: scanAt, by: user._id, at: new Date(), reason, source: 'IMPORT_ADD' } },
          }, { session: tx });
        } else skipped++;
      }
      await AttendanceSession.updateOne({ _id: id }, { $inc: { revision: 1 } }, { session: tx });
    }
    const counts = await countsFromRecords(id, tx);
    await AttendanceSession.updateOne({ _id: id }, {
      $set: { eligibleCount: counts.eligible, presentCount: counts.present, absentCount: counts.absent },
    }, { session: tx });
  });
  await audit(req, 'attendance.session.import', { type: 'AttendanceSession', id }, {
    mode: input.mode, added, promoted, replaced, skipped, reason, uploadSummary: classification.uploadSummary,
  });
  return { added, promoted, replaced, skipped, ...(await getSessionDetail(user, sessionId)) };
}

/** Authorized status correction. Finalized attendance requires a reason and keeps an immutable correction trail. */
export async function correctAttendance(req: Request, user: UserDoc, sessionId: string, input: {
  corrections: { studentId: string; status: 'PRESENT' | 'ABSENT'; scanAt?: string | null }[]; reason: string;
}) {
  const id = new Types.ObjectId(sessionId);
  const session = await AttendanceSession.findById(id);
  if (!session) throw notFound('Attendance session not found');
  await loadBatchFor(user, String(session.batchId), { writable: true });
  if (session.status !== 'FINALIZED') throw conflict('Only finalized attendance can be corrected.', 'NOT_FINALIZED');
  const reason = input.reason?.trim() ?? '';
  if (reason.length < 3) throw badRequest('Add a reason for the correction.');
  const records = await AttendanceRecord.find({ sessionId: id, studentId: { $in: input.corrections.map((c) => c.studentId) } });
  const byStudent = new Map(records.map((r) => [String(r.studentId), r]));
  const changes: Record<string, unknown>[] = [];
  await maybeTransaction(async (tx) => {
    for (const correction of input.corrections) {
      const record = byStudent.get(correction.studentId);
      if (!record) throw conflict('This student is not part of the recorded attendance roster.', 'NOT_IN_ROSTER');
      const scanAt = correction.status === 'PRESENT'
        ? (correction.scanAt ? new Date(correction.scanAt) : record.scanAt ?? new Date())
        : null;
      const changed = record.status !== correction.status || String(record.scanAt ?? '') !== String(scanAt ?? '');
      if (!changed) continue;
      changes.push({ studentId: correction.studentId, from: record.status, to: correction.status, fromScanAt: record.scanAt, toScanAt: scanAt });
      await AttendanceRecord.updateOne({ _id: record._id }, {
        $set: { status: correction.status, scanAt: scanAt ?? undefined, markingSource: 'MANUAL_CORRECTION', correctedBy: user._id, correctedAt: new Date(), correctionReason: reason },
        $push: { corrections: { from: record.status, to: correction.status, fromScanAt: record.scanAt, toScanAt: scanAt, by: user._id, at: new Date(), reason, source: 'MANUAL_CORRECTION' } },
      }, { session: tx });
    }
    const counts = await countsFromRecords(id, tx);
    await AttendanceSession.updateOne({ _id: id }, {
      $set: { eligibleCount: counts.eligible, presentCount: counts.present, absentCount: counts.absent },
      $inc: { revision: 1 },
    }, { session: tx });
  });
  if (changes.length) await audit(req, 'attendance.session.correct', { type: 'AttendanceSession', id }, { reason, changes });
  return getSessionDetail(user, sessionId);
}

export async function cancelAttendanceSession(req: Request, user: UserDoc, sessionId: string, reason: string) {
  const id = new Types.ObjectId(sessionId);
  const session = await AttendanceSession.findById(id);
  if (!session) throw notFound('Attendance session not found');
  await loadBatchFor(user, String(session.batchId), { writable: true });
  if (session.status === 'CANCELLED') throw conflict('This attendance session is already cancelled.', 'SESSION_CANCELLED');
  if (!reason || reason.trim().length < 3) throw badRequest('Add a reason for cancelling this session.');
  await maybeTransaction(async (tx) => {
    await AttendanceRecord.updateMany({ sessionId: id }, { $set: { sessionStatus: 'CANCELLED' } }, { session: tx });
    await AttendanceSession.updateOne({ _id: id }, {
      $set: { status: 'CANCELLED', isActive: false, cancelledBy: user._id, cancelledAt: new Date(), cancellationReason: reason.trim() },
    }, { session: tx });
  });
  await audit(req, 'attendance.session.cancel', { type: 'AttendanceSession', id }, { reason, previousStatus: session.status });
  return getSessionDetail(user, sessionId);
}

/** Recompute stored summary counts from individual records. Reports, never invents, history. */
export async function reconcileAttendance(limit = 2000) {
  const sessions = await AttendanceSession.find({ status: 'FINALIZED' }, '_id eligibleCount presentCount absentCount').limit(limit).lean();
  const aggregates = await AttendanceRecord.aggregate([
    { $match: { sessionId: { $in: sessions.map((s) => s._id) } } },
    { $group: { _id: '$sessionId', eligible: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } } } },
  ]);
  const byId = new Map(aggregates.map((a) => [String(a._id), a]));
  const fixes = [];
  for (const session of sessions) {
    const a = byId.get(String(session._id)) ?? { eligible: 0, present: 0 };
    const absent = Math.max(0, a.eligible - a.present);
    if (session.eligibleCount !== a.eligible || session.presentCount !== a.present || session.absentCount !== absent) {
      fixes.push({ sessionId: String(session._id), eligible: a.eligible, present: a.present, absent });
    }
  }
  if (fixes.length) {
    await AttendanceSession.bulkWrite(fixes.map((f) => ({
      updateOne: { filter: { _id: f.sessionId }, update: { $set: { eligibleCount: f.eligible, presentCount: f.present, absentCount: f.absent } } },
    })), { ordered: false });
  }
  return { checked: sessions.length, repaired: fixes.length, fixes };
}

// ------------------------------------------------------------------------------------------------ read models

export interface SessionFilters {
  batchId?: string; collegeId?: string; status?: 'DRAFT' | 'FINALIZED' | 'CANCELLED'; sessionType?: SessionType;
  from?: string; to?: string; q?: string; page?: number; pageSize?: number;
  sort?: 'date' | 'eligible' | 'present' | 'absent'; dir?: 'asc' | 'desc';
}

export async function allowedBatchIds(user: UserDoc): Promise<Types.ObjectId[] | null> {
  if (user.role === 'SUPER_ADMIN') return null;
  return (await trainerBatchIds(user)) as Types.ObjectId[];
}

async function scopedBatchFilter(user: UserDoc, f: SessionFilters, opts: { includeArchived?: boolean } = {}) {
  const q: Record<string, unknown> = {};
  // Archived batches are excluded from comparisons, but attendance history stays readable when one is named explicitly.
  if (!opts.includeArchived && !f.batchId) q.status = { $ne: 'ARCHIVED' };
  const allowed = await allowedBatchIds(user);
  if (allowed) q._id = { $in: allowed };
  if (f.batchId) q._id = allowed ? { $in: allowed.filter((id) => String(id) === f.batchId) } : f.batchId;
  if (f.collegeId) q.collegeId = f.collegeId;
  return q;
}

/** Batches (and their ids) the user may analyse. Archive is excluded: attendance stays readable through history. */
async function scopedBatches(user: UserDoc, f: SessionFilters) {
  return Batch.find(await scopedBatchFilter(user, f), 'name collegeId status startDate endDate').lean();
}

function sessionMatch(batchIds: Types.ObjectId[], f: SessionFilters) {
  const match: Record<string, unknown> = { batchId: { $in: batchIds } };
  if (f.status) match.status = f.status;
  if (f.sessionType) match.sessionType = f.sessionType;
  if (f.from || f.to) match.attendanceDate = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  return match;
}

export async function listSessions(user: UserDoc, f: SessionFilters) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25));
  const batches = await scopedBatches(user, f);
  if (f.batchId && !batches.length) throw notFound('Batch not found');
  const match = sessionMatch(batches.map((b) => b._id), f);
  if (f.q) {
    const escaped = f.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match.batchName = { $regex: escaped, $options: 'i' };
  }
  const dir: 1 | -1 = f.dir === 'asc' ? 1 : -1;
  const sortField = f.sort === 'eligible' ? 'eligibleCount' : f.sort === 'present' ? 'presentCount' : f.sort === 'absent' ? 'absentCount' : 'attendanceDate';
  const sort: Record<string, 1 | -1> = f.sort ? { [sortField]: dir, sessionType: 1 } : { attendanceDate: -1, sessionType: 1 };
  const [items, total] = await Promise.all([
    AttendanceSession.find(match).sort(sort).skip((page - 1) * pageSize).limit(pageSize)
      .populate('createdBy finalizedBy', 'fullName').lean(),
    AttendanceSession.countDocuments(match),
  ]);
  return {
    total, page, pageSize,
    items: items.map((s) => ({
      _id: s._id, batchId: s.batchId, batchName: s.batchName, attendanceDate: s.attendanceDate, sessionType: s.sessionType,
      attendanceTime: s.attendanceTime, timezone: s.timezone, status: s.status, eligibleCount: s.eligibleCount,
      presentCount: s.presentCount, absentCount: s.absentCount, percentage: percent(s.presentCount, s.eligibleCount),
      createdBy: (s.createdBy as any)?.fullName ?? null, finalizedBy: (s.finalizedBy as any)?.fullName ?? null,
      finalizedAt: s.finalizedAt ?? null, notes: s.notes ?? null, revision: s.revision ?? 0, createdAt: s.createdAt,
    })),
  };
}

export async function getSessionDetail(user: UserDoc, sessionId: string) {
  const session = await AttendanceSession.findById(sessionId).populate('createdBy finalizedBy cancelledBy', 'fullName').lean();
  if (!session) throw notFound('Attendance session not found');
  await loadBatchFor(user, String(session.batchId));
  const records = await AttendanceRecord.find({ sessionId: session._id }).sort({ rollNumber: 1 }).lean();
  const rosterById = new Map(session.roster.map((r) => [String(r.studentId), r]));
  const batch = await Batch.findById(session.batchId, 'name collegeId status').lean();
  return {
    session: {
      _id: session._id, batchId: session.batchId, batchName: session.batchName, batchStatus: batch?.status ?? null,
      attendanceDate: session.attendanceDate, sessionType: session.sessionType, attendanceTime: session.attendanceTime,
      timezone: session.timezone, status: session.status, eligibleCount: session.eligibleCount,
      presentCount: session.presentCount, absentCount: session.absentCount, percentage: percent(session.presentCount, session.eligibleCount),
      notes: session.notes ?? null, uploadSummary: session.uploadSummary ?? null, revision: session.revision ?? 0,
      createdBy: (session.createdBy as any)?.fullName ?? null, finalizedBy: (session.finalizedBy as any)?.fullName ?? null,
      finalizedAt: session.finalizedAt ?? null, createdAt: session.createdAt, updatedAt: session.updatedAt,
      cancelledBy: (session.cancelledBy as any)?.fullName ?? null, cancelledAt: session.cancelledAt ?? null,
      cancellationReason: session.cancellationReason ?? null,
    },
    records: records.map((r) => ({
      _id: r._id, studentId: r.studentId, rollNumber: r.rollNumber,
      studentName: r.studentName ?? rosterById.get(String(r.studentId))?.name ?? 'Student',
      collegeId: r.collegeId ?? null, college: r.collegeName ?? rosterById.get(String(r.studentId))?.collegeName ?? null,
      status: r.status, scanAt: r.scanAt ?? null, markingSource: r.markingSource,
      corrections: (r.corrections ?? []).map((c) => ({ from: c.from, to: c.to, fromScanAt: c.fromScanAt ?? null, toScanAt: c.toScanAt ?? null, at: c.at, reason: c.reason ?? null, source: c.source ?? null })),
    })),
    correctionHistory: records.flatMap((r) => (r.corrections ?? []).map((c) => ({
      studentId: r.studentId, rollNumber: r.rollNumber, studentName: r.studentName ?? null,
      from: c.from, to: c.to, at: c.at, reason: c.reason ?? null, source: c.source ?? null,
    }))).sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()),
    canCorrect: user.role === 'SUPER_ADMIN' || session.status === 'FINALIZED',
  };
}

/** Session-level totals for a scope. Weighted: total present divided by total eligible opportunities. */
export async function sessionTotals(batchIds: Types.ObjectId[], f: SessionFilters) {
  const match = sessionMatch(batchIds, f);
  const rows = await AttendanceSession.aggregate([
    { $match: match },
    { $group: {
      _id: '$status', sessions: { $sum: 1 }, eligible: { $sum: '$eligibleCount' }, present: { $sum: '$presentCount' },
      absent: { $sum: '$absentCount' }, morningSessions: { $sum: { $cond: [{ $eq: ['$sessionType', 'MORNING'] }, 1, 0] } },
      afternoonSessions: { $sum: { $cond: [{ $eq: ['$sessionType', 'AFTERNOON'] }, 1, 0] } },
    } },
  ]);
  const finalized = rows.find((r) => r._id === 'FINALIZED') ?? { sessions: 0, eligible: 0, present: 0, absent: 0, morningSessions: 0, afternoonSessions: 0 };
  const draft = rows.find((r) => r._id === 'DRAFT')?.sessions ?? 0;
  const cancelled = rows.find((r) => r._id === 'CANCELLED')?.sessions ?? 0;
  return { ...finalized, draftSessions: draft, cancelledSessions: cancelled, percentage: percent(finalized.present, finalized.eligible) };
}

export async function attendanceOverview(user: UserDoc, f: SessionFilters) {
  const batches = await scopedBatches(user, f);
  const ids = batches.map((b) => b._id);
  const [totals, recent] = await Promise.all([
    sessionTotals(ids, f),
    AttendanceSession.find(sessionMatch(ids, { ...f, page: 1 })).sort({ attendanceDate: -1, sessionType: 1 }).limit(8)
      .select('batchId batchName attendanceDate sessionType attendanceTime status eligibleCount presentCount absentCount').lean(),
  ]);
  const withAttendance = new Set((await AttendanceSession.distinct('batchId', { batchId: { $in: ids }, status: 'FINALIZED' })).map(String));
  return {
    totals, batches: batches.length, batchesWithAttendance: withAttendance.size,
    recent: recent.map((s) => ({ ...s, _id: String(s._id), percentage: percent(s.presentCount, s.eligibleCount) })),
  };
}

export async function batchAttendanceSummary(user: UserDoc, batchId: string) {
  const batch = await loadBatchFor(user, batchId);
  const [totals, morning, afternoon, recent, enrolled] = await Promise.all([
    sessionTotals([batch._id], { batchId }),
    sessionTotals([batch._id], { batchId, sessionType: 'MORNING' }),
    sessionTotals([batch._id], { batchId, sessionType: 'AFTERNOON' }),
    AttendanceSession.find({ batchId: batch._id }).sort({ attendanceDate: -1, sessionType: 1 }).limit(8)
      .select('attendanceDate sessionType attendanceTime status eligibleCount presentCount absentCount').lean(),
    Enrollment.countDocuments({ batchId: batch._id, status: 'ACTIVE' }),
  ]);
  return {
    batch: { _id: batch._id, name: batch.name, status: batch.status }, enrolled, totals,
    morning: { sessions: morning.sessions, percentage: morning.percentage, present: morning.present, absent: morning.absent },
    afternoon: { sessions: afternoon.sessions, percentage: afternoon.percentage, present: afternoon.present, absent: afternoon.absent },
    recent: recent.map((s) => ({ ...s, percentage: percent(s.presentCount, s.eligibleCount) })),
  };
}

export interface StudentAttendanceFilters { batchId?: string; from?: string; to?: string; sessionType?: SessionType; status?: 'PRESENT' | 'ABSENT' }

/** Summary + history for one student, computed from finalized records only. */
export async function studentAttendanceData(studentId: string, f: StudentAttendanceFilters) {
  const student = await User.findOne({ _id: studentId, role: 'STUDENT' }, 'fullName rollNumber collegeId status').populate('collegeId', 'name').lean();
  if (!student) throw notFound('Student not found');
  const base: Record<string, unknown> = { studentId: new Types.ObjectId(studentId), sessionStatus: 'FINALIZED' };
  if (f.batchId) base.batchId = new Types.ObjectId(f.batchId);
  if (f.from || f.to) base.attendanceDate = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  const typeMatch = { ...base, ...(f.sessionType ? { sessionType: f.sessionType } : {}) };
  const [totals] = await AttendanceRecord.aggregate([
    { $match: typeMatch },
    { $group: { _id: null, eligible: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } } } },
  ]);
  const byType = await AttendanceRecord.aggregate([
    { $match: base },
    { $group: { _id: '$sessionType', eligible: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } } } },
  ]);
  const history = await AttendanceRecord.find({ ...base, ...(f.status ? { status: f.status } : {}) })
    .sort({ attendanceDate: -1, sessionType: 1 }).limit(500)
    .select('attendanceDate sessionType status scanAt batchId rollNumber studentName collegeName markingSource').lean();
  const enrollments = await Enrollment.find({ studentId, status: 'ACTIVE' }, 'batchId enrolledAt').lean();
  const batches = await Batch.find({ _id: { $in: enrollments.map((e) => e.batchId) } }, 'name').lean();
  const morning = byType.find((t) => t._id === 'MORNING');
  const afternoon = byType.find((t) => t._id === 'AFTERNOON');
  const eligible = totals?.eligible ?? 0;
  const present = totals?.present ?? 0;
  return {
    student: {
      _id: student._id, fullName: student.fullName, rollNumber: student.rollNumber,
      college: (student.collegeId as any)?.name ?? null, collegeId: (student.collegeId as any)?._id ?? null,
      batches: enrollments.map((e) => ({ batchId: e.batchId, name: batches.find((b) => String(b._id) === String(e.batchId))?.name ?? 'Batch' })),
    },
    summary: {
      eligible, present, absent: Math.max(0, eligible - present), percentage: percent(present, eligible),
      morning: morning ? { eligible: morning.eligible, present: morning.present, percentage: percent(morning.present, morning.eligible) } : { eligible: 0, present: 0, percentage: null },
      afternoon: afternoon ? { eligible: afternoon.eligible, present: afternoon.present, percentage: percent(afternoon.present, afternoon.eligible) } : { eligible: 0, present: 0, percentage: null },
    },
    /** Per-day breakdown. Sessions that were never recorded are absent from this list, never counted as absences. */
    daily: Object.values(history.reduce<Record<string, { date: string; morning: string | null; afternoon: string | null }>>((acc, r) => {
      const row = acc[r.attendanceDate] ?? (acc[r.attendanceDate] = { date: r.attendanceDate, morning: null, afternoon: null });
      row[r.sessionType === 'MORNING' ? 'morning' : 'afternoon'] = r.status;
      return acc;
    }, {})).sort((a, b) => b.date.localeCompare(a.date)),
    history: history.map((r) => ({
      attendanceDate: r.attendanceDate, sessionType: r.sessionType, status: r.status, scanAt: r.scanAt ?? null,
      batchId: r.batchId, rollNumber: r.rollNumber, studentName: r.studentName ?? null, college: r.collegeName ?? null,
      markingSource: r.markingSource,
    })),
  };
}

/** Trainers may only read students enrolled in one of their batches. */
export async function assertCanReadStudent(user: UserDoc, studentId: string) {
  if (user.role === 'SUPER_ADMIN') return;
  const allowed = await trainerBatchIds(user);
  const ok = await Enrollment.exists({ studentId, batchId: { $in: allowed }, status: 'ACTIVE' });
  if (!ok) throw notFound('Student not found');
}

export const sessionIdParam = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Attendance session not found');
  return id;
};
