import { Router } from 'express';
import { z } from 'zod';
import { forbidden, parse } from '../../lib/errors';
import { objectId, pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { AttendanceSession } from '../../models';
import { audit } from '../audit/audit';
import { loadBatchFor } from '../access';
import {
  attendanceRegister, batchAnalysis, collegeAnalysis, dailyAnalysis, lowAttendance, monthlyAnalysis, weeklyAnalysis,
} from './attendance.analytics';
import { buildAttendanceExport, renderCsv, renderXlsx, SAMPLE_ATTENDANCE_CSV, type ExportType } from './attendance.export';
import {
  assertAttendanceDate, attendanceOverview, batchAttendanceSummary, cancelAttendanceSession, classifyCsv, correctAttendance,
  createAttendanceSession, finalizeAttendanceSession, getSessionDetail, importSessionScans, listSessions, reconcileAttendance,
  assertCanReadStudent, studentAttendanceData, updateDraftSession,
} from './attendance.service';
import { DEFAULT_TIMEZONE } from './attendance.time';

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));

const sessionType = z.enum(['MORNING', 'AFTERNOON']);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const columnMap = z.object({
  rollColumn: z.number().int().min(0).max(100).nullable().optional(),
  timestampColumn: z.number().int().min(0).max(100).nullable().optional(),
}).strict();
const filterFields = {
  batchId: objectId.optional(), collegeId: objectId.optional(), from: dateStr.optional(), to: dateStr.optional(), sessionType: sessionType.optional(),
};
const superOnly: import('express').RequestHandler = (req, _res, next) => (req.user!.role === 'SUPER_ADMIN' ? next() : next(forbidden()));

// ---------------------------------------------------------------- overview & sessions
attendanceRouter.get('/overview', async (req, res) => {
  res.json(await attendanceOverview(req.user!, parse(z.object(filterFields).partial(), req.query)));
});

attendanceRouter.get('/sessions', async (req, res) => {
  const q = parse(pagination.extend({
    ...filterFields, status: z.enum(['DRAFT', 'FINALIZED', 'CANCELLED']).optional(), q: z.string().trim().max(60).optional(),
    sort: z.enum(['date', 'eligible', 'present', 'absent']).optional(), dir: z.enum(['asc', 'desc']).optional(),
  }), req.query);
  res.json(await listSessions(req.user!, q));
});

/** Stateless validation + preview. Nothing is written and no attendance is finalized. */
attendanceRouter.post('/preview', async (req, res) => {
  const b = parse(z.object({
    batchId: objectId, attendanceDate: dateStr, sessionType: sessionType.default('MORNING'), attendanceTime: timeStr.optional(),
    timezone: z.string().trim().max(60).optional(), csv: z.string().min(1).max(2_500_000), columnMap: columnMap.optional(),
  }).strict(), req.body);
  const batch = await loadBatchFor(req.user!, b.batchId);
  assertAttendanceDate(b.attendanceDate, b.timezone || DEFAULT_TIMEZONE);
  const classification = await classifyCsv({
    batchId: b.batchId, attendanceDate: b.attendanceDate, csv: b.csv, timezone: b.timezone, columnMap: b.columnMap,
  });
  const existing = await AttendanceSession.findOne({ batchId: batch._id, attendanceDate: b.attendanceDate, sessionType: b.sessionType, isActive: true }, '_id status').lean();
  res.json({
    batch: { _id: batch._id, name: batch.name }, attendanceDate: b.attendanceDate, sessionType: b.sessionType,
    attendanceTime: b.attendanceTime ?? null, rosterCount: classification.roster.length, pendingCount: classification.pendingCount,
    present: classification.present, absent: classification.absent, rows: classification.rows, counts: classification.counts,
    uploadSummary: classification.uploadSummary,
    columns: { header: classification.columns.header, columns: classification.columns.columns },
    existingSession: existing ? { _id: existing._id, status: existing.status } : null,
  });
});

attendanceRouter.post('/sessions', async (req, res) => {
  const b = parse(z.object({
    batchId: objectId, attendanceDate: dateStr, sessionType, attendanceTime: timeStr, timezone: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(1000).optional(), csv: z.string().max(2_500_000).optional(), columnMap: columnMap.optional(),
    finalize: z.boolean().default(false),
  }).strict(), req.body);
  const detail = await createAttendanceSession(req, req.user!, b);
  res.status(201).json(detail);
});

attendanceRouter.get('/sessions/:id', async (req, res) => {
  res.json(await getSessionDetail(req.user!, parse(objectId, req.params.id)));
});

attendanceRouter.patch('/sessions/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const b = parse(z.object({
    attendanceTime: timeStr.optional(), notes: z.string().trim().max(1000).optional(), csv: z.string().max(2_500_000).optional(), columnMap: columnMap.optional(),
  }).strict(), req.body);
  res.json(await updateDraftSession(req, req.user!, id, b));
});

attendanceRouter.post('/sessions/:id/finalize', async (req, res) => {
  res.json(await finalizeAttendanceSession(req, req.user!, parse(objectId, req.params.id)));
});

/** Add scanned roll numbers, or replace the whole roster from a corrected CSV. */
attendanceRouter.post('/sessions/:id/import', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const b = parse(z.object({
    csv: z.string().min(1).max(2_500_000), mode: z.enum(['ADD', 'REPLACE']).default('ADD'),
    reason: z.string().trim().max(500).optional(), columnMap: columnMap.optional(),
  }).strict(), req.body);
  res.json(await importSessionScans(req, req.user!, id, b));
});

