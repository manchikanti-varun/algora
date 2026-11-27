import { collegeLabel } from '../colleges/registry';
import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse } from '../../lib/errors';
import { objectId } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { BatchChapterAccess, CatalogProblem, Chapter, Problem } from '../../models';
import { studentContexts } from './contexts';
import { ownRequestsRouter, submitLinkRequest, submitProfileRequest } from './requests';
import { objectId as _oid, pagination as _pg } from '../../lib/validate';
import { StudentRequest, User } from '../../models';
import { audit } from '../audit/audit';
import { getScoring } from '../progress/scoring';
import { buildDashboard, verifiedHistory } from '../progress/dashboard';
import { linkView, withdrawConsent } from '../leetcode/links.service';
import { countableEvidence, purgeStudentLeetcodeData } from '../leetcode/evidence.repository';
import { batchCourseBoard, cachedBoard, clearBoardCache, paginate, scopeProblems, visibleContent } from '../progress/progress.service';
import { studentAi } from '../ai/student.routes';
import { batchAiAvailable, practice } from '../ai/context';
import { configuredProvider, settings } from '../ai/runtime';
import { AiBatch, AiConversation } from '../../models/ai';
import { studentAttendanceData } from '../attendance/attendance.service';


export const studentRouter = Router();
studentRouter.use(requireAuth, requireRole('STUDENT'));
studentRouter.use('/requests', ownRequestsRouter);
studentRouter.use('/ai', studentAi);

/** Visible chapter metadata only; problems are returned from the chapter endpoint and only when visible. */
studentRouter.get('/courses', async (req, res) => {
  const ctxs = await studentContexts(req.user!._id);
  if (!ctxs.length) return void res.json({ items: [] });
  const [contents, evidence] = await Promise.all([
    Promise.all(ctxs.map(({ bc }) => visibleContent(bc._id, bc.courseId))),
    countableEvidence(req.user!._id),
  ]);
  const verified = new Set(evidence.map((item) => item.slug));
  const items = ctxs.map(({ bc, course, batchName }, index) => {
    const content = contents[index];
    const available = scopeProblems([content]);
    const verifiedSolved = [...available.keys()].filter((slug) => verified.has(slug)).length;
    const next = content.find((chapter) => chapter.problems.some((problem) => !verified.has(problem.slug)));
    return {
      batchCourseId: bc._id, batchId: bc.batchId, batchName, courseId: course._id, title: course.title, description: course.description,
      chapters: content.map((chapter) => ({ _id: chapter.chapterId, title: chapter.title, order: chapter.order })),
      progress: { verifiedSolved, total: available.size, completionPct: available.size ? verifiedSolved / available.size * 100 : null },
      nextChapterId: next?.chapterId ?? null,
    };
  });
  res.json({ items });
});

