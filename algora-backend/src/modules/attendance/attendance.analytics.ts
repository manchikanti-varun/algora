import { Types } from 'mongoose';
import { badRequest, notFound } from '../../lib/errors';
import { AttendanceRecord, AttendanceSession, Batch, College, Enrollment, type UserDoc } from '../../models';
import { allowedBatchIds } from './attendance.service';
import { addDays, dateRange, monthEnd, monthStart, weekStart } from './attendance.time';

export interface RangeFilters {
  batchId?: string; collegeId?: string; from?: string; to?: string; sessionType?: 'MORNING' | 'AFTERNOON';
}

const percent = (present: number, eligible: number) => (eligible > 0 ? Math.round((present / eligible) * 1000) / 10 : null);

async function scope(user: UserDoc, f: RangeFilters) {
  const q: Record<string, unknown> = { status: { $ne: 'ARCHIVED' } };
  const allowed = await allowedBatchIds(user);
  if (allowed) q._id = { $in: allowed };
  if (f.batchId) q._id = allowed ? { $in: allowed.filter((id) => String(id) === f.batchId) } : f.batchId;
  if (f.collegeId) q.collegeId = f.collegeId;
  const batches = await Batch.find(q, 'name collegeId status startDate endDate').lean();
  if (f.batchId && !batches.length) throw notFound('Batch not found');
  return { batches, ids: batches.map((b) => b._id) };
}

const assertRange = (from: string, to: string) => {
  if (!from || !to || from > to) throw badRequest('Choose a valid start and end date.');
  if (dateRange(from, to, 800).length >= 800) throw badRequest('Choose a date range of at most two years.');
};

function sessionMatch(ids: Types.ObjectId[], f: RangeFilters, from: string, to: string) {
  return {
    batchId: { $in: ids }, status: 'FINALIZED' as const, attendanceDate: { $gte: from, $lte: to },
    ...(f.sessionType ? { sessionType: f.sessionType } : {}),
  };
}

interface Bucket { eligible: number; present: number; absent: number; sessions: number }
const emptyBucket = (): Bucket => ({ eligible: 0, present: 0, absent: 0, sessions: 0 });

/** Day-by-day analysis. A day with only one recorded session never reports the other session as absent. */
export async function dailyAnalysis(user: UserDoc, f: RangeFilters) {
  if (!f.from || !f.to) throw badRequest('Choose a start and end date.');
  assertRange(f.from, f.to);
  const { ids } = await scope(user, f);
  const rows = await AttendanceSession.aggregate([
    { $match: sessionMatch(ids, f, f.from, f.to) },
    { $group: {
      _id: { date: '$attendanceDate', type: '$sessionType' },
      eligible: { $sum: '$eligibleCount' }, present: { $sum: '$presentCount' }, absent: { $sum: '$absentCount' }, sessions: { $sum: 1 },
    } },
  ]);
  const days = new Map<string, { date: string; morning: Bucket | null; afternoon: Bucket | null }>();
  for (const date of dateRange(f.from, f.to, 400)) days.set(date, { date, morning: null, afternoon: null });
  for (const row of rows) {
    const day = days.get(row._id.date);
    if (!day) continue;
    const bucket = { eligible: row.eligible, present: row.present, absent: row.absent, sessions: row.sessions };
    if (row._id.type === 'MORNING') day.morning = bucket; else day.afternoon = bucket;
  }
  return {
    from: f.from, to: f.to,
    days: [...days.values()].map((d) => {
      const eligible = (d.morning?.eligible ?? 0) + (d.afternoon?.eligible ?? 0);
      const present = (d.morning?.present ?? 0) + (d.afternoon?.present ?? 0);
      return {
        ...d,
        morningPct: d.morning ? percent(d.morning.present, d.morning.eligible) : null,
        afternoonPct: d.afternoon ? percent(d.afternoon.present, d.afternoon.eligible) : null,
        overall: { eligible, present, absent: Math.max(0, eligible - present), percentage: percent(present, eligible) },
      };
    }),
  };
}