attendanceRouter.patch('/sessions/:id/records', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const b = parse(z.object({
    corrections: z.array(z.object({
      studentId: objectId, status: z.enum(['PRESENT', 'ABSENT']), scanAt: z.string().datetime().nullable().optional(),
    })).min(1).max(500),
    reason: z.string().trim().min(3).max(500),
  }).strict(), req.body);
  res.json(await correctAttendance(req, req.user!, id, b));
});

attendanceRouter.post('/sessions/:id/cancel', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }).strict(), req.body);
  res.json(await cancelAttendanceSession(req, req.user!, id, reason));
});

attendanceRouter.post('/reconcile', superOnly, async (req, res) => {
  const result = await reconcileAttendance();
  await audit(req, 'attendance.reconcile', { type: 'AttendanceSession', id: 'all' }, { checked: result.checked, repaired: result.repaired });
  res.json(result);
});

// ---------------------------------------------------------------- individual students
attendanceRouter.get('/students/:studentId', async (req, res) => {
  const studentId = parse(objectId, req.params.studentId);
  await assertCanReadStudent(req.user!, studentId);
  const f = parse(z.object({
    batchId: objectId.optional(), from: dateStr.optional(), to: dateStr.optional(), sessionType: sessionType.optional(),
    status: z.enum(['PRESENT', 'ABSENT']).optional(),
  }).partial(), req.query);
  res.json(await studentAttendanceData(studentId, f));
});

// ---------------------------------------------------------------- analytics
attendanceRouter.get('/analytics/daily', async (req, res) => {
  const q = parse(z.object({ ...filterFields, from: dateStr, to: dateStr }).strict(), req.query);
  res.json(await dailyAnalysis(req.user!, q));
});

attendanceRouter.get('/analytics/weekly', async (req, res) => {
  const q = parse(z.object({
    ...filterFields, anchor: dateStr.optional(), threshold: z.coerce.number().min(0).max(100).optional(),
  }).strict(), req.query);
  res.json(await weeklyAnalysis(req.user!, q));
});

attendanceRouter.get('/analytics/monthly', async (req, res) => {
  const q = parse(z.object({
    ...filterFields, month: z.string().regex(/^\d{4}-\d{2}$/).optional(), threshold: z.coerce.number().min(0).max(100).optional(),
  }).strict(), req.query);
  res.json(await monthlyAnalysis(req.user!, q));
});

attendanceRouter.get('/analytics/batches', async (req, res) => {
  res.json(await batchAnalysis(req.user!, parse(z.object(filterFields).partial(), req.query)));
});

attendanceRouter.get('/analytics/colleges', async (req, res) => {
  res.json(await collegeAnalysis(req.user!, parse(z.object(filterFields).partial(), req.query)));
});

attendanceRouter.get('/analytics/low', async (req, res) => {
  const q = parse(z.object({
    ...filterFields, threshold: z.coerce.number().min(0).max(100).optional(), q: z.string().trim().max(60).optional(),
  }).merge(pagination).partial(), req.query);
  res.json(await lowAttendance(req.user!, q));
});

// ---------------------------------------------------------------- register, exports, template
attendanceRouter.get('/register', async (req, res) => {
  const q = parse(z.object({
    batchId: objectId, from: dateStr, to: dateStr, q: z.string().trim().max(60).optional(),
    status: z.enum(['PRESENT', 'ABSENT']).optional(),
  }).merge(pagination), req.query);
  res.json(await attendanceRegister(req.user!, q));
});

attendanceRouter.get('/batch/:batchId/summary', async (req, res) => {
  res.json(await batchAttendanceSummary(req.user!, parse(objectId, req.params.batchId)));
});

attendanceRouter.get('/template', (_req, res) => {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="algora-attendance-template.csv"');
  res.setHeader('cache-control', 'no-store');
  res.send(SAMPLE_ATTENDANCE_CSV);
});

const exportTypes = ['session', 'student', 'batch', 'college', 'register', 'low', 'daily', 'weekly', 'monthly'] as const;

attendanceRouter.get('/export', async (req, res) => {
  const q = parse(z.object({
    type: z.enum(exportTypes), format: z.enum(['csv', 'xlsx']).default('csv'),
    batchId: objectId.optional(), studentId: objectId.optional(), sessionId: objectId.optional(), collegeId: objectId.optional(),
    from: dateStr.optional(), to: dateStr.optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    sessionType: sessionType.optional(), threshold: z.coerce.number().min(0).max(100).optional(), q: z.string().trim().max(60).optional(),
  }).strict(), req.query);
  const built = await buildAttendanceExport(req.user!, { ...q, type: q.type as ExportType });
  // Batch names can contain quotes or slashes; keep the download header safe.
  const base = built.filename.replace(/\.xlsx$/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  await audit(req, 'attendance.report.export', { type: 'AttendanceReport', id: q.type }, { format: q.format, filters: { ...q, type: undefined, format: undefined } });
  res.setHeader('cache-control', 'no-store');
  if (q.format === 'xlsx') {
    const buf = await renderXlsx(built);
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', `attachment; filename="${base}.xlsx"`);
    res.send(buf);
    return;
  }
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${base}.csv"`);
  res.send(renderCsv(built));
});
