import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse } from '../../lib/errors';
import { objectId } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { BatchChapterAccess, Chapter, Problem } from '../../models';
import { studentContexts } from './contexts';
import { objectId as _oid, pagination as _pg } from '../../lib/validate';
import { User } from '../../models';
import { audit } from '../audit/audit';
import { buildDashboard, verifiedHistory } from '../progress/dashboard';
import { linkAccount, linkView, revokeLinks } from '../leetcode/links.service';
import { countableEvidence, purgeStudentLeetcodeData } from '../leetcode/evidence.repository';
import { batchBoard, batchCourseBoard, cachedBoard, clearBoardCache, courseBoard, paginate } from '../progress/progress.service';


export const studentRouter = Router();
studentRouter.use(requireAuth, requireRole('STUDENT'));

/** Visible chapter metadata only; problems are returned from the chapter endpoint and only when visible. */
studentRouter.get('/courses', async (req, res) => {
  const ctxs = await studentContexts(req.user!._id);
  const items = [];
  for (const { bc, course, batchName } of ctxs) {
    const vis = await BatchChapterAccess.find({ batchCourseId: bc._id, isVisible: true }, 'chapterId').lean();
    const chapters = await Chapter.find({ _id: { $in: vis.map((v) => v.chapterId) }, courseId: bc.courseId, status: 'ACTIVE' }, 'title order').sort({ order: 1 }).lean();
    items.push({ batchCourseId: bc._id, batchId: bc.batchId, batchName, courseId: course._id, title: course.title, description: course.description, chapters });
  }
  res.json({ items });
});

