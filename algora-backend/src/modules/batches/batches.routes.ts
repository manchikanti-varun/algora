import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { activeCollege, collegeLabel } from '../colleges/registry';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors';
import { parseCsv } from '../../lib/csv';
import { normalizeRoll } from '../../lib/normalize';
import { objectId, pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import {
  Batch, BatchChapterAccess, BatchCourse, CatalogProblem, Chapter, Course, Enrollment, PendingEnrollment, Problem, TrainerBatchAssignment, User,
} from '../../models';
import { AiBatch, AiHint } from '../../models/ai';
import { batchAiAvailable } from '../ai/context';
import { configuredProvider, settings } from '../ai/runtime';
import { audit } from '../audit/audit';
import { loadBatchFor, trainerBatchIds } from '../access';
import { enrollByRoll } from './enrollment.service';

export const batchesRouter = Router();
batchesRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));

const rollSchema = z.string().trim().regex(/^[A-Za-z0-9]{10}$/, 'Roll number must be exactly 10 letters/digits').transform(normalizeRoll);
const batchFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  collegeId: objectId,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED']),
};
const dateOrder = (v: { startDate?: Date; endDate?: Date }) => !v.startDate || !v.endDate || v.endDate >= v.startDate;
/** Optional per-batch synchronization calendar; unset parts fall back to the server defaults. */
const scheduleSchema = z.object({
  hours: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).optional(),
  days: z.string().regex(/^[0-6](,[0-6])*$/).optional(),
  tzOffsetMin: z.number().int().min(-720).max(840).optional(),
  termStart: z.coerce.date().optional(),
  termEnd: z.coerce.date().optional(),
}).strict();

// ---------- Batches (independent of courses) ----------
batchesRouter.post('/', async (req, res) => {
  const b = parse(
    z.object({ name: batchFields.name, description: batchFields.description.default(''), collegeId: batchFields.collegeId.optional(), startDate: batchFields.startDate.optional(), endDate: batchFields.endDate.optional(), status: batchFields.status.default('DRAFT'), leetcodeSchedule: scheduleSchema.optional() })
      .strict().refine(dateOrder, 'endDate must not be before startDate'),
    req.body,
  );
  const { collegeId, ...rest } = b;
  const batch = await Batch.create({ ...rest, collegeId: collegeId ? (await activeCollege(collegeId))._id : undefined, createdBy: req.user!._id });
  if (req.user!.role === 'TRAINER') {
    await TrainerBatchAssignment.create({ trainerId: req.user!._id, batchId: batch._id, assignedBy: req.user!._id });
  }
  await audit(req, 'batch.create', { type: 'Batch', id: batch._id });
  res.status(201).json(batch);
});

batchesRouter.get('/', async (req, res) => {
  const q = parse(pagination.extend({ status: batchFields.status.optional(), q: z.string().trim().max(60).optional() }), req.query);
  const filter: Record<string, unknown> = q.status ? { status: q.status } : {};
  if (req.user!.role === 'TRAINER') filter._id = { $in: await trainerBatchIds(req.user!) };
  if (q.q) filter.name = { $regex: q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const [items, total] = await Promise.all([
    Batch.find(filter).populate('collegeId', 'name code').sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    Batch.countDocuments(filter),
  ]);
  const ids = items.map((b) => b._id);
  const [st, co, pe] = await Promise.all([
    Enrollment.aggregate([{ $match: { batchId: { $in: ids }, status: 'ACTIVE' } }, { $group: { _id: '$batchId', n: { $sum: 1 } } }]),
    BatchCourse.aggregate([{ $match: { batchId: { $in: ids }, status: 'ACTIVE' } }, { $group: { _id: '$batchId', n: { $sum: 1 } } }]),
    PendingEnrollment.aggregate([{ $match: { batchId: { $in: ids }, status: 'PENDING' } }, { $group: { _id: '$batchId', n: { $sum: 1 } } }]),
  ]);
  const n = (arr: any[], id: unknown) => arr.find((x) => String(x._id) === String(id))?.n ?? 0;
  // `name` is always the batch name; college and its code are separate fields so selectors can never swap them.
  res.json({ items: items.map((b) => ({
    ...b, name: b.name, college: collegeLabel(b.collegeId as any), collegeCode: (b.collegeId as any)?.code ?? null,
    collegeId: (b.collegeId as any)?._id ?? null, startDate: b.startDate ?? null, endDate: b.endDate ?? null,
    studentCount: n(st, b._id), courseCount: n(co, b._id), pendingCount: n(pe, b._id),
  })), total, page: q.page, pageSize: q.pageSize });
});

batchesRouter.get('/:id', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id));
  const [trainers, studentCount, courseCount] = await Promise.all([
    TrainerBatchAssignment.find({ batchId: batch._id, status: 'ACTIVE' }, 'trainerId').populate('trainerId', 'fullName trainerId').lean(),
    Enrollment.countDocuments({ batchId: batch._id, status: 'ACTIVE' }),
    BatchCourse.countDocuments({ batchId: batch._id, status: 'ACTIVE' }),
  ]);
  const college = batch.collegeId ? await (await import('../../models/index.js')).College.findById(batch.collegeId, 'name code').lean() : null;
  res.json({ ...batch.toObject(), college: collegeLabel(college), trainers: trainers.map((t) => t.trainerId), studentCount, courseCount });
});

