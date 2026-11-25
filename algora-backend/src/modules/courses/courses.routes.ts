import { Router } from 'express';
import { z } from 'zod';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors';
import { parseLeetCodeUrl } from '../../lib/leetcodeUrl';
import { objectId, pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { BatchCourse, Chapter, Course, Problem } from '../../models';
import { audit } from '../audit/audit';
import { canManageCourses } from '../access';

export const coursesRouter = Router();
export const chaptersRouter = Router();
export const problemsRouter = Router();
for (const r of [coursesRouter, chaptersRouter, problemsRouter]) r.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));

const mustManage: import('express').RequestHandler = (req, _res, next) =>
  canManageCourses(req.user!) ? next() : next(forbidden('Course management permission required'));

const title = z.string().trim().min(1).max(150);
const description = z.string().trim().max(5000);
const courseStatus = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

// ---------- Courses ----------
coursesRouter.post('/', mustManage, async (req, res) => {
  const b = parse(z.object({ title, description: description.default('') }), req.body);
  const c = await Course.create({ ...b, createdBy: req.user!._id });
  await audit(req, 'course.create', { type: 'Course', id: c._id });
  res.status(201).json(c);
});

coursesRouter.get('/', async (req, res) => {
  const q = parse(pagination.extend({ status: courseStatus.optional(), q: z.string().trim().max(60).optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  // Trainers without course permission can only see published courses (needed to assign them to batches).
  if (!canManageCourses(req.user!)) filter.status = 'PUBLISHED';
  if (q.q) filter.title = { $regex: q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const [items, total] = await Promise.all([
    Course.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    Course.countDocuments(filter),
  ]);
  const ids = items.map((c) => c._id);
  const [ch, pr, bc] = await Promise.all([
    Chapter.aggregate([{ $match: { courseId: { $in: ids }, status: 'ACTIVE' } }, { $group: { _id: '$courseId', n: { $sum: 1 } } }]),
    Problem.aggregate([{ $match: { courseId: { $in: ids }, status: 'ACTIVE' } }, { $group: { _id: '$courseId', n: { $sum: 1 } } }]),
    BatchCourse.aggregate([{ $match: { courseId: { $in: ids }, status: 'ACTIVE' } }, { $group: { _id: '$courseId', n: { $sum: 1 } } }]),
  ]);
  const n = (arr: any[], id: unknown) => arr.find((x) => String(x._id) === String(id))?.n ?? 0;
  res.json({ items: items.map((c) => ({ ...c, chapterCount: n(ch, c._id), problemCount: n(pr, c._id), batchCount: n(bc, c._id) })), total, page: q.page, pageSize: q.pageSize });
});

coursesRouter.get('/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const course = await Course.findById(id).lean();
  if (!course || (!canManageCourses(req.user!) && course.status !== 'PUBLISHED')) throw notFound('Course not found');
  const all = canManageCourses(req.user!) && req.query.includeArchived === '1';
  const st = all ? {} : { status: 'ACTIVE' as const };
  const chapters = await Chapter.find({ courseId: id, ...st }).sort({ status: 1, order: 1 }).lean();
  const problems = await Problem.find({ courseId: id, ...st }).sort({ status: 1, order: 1 }).lean();
  res.json({
    ...course,
    chapters: chapters.map((c) => ({ ...c, problems: problems.filter((p) => String(p.chapterId) === String(c._id)) })),
  });
});

coursesRouter.patch('/:id', mustManage, async (req, res) => {
  const id = parse(objectId, req.params.id);
  const b = parse(z.object({ title: title.optional(), description: description.optional(), status: courseStatus.optional() }).strict(), req.body);
  const c = await Course.findByIdAndUpdate(id, { $set: b }, { returnDocument: 'after' });
  if (!c) throw notFound('Course not found');
  await audit(req, 'course.update', { type: 'Course', id: c._id }, b);
  res.json(c);
});

coursesRouter.post('/:id/chapters', mustManage, async (req, res) => {
  const id = parse(objectId, req.params.id);
  const b = parse(z.object({ title, description: description.default('') }), req.body);
  const course = await Course.findById(id);
  if (!course) throw notFound('Course not found');
  if (course.status === 'ARCHIVED') throw forbidden('Course is archived', 'COURSE_ARCHIVED');
  const last = await Chapter.findOne({ courseId: id }).sort({ order: -1 }).lean();
  // No access rows are created: a chapter without a batch_chapter_access record is hidden everywhere.
  const ch = await Chapter.create({ ...b, courseId: id, order: (last?.order ?? -1) + 1 });
  await audit(req, 'chapter.create', { type: 'Chapter', id: ch._id });
  res.status(201).json(ch);
});

// ---------- Chapters ----------
async function reorder(model: typeof Chapter | typeof Problem, filter: object, movedId: string, position: number) {
  const items = await (model as any).find({ ...filter, status: 'ACTIVE' }).sort({ order: 1, _id: 1 }).select('_id').lean();
  const ids: string[] = items.map((i: any) => String(i._id));
  const from = ids.indexOf(movedId);
  if (from < 0) throw notFound();
  ids.splice(from, 1);
  ids.splice(Math.min(position, ids.length), 0, movedId);
  await (model as any).bulkWrite(ids.map((id, order) => ({ updateOne: { filter: { _id: id }, update: { $set: { order } } } })));
}

chaptersRouter.patch('/:id', mustManage, async (req, res) => {
  const id = parse(objectId, req.params.id);
  const b = parse(z.object({ title: title.optional(), description: description.optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).strict(), req.body);
  const ch = await Chapter.findByIdAndUpdate(id, { $set: b }, { returnDocument: 'after' });
  if (!ch) throw notFound('Chapter not found');
  await audit(req, 'chapter.update', { type: 'Chapter', id: ch._id }, b);
  res.json(ch);
});

/** Body `{position}` moves the chapter within its course; `{problemIds}` sets the order of the chapter's problems. */
chaptersRouter.patch('/:id/reorder', mustManage, async (req, res) => {
  const id = parse(objectId, req.params.id);
  const b = parse(z.union([z.object({ position: z.number().int().min(0) }).strict(), z.object({ problemIds: z.array(objectId).min(1).max(500) }).strict()]), req.body);
  const ch = await Chapter.findById(id);
  if (!ch) throw notFound('Chapter not found');
  if ('position' in b) await reorder(Chapter, { courseId: ch.courseId }, id, b.position);
  else {
    const current = await Problem.find({ chapterId: id, status: 'ACTIVE' }, '_id').lean();
    const have = new Set(current.map((p) => String(p._id)));
    if (b.problemIds.length !== have.size || new Set(b.problemIds).size !== have.size || !b.problemIds.every((p) => have.has(p))) {
      throw badRequest('problemIds must list every active problem in the chapter exactly once');
    }
    await Problem.bulkWrite(b.problemIds.map((pid, order) => ({ updateOne: { filter: { _id: pid }, update: { $set: { order } } } })));
  }
  await audit(req, 'chapter.reorder', { type: 'Chapter', id });
  res.json({ ok: true });
});

const problemInput = z.object({
  title,
  url: z.string().trim().max(300),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
});

chaptersRouter.post('/:id/problems', mustManage, async (req, res) => {
  const id = parse(objectId, req.params.id);
  const b = parse(problemInput, req.body);
  const { slug, url } = parseLeetCodeUrl(b.url);
  const ch = await Chapter.findById(id);
  if (!ch || ch.status !== 'ACTIVE') throw notFound('Chapter not found');
  const last = await Problem.findOne({ chapterId: id }).sort({ order: -1 }).lean();
  // Duplicate in same chapter -> unique index -> 409. Same slug in another chapter is allowed on purpose.
  const p = await Problem.create({ chapterId: id, courseId: ch.courseId, title: b.title, difficulty: b.difficulty, url, slug, order: (last?.order ?? -1) + 1 });
  await audit(req, 'problem.create', { type: 'Problem', id: p._id }, { slug });
  res.status(201).json(p);
});

problemsRouter.patch('/:id', mustManage, async (req, res) => {
  const id = parse(objectId, req.params.id);
  const b = parse(
    z.object({ title: title.optional(), url: z.string().trim().max(300).optional(), difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).strict(),
    req.body,
  );
  const set: Record<string, unknown> = { ...b };
  if (b.url) { const { slug, url } = parseLeetCodeUrl(b.url); set.slug = slug; set.url = url; }
  const p = await Problem.findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after' });
  if (!p) throw notFound('Problem not found');
  await audit(req, 'problem.update', { type: 'Problem', id: p._id }, b);
  res.json(p);
});
