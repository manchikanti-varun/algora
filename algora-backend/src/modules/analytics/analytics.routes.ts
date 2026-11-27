import ExcelJS from 'exceljs';
import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse } from '../../lib/errors';
import { toCsv } from '../../lib/csv';
import { objectId, pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { Batch, BatchCourse, College, Course, Enrollment, PendingEnrollment, TrainerBatchAssignment, User } from '../../models';
import { audit } from '../audit/audit';
import { loadBatchFor } from '../access';
import { batchAnalysis } from '../attendance/attendance.analytics';
import { batchAttendanceSummary, studentAttendanceData } from '../attendance/attendance.service';
import { chapterStats, overview, performanceRows, problemDetail, problemStats, scopedBatches, studentChapters, type Filters } from './analytics.service';

export const analyticsRouter = Router();
export const reportsRouter = Router();
for (const r of [analyticsRouter, reportsRouter]) r.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));

const date = z.coerce.date();
export const filterSchema = z.object({
  collegeId: objectId.optional(), batchId: objectId.optional(), courseId: objectId.optional(), chapterId: objectId.optional(), studentId: objectId.optional(),
  slug: z.string().trim().max(120).regex(/^[a-z0-9-]+$/, 'Use a canonical problem slug').optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(), q: z.string().trim().max(60).optional(),
  verification: z.enum(['LINKED', 'UNLINKED', 'VERIFIED', 'PENDING_VERIFICATION', 'REVALIDATION_REQUIRED']).optional(),
  minPct: z.coerce.number().min(0).max(100).optional(), maxPct: z.coerce.number().min(0).max(100).optional(),
  syncFilter: z.enum(['QUEUED', 'DELAYED', 'FAILED', 'GAP', 'ATTENTION']).optional(),
  from: date.optional(), to: date.optional(), dateBasis: z.enum(['verified', 'submitted']).default('verified'),
});
const sortable = ['points', 'solved', 'completionPct', 'name', 'rollNumber', 'lastVerifiedAt', 'lastSyncAt'] as const;

analyticsRouter.get('/overview', async (req, res) => res.json(await overview(req.user!, parse(filterSchema, req.query) as Filters)));

analyticsRouter.get('/students', async (req, res) => {
  const q = parse(filterSchema.merge(pagination).extend({ sort: z.enum(sortable).default('points'), dir: z.enum(['asc', 'desc']).default('desc') }), req.query);
  const { rows } = await performanceRows(req.user!, q as Filters);
  const k = q.sort; const sign = q.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => { const x = (a as any)[k] ?? ''; const y = (b as any)[k] ?? ''; return (x > y ? 1 : x < y ? -1 : 0) * sign || a.rollNumber.localeCompare(b.rollNumber); });
  res.json({ total: rows.length, page: q.page, pageSize: q.pageSize, items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize) });
});

analyticsRouter.get('/chapters', async (req, res) => res.json({ items: await chapterStats(req.user!, parse(filterSchema, req.query) as Filters) }));
analyticsRouter.get('/problems', async (req, res) => res.json({ items: await problemStats(req.user!, parse(filterSchema, req.query) as Filters) }));

analyticsRouter.get('/batches/:id', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id));
  const f = { ...(parse(filterSchema, req.query) as Filters), batchId: String(batch._id) };
  const [college, courses, trainers, pending, attendance, o] = await Promise.all([
    batch.collegeId ? College.findById(batch.collegeId, 'name code').lean() : null,
    BatchCourse.find({ batchId: batch._id, status: 'ACTIVE' }, 'courseId status').populate('courseId', 'title status').lean(),
    TrainerBatchAssignment.find({ batchId: batch._id, status: 'ACTIVE' }, 'trainerId').populate('trainerId', 'fullName trainerId').lean(),
    PendingEnrollment.countDocuments({ batchId: batch._id, status: 'PENDING' }),
    batchAttendanceSummary(req.user!, String(batch._id)),
    overview(req.user!, f, { withRows: true }),
  ]);
  res.json({
    batch: {
      _id: batch._id, name: batch.name, status: batch.status, startDate: batch.startDate, endDate: batch.endDate,
      collegeId: batch.collegeId ?? null, college: college ? [college.name, college.code ? `[${college.code}]` : ''].filter(Boolean).join(' ') : null, colleges: college ? [college.name] : [],
      courses: courses.map((c) => ({ _id: c.courseId?._id ?? c.courseId, title: (c.courseId as any)?.title ?? 'Course', status: c.status })),
      trainers: trainers.map((t) => t.trainerId).filter(Boolean), pendingEnrollments: pending,
    },
    ...o, chapters: await chapterStats(req.user!, f), attendance,
  });
});