/** Totals plus morning/afternoon split for a range. */
export async function rangeTotals(user: UserDoc, f: RangeFilters & { from: string; to: string }) {
  assertRange(f.from, f.to);
  const { ids, batches } = await scope(user, f);
  const rows = await AttendanceSession.aggregate([
    { $match: sessionMatch(ids, f, f.from, f.to) },
    { $group: { _id: '$sessionType', eligible: { $sum: '$eligibleCount' }, present: { $sum: '$presentCount' }, absent: { $sum: '$absentCount' }, sessions: { $sum: 1 } } },
  ]);
  const of = (type: string) => rows.find((r) => r._id === type) ?? { eligible: 0, present: 0, absent: 0, sessions: 0 };
  const eligible = rows.reduce((a, r) => a + r.eligible, 0);
  const present = rows.reduce((a, r) => a + r.present, 0);
  return {
    from: f.from, to: f.to, batches: batches.length,
    totals: { eligible, present, absent: Math.max(0, eligible - present), sessions: rows.reduce((a, r) => a + r.sessions, 0), percentage: percent(present, eligible) },
    morning: { ...of('MORNING'), percentage: percent(of('MORNING').present, of('MORNING').eligible) },
    afternoon: { ...of('AFTERNOON'), percentage: percent(of('AFTERNOON').present, of('AFTERNOON').eligible) },
  };
}

/** Weekly view (Monday–Sunday by default) with daily trend and low-attendance students for the week. */
export async function weeklyAnalysis(user: UserDoc, f: RangeFilters & { anchor?: string; threshold?: number }) {
  const from = f.from ?? weekStart(f.anchor ?? f.to ?? new Date().toISOString().slice(0, 10));
  const to = f.to ?? addDays(from, 6);
  const [totals, daily, low] = await Promise.all([
    rangeTotals(user, { ...f, from, to }),
    dailyAnalysis(user, { ...f, from, to }),
    lowAttendance(user, { batchId: f.batchId, collegeId: f.collegeId, from, to, sessionType: f.sessionType, threshold: f.threshold ?? 75, pageSize: 100 }),
  ]);
  return { ...totals, daily: daily.days, lowAttendance: low.items, threshold: f.threshold ?? 75 };
}

export async function monthlyAnalysis(user: UserDoc, f: RangeFilters & { month?: string; threshold?: number }) {
  const month = f.month ?? (f.from ?? new Date().toISOString()).slice(0, 7);
  const from = f.from ?? monthStart(`${month}-01`);
  const to = f.to ?? monthEnd(`${month}-01`);
  return { month, ...(await weeklyAnalysis(user, { ...f, from, to, threshold: f.threshold })) };
}