studentRouter.get('/chapters/:chapterId', async (req, res) => {
  const chapterId = parse(objectId, req.params.chapterId);
  const { batchCourseId } = parse(z.object({ batchCourseId: objectId }), req.query);
  const ctx = (await studentContexts(req.user!._id)).find((c) => String(c.bc._id) === batchCourseId);
  const chapter = ctx && (await Chapter.findOne({ _id: chapterId, courseId: ctx.bc.courseId, status: 'ACTIVE' }).lean());
  const visible = chapter && (await BatchChapterAccess.findOne({ batchCourseId, chapterId, isVisible: true }, 'studentAiEnabled').lean());
  // Same 404 for "does not exist", "not enrolled" and "hidden": hidden content is indistinguishable from absent.
  if (!ctx || !chapter || !visible) throw notFound('Chapter not found');
  res.set('Cache-Control', 'no-store');
  const [problems, evidence, scoring, aiEnabled, history] = await Promise.all([
    Problem.find({ chapterId, status: 'ACTIVE' }, 'title url slug difficulty order catalogId')
      .sort({ order: 1, _id: 1 }).populate<{ catalogId?: { problemNumber?: number; topics: string[] } | null }>('catalogId', 'problemNumber topics').lean(),
    countableEvidence(req.user!._id),
    getScoring(),
    visible.studentAiEnabled === true ? Promise.all([
      settings('STUDENT_MENTOR'), AiBatch.findById(String(ctx.bc.batchId)).lean(),
    ]).then(async ([mentor, controls]) =>
      mentor.enabled && batchAiAvailable(controls, String(ctx.bc.courseId)) && await configuredProvider('STUDENT_MENTOR', mentor)) : false,
    AiConversation.distinct('problemId', { workload: 'STUDENT_MENTOR', userId: String(req.user!._id), batchCourseId, chapterId, expiresAt: { $gt: new Date() } }),
  ]);
  const historyIds = new Set(history);
  const unlinked = problems.filter((problem) => !problem.catalogId).map((problem) => problem.slug);
  const catalogMatches = unlinked.length ? await CatalogProblem.find({ platform: 'leetcode', slug: { $in: unlinked } }, 'slug problemNumber topics').lean() : [];
  const catalogBySlug = new Map(catalogMatches.map((item) => [item.slug, item]));
  const ev = new Map(evidence.map((e) => [e.slug, e]));
  // Navigation only between VISIBLE chapters.
  const visibleIds = (await BatchChapterAccess.find({ batchCourseId, isVisible: true }, 'chapterId').lean()).map((v) => v.chapterId);
  const siblings = await Chapter.find({ _id: { $in: visibleIds }, courseId: ctx.bc.courseId, status: 'ACTIVE' }, 'title order').sort({ order: 1 }).lean();
  const idx = siblings.findIndex((c) => String(c._id) === chapterId);
  res.json({
    chapter: { _id: chapter._id, title: chapter.title, description: chapter.description, studentAiEnabled: visible.studentAiEnabled === true, aiEnabled },
    course: { _id: ctx.course._id, title: ctx.course.title }, batchName: ctx.batchName,
    problems: problems.map(({ catalogId, ...p }) => {
      const e = ev.get(p.slug);
      const metadata = catalogId ?? catalogBySlug.get(p.slug);
      return { ...p, catalogEligible: !!metadata, hasAiHistory: historyIds.has(String(p._id)), problemNumber: metadata?.problemNumber ?? null, topics: metadata?.topics ?? [], points: scoring[p.difficulty], verified: !!e, evidence: e ? { firstVerifiedAt: e.firstVerifiedAt ?? null, lastVerifiedAt: e.lastVerifiedAt ?? null, earliestObservedSolvedAt: e.earliestObservedSolvedAt ?? null, latestObservedSolvedAt: e.latestObservedSolvedAt ?? null } : null };
    }),
    prev: idx > 0 ? { _id: siblings[idx - 1]._id, title: siblings[idx - 1].title } : null,
    next: idx >= 0 && idx < siblings.length - 1 ? { _id: siblings[idx + 1]._id, title: siblings[idx + 1].title } : null,
  });
});

// ---------- Progress, leaderboard, profile ----------

const ctxQuery = z.object({ batchCourseId: _oid.optional() });

studentRouter.get('/dashboard', async (req, res) => {
  const { batchCourseId } = parse(ctxQuery, req.query);
  const uid = req.user!._id;
  // Throttled activity marker used by the sync scheduler. Does not trigger a sync.
  const last = req.user!.sync?.lastActiveAt;
  if (!last || Date.now() - last.getTime() > 5 * 60_000) await User.updateOne({ _id: uid }, { $set: { 'sync.lastActiveAt': new Date() } });
  const [d, previousPractice] = await Promise.all([buildDashboard(uid, batchCourseId), practice(req.user!)]);
  if (batchCourseId && !d.selected) throw notFound('Context not found');
  res.json({ ...d, previousPractice });
});

studentRouter.get('/progress', async (req, res) => {
  const { batchCourseId, view } = parse(ctxQuery.extend({ view: z.literal('history').optional() }), req.query);
  if (view === 'history') {
    if (batchCourseId && !(await studentContexts(req.user!._id)).some((context) => String(context.bc._id) === batchCourseId)) {
      throw notFound('Context not found');
    }
    return void res.json({ history: await verifiedHistory(req.user!._id) });
  }
  const [d, history] = await Promise.all([buildDashboard(req.user!._id, batchCourseId), verifiedHistory(req.user!._id)]);
  if (batchCourseId && !d.selected) throw notFound('Context not found');
  res.json({ selected: d.selected, chapters: d.chapters, difficulty: d.difficulty, sync: d.sync, history });
});

