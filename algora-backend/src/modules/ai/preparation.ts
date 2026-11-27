import { z } from 'zod';
import { log } from '../../lib/logger';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { takeToken } from '../../lib/ratelimit';
import { withFencedWrite, withLease, type Lease } from '../../lib/lease';
import { AiJob, AiPreparation, AiUsage } from '../../models/ai';
import { env } from '../../config/env';
import { CatalogProblem, User, type UserDoc } from '../../models';
import { audit } from '../audit/audit';
import { fingerprint, staffChapter } from './context';
import { redact, staffPrompt } from './policy';
import { completion, configuredProvider, encryptionReady, settings, type Attribution } from './runtime';

const paragraph = z.string().trim().min(1).max(12000);
const approach = z.object({
  name: paragraph, idea: paragraph, algorithm: paragraph, code: paragraph, time: paragraph, space: paragraph,
  derivation: paragraph, difficulty: paragraph, suitability: paragraph, tradeoffs: paragraph, mistakes: paragraph, teachingOrder: paragraph,
}).strict();
export const problemMaterial = z.object({
  understanding: paragraph, approaches: z.array(approach).min(1).max(6), dryRuns: paragraph,
  mistakes: paragraph, edgeCases: paragraph, expectedDoubts: paragraph, teachingGuide: paragraph, hints: z.array(z.string().trim().min(1).max(600)).length(4),
}).strict();
export const chapterMaterial = z.object({
  objectives: paragraph, prerequisites: paragraph, patterns: paragraph, sequence: paragraph,
  relationships: paragraph, difficulties: paragraph, mistakes: paragraph, strategy: paragraph, questions: paragraph,
}).strict();
export const promptVersion = 1;
export const preparationWorkload = 'STAFF_PREPARATION' as const;

export type StaffContext = Awaited<ReturnType<typeof staffChapter>>;
export function target(ctx: StaffContext, problemId: string | undefined, language: string) {
  if (!problemId) {
    return { key: `chapter:${ctx.chapter.id}:${language}`, fingerprint: fingerprint({ chapter: ctx.chapter, problems: ctx.problems }),
      schema: chapterMaterial, prompt: 'Return string fields objectives, prerequisites, patterns, sequence, relationships, difficulties, mistakes, strategy, questions. Respect existing assignment ordering and label any alternative order as a suggestion.',
      data: { ...ctx, problems: ctx.problems.map(({ fingerprint: _hash, ...problem }) => problem) } };
  }
  const problem = ctx.problems.find((p) => p.id === problemId);
  if (!problem) throw notFound('Assigned problem not found');
  return { key: `problem:${problem.catalogId ?? problem.id}:${language}`, fingerprint: problem.fingerprint,
    schema: problemMaterial, prompt: 'Return fields understanding, approaches, dryRuns, mistakes, edgeCases, expectedDoubts, teachingGuide, hints. Except approaches and hints all fields are strings. Return up to six meaningful approaches, each with string fields name, idea, algorithm, code, time, space, derivation, difficulty, suitability, tradeoffs, mistakes, teachingOrder. Include complete code, detailed derivations, anticipated mistakes with diagnostic examples and four progressive solution-free hints.',
    data: problem };
}

export async function saveMaterial(item: ReturnType<typeof target>, current: Awaited<ReturnType<typeof readMaterial>>, content: unknown, metadata: Record<string, unknown>, lease?: Lease) {
  const version = current?.version ?? 0;
  const history = current ? { version, content: current.content, status: current.status, model: current.model, provider: current.provider, configId: current.configId, configVersion: current.configVersion,
    editedBy: current.editedBy, reviewedBy: current.reviewedBy, sectionReviews: current.sectionReviews, at: current.updatedAt } : undefined;
  const write = async (session?: import('mongoose').ClientSession) => {
    const doc = await AiPreparation.findOneAndUpdate({ _id: item.key, version }, {
      $set: { ...metadata, content, fingerprint: item.fingerprint, promptVersion }, $inc: { version: 1 },
      ...(history ? { $push: { history: { $each: [history], $slice: -8 } } } : {}),
      ...(metadata.status === 'DRAFT' ? { $unset: { reviewedBy: 1, reviewedAt: 1 } } : {}),
    }, { returnDocument: 'after', upsert: version === 0, session }).lean();
    if (!doc) throw conflict('This preparation changed. Reload and try again.');
    return doc;
  };
  return lease ? withFencedWrite(lease, write) : write();
}

