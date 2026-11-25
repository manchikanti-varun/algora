import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse } from '../../lib/errors';
import { toCsv } from '../../lib/csv';
import { objectId, pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { Batch, BatchCourse, Course, Enrollment, PendingEnrollment, User } from '../../models';
import { audit } from '../audit/audit';
import { loadBatchFor } from '../access';
import { chapterStats, overview, performanceRows, problemStats, scopedBatches, type Filters } from './analytics.service';

export const analyticsRouter = Router();
export const reportsRouter = Router();
for (const r of [analyticsRouter, reportsRouter]) r.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));

const date = z.coerce.date();
export const filterSchema = z.object({
  collegeId: objectId.optional(), batchId: objectId.optional(), courseId: objectId.optional(), chapterId: objectId.optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(), q: z.string().trim().max(60).optional(),
  verification: z.enum(['LINKED', 'UNLINKED', 'VERIFIED', 'PENDING_VERIFICATION', 'REVALIDATION_REQUIRED']).optional(),
  minPct: z.coerce.number().min(0).max(100).optional(), maxPct: z.coerce.number().min(0).max(100).optional(),
  from: date.optional(), to: date.optional(), dateBasis: z.enum(['verified', 'submitted']).default('verified'),
});
const sortable = ['points', 'solved', 'completionPct', 'name', 'rollNumber', 'lastVerifiedAt'] as const;

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
  res.json({ batch: { _id: batch._id, name: batch.name, status: batch.status }, ...(await overview(req.user!, f)), chapters: await chapterStats(req.user!, f) });
});

analyticsRouter.get('/courses/:id', async (req, res) => {
  const courseId = parse(objectId, req.params.id);
  const course = await Course.findById(courseId, 'title status').lean();
  if (!course) throw notFound('Course not found');
  const f = { ...(parse(filterSchema, req.query) as Filters), courseId };
  res.json({ course, ...(await overview(req.user!, f)), chapters: await chapterStats(req.user!, f) });
});

/** Individual student progress. Trainers only for students enrolled in one of their batches (404 otherwise, no IDOR). */
analyticsRouter.get('/students/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const student = await User.findOne({ _id: id, role: 'STUDENT' }, 'fullName rollNumber email collegeId status sync createdAt').populate('collegeId', 'name').lean();
  if (!student) throw notFound('Student not found');
  const batches = await scopedBatches(req.user!, {});
  const enrolledIn = await Enrollment.find({ studentId: id, batchId: { $in: batches.map((b) => b._id) } }).lean();
  if (!enrolledIn.length && req.user!.role !== 'SUPER_ADMIN') throw notFound('Student not found');
  const { rows } = await performanceRows(req.user!, parse(filterSchema, req.query) as Filters);
  const { linkView } = await import('../leetcode/links.service.js');
  const { verifiedHistory } = await import('../progress/dashboard.js');
  res.json({
    student: { ...student, college: (student.collegeId as any)?.name, collegeId: undefined },
    enrollments: enrolledIn.map((e) => ({ batchId: e.batchId, batch: batches.find((b) => String(b._id) === String(e.batchId))?.name, status: e.status, enrolledAt: e.enrolledAt })),
    contexts: rows.filter((r) => r.studentId === id), link: await linkView(id), history: await verifiedHistory(student._id as any),
  });
});

// ---------- CSV reports ----------
const reportSchema = filterSchema.extend({ type: z.enum(['student', 'batch', 'course', 'chapter', 'problem']) });

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
  await audit(req, 'report.export', { type: 'Report', id: f.type }, { filters: { ...f, type: undefined }, rows: data.length });
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="algora-${f.type}-report-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('cache-control', 'no-store');
  res.send(toCsv(header, data));
});

export { Batch };