analyticsRouter.get('/courses/:id', async (req, res) => {
  const courseId = parse(objectId, req.params.id);
  const course = await Course.findById(courseId, 'title status').lean();
  if (!course) throw notFound('Course not found');
  const scoped = await scopedBatches(req.user!, {});
  const contexts = await BatchCourse.find({ batchId: { $in: scoped.map((b) => b._id) }, courseId, status: 'ACTIVE' }, 'batchId').lean();
  // A Trainer may only analyse courses actually taught in one of their batches.
  if (req.user!.role !== 'SUPER_ADMIN' && !contexts.length) throw notFound('Course not found');
  const f = { ...(parse(filterSchema, req.query) as Filters), courseId };
  const o = await overview(req.user!, f, { withRows: true });
  const detailRows = o.rows ?? [];
  const batches = scoped.filter((b) => contexts.some((c) => String(c.batchId) === String(b._id)));
  const uniqueStudents = new Set(detailRows.map((r) => r.studentId)).size;
  const byBatch = [...new Map(detailRows.map((r) => [r.batchId, { batchId: r.batchId, batch: r.batch }])).values()].map((b) => {
    const rows = detailRows.filter((r) => r.batchId === b.batchId);
    const work = rows.filter((r) => r.accessible > 0);
    return { ...b, students: rows.length, avgCompletionPct: work.length ? Math.round((work.reduce((a, r) => a + (r.completionPct ?? 0), 0) / work.length) * 10) / 10 : null, verified: rows.reduce((a, r) => a + r.solved, 0) };
  });
  res.json({
    course, ...o, chapters: await chapterStats(req.user!, f),
    uniqueStudents, contexts: detailRows.length,
    batches: batches.map((b) => { const extra = byBatch.find((x) => x.batchId === String(b._id)); return { _id: b._id, name: b.name, status: b.status, students: extra?.students ?? 0, avgCompletionPct: extra?.avgCompletionPct ?? null }; }),
    batchComparison: byBatch,
  });
});

/** College detail. Trainer scope is applied before the college filter, so one batch never reveals the whole college. */
analyticsRouter.get('/colleges/:id', async (req, res) => {
  const collegeId = parse(objectId, req.params.id);
  const college = await College.findById(collegeId, 'name code status').lean();
  if (!college) throw notFound('College not found');
  const f = { ...(parse(filterSchema, req.query) as Filters), collegeId };
  const [o, attendance] = await Promise.all([
    overview(req.user!, f, { withRows: true }),
    batchAnalysis(req.user!, { collegeId }),
  ]);
  res.json({ college, ...o, attendance });
});

/** Chapter detail behind the summary: eligible students, per-problem stats and student rows for that chapter. */
analyticsRouter.get('/chapter', async (req, res) => {
  const q = parse(filterSchema.extend({ courseId: objectId, chapterId: objectId }), req.query);
  const course = await Course.findById(q.courseId, 'title status').lean();
  if (!course) throw notFound('Course not found');
  const scoped = await scopedBatches(req.user!, q as Filters);
  const context = await BatchCourse.exists({ batchId: { $in: scoped.map((b) => b._id) }, courseId: q.courseId, status: 'ACTIVE' });
  if (!context) throw notFound('Course not found');
  const [o, chapters, problems] = await Promise.all([
    overview(req.user!, q as Filters, { withRows: true }),
    chapterStats(req.user!, q as Filters),
    problemStats(req.user!, q as Filters),
  ]);
  const summary = chapters.filter((c) => c.chapterId === q.chapterId);
  if (!summary.length) throw notFound('Chapter not found');
  res.json({
    course, chapter: { _id: q.chapterId, title: summary[0].chapter }, summary: summary[0], totals: o.totals, difficulty: o.difficulty,
    problems: problems.filter((p) => p.chapter === summary[0].chapter), items: o.rows,
  });
});

/** One problem with per-student verified / not-yet-verified records. */
analyticsRouter.get('/problem', async (req, res) => {
  const q = parse(filterSchema.extend({ slug: z.string().trim().max(120).regex(/^[a-z0-9-]+$/, 'Use a canonical problem slug') }), req.query);
  const detail = await problemDetail(req.user!, q as Filters, q.slug);
  if (!detail.problem) throw notFound('Problem not found');
  res.json(detail);
});

/** Individual student progress. Trainers only for students enrolled in one of their batches (404 otherwise, no IDOR). */
analyticsRouter.get('/students/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  // No email or mobile number: management analytics never needs contact data.
  const student = await User.findOne({ _id: id, role: 'STUDENT' }, 'fullName rollNumber collegeId status sync createdAt').populate('collegeId', 'name').lean();
  if (!student) throw notFound('Student not found');
  const batches = await scopedBatches(req.user!, {});
  const enrolledIn = await Enrollment.find({ studentId: id, batchId: { $in: batches.map((b) => b._id) } }).lean();
  if (!enrolledIn.length && req.user!.role !== 'SUPER_ADMIN') throw notFound('Student not found');
  const filters = parse(filterSchema, req.query) as Filters;
  const { rows } = await performanceRows(req.user!, filters);
  const { linkView } = await import('../leetcode/links.service.js');
  const { verifiedHistory } = await import('../progress/dashboard.js');
  const [chapters, attendance, link, history] = await Promise.all([
    studentChapters(req.user!, id, filters), studentAttendanceData(id, {}), linkView(id), verifiedHistory(student._id as any),
  ]);
  res.json({
    student: { ...student, college: (student.collegeId as any)?.name, collegeId: undefined },
    enrollments: enrolledIn.map((e) => ({ batchId: e.batchId, batch: batches.find((b) => String(b._id) === String(e.batchId))?.name, status: e.status, enrolledAt: e.enrolledAt })),
    contexts: rows.filter((r) => r.studentId === id), chapters, attendance: attendance.summary, attendanceHistory: attendance.history.slice(0, 10),
    link, history,
  });
});