export const readMaterial = (key: string) => AiPreparation.findById(key).lean().exec();
export const compatible = (doc: { fingerprint?: string | null; promptVersion?: number | null } | null | undefined, fp: string) =>
  !!doc && doc.fingerprint === fp && doc.promptVersion === promptVersion;

interface Task { problemId?: string; status: string; section?: string; force?: boolean; version?: number; error?: string; notes?: string }
export async function generateMaterial(ctx: StaffContext, task: Task, language: string, attribution: Attribution, lease: Lease) {
  const item = target(ctx, task.problemId, language);
  const current = await readMaterial(item.key);
  if (!task.force && compatible(current, item.fingerprint)) {
    await AiUsage.create({ ...attribution, workload: preparationWorkload, action: 'REUSED_PREPARATION', status: 'SUCCESS', local: true, outbound: false, finishedAt: new Date() });
    return 'REUSED';
  }
  if ((current?.version ?? 0) !== (task.version ?? 0)) throw conflict('Preparation changed while this job was queued.');
  if (task.section && (!current?.content || !(task.section in item.schema.shape))) throw badRequest('Section cannot be regenerated.');
  const section = task.section;
  const schema = section ? z.object({ [section]: item.schema.shape[section as keyof typeof item.schema.shape] as z.ZodType }).strict() : item.schema;
  const sectionInstruction = section ? `\nThis request regenerates one section. Return a JSON object containing only the ${section} field.` : '';
  const result = await completion(preparationWorkload, attribution, staffPrompt + '\n' + item.prompt + sectionInstruction, {
    context: item.data, language, providedNotes: task.notes, section,
  }, (value) => schema.parse(value), undefined, undefined, schema);
  const content = item.schema.parse(section ? { ...current!.content, ...result.content } : result.content);
  const sectionReviews = section ? Object.fromEntries(Object.entries(current?.sectionReviews ?? {}).filter(([field]) => field !== section)) : {};
  await saveMaterial(item, current, content, { language, status: 'DRAFT', model: result.model, provider: result.provider, configId: result.configId, configVersion: result.configVersion, generatedAt: new Date(), editedBy: null, sectionReviews }, lease);
  await audit(null, task.force ? 'ai.preparation.regenerate' : 'ai.preparation.generate', { type: 'AiPreparation', id: item.key },
    { section }, { _id: attribution.userId, role: attribution.role });
  return 'DRAFT';
}

export function startPreparationWorker() {
  let running: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (running || !encryptionReady()) return;
    running = processPreparationTask().catch(() => { log.warn('AI preparation worker tick failed'); }).finally(() => { running = undefined; });
  }, 3000);
  timer.unref();
  return async () => { clearInterval(timer); await running; };
}

export async function processPreparationTask() {
  if (!(await AiJob.exists({ active: true, status: { $ne: 'PAUSED' }, availableAt: { $lte: new Date() } }))) return;
  await withLease('ai:preparation-worker', 70_000, async (lease) => {
    const job = await AiJob.findOne({ active: true, status: { $ne: 'PAUSED' }, availableAt: { $lte: new Date() } }).sort({ availableAt: 1, createdAt: 1 }).lean();
    if (!job?.userId || !job.language || !job.chapterId) return;
    const tasks = job.tasks as Task[];
    const next = tasks.findIndex((entry) => ['QUEUED', 'GENERATING'].includes(entry.status));
    if (next === -1) {
      await AiJob.updateOne({ _id: job._id, active: true }, { status: tasks.some((entry) => entry.status === 'FAILED') ? 'PARTIAL' : 'DONE', active: false });
      return;
    }
    const task = tasks[next];
    const prefix = `tasks.${next}`;
    const write = (fields: Record<string, unknown>) => withFencedWrite(lease, (session) =>
      AiJob.updateOne({ _id: job._id, active: true }, { $set: fields }, { session }));
    if (task.status === 'GENERATING') {
      await write({ status: 'QUEUED', [`${prefix}.status`]: 'FAILED', [`${prefix}.error`]: 'This generation was interrupted. Review saved material before retrying.' });
      return;
    }
    const actor = await User.findOne({ _id: job.userId, status: 'ACTIVE', role: { $in: ['SUPER_ADMIN', 'TRAINER'] } }).lean<UserDoc>();
    if (!actor || (actor.role === 'SUPER_ADMIN' && actor.email !== env.SUPER_ADMIN_EMAIL)) {
      await write({ status: 'CANCELLED', active: false });
      return;
    }
    try {
      const ctx = job.chapterId === 'library' && job.problemId ? await libraryContext(actor, job.problemId) : await staffChapter(actor, job.chapterId);
      const claim = await write({ status: 'GENERATING', [`${prefix}.status`]: 'GENERATING' });
      if (!claim.matchedCount) return;
      const status = await generateMaterial(ctx, task, job.language, {
        userId: job.userId, role: actor.role, action: task.section ? 'SECTION' : task.problemId ? 'PROBLEM' : 'CHAPTER',
        chapterId: job.chapterId, courseId: job.courseId ?? undefined, problemId: task.problemId, referenceId: String(job._id),
      }, lease);
      await write({ status: 'QUEUED', [`${prefix}.status`]: status, [`${prefix}.error`]: null });
    } catch (error) {
      const status = error instanceof Error && 'status' in error ? error.status : undefined;
      if (status === 429) {
        await write({ status: 'PAUSED', availableAt: new Date(Date.now() + 60_000), [`${prefix}.status`]: 'QUEUED',
          [`${prefix}.error`]: 'Allowance reached. Resume after the limit resets.' });
        return;
      }
      await write({ status: 'QUEUED', [`${prefix}.status`]: 'FAILED', [`${prefix}.error`]: status === 409 ? 'Preparation changed. Refresh and retry.' : 'Generation failed. Review availability and retry.' });
    }
  });
}

