import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors';
import { withFencedWrite, withLease } from '../../lib/lease';
import { takeToken } from '../../lib/ratelimit';
import { objectId } from '../../lib/validate';
import { AiConversation, AiHint, AiPractice, AiUsage } from '../../models/ai';
import { studentProblem } from './context';
import { fallback, guidance, languages, modes, redact, safeGuidance, studentPrompt } from './policy';
import { allowance, completion, configuredProvider, countSuccess, limited, settings } from './runtime';

const workload = 'STUDENT_MENTOR' as const;
const scope = z.object({ batchCourseId: objectId, problemId: objectId });
const language = z.enum(languages).default('Java');
const optionalText = (max: number) => z.string().trim().max(max).optional();
const message = z.object({
  mode: z.enum(modes), requestKey: z.uuid(), consent: z.literal(true), question: optionalText(2000), code: optionalText(15000),
  error: optionalText(1500), result: optionalText(250), input: optionalText(650), expected: optionalText(350), actual: optionalText(350),
  constraints: optionalText(1200), passed: z.number().int().nonnegative().optional(), total: z.number().int().positive().optional(),
}).strict().refine((value) => value.passed === undefined || value.total === undefined || value.passed <= value.total);

export const studentAi = Router();
studentAi.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

studentAi.get('/availability', async (req, res) => {
  const { batchCourseId, problemId } = parse(scope, req.query);
  const problem = await studentProblem(req.user!, batchCourseId, problemId);
  const config = await settings(workload);
  res.json({ problem, languages, codeLimit: config.limits.code, enabled: problem.allowed && config.enabled,
    provider: problem.allowed && await configuredProvider(workload, config), remaining: await allowance(String(req.user!._id), problem.daily ?? config.limits.daily) });
});

studentAi.put('/practice', async (req, res) => {
  const context = parse(scope, req.body);
  await studentProblem(req.user!, context.batchCourseId, context.problemId);
  await AiPractice.updateOne({ _id: String(req.user!._id) }, { $set: context }, { upsert: true });
  res.status(204).end();
});

studentAi.get('/conversations', async (req, res) => {
  const context = parse(scope, req.query);
  const problem = await studentProblem(req.user!, context.batchCourseId, context.problemId);
  const items = await AiConversation.find({ ...context, chapterId: problem.chapterId, workload, userId: String(req.user!._id), expiresAt: { $gt: new Date() } }, 'language level updatedAt').sort({ updatedAt: -1 }).limit(30).lean();
  res.json({ items });
});

studentAi.post('/conversations', async (req, res) => {
  const { language: lang, ...context } = parse(scope.extend({ language }), req.body);
  const userId = String(req.user!._id);
  const problem = await studentProblem(req.user!, context.batchCourseId, context.problemId);
  const config = await settings(workload);
  if (!problem.allowed || !config.enabled) throw forbidden('AI is disabled for this practice context.');
  if (!(await takeToken(`ai:new:${userId}`, 4, 4, true))) throw limited();
  const doc = await AiConversation.create({ ...context, workload, userId, language: lang, batchId: problem.batchId,
    chapterId: problem.chapterId, courseId: problem.courseId, level: 0, turns: [], expiresAt: new Date(Date.now() + config.limits.retention * 86400000) });
  res.status(201).json({ _id: doc._id, language: lang, level: 0, turns: [] });
});

async function conversation(user: Parameters<typeof studentProblem>[0], id: string) {
  const doc = await AiConversation.findOne({ _id: id, workload, userId: String(user._id), expiresAt: { $gt: new Date() } }).lean();
  if (!doc?.batchCourseId || !doc.problemId) throw notFound('Conversation not found');
  const problem = await studentProblem(user, doc.batchCourseId, doc.problemId);
  if (doc.chapterId !== problem.chapterId) throw notFound('Conversation not found');
  return { doc, problem };
}

studentAi.get('/conversations/:id', async (req, res) => {
  const { doc } = await conversation(req.user!, parse(objectId, req.params.id));
  res.json({ _id: doc._id, language: doc.language, level: doc.level, turns: doc.turns });
});

studentAi.delete('/conversations/:id', async (req, res) => {
  const { doc, problem } = await conversation(req.user!, parse(objectId, req.params.id));
  if (!problem.allowed || !(await settings(workload)).enabled) throw forbidden('This conversation is read-only.');
  await AiConversation.deleteOne({ _id: doc._id });
  res.status(204).end();
});