// ---------- CSV / XLSX reports ----------
const reportSchema = filterSchema.extend({ type: z.enum(['student', 'batch', 'course', 'chapter', 'problem']), format: z.enum(['csv', 'xlsx']).default('csv') });

reportsRouter.get('/export', async (req, res) => {
  const f = parse(reportSchema, req.query);
  const u = req.user!;
  let header: string[] = []; let data: unknown[][] = [];
  if (f.type === 'student') {
    const { rows } = await performanceRows(u, f as Filters);
    header = ['Roll number', 'Name', 'College', 'Batch', 'Course', 'Easy', 'Medium', 'Hard', 'Verified solved', 'Accessible', 'Completion %', 'Points', 'Rank', 'Last verified', 'LeetCode link', 'Sync status'];
    data = rows.map((r) => [r.rollNumber, r.name, r.college, r.batch, r.course, r.easy, r.medium, r.hard, r.solved, r.accessible, r.completionPct, r.points, r.rank, r.lastVerifiedAt?.toISOString(), r.linkState, r.syncStatus]);
  } else if (f.type === 'batch') {
    const o = await overview(u, f as Filters);
    const batches = await scopedBatches(u, f as Filters);
    const pend = await PendingEnrollment.aggregate([{ $match: { batchId: { $in: batches.map((b) => b._id) }, status: 'PENDING' } }, { $group: { _id: '$batchId', n: { $sum: 1 } } }]);
    const courses = await BatchCourse.aggregate([{ $match: { batchId: { $in: batches.map((b) => b._id) }, status: 'ACTIVE' } }, { $group: { _id: '$batchId', n: { $sum: 1 } } }]);
    header = ['Batch', 'Status', 'Start', 'End', 'Students', 'Pending enrollments', 'Active courses', 'Avg completion %', 'Verified completions'];
    data = o.batchComparison.map((b) => { const bt = batches.find((x) => String(x._id) === b.batchId)!; return [b.name, b.status, bt.startDate?.toISOString().slice(0, 10), bt.endDate?.toISOString().slice(0, 10), b.students, pend.find((p) => String(p._id) === b.batchId)?.n ?? 0, courses.find((p) => String(p._id) === b.batchId)?.n ?? 0, b.avgCompletionPct, b.verifiedCompletions]; });
  } else if (f.type === 'course') {
    const o = await overview(u, f as Filters);
    header = ['Course', 'Student-course rows', 'Avg completion %', 'Completed all available'];
    data = o.courseCompletion.map((c) => [c.title, c.rows, c.avgCompletionPct, c.completed]);
  } else if (f.type === 'chapter') {
    header = ['Batch', 'Course', 'Chapter', 'Problems', 'Students', 'Completed chapter', 'Avg completion %'];
    data = (await chapterStats(u, f as Filters)).map((c) => [c.batch, c.course, c.chapter, c.problems, c.students, c.completedStudents, c.avgCompletionPct]);
  } else {
    header = ['Batch', 'Course', 'Chapter', 'Problem', 'Slug', 'Difficulty', 'Students', 'Verified solved', 'Solved %'];
    data = (await problemStats(u, f as Filters)).map((p) => [p.batch, p.course, p.chapter, p.problem, p.slug, p.difficulty, p.students, p.verifiedSolved, p.solvedPct]);
  }
  await audit(req, 'report.export', { type: 'Report', id: f.type }, { filters: { ...f, type: undefined, format: undefined }, rows: data.length });
  const suffix = f.studentId && f.type === 'student' ? `-${data[0]?.[0] ?? 'student'}` : '';
  const base = `algora-${f.type}${suffix}-report-${new Date().toISOString().slice(0, 10)}`.replace(/[^A-Za-z0-9._-]+/g, '-');
  res.setHeader('cache-control', 'no-store');
  if (f.format === 'xlsx') {
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', `attachment; filename="${base}.xlsx"`);
    res.send(await toXlsx(header, data, f.type));
    return;
  }
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${base}.csv"`);
  res.send(toCsv(header, data));
});

/** XLSX mirrors the CSV exactly, including formula-injection escaping. */
export async function toXlsx(header: string[], data: unknown[][], name: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(name.slice(0, 30));
  sheet.addRow(header.map((h) => String(h)));
  sheet.getRow(1).font = { bold: true };
  for (const row of data) {
    sheet.addRow(row.map((cell) => {
      if (typeof cell === 'string' && /^[=+\-@]/.test(cell)) return `'${cell}`;
      return cell ?? '';
    }));
  }
  sheet.columns.forEach((column) => { column.width = 20; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export { Batch };