export async function libraryContext(user: UserDoc, problemId: string): Promise<StaffContext> {
  if (user.role !== 'SUPER_ADMIN') throw forbidden();
  const problem = await CatalogProblem.findById(problemId).lean();
  if (!problem) throw notFound('Library problem not found');
  const metadata = { title: problem.title, slug: problem.slug, url: problem.url, difficulty: problem.difficulty,
    number: problem.problemNumber, topics: problem.topics };
  return { course: { id: 'library', title: 'Problem Library' }, chapter: { id: 'library', title: 'Problem Library', description: '' },
    problems: [{ ...metadata, id: problemId, catalogId: problemId, order: 0, fingerprint: fingerprint(metadata) }] };
}

export async function enqueue(ctx: StaffContext, user: UserDoc, language: string, ids: (string | undefined)[], force: boolean, section?: string, notes?: string) {
  const config = await settings(preparationWorkload);
  if (!(await configuredProvider(preparationWorkload, config))) throw forbidden('Staff generation is unavailable.');
  if (!ids.length || ids.filter(Boolean).length > config.limits.chapterSize) throw badRequest('Select a smaller set of assigned problems.');
  const userId = String(user._id);
  if (!(await takeToken(`ai:enqueue:${userId}`, 6, 6, true))) throw conflict('Wait before requesting more preparation jobs.');
  const tasks: Task[] = [];
  const reused: (string | undefined)[] = [];
  for (const problemId of ids) {
    const item = target(ctx, problemId, language);
    const current = await readMaterial(item.key);
    if (!force && current && (current.reviewedAt || current.editedBy)) continue;
    if (force || !compatible(current, item.fingerprint)) tasks.push({ problemId, status: 'QUEUED', force, section, notes, version: current?.version ?? 0 });
    else reused.push(problemId);
  }
  if (reused.length) await AiUsage.insertMany(reused.map((problemId) => ({
    userId, role: user.role, courseId: ctx.course.id, chapterId: ctx.chapter.id, problemId, workload: preparationWorkload,
    action: 'REUSED_PREPARATION', status: 'SUCCESS', local: true, outbound: false, finishedAt: new Date(),
  })));
  if (!tasks.length) return null;
  const signature = fingerprint({ chapter: ctx.chapter.id, language, tasks });
  const result = await withLease('ai:enqueue', 15_000, async () => {
    const existing = await AiJob.findOne({ signature, active: true }).lean();
    if (existing) return existing;
    if (await AiJob.countDocuments({ active: true, userId: String(user._id) }) >= 3) throw conflict('You already have three active preparation jobs.');
    if (await AiJob.countDocuments({ active: true }) >= 20) throw conflict('The preparation queue is full.');
    const now = new Date();
    return (await AiJob.create({ signature, workload: preparationWorkload, userId: String(user._id),
      chapterId: ctx.chapter.id, courseId: ctx.course.id, problemId: ctx.chapter.id === 'library' ? tasks[0]?.problemId : undefined,
      language, tasks, status: 'QUEUED', active: true, availableAt: now, expiresAt: new Date(+now + 7 * 86400000) })).toObject();
  });
  if (!result) throw conflict('The queue is busy. Try again in a moment.');
  return result;
}

export const cleanQuestion = (value: string) => redact(value).slice(0, 4000);