batchesRouter.patch('/:id', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id));
  const b = parse(
    z.object({ name: batchFields.name.optional(), description: batchFields.description.optional(), collegeId: batchFields.collegeId.nullable().optional(), startDate: batchFields.startDate.optional(), endDate: batchFields.endDate.optional(), status: batchFields.status.optional(), leetcodeSchedule: scheduleSchema.nullable().optional() }).strict(),
    req.body,
  );
  if (batch.status === 'ARCHIVED' && b.status === undefined) throw forbidden('Batch is archived', 'BATCH_ARCHIVED');
  const merged = { startDate: b.startDate ?? batch.startDate ?? undefined, endDate: b.endDate ?? batch.endDate ?? undefined };
  if (!dateOrder(merged)) throw badRequest('endDate must not be before startDate');
  const { collegeId, ...rest } = b;
  Object.assign(batch, rest);
  if (collegeId !== undefined && collegeId !== String(batch.collegeId)) batch.set('collegeId', collegeId ? (await activeCollege(collegeId))._id : undefined);
  await batch.save();
  await audit(req, 'batch.update', { type: 'Batch', id: batch._id }, { ...rest, ...(collegeId !== undefined ? { collegeId } : {}) });
  res.json(batch);
});

// ---------- Trainer assignment (Super Admin only) ----------
const superOnly: import('express').RequestHandler = (req, _res, next) => (req.user!.role === 'SUPER_ADMIN' ? next() : next(forbidden()));

batchesRouter.post('/:id/trainers', superOnly, async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id));
  const { trainerId } = parse(z.object({ trainerId: objectId }), req.body);
  const t = await User.findOne({ _id: trainerId, role: 'TRAINER', status: 'ACTIVE' }, '_id').lean();
  if (!t) throw notFound('Trainer not found');
  await TrainerBatchAssignment.updateOne({ trainerId, batchId: batch._id }, { $set: { status: 'ACTIVE', assignedBy: req.user!._id } }, { upsert: true });
  await audit(req, 'batch.trainer.assign', { type: 'Batch', id: batch._id }, { trainerId });
  res.status(201).json({ ok: true });
});

batchesRouter.delete('/:id/trainers/:trainerId', superOnly, async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id));
  const trainerId = parse(objectId, req.params.trainerId);
  await TrainerBatchAssignment.updateOne({ trainerId, batchId: batch._id }, { $set: { status: 'REVOKED' } });
  await audit(req, 'batch.trainer.revoke', { type: 'Batch', id: batch._id }, { trainerId });
  res.status(204).end();
});

// ---------- Enrollment ----------
batchesRouter.get('/:id/enrollments', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id));
  const q = parse(pagination, req.query);
  const filter = { batchId: batch._id, status: 'ACTIVE' as const };
  const [rows, total, pending] = await Promise.all([
    Enrollment.find(filter).sort({ enrolledAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate('studentId', 'fullName rollNumber leetcodeUsername collegeId').lean(),
    Enrollment.countDocuments(filter),
    PendingEnrollment.find({ batchId: batch._id, status: 'PENDING' }, 'rollNumber email createdAt').lean(), // never expose claim hashes
  ]);
  res.json({ items: rows, total, pending, page: q.page, pageSize: q.pageSize });
});

batchesRouter.post('/:id/enrollments', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id), { writable: true });
  const b = parse(z.object({ rollNumber: rollSchema, email: z.string().trim().toLowerCase().email().optional() }), req.body);
  const out = await enrollByRoll(batch._id, b.rollNumber, req.user!._id, b.email);
  await audit(req, 'enrollment.add', { type: 'Batch', id: batch._id }, { rollNumber: b.rollNumber, result: out.result });
  res.status(201).json(out);
});