/** Batch comparison. Overall percentage is weighted by eligible opportunities, never an average of percentages. */
export async function batchAnalysis(user: UserDoc, f: RangeFilters) {
  if (f.from && f.to) assertRange(f.from, f.to);
  const { ids, batches } = await scope(user, f);
  const match: Record<string, unknown> = { batchId: { $in: ids }, status: 'FINALIZED' };
  if (f.from || f.to) match.attendanceDate = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.sessionType) match.sessionType = f.sessionType;
  const rows = await AttendanceSession.aggregate([
    { $match: match },
    { $group: {
      _id: { batchId: '$batchId', type: '$sessionType' }, eligible: { $sum: '$eligibleCount' }, present: { $sum: '$presentCount' },
      absent: { $sum: '$absentCount' }, sessions: { $sum: 1 },
    } },
  ]);
  const students = new Map((await Enrollment.aggregate([
    { $match: { batchId: { $in: ids }, status: 'ACTIVE' } }, { $group: { _id: '$batchId', n: { $sum: 1 } } },
  ])).map((r) => [String(r._id), r.n]));
  const items = batches.map((batch) => {
    const mine = rows.filter((r) => String(r._id.batchId) === String(batch._id));
    const sum = (type?: string) => mine.filter((r) => !type || r._id.type === type).reduce((a, r) => ({
      eligible: a.eligible + r.eligible, present: a.present + r.present, absent: a.absent + r.absent, sessions: a.sessions + r.sessions,
    }), emptyBucket());
    const all = sum(); const m = sum('MORNING'); const a = sum('AFTERNOON');
    return {
      batchId: String(batch._id), name: batch.name, status: batch.status, students: students.get(String(batch._id)) ?? 0,
      eligible: all.eligible, present: all.present, absent: all.absent, sessions: all.sessions, percentage: percent(all.present, all.eligible),
      morning: { ...m, percentage: percent(m.present, m.eligible) }, afternoon: { ...a, percentage: percent(a.present, a.eligible) },
      hasData: all.sessions > 0,
    };
  });
  const eligible = items.reduce((a, r) => a + r.eligible, 0);
  const present = items.reduce((a, r) => a + r.present, 0);
  return { items, weighted: { eligible, present, absent: Math.max(0, eligible - present), percentage: percent(present, eligible) } };
}

/** College analysis uses stable college ids and historical record snapshots. */
export async function collegeAnalysis(user: UserDoc, f: RangeFilters) {
  if (f.from && f.to) assertRange(f.from, f.to);
  const { ids, batches } = await scope(user, f);
  const match: Record<string, unknown> = { batchId: { $in: ids }, sessionStatus: 'FINALIZED' };
  if (f.from || f.to) match.attendanceDate = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.sessionType) match.sessionType = f.sessionType;
  const rows = await AttendanceRecord.aggregate([
    { $match: match },
    { $group: {
      _id: { collegeId: '$collegeId', batchId: '$batchId' }, collegeName: { $first: '$collegeName' },
      eligible: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
    } },
  ]);
  const collegeIds = rows.map((r) => r._id.collegeId).filter(Boolean);
  const colleges = new Map((await College.find({ _id: { $in: collegeIds } }, 'name code').lean()).map((c) => [String(c._id), c]));
  const batchNames = new Map(batches.map((b) => [String(b._id), b.name]));
  const items = rows.map((r) => {
    const college = r._id.collegeId ? colleges.get(String(r._id.collegeId)) : null;
    return {
      collegeId: r._id.collegeId ? String(r._id.collegeId) : null,
      college: college?.name ?? r.collegeName ?? 'Not specified',
      batchId: String(r._id.batchId), batch: batchNames.get(String(r._id.batchId)) ?? 'Batch',
      eligible: r.eligible, present: r.present, absent: Math.max(0, r.eligible - r.present), percentage: percent(r.present, r.eligible),
    };
  }).sort((a, b) => a.college.localeCompare(b.college) || a.batch.localeCompare(b.batch));
  const eligible = items.reduce((a, r) => a + r.eligible, 0);
  const present = items.reduce((a, r) => a + r.present, 0);
  return { items, weighted: { eligible, present, percentage: percent(present, eligible) } };
}

