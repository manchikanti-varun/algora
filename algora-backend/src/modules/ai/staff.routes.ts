import { Router, type Request } from 'express';
import { z } from 'zod';
import { badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors';
import { objectId } from '../../lib/validate';
import { requireRole } from '../../middleware/auth';
import { Chapter, Course } from '../../models';
import { AiConversation, AiHint, AiJob, AiPreparation, AiUsage } from '../../models/ai';
import { canManageCourses, trainerBatchIds } from '../access';
import { audit } from '../audit/audit';
import { staffChapter, staffCourse, staffCourses } from './context';
import { fallback, languages, safeGuidance, staffPrompt } from './policy';
import { cleanQuestion, compatible, enqueue, libraryContext, preparationWorkload as workload, readMaterial, saveMaterial, target } from './preparation';
import { completion, settings } from './runtime';

const language = z.enum(languages).default('Java');
const languageQuery = z.object({ language });
const identify = z.object({ chapterId: z.union([objectId, z.literal('library')]), problemId: objectId.optional(), language });
const contextFor = (req: Request, chapterId: string, problemId?: string) =>
  chapterId === 'library' && problemId ? libraryContext(req.user!, problemId) : staffChapter(req.user!, chapterId);
const canEdit = (req: Request) => { if (!canManageCourses(req.user!)) throw forbidden('Course content permission is required.'); };

export const staffAi = Router();
staffAi.use(requireRole('SUPER_ADMIN', 'TRAINER'));

staffAi.get('/courses', async (req, res) => {
  const { page } = parse(z.object({ page: z.coerce.number().int().min(1).max(500).default(1) }), req.query);
  const rows = await Course.find({ ...await staffCourses(req.user!), status: { $ne: 'ARCHIVED' } }, 'title aiLanguage').sort({ title: 1, _id: 1 }).skip((page - 1) * 100).limit(101).lean();
  res.json({ items: rows.slice(0, 100), more: rows.length > 100, languages });
});
staffAi.put('/courses/:courseId/language', async (req, res) => {
  canEdit(req);
  const id = parse(objectId, req.params.courseId);
  const course = await staffCourse(req.user!, id);
  const { language: lang } = parse(z.object({ language }), req.body);
  await Course.updateOne({ _id: course._id }, { aiLanguage: lang });
  await audit(req, 'ai.course.language', { type: 'Course', id }, { language: lang });
  res.status(204).end();
});
staffAi.get('/courses/:courseId/chapters', async (req, res) => {
  const id = parse(objectId, req.params.courseId);
  await staffCourse(req.user!, id);
  const { page } = parse(z.object({ page: z.coerce.number().int().min(1).max(500).default(1) }), req.query);
  const rows = await Chapter.find({ courseId: id, status: 'ACTIVE' }, 'title order').sort({ order: 1, _id: 1 }).skip((page - 1) * 100).limit(101).lean();
  res.json({ items: rows.slice(0, 100), more: rows.length > 100 });
});
staffAi.get('/chapters/:chapterId', async (req, res) => {
  const chapterId = parse(objectId, req.params.chapterId);
  const { language: lang } = parse(languageQuery, req.query);
  const ctx = await staffChapter(req.user!, chapterId);
  const targets = [target(ctx, undefined, lang), ...ctx.problems.map((p) => target(ctx, p.id, lang))];
  const docs = await AiPreparation.find({ _id: { $in: targets.map((item) => item.key) } }, 'status updatedAt version fingerprint promptVersion').lean();
  const index = new Map(docs.map((item) => [item._id, item]));
  const prep = (position: number) => {
    const item = targets[position];
    const doc = index.get(item.key);
    return { status: doc ? compatible(doc, item.fingerprint) ? doc.status : 'OUTDATED' : 'NOT_PREPARED', updatedAt: doc?.updatedAt, version: doc?.version ?? 0 };
  };
  const config = await settings(workload);
  const jobs = await AiJob.find({ chapterId, language: lang }, 'status tasks createdAt active').sort({ createdAt: -1 }).limit(8).lean();
  res.json({ ...ctx, guide: prep(0), problems: ctx.problems.map((p, i) => ({ ...p, ...prep(i + 1) })), jobs,
    canEdit: canManageCourses(req.user!), enabled: config.enabled && !!config.activeId });
});
staffAi.get('/material', async (req, res) => {
  const context = parse(identify, req.query);
  const ctx = await contextFor(req, context.chapterId, context.problemId);
  const item = target(ctx, context.problemId, context.language);
  const doc = await readMaterial(item.key);
  const hints = context.problemId ? await AiHint.find({ catalogId: ctx.problems.find((p) => p.id === context.problemId)?.catalogId ?? null,
    courseId: ctx.course.id, language: context.language }, 'level text status version').sort({ level: 1 }).lean() : [];
  res.json({ material: doc, context: item.data, hints, canEdit: canManageCourses(req.user!), outdated: !!doc && !compatible(doc, item.fingerprint) });
});
staffAi.post('/generate', async (req, res) => {
  const { chapterId, problemId, language: lang, action, selected, section, confirm, notes } = parse(identify.extend({
    action: z.enum(['chapter', 'remaining', 'selected', 'problem', 'summary', 'section', 'refresh']),
    selected: z.array(objectId).max(50).optional(), section: z.string().regex(/^[a-zA-Z]+$/).optional(), confirm: z.boolean().optional(), notes: z.string().trim().max(2400).optional(),
  }), req.body);
  const ctx = await contextFor(req, chapterId, problemId);
  const force = action === 'section' || action === 'summary' || (action === 'problem' && !!confirm);
  if (force && !confirm) throw badRequest('Confirm regeneration first.');
  if (action === 'section' && !section) throw badRequest('Select a section.');
  if (action === 'problem' && !problemId) throw badRequest('Select an assigned problem.');
  if (force) canEdit(req);
  const ids = action === 'selected' ? [...new Set(selected ?? [])] :
    action === 'problem' || action === 'section' || (action === 'refresh' && problemId) ? [problemId] :
    action === 'summary' ? [undefined] : [...(action === 'chapter' ? [undefined] : []), ...ctx.problems.map((p) => p.id)];
  const job = await enqueue(ctx, req.user!, lang, ids, force, action === 'section' ? section : undefined, notes ? cleanQuestion(notes) : undefined);
  res.status(job ? 202 : 200).json({ job });
});
staffAi.get('/jobs/:id', async (req, res) => {
  const job = await AiJob.findById(parse(objectId, req.params.id)).lean();
  if (!job?.chapterId) throw notFound();
  await contextFor(req, job.chapterId, job.problemId ?? undefined);
  res.json({ id: job._id, status: job.status, tasks: job.tasks, availableAt: job.availableAt });
});
staffAi.post('/jobs/:id/resume', async (req, res) => {
  const job = await AiJob.findById(parse(objectId, req.params.id)).lean();
  if (!job?.chapterId) throw notFound();
  await contextFor(req, job.chapterId, job.problemId ?? undefined);
  if (job.userId !== String(req.user!._id) && req.user!.role !== 'SUPER_ADMIN') throw forbidden();
  const resumed = await AiJob.updateOne({ _id: job._id, active: true, status: 'PAUSED', availableAt: { $lte: new Date() } },
    { status: 'QUEUED', availableAt: new Date() });
  if (!resumed.matchedCount) throw conflict('This job cannot be resumed yet.');
  res.status(204).end();
});
staffAi.post('/jobs/:id/cancel', async (req, res) => {
  const job = await AiJob.findById(parse(objectId, req.params.id)).lean();
  if (!job?.chapterId) throw notFound();
  await contextFor(req, job.chapterId, job.problemId ?? undefined);
  if (job.userId !== String(req.user!._id) && req.user!.role !== 'SUPER_ADMIN') throw forbidden();
  await AiJob.updateOne({ _id: job._id, active: true, status: { $ne: 'GENERATING' } }, { status: 'CANCELLED', active: false }).then((result) => {
    if (!result.matchedCount) throw conflict('A generation is currently running or has already finished.');
  });
  res.status(204).end();
});
staffAi.patch('/material', async (req, res) => {
  canEdit(req);
  const { chapterId, problemId, language: lang, content, version, status, reviewSection } = parse(identify.extend({
    content: z.unknown().optional(), version: z.number().int().nonnegative(), status: z.enum(['DRAFT', 'REVIEWED', 'READY']), reviewSection: z.string().max(30).optional(),
  }), req.body);
  const ctx = await contextFor(req, chapterId, problemId);
  const item = target(ctx, problemId, lang);
  const current = await readMaterial(item.key);
  if ((current?.version ?? 0) !== version) throw conflict('Preparation changed. Reload before saving.');
  const parsed = parse(item.schema, content ?? current?.content);
  const actor = String(req.user!._id);
  if (reviewSection && (!Object.hasOwn(item.schema.shape, reviewSection) || content !== undefined)) throw badRequest('Select one saved section to review.');
  const sectionReviews = content === undefined ? { ...(current?.sectionReviews ?? {}) } : {};
  if (reviewSection) sectionReviews[reviewSection] = { reviewer: actor, at: new Date() };
  const nextStatus = reviewSection ? current?.status ?? 'DRAFT' : status;
  const material = await saveMaterial(item, current, parsed, { language: lang, status: nextStatus, sectionReviews, ...(content === undefined ? {} : { editedBy: actor }),
    ...(nextStatus !== 'DRAFT' && !reviewSection ? { reviewedBy: actor, reviewedAt: new Date() } : {}) });
  await audit(req, status === 'DRAFT' ? 'ai.preparation.edit' : 'ai.preparation.review', { type: 'AiPreparation', id: item.key }, { version: material.version, status: nextStatus, reviewSection });
  res.json({ material });
});
staffAi.put('/hints', async (req, res) => {
  canEdit(req);
  const { chapterId, problemId, language: lang, level, text, status, version, reviewed } = parse(identify.extend({
    problemId: objectId, level: z.number().int().min(1).max(4), text: z.string().trim().min(1).max(600),
    status: z.enum(['DRAFT', 'PUBLISHED', 'UNPUBLISHED']), version: z.number().int().nonnegative(), reviewed: z.literal(true).optional(),
  }), req.body);
  const ctx = await contextFor(req, chapterId, problemId);
  const problem = ctx.problems.find((p) => p.id === problemId);
  if (!problem?.catalogId || chapterId === 'library') throw badRequest('Select an assigned catalog problem.');
  if (status === 'PUBLISHED' && !reviewed) throw badRequest('Confirm student-safe review before publishing.');
  if (status === 'PUBLISHED' && safeGuidance({ ...fallback, explanation: text }) === fallback) throw badRequest('Publish a short conceptual hint without code or a solution sequence.');
  const id = `${problem.catalogId}:${ctx.course.id}:${lang}:${level}`;
  const existing = await AiHint.findById(id).lean();
  if ((existing?.version ?? 0) !== version) throw conflict('This hint changed. Reload before saving.');
  const actor = String(req.user!._id);
  const saved = await AiHint.findOneAndUpdate({ _id: id, version }, {
    $set: { catalogId: problem.catalogId, courseId: ctx.course.id, language: lang, level, text: cleanQuestion(text), status, reviewer: status === 'PUBLISHED' ? actor : null },
    $setOnInsert: { author: actor }, $inc: { version: 1 },
    ...(existing ? { $push: { history: { $each: [{ version, text: existing.text, status: existing.status, reviewer: existing.reviewer, at: existing.updatedAt }], $slice: -8 } } } : {}),
  }, { upsert: version === 0, returnDocument: 'after' }).lean();
  if (!saved) throw conflict('This hint changed. Reload before saving.');
  await audit(req, `ai.hint.${status.toLowerCase()}`, { type: 'AiHint', id }, { level });
  res.json({ level, status, version: saved.version, text: saved.text });
});
staffAi.get('/conversations', async (req, res) => {
  const { chapterId, problemId, language: lang } = parse(identify, req.query);
  target(await contextFor(req, chapterId, problemId), problemId, lang);
  const row = await AiConversation.findOne({ workload, userId: String(req.user!._id), chapterId, problemId: problemId ?? null, language: lang, expiresAt: { $gt: new Date() } }).sort({ updatedAt: -1 }).lean();
  res.json({ turns: row?.turns ?? [] });
});
staffAi.post('/conversations', async (req, res) => {
  const { chapterId, problemId, language: lang, question, requestKey } = parse(identify.extend({
    question: z.string().trim().min(1).max(4000), requestKey: z.uuid(), consent: z.literal(true),
  }), req.body);
  const ctx = await contextFor(req, chapterId, problemId);
  const item = target(ctx, problemId, lang);
  const user = req.user!;
  const userId = String(user._id);
  const filters = { workload, userId, chapterId, problemId: problemId ?? null, language: lang };
  const config = await settings(workload);
  const [current, material] = await Promise.all([
    AiConversation.findOne({ ...filters, expiresAt: { $gt: new Date() } }).sort({ updatedAt: -1 }).lean(),
    readMaterial(item.key),
  ]);
  const clean = cleanQuestion(question);
  const answerSchema = z.object({ answer: z.string().trim().min(1).max(12000) }).strict();
  const { content } = await completion(workload, { userId, role: user.role, action: 'STAFF_FOLLOWUP', courseId: ctx.course.id, chapterId, problemId, requestKey },
    staffPrompt + ' Return a JSON object with one string field answer. Give a detailed educational answer and complete code where relevant.', {
      context: item.data, question: clean, language: lang, savedPreparationExcerpt: material?.content ? cleanQuestion(JSON.stringify(material.content).slice(0, 1800)) : undefined,
      history: current?.turns.slice(-config.limits.history).map(({ question: q, answer }) => ({ question: q, answer: String(answer).slice(0, 2500) })),
    }, (value) => answerSchema.parse(value), undefined, undefined, answerSchema);
  const turn = { question: clean, answer: content.answer, at: new Date() };
  if (current) await AiConversation.updateOne({ _id: current._id }, { $push: { turns: { $each: [turn], $slice: -60 } } });
  else await AiConversation.create({ ...filters, courseId: ctx.course.id, turns: [turn], expiresAt: new Date(Date.now() + config.limits.retention * 86400000) });
  res.json({ turn });
});

staffAi.delete('/conversations', async (req, res) => {
  const { chapterId, problemId, language: lang } = parse(identify, req.query);
  target(await contextFor(req, chapterId, problemId), problemId, lang);
  await AiConversation.deleteMany({ workload, userId: String(req.user!._id), chapterId, problemId: problemId ?? null, language: lang });
  res.status(204).end();
});
staffAi.get('/usage/:courseId', async (req, res) => {
  const courseId = parse(objectId, req.params.courseId);
  await staffCourse(req.user!, courseId);
  const batchIds = req.user!.role === 'TRAINER' ? (await trainerBatchIds(req.user!)).map(String) : null;
  const items = await AiUsage.aggregate([
    { $match: { courseId, createdAt: { $gte: new Date(Date.now() - 30 * 86400000) },
      ...(batchIds ? { $or: [{ batchId: { $in: batchIds } }, { userId: String(req.user!._id), workload }] } : {}) } },
    { $group: { _id: { workload: '$workload', status: '$status' }, requests: { $sum: 1 }, outbound: { $sum: { $cond: ['$outbound', 1, 0] } } } },
  ]);
  res.json({ items });
});

staffAi.get('/export', async (req, res) => {
  const { chapterId, problemId, language: lang } = parse(identify, req.query);
  const ctx = await contextFor(req, chapterId, problemId);
  const ids = problemId ? [problemId] : [undefined, ...ctx.problems.map((p) => p.id)];
  const targets = ids.map((id) => target(ctx, id, lang));
  const records = await AiPreparation.find({ _id: { $in: targets.map((item) => item.key) } }, 'content status').lean();
  const format = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(format).join('\n\n');
    if (value && typeof value === 'object') return Object.entries(value).map(([label, text]) => `${label}\n${format(text)}`).join('\n\n');
    return String(value ?? '');
  };
  await audit(req, 'ai.preparation.export', { type: 'Chapter', id: chapterId }, { problemId, language: lang });
  const sections = targets.flatMap((item, index) => {
    const data = records.find((record) => record._id === item.key);
    if (!data) return [];
    const title = ids[index] ? ctx.problems.find((problem) => problem.id === ids[index])?.title : 'Chapter teaching guide';
    return [`${title} (${data.status})\n${format(data.content)}`];
  });
  res.attachment('algora-teaching-preparation.txt').type('text/plain').send(['ALGORA STAFF ONLY', ctx.course.title, ctx.chapter.title, lang, ...sections].join('\n\n'));
});