batchesRouter.delete('/:id/enrollments/:studentId', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id), { writable: true });
  const studentId = parse(objectId, req.params.studentId);
  const r = await Enrollment.updateOne({ studentId, batchId: batch._id, status: 'ACTIVE' }, { $set: { status: 'REMOVED', removedAt: new Date() } });
  if (!r.matchedCount) throw notFound('Enrollment not found');
  await audit(req, 'enrollment.remove', { type: 'Batch', id: batch._id }, { studentId });
  res.status(204).end();
});

/** Accepts `text/csv` body or JSON `{csv}`. Columns: rollNumber (required), email (optional). */
batchesRouter.post('/:id/enrollments/import', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id), { writable: true });
  const text = typeof req.body === 'string' ? req.body : parse(z.object({ csv: z.string().min(1) }), req.body).csv;
  const rows = parseCsv(text);
  if (!('rollnumber' in rows[0])) throw badRequest('CSV must have a rollNumber column');
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];
  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const roll = rollSchema.safeParse(row.rollnumber);
    if (!roll.success) { results.push({ line, rollNumber: row.rollnumber, result: 'INVALID', error: 'Invalid roll number' }); continue; }
    if (seen.has(roll.data)) { results.push({ line, rollNumber: roll.data, result: 'DUPLICATE_IN_FILE' }); continue; }
    seen.add(roll.data);
    const email = row.email ? z.string().email().safeParse(row.email.toLowerCase()) : null;
    if (email && !email.success) { results.push({ line, rollNumber: roll.data, result: 'INVALID', error: 'Invalid email' }); continue; }
    results.push({ line, ...(await enrollByRoll(batch._id, roll.data, req.user!._id, email?.data)) });
  }
  const summary = results.reduce<Record<string, number>>((a, r) => ((a[r.result as string] = (a[r.result as string] ?? 0) + 1), a), {});
  await audit(req, 'enrollment.import', { type: 'Batch', id: batch._id }, summary);
  res.status(200).json({ summary, results });
});

// ---------- Batch <-> course assignment (many-to-many) ----------
batchesRouter.get('/:id/courses', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id));
  const items = await BatchCourse.find({ batchId: batch._id }).populate('courseId', 'title status').lean();
  res.json({ items });
});

batchesRouter.post('/:id/courses', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id), { writable: true });
  const { courseId } = parse(z.object({ courseId: objectId }), req.body);
  const course = await Course.findById(courseId).lean();
  if (!course || course.status !== 'PUBLISHED') throw badRequest('Only published courses can be assigned');
  // Create or reactivate. No chapter access rows are created (hidden by default); enrollments and progress untouched.
  const bc = await BatchCourse.findOneAndUpdate(
    { batchId: batch._id, courseId },
    { $set: { status: 'ACTIVE' }, $setOnInsert: { assignedBy: req.user!._id, assignedAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  await audit(req, 'batch.course.assign', { type: 'Batch', id: batch._id }, { courseId });
  res.status(201).json(bc);
});

batchesRouter.patch('/:id/courses/:courseId', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id), { writable: true });
  const courseId = parse(objectId, req.params.courseId);
  const { status } = parse(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).strict(), req.body);
  const bc = await BatchCourse.findOneAndUpdate({ batchId: batch._id, courseId }, { $set: { status } }, { returnDocument: 'after' });
  if (!bc) throw notFound('Assignment not found');
  await audit(req, 'batch.course.status', { type: 'Batch', id: batch._id }, { courseId, status });
  res.json(bc);
});

// ---------- Chapter visibility (per batch-course) ----------
async function setVisibility(batchCourseId: Types.ObjectId, chapterIds: Types.ObjectId[], isVisible: boolean, by: Types.ObjectId) {
  const now = new Date();
  const set: Record<string, unknown> = { isVisible };
  if (isVisible) { set.unlockedAt = now; set.unlockedBy = by; }
  // Atomic per-document upsert; the unique (batchCourseId, chapterId) index makes concurrent calls converge.
  await BatchChapterAccess.bulkWrite(chapterIds.map((chapterId) => ({ updateOne: { filter: { batchCourseId, chapterId }, update: { $set: set }, upsert: true } })), { ordered: false });
}

async function activeAssignment(batchId: Types.ObjectId, courseId: string) {
  const bc = await BatchCourse.findOne({ batchId, courseId, status: 'ACTIVE' });
  if (!bc) throw notFound('Course is not actively assigned to this batch');
  return bc;
}