/** Students below an attendance threshold. Students with no eligible recorded sessions are never flagged. */
export async function lowAttendance(user: UserDoc, f: RangeFilters & { threshold?: number; q?: string; page?: number; pageSize?: number }) {
  const { ids } = await scope(user, f);
  const match: Record<string, unknown> = { batchId: { $in: ids }, sessionStatus: 'FINALIZED' };
  if (f.from || f.to) match.attendanceDate = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.sessionType) match.sessionType = f.sessionType;
  const threshold = Math.min(100, Math.max(0, f.threshold ?? 75));
  const rows = await AttendanceRecord.aggregate([
    { $match: match },
    { $group: {
      _id: { studentId: '$studentId', batchId: '$batchId' }, rollNumber: { $last: '$rollNumber' }, name: { $last: '$studentName' },
      college: { $last: '$collegeName' }, eligible: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
    } },
    { $addFields: { percentage: { $round: [{ $multiply: [{ $divide: ['$present', '$eligible'] }, 100] }, 1] } } },
    { $match: { eligible: { $gt: 0 }, percentage: { $lt: threshold } } },
    { $sort: { percentage: 1, rollNumber: 1 } },
  ]);
  const batches = new Map((await Batch.find({ _id: { $in: ids } }, 'name').lean()).map((b) => [String(b._id), b.name]));
  const q = f.q?.toLowerCase();
  let items = rows.map((r) => ({
    studentId: String(r._id.studentId), batchId: String(r._id.batchId), batch: batches.get(String(r._id.batchId)) ?? 'Batch',
    rollNumber: r.rollNumber, name: r.name ?? 'Student', college: r.college ?? null,
    eligible: r.eligible, present: r.present, absent: Math.max(0, r.eligible - r.present), percentage: r.percentage,
  }));
  if (q) items = items.filter((i) => i.rollNumber.toLowerCase().includes(q) || (i.name ?? '').toLowerCase().includes(q));
  const page = Math.max(1, f.page ?? 1); const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  return { threshold, total: items.length, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

/** Traditional register: one row per student, one column per recorded session. Bounded so a browser never holds years. */
export async function attendanceRegister(user: UserDoc, f: { batchId: string; from: string; to: string; q?: string; status?: 'PRESENT' | 'ABSENT'; page?: number; pageSize?: number }) {
  if (!f.batchId) throw badRequest('Choose a batch.');
  assertRange(f.from, f.to);
  const days = dateRange(f.from, f.to, 93);
  if (days.length >= 93 && addDays(f.from, 92) < f.to) throw badRequest('Choose a register period of at most 92 days.');
  const { ids, batches } = await scope(user, { batchId: f.batchId });
  const batch = batches[0];
  const sessions = await AttendanceSession.find({ batchId: batch._id, status: 'FINALIZED', attendanceDate: { $gte: f.from, $lte: f.to } })
    .sort({ attendanceDate: 1, sessionType: 1 }).select('_id attendanceDate sessionType attendanceTime').lean();
  const records = await AttendanceRecord.find({ sessionId: { $in: sessions.map((s) => s._id) } })
    .select('sessionId studentId rollNumber studentName collegeName status').lean();
  const columns = sessions.map((s) => ({ sessionId: String(s._id), date: s.attendanceDate, sessionType: s.sessionType, time: s.attendanceTime }));
  const cells = new Map<string, Map<string, string>>();
  const students = new Map<string, { studentId: string; rollNumber: string; name: string; college: string | null; present: number; absent: number }>();
  for (const r of records) {
    const key = String(r.studentId);
    const student = students.get(key) ?? { studentId: key, rollNumber: r.rollNumber, name: r.studentName ?? 'Student', college: r.collegeName ?? null, present: 0, absent: 0 };
    student.present += r.status === 'PRESENT' ? 1 : 0;
    student.absent += r.status === 'ABSENT' ? 1 : 0;
    students.set(key, student);
    const row = cells.get(key) ?? new Map<string, string>();
    row.set(String(r.sessionId), r.status);
    cells.set(key, row);
  }
  let rows = [...students.values()].map((s) => ({ ...s, percentage: percent(s.present, s.present + s.absent), cells: cells.get(s.studentId) ?? new Map() }));
  if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter((r) => r.rollNumber.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)); }
  if (f.status) rows = rows.filter((r) => (f.status === 'PRESENT' ? r.present > 0 : r.absent > 0));
  rows.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));
  const page = Math.max(1, f.page ?? 1); const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25));
  return {
    batch: { _id: batch._id, name: batch.name }, from: f.from, to: f.to, columns, total: rows.length, page, pageSize,
    items: rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r, cells: columns.map((c) => r.cells.get(c.sessionId) ?? null) })),
    days: days.length,
  };
}