studentAi.post('/conversations/:id/messages', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { requestKey, consent: _consent, ...form } = parse(message, req.body);
  const user = req.user!;
  const userId = String(user._id);
  const result = await withLease(`ai:student-turn:${userId}`, 90_000, async (lease) => {
    const started = Date.now();
    const { doc, problem } = await conversation(user, id);
    if (!problem.allowed || !problem.catalogId) throw forbidden('AI is disabled for this practice context.');
    const config = await settings(workload);
    if (!config.enabled) throw forbidden('Student AI is disabled.');
    const daily = problem.daily ?? config.limits.daily;
    const remaining = await allowance(userId, daily);
    const previous = doc.turns.find((turn) => turn.requestKey === requestKey);
    if (previous) return { turn: previous, level: doc.level, remaining };
    if (!remaining || !(await takeToken(`ai:student-admission:${userId}`, config.limits.minute, config.limits.minute, true))) throw limited();
    if ((form.code?.length ?? 0) > config.limits.code) throw badRequest('Student code exceeds the configured limit');
    if (doc.turns.length >= 100) throw conflict('Start a fresh conversation to continue.');
    const level = doc.level ?? 0;
    if (form.mode === 'Hint' && level >= 4) throw conflict('All four hint levels have been used. Try reviewing your attempt.');
    const nextLevel = form.mode === 'Hint' ? level + 1 : level;
    const hint = form.mode === 'Hint' ? await AiHint.findOne({ catalogId: problem.catalogId, level: nextLevel, status: 'PUBLISHED',
      courseId: problem.courseId, language: doc.language }).lean() : null;
    const sensitive = [user.rollNumber, user.fullName, user.email, user.mobile].filter((value): value is string => typeof value === 'string' && value.length > 4);
    const clean = (value: string) => redact(sensitive.reduce((text, item) => text.replaceAll(item, '[redacted personal detail]'), value));
    const input = Object.fromEntries(Object.entries(form).map(([field, value]) => [field, typeof value === 'string' ? clean(value) : value]));
    const attribution = { userId, role: user.role, collegeId: user.collegeId ? String(user.collegeId) : undefined, action: form.mode, requestKey, referenceId: id,
      batchId: problem.batchId, courseId: problem.courseId, chapterId: problem.chapterId, problemId: problem.problemId };
    const authorize = async () => {
      const current = await studentProblem(user, doc.batchCourseId!, doc.problemId!);
      if (!current.allowed || !(await settings(workload)).enabled) throw forbidden('AI is disabled for this practice context.');
    };
    let answer;
    if (hint?.text) {
      await authorize();
      answer = { ...fallback, diagnosis: '', explanation: hint.text, question: '', nextAction: 'Try applying this hint to your attempt.' };
      await AiUsage.create({ ...attribution, workload, status: 'SUCCESS', local: true, outbound: false, finishedAt: new Date() });
    } else {
      const { title, number, difficulty, topics, course, chapter } = problem;
      const asksForAnswers = /ignore.{0,40}(instruction|previous)|(?:full|complete|accepted|reference|optimal)\s+(?:code|solution|implementation|pseudocode)|system prompt|staff (?:answer|preparation)/i.test(form.question ?? '');
      if (asksForAnswers && await configuredProvider(workload, config)) {
        await authorize();
        answer = fallback;
        await AiUsage.create({ ...attribution, workload, status: 'SUCCESS', local: true, outbound: false, finishedAt: new Date() });
      } else {
        const history = doc.turns.slice(-config.limits.history).map((turn) => ({ mode: turn.mode, guidance: turn.answer }));
        answer = (await completion(workload, attribution, studentPrompt, {
          problem: { title, number, difficulty, topics, course, chapter }, language: doc.language, input, history,
          hintLevel: nextLevel, hintStages: ['Understanding', 'Observation', 'Direction', 'Refinement'],
        }, safeGuidance, undefined, authorize, guidance)).content;
      }
    }
    const turn = { requestKey, mode: form.mode, question: input.question, answer, at: new Date() };
    await withFencedWrite(lease, async (session) => {
      const saved = await AiConversation.updateOne({ _id: id, userId, expiresAt: { $gt: new Date() } }, { $push: { turns: turn }, $set: { level: nextLevel } }, { session });
      if (!saved.matchedCount) throw notFound('Conversation not found');
      await countSuccess(userId, session, started);
    });
    return { turn, level: nextLevel, remaining: remaining - 1 };
  });
  if (!result) throw limited('An assistance request is already in progress.');
  res.json(result);
});