batchesRouter.get('/:id/chapter-access', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id));
  res.set('Cache-Control', 'no-store');
  const [bcs, controls, mentor] = await Promise.all([
    BatchCourse.find({ batchId: batch._id }).populate<{ courseId: { _id: Types.ObjectId; title: string; status: string } | null }>('courseId', 'title status').lean(),
    AiBatch.findById(String(batch._id)).lean(),
    settings('STUDENT_MENTOR'),
  ]);
  const courseIds = bcs.flatMap((bc) => bc.courseId ? [bc.courseId._id] : []);
  const providerConfigured = await configuredProvider('STUDENT_MENTOR', mentor);
  const [chapters, access, counts, hints] = await Promise.all([
    Chapter.find({ courseId: { $in: courseIds }, status: 'ACTIVE' }).sort({ order: 1 }).lean(),
    BatchChapterAccess.find({ batchCourseId: { $in: bcs.map((bc) => bc._id) } }).lean(),
    Problem.aggregate<{ _id: Types.ObjectId; count: number; catalogIds?: Types.ObjectId[]; slugs?: string[] }>([
      { $match: { courseId: { $in: courseIds }, status: 'ACTIVE' } },
      { $group: { _id: '$chapterId', count: { $sum: 1 },
        ...(!providerConfigured && mentor.enabled ? { catalogIds: { $addToSet: '$catalogId' }, slugs: { $addToSet: '$slug' } } : {}),
      } },
    ]),
    !providerConfigured && mentor.enabled
      ? AiHint.find({ courseId: { $in: courseIds.map(String) }, status: 'PUBLISHED' }, 'courseId catalogId').lean() : [],
  ]);
  const hintsByCourse = new Map<string, Set<string>>();
  for (const { courseId, catalogId } of hints) {
    if (!courseId || !catalogId) continue;
    const entries = hintsByCourse.get(courseId) ?? new Set<string>();
    entries.add(catalogId);
    hintsByCourse.set(courseId, entries);
  }
  const hintCatalog = hints.length ? await CatalogProblem.find({ _id: { $in: hints.map((hint) => hint.catalogId) }, platform: 'leetcode' }, 'slug').lean() : [];
  const hintBySlug = new Map(hintCatalog.map((item) => [item.slug, String(item._id)]));
  const chaptersByCourse = new Map<string, typeof chapters>();
  for (const chapter of chapters) {
    const id = String(chapter.courseId);
    const group = chaptersByCourse.get(id);
    if (group) group.push(chapter);
    else chaptersByCourse.set(id, [chapter]);
  }
  const byChapter = new Map(counts.map((row) => [String(row._id), row]));
  const byAccess = new Map(access.map((row) => [`${row.batchCourseId}:${row.chapterId}`, row]));
  const out = bcs.flatMap((bc) => {
    const course = bc.courseId;
    if (!course) return [];
    const courseId = String(course._id);
    return [{
      batchCourseId: bc._id, status: bc.status, course,
      chapters: (chaptersByCourse.get(courseId) ?? []).map((chapter) => {
        const row = byAccess.get(`${bc._id}:${chapter._id}`);
        const isVisible = row?.isVisible === true;
        const studentAiEnabled = row?.studentAiEnabled === true;
        const assigned = byChapter.get(String(chapter._id));
        const courseHints = hintsByCourse.get(courseId);
        const hasPublishedHints = courseHints && (assigned?.catalogIds?.some((id) => courseHints.has(String(id)))
          || assigned?.slugs?.some((slug) => courseHints.has(hintBySlug.get(slug) ?? '')));
        const aiAvailability = !isVisible ? 'CHAPTER_HIDDEN' : !studentAiEnabled ? 'CHAPTER_DISABLED'
          : batch.status !== 'ACTIVE' || bc.status !== 'ACTIVE' || course.status !== 'PUBLISHED' ? 'CONTEXT_INACTIVE'
          : !mentor.enabled ? 'GLOBAL_DISABLED' : !batchAiAvailable(controls, courseId) ? 'BATCH_UNAVAILABLE'
          : providerConfigured ? 'AVAILABLE' : hasPublishedHints ? 'PUBLISHED_HINTS_ONLY' : 'NO_AI_SOURCE';
        return { chapterId: chapter._id, title: chapter.title, order: chapter.order, isVisible, unlockedAt: row?.unlockedAt,
          problemCount: assigned?.count ?? 0, studentAiEnabled, aiAvailability };
      }),
    }];
  });
  res.json({ items: out });
});