studentRouter.get('/chapters/:chapterId', async (req, res) => {
  const chapterId = parse(objectId, req.params.chapterId);
  const { batchCourseId } = parse(z.object({ batchCourseId: objectId }), req.query);
  const ctx = (await studentContexts(req.user!._id)).find((c) => String(c.bc._id) === batchCourseId);
  const chapter = ctx && (await Chapter.findOne({ _id: chapterId, courseId: ctx.bc.courseId, status: 'ACTIVE' }).lean());
  const visible = chapter && (await BatchChapterAccess.exists({ batchCourseId, chapterId, isVisible: true }));
  // Same 404 for "does not exist", "not enrolled" and "hidden": hidden content is indistinguishable from absent.
  if (!ctx || !chapter || !visible) throw notFound('Chapter not found');
  const [problems, evidence] = await Promise.all([
    Problem.find({ chapterId, status: 'ACTIVE' }, 'title url slug difficulty order catalogId')
      .sort({ order: 1, _id: 1 }).populate<{ catalogId?: { problemNumber?: number; topics: string[] } | null }>('catalogId', 'problemNumber topics').lean(),
    countableEvidence(req.user!._id),
  ]);
  const ev = new Map(evidence.map((e) => [e.slug, e]));
  // Navigation only between VISIBLE chapters.
  const visibleIds = (await BatchChapterAccess.find({ batchCourseId, isVisible: true }, 'chapterId').lean()).map((v) => v.chapterId);
  const siblings = await Chapter.find({ _id: { $in: visibleIds }, courseId: ctx.bc.courseId, status: 'ACTIVE' }, 'title order').sort({ order: 1 }).lean();
  const idx = siblings.findIndex((c) => String(c._id) === chapterId);
  res.json({
    chapter: { _id: chapter._id, title: chapter.title, description: chapter.description },
    course: { _id: ctx.course._id, title: ctx.course.title }, batchName: ctx.batchName,
    problems: problems.map(({ catalogId, ...p }) => {
      const e = ev.get(p.slug);
      return { ...p, problemNumber: catalogId?.problemNumber ?? null, topics: catalogId?.topics ?? [], verified: !!e, evidence: e ? { firstVerifiedAt: e.firstVerifiedAt ?? null, lastVerifiedAt: e.lastVerifiedAt ?? null, earliestObservedSolvedAt: e.earliestObservedSolvedAt ?? null, latestObservedSolvedAt: e.latestObservedSolvedAt ?? null } : null };
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
  const d = await buildDashboard(uid, batchCourseId);
  if (batchCourseId && !d.selected) throw notFound('Context not found');
  res.json(d);
});

studentRouter.get('/progress', async (req, res) => {
  const { batchCourseId } = parse(ctxQuery, req.query);
  const d = await buildDashboard(req.user!._id, batchCourseId);
  if (batchCourseId && !d.selected) throw notFound('Context not found');
  res.json({ selected: d.selected, chapters: d.chapters, difficulty: d.difficulty, sync: d.sync, history: await verifiedHistory(req.user!._id) });
});

studentRouter.get('/leaderboard', async (req, res) => {
  const q = parse(_pg.extend({ batchCourseId: _oid, scope: z.enum(['batch-course', 'course', 'batch']).default('batch-course') }), req.query);
  const ctx = (await studentContexts(req.user!._id)).find((c) => String(c.bc._id) === q.batchCourseId);
  if (!ctx) throw notFound('Context not found'); // also covers contexts the student has no access to
  const board = q.scope === 'batch-course' ? await cachedBoard(`bc:${q.batchCourseId}`, () => batchCourseBoard(q.batchCourseId))
    : q.scope === 'course' ? await cachedBoard(`c:${ctx.course._id}`, () => courseBoard(String(ctx.course._id)))
    : await cachedBoard(`b:${ctx.bc.batchId}`, () => batchBoard(String(ctx.bc.batchId)));
  if (!board) throw notFound('Context not found');
  const me = board.rows.find((r) => r.studentId === String(req.user!._id)) ?? null;
  const strip = (r: (typeof board.rows)[number]) => ({ ...r, studentId: undefined, isMe: r.studentId === String(req.user!._id) }); // never expose other students' ids
  res.json({
    scope: board.scope, page: q.page, pageSize: q.pageSize, total: board.rows.length,
    top3: board.rows.slice(0, 3).map(strip), items: paginate(board.rows, q.page, q.pageSize).map(strip), me: me && strip(me),
    note: 'Rankings use verified accepted submissions only. Students whose sync is incomplete may rank lower than their real LeetCode activity.',
  });
});

studentRouter.get('/profile', async (req, res) => {
  const u = await User.findById(req.user!._id, 'firstName lastName email rollNumber mobile leetcodeUsername collegeId').populate('collegeId', 'name').lean();
  res.json({ ...u, college: (u?.collegeId as any)?.name, collegeId: undefined });
});

studentRouter.patch('/profile', async (req, res) => {
  // rollNumber, email, role, college and the LeetCode account are intentionally not editable here (see /student/leetcode).
  const b = parse(z.object({
    firstName: z.string().trim().min(1).max(60).optional(), lastName: z.string().trim().min(1).max(60).optional(),
    mobile: z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
  }).strict(), req.body);
  const u = (await User.findById(req.user!._id))!;
  Object.assign(u, b);
  if (b.firstName || b.lastName) u.fullName = `${u.firstName} ${u.lastName}`;
  await u.save();
  await audit(req, 'student.profile.update', { type: 'User', id: u._id }, { fields: Object.keys(b) });
  res.json({ ok: true });
});

// ---------- LeetCode account linking (no ownership verification) ----------
studentRouter.get('/leetcode', async (req, res) => res.json(await linkView(req.user!._id)));

/**
 * Link a username, or change it. Takes effect immediately and makes no provider request, so it also works while
 * synchronization is unavailable. A changed account starts with no counted evidence; the old account's evidence is kept.
 */
studentRouter.post('/leetcode/link', async (req, res) => {
  const { username, consent } = parse(
    z.object({ username: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Invalid LeetCode username'), consent: z.literal(true, { message: 'Consent is required' }) }).strict(),
    req.body,
  );
  const before = await linkView(req.user!._id);
  await linkAccount(req.user!._id, username, { consent });
  await audit(req, before.state === 'LINKED' ? 'student.leetcode.username_changed' : 'student.leetcode.linked', { type: 'User', id: req.user!._id }, { from: before.username, to: username });
  res.status(201).json(await linkView(req.user!._id));
});

/**
 * Withdraw consent AND delete: revokes every link, then removes all LeetCode-derived data for this student
 * (evidence, observed submissions, conflicts). Irreversible; audited without the deleted content.
 */
studentRouter.delete('/leetcode/data', async (req, res) => {
  parse(z.object({ confirm: z.literal('DELETE') }), req.body ?? {});
  const links = await revokeLinks(req.user!._id, 'STUDENT_WITHDREW_CONSENT', req.user!._id);
  const removed = await purgeStudentLeetcodeData(req.user!._id);
  await User.updateOne({ _id: req.user!._id }, { $unset: { 'sync.lastSuccessAt': 1, 'sync.possibleGap': 1, 'sync.coverage': 1, 'sync.lastProvider': 1 }, $set: { 'sync.status': 'IDLE' } });
  await audit(req, 'student.leetcode.data_deleted', { type: 'User', id: req.user!._id }, { links, ...removed });
  clearBoardCache();
  res.json({ ok: true, ...removed, link: await linkView(req.user!._id) });
});

studentRouter.delete('/leetcode/link', async (req, res) => {
  const n = await revokeLinks(req.user!._id, 'STUDENT_UNLINKED', req.user!._id);
  await audit(req, 'student.leetcode.unlink', { type: 'User', id: req.user!._id }, { links: n });
  res.json(await linkView(req.user!._id));
});