studentRouter.get('/leaderboard', async (req, res) => {
  const q = parse(_pg.extend({ batchCourseId: _oid, scope: z.literal('batch-course').default('batch-course') }), req.query);
  const ctx = (await studentContexts(req.user!._id)).find((c) => String(c.bc._id) === q.batchCourseId);
  if (!ctx) throw notFound('Context not found'); // also covers contexts the student has no access to
  const board = await cachedBoard(`bc:${q.batchCourseId}`, () => batchCourseBoard(q.batchCourseId));
  if (!board) throw notFound('Context not found');
  const me = board.rows.find((r) => r.studentId === String(req.user!._id)) ?? null;
  const strip = (r: (typeof board.rows)[number]) => ({ ...r, studentId: undefined, isMe: r.studentId === String(req.user!._id) }); // never expose other students' ids
  res.json({
    scope: board.scope, page: q.page, pageSize: q.pageSize, total: board.rows.length,
    top3: board.rows.slice(0, 3).map(strip), items: paginate(board.rows, q.page, q.pageSize).map(strip), me: me && strip(me),
    note: 'Rankings use verified accepted submissions only. Students whose sync is incomplete may rank lower than their real LeetCode activity.',
  });
});

/**
 * Attendance QR. The payload is exactly the approved roll number (plain text) so any standard scanner returns it
 * verbatim. A pending roll-number change request does not affect this value: only an approved change updates it.
 * Students can read their own attendance only; there is no student-side attendance submission endpoint.
 */
studentRouter.get('/attendance/qr', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const u = await User.findById(req.user!._id, 'rollNumber fullName').lean();
  if (!u?.rollNumber) throw notFound('Your roll number has not been assigned yet. Ask your trainer.');
  res.json({ rollNumber: u.rollNumber, payload: u.rollNumber, studentName: u.fullName });
});

studentRouter.get('/attendance', async (req, res) => {
  const f = parse(z.object({
    batchId: _oid.optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sessionType: z.enum(['MORNING', 'AFTERNOON']).optional(), status: z.enum(['PRESENT', 'ABSENT']).optional(),
  }).partial(), req.query);
  res.json(await studentAttendanceData(String(req.user!._id), f));
});

studentRouter.get('/profile', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const u = await User.findById(req.user!._id, 'firstName lastName email rollNumber mobile leetcodeUsername collegeId').populate('collegeId', 'name code').lean();
  res.json({ ...u, college: collegeLabel(u?.collegeId as any), collegeId: (u?.collegeId as { _id?: unknown } | null)?._id });
});

studentRouter.patch('/profile', async (req, res) => res.status(202).json(await submitProfileRequest(req)));

studentRouter.get('/leetcode', async (req, res) => res.json(await linkView(req.user!._id)));
studentRouter.post('/leetcode/link', async (req, res) => res.status(202).json(await submitLinkRequest(req)));

/**
 * Withdraw consent AND delete: revokes every link, then removes all LeetCode-derived data for this student
 * (evidence, observed submissions, conflicts). Irreversible; audited without the deleted content.
 */
studentRouter.delete('/leetcode/data', async (req, res) => {
  parse(z.object({ confirm: z.literal('DELETE') }), req.body ?? {});
  await withdrawConsent(req.user!._id);
  const removed = await purgeStudentLeetcodeData(req.user!._id);
  await StudentRequest.updateMany({ studentId: req.user!._id, kind: 'LEETCODE' }, { $unset: { current: 1, requested: 1, previousLinkId: 1 } });
  await User.updateOne({ _id: req.user!._id }, { $unset: { 'sync.lastSuccessAt': 1, 'sync.possibleGap': 1, 'sync.coverage': 1, 'sync.lastProvider': 1 }, $set: { 'sync.status': 'IDLE' } });
  await audit(req, 'student.leetcode.data_deleted', { type: 'User', id: req.user!._id }, { ...removed });
  clearBoardCache();
  res.json({ ok: true, ...removed, link: await linkView(req.user!._id) });
});

studentRouter.delete('/leetcode/link', async (req, res) => res.status(202).json(await submitLinkRequest(req, true)));
studentRouter.delete('/leetcode/consent', async (req, res) => {
  await withdrawConsent(req.user!._id);
  await audit(req, 'student.leetcode.consent_withdrawn', { type: 'User', id: req.user!._id });
  res.json(await linkView(req.user!._id));
});