batchesRouter.put('/:id/courses/:courseId/chapters/:chapterId/access', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id), { writable: true });
  const courseId = parse(objectId, req.params.courseId);
  const chapterId = parse(objectId, req.params.chapterId);
  const { isVisible } = parse(z.object({ isVisible: z.boolean() }).strict(), req.body);
  const bc = await activeAssignment(batch._id, courseId);
  if (!(await Chapter.exists({ _id: chapterId, courseId, status: 'ACTIVE' }))) throw notFound('Chapter not found in this course');
  await setVisibility(bc._id, [new Types.ObjectId(chapterId)], isVisible, req.user!._id);
  await audit(req, isVisible ? 'chapter.unlock' : 'chapter.hide', { type: 'Batch', id: batch._id }, { courseId, chapterId });
  res.json({ chapterId, isVisible });
});

batchesRouter.post('/:id/chapter-access/bulk', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id), { writable: true });
  const b = parse(
    z.object({ courseId: objectId, isVisible: z.boolean(), chapterIds: z.array(objectId).min(1).max(500).optional(), all: z.literal(true).optional() })
      .refine((v) => !!v.chapterIds !== !!v.all, 'Provide exactly one of chapterIds or all'),
    req.body,
  );
  const bc = await activeAssignment(batch._id, b.courseId);
  const chapters = await Chapter.find({ courseId: b.courseId, status: 'ACTIVE', ...(b.all ? {} : { _id: { $in: b.chapterIds } }) }, '_id').lean();
  if (!b.all && chapters.length !== new Set(b.chapterIds).size) throw badRequest('Some chapters do not belong to this course');
  await setVisibility(bc._id, chapters.map((c) => c._id), b.isVisible, req.user!._id);
  await audit(req, 'chapter.bulk', { type: 'Batch', id: batch._id }, { courseId: b.courseId, isVisible: b.isVisible, count: chapters.length });
  res.json({ updated: chapters.length, isVisible: b.isVisible });
});

async function setChapterAi(req: Request, batchCourseId: Types.ObjectId, courseId: string, chapterIds: Types.ObjectId[], enabled: boolean, bulk: boolean) {
  let changed = 0;
  for (const chapterId of chapterIds) {
    // Return the pre-update document so audit records reflect the state this write replaced.
    const write = () => BatchChapterAccess.findOneAndUpdate({ batchCourseId, chapterId },
      { $set: { studentAiEnabled: enabled } }, { upsert: enabled, returnDocument: 'before' }).lean();
    const previous = await write().catch((error: unknown) => {
      // A concurrent visibility or AI upsert may have created the shared row first.
      if (error instanceof Error && 'code' in error && error.code === 11000) return write();
      throw error;
    });
    const previousEnabled = previous?.studentAiEnabled === true;
    if (previousEnabled === enabled) continue;
    changed++;
    await audit(req, 'chapter.student_ai.update', { type: 'Batch', id: req.params.id }, {
      batchId: req.params.id, courseId, chapterId: String(chapterId), previousEnabled, enabled, bulk,
    });
  }
  return changed;
}

batchesRouter.put('/:id/courses/:courseId/chapters/:chapterId/student-ai', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id), { writable: true });
  const courseId = parse(objectId, req.params.courseId);
  const chapterId = parse(objectId, req.params.chapterId);
  const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), req.body);
  const bc = await activeAssignment(batch._id, courseId);
  if (!(await Chapter.exists({ _id: chapterId, courseId, status: 'ACTIVE' }))) throw notFound('Chapter not found in this course');
  await setChapterAi(req, bc._id, courseId, [new Types.ObjectId(chapterId)], enabled, false);
  res.json({ chapterId, enabled });
});

batchesRouter.post('/:id/chapter-access/student-ai/bulk', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id), { writable: true });
  const input = parse(z.object({ courseId: objectId, enabled: z.boolean(), chapterIds: z.array(objectId).min(1).max(500).optional(), all: z.literal(true).optional() })
    .strict().refine((value) => !!value.chapterIds !== !!value.all, 'Provide exactly one of chapterIds or all'), req.body);
  const bc = await activeAssignment(batch._id, input.courseId);
  const chapters = await Chapter.find({ courseId: input.courseId, status: 'ACTIVE', ...(input.all ? {} : { _id: { $in: input.chapterIds } }) }, '_id').lean();
  if (input.chapterIds && chapters.length !== new Set(input.chapterIds).size) throw badRequest('Some chapters do not belong to this course');
  const updated = await setChapterAi(req, bc._id, input.courseId, chapters.map((chapter) => chapter._id), input.enabled, true);
  res.json({ updated, enabled: input.enabled });
});
