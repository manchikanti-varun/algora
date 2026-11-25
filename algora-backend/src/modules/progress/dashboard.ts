import type { Types } from 'mongoose';
import { BatchCourse, SolveEvidence, User } from '../../models';
import { countingSources, verifiedLinkIds } from '../leetcode/evidence.repository';
import { linkView } from '../leetcode/links.service';
import { studentContexts } from '../student/contexts';
import { batchBoard, batchCourseBoard, cachedBoard, courseBoard, scopeProblems, scoreStudents, visibleContent } from './progress.service';
import { getScoring } from './scoring';

export async function buildDashboard(studentId: Types.ObjectId, batchCourseId?: string) {
  const ctxs = await studentContexts(studentId);
  const contexts = ctxs.map((c) => ({ batchCourseId: String(c.bc._id), batchId: String(c.bc.batchId), batchName: c.batchName, courseId: String(c.course._id), courseTitle: c.course.title }));
  const ctx = ctxs.find((c) => String(c.bc._id) === batchCourseId) ?? (batchCourseId ? null : ctxs[0]);
  const user = await User.findById(studentId, 'sync leetcodeUsername').lean();
  const link = await linkView(studentId);
  const sync = {
    status: user?.sync?.status ?? 'IDLE', lastSuccessAt: user?.sync?.lastSuccessAt ?? null, possibleGap: !!user?.sync?.possibleGap, hasUsername: !!user?.leetcodeUsername, link,
    note: 'Problems are verified from accepted LeetCode submissions seen by Algora. A problem that is not shown as solved may still have been solved: it is simply not verified.',
  };
  if (!ctx) return { contexts, selected: null, sync, summary: null, chapters: [], difficulty: null };

  const content = await visibleContent(ctx.bc._id, ctx.bc.courseId);
  const scope = scopeProblems([content]);
  const scoring = await getScoring();
  const score = (await scoreStudents([studentId], scope, scoring)).get(String(studentId))!;
  const total = { EASY: 0, MEDIUM: 0, HARD: 0 };
  for (const p of scope.values()) total[p.difficulty]++;

  const chapters = content.map((c) => {
    const solved = c.problems.filter((p) => score.solved.has(p.slug));
    const by = (d: string, list = c.problems) => list.filter((p) => p.difficulty === d).length;
    return {
      chapterId: c.chapterId, title: c.title, order: c.order, total: c.problems.length, solved: solved.length,
      completionPct: c.problems.length ? Math.round((solved.length / c.problems.length) * 1000) / 10 : null,
      difficulty: { EASY: { solved: by('EASY', solved), total: by('EASY') }, MEDIUM: { solved: by('MEDIUM', solved), total: by('MEDIUM') }, HARD: { solved: by('HARD', solved), total: by('HARD') } },
      problems: c.problems.map((p) => ({ ...p, verified: score.solved.has(p.slug) })),
    };
  });
  const [bcBoard, cBoard] = await Promise.all([
    cachedBoard(`bc:${ctx.bc._id}`, () => batchCourseBoard(String(ctx.bc._id))),
    cachedBoard(`c:${ctx.course._id}`, () => courseBoard(String(ctx.course._id))),
  ]);
  // Unranked until at least one problem is verified: a rank with zero verified evidence would misrepresent standing.
  const rankIn = (b: { rows: { studentId: string; rank: number; points: number }[] } | null) => { const r = b?.rows.find((x) => x.studentId === String(studentId)); return r && r.points > 0 ? r.rank : null; };
  return {
    contexts,
    selected: { batchCourseId: String(ctx.bc._id), batchName: ctx.batchName, courseTitle: ctx.course.title },
    sync,
    summary: {
      accessibleProblems: scope.size, verifiedSolved: score.solved.size,
      completionPct: scope.size ? Math.round((score.solved.size / scope.size) * 1000) / 10 : null, // null when nothing is unlocked
      points: score.points, batchRank: rankIn(bcBoard), courseRank: cBoard?.scope.problems ? rankIn(cBoard) : null,
      unlockedChapters: chapters.length, completedChapters: chapters.filter((c) => c.total > 0 && c.solved === c.total).length,
      scoring,
    },
    difficulty: { EASY: { solved: score.easy, total: total.EASY }, MEDIUM: { solved: score.medium, total: total.MEDIUM }, HARD: { solved: score.hard, total: total.HARD } },
    chapters,
  };
}

/** Verified evidence list for the student's own history view (current verified link only). */
export async function verifiedHistory(studentId: Types.ObjectId) {
  const link = (await verifiedLinkIds([studentId])).get(String(studentId));
  if (!link) return [];
  const ev = await SolveEvidence.find({ studentId, linkId: link, status: 'VERIFIED', source: { $in: countingSources() } } as Record<string, unknown>, 'slug title earliestObservedSolvedAt latestObservedSolvedAt firstVerifiedAt lastVerifiedAt').sort({ firstVerifiedAt: -1 }).lean();
  return ev.map((e) => ({ slug: e.slug, title: e.title, earliestObservedSolvedAt: e.earliestObservedSolvedAt ?? null, latestObservedSolvedAt: e.latestObservedSolvedAt ?? null, firstVerifiedAt: e.firstVerifiedAt ?? null, lastVerifiedAt: e.lastVerifiedAt ?? null }));
}

export { batchBoard };
export const _bc = BatchCourse;
