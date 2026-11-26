import { Types } from 'mongoose';
import { Batch, BatchCourse, College, Course, Enrollment, LeetcodeLink, LeetcodeSyncJob, LeetcodeSyncLog, PendingEnrollment, User, type UserDoc } from '../../models';
import { trainerBatchIds } from '../access';
import { scopeProblems, scoreStudents, visibleContent, type ChapterInfo } from '../progress/progress.service';
import { getScoring } from '../progress/scoring';
import { displayStatus } from '../leetcode/sync-metrics';

export interface Filters {
  collegeId?: string; batchId?: string; courseId?: string; chapterId?: string; difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  /** LINKED/UNLINKED are current; the legacy values are accepted so old links keep working. */
  q?: string; verification?: 'LINKED' | 'UNLINKED' | 'VERIFIED' | 'PENDING_VERIFICATION' | 'REVALIDATION_REQUIRED'; minPct?: number; maxPct?: number;
  from?: Date; to?: Date; dateBasis?: 'verified' | 'submitted';
  /** Synchronization health filter. ATTENTION = failed, delayed, possible gap or not linked. */
  syncFilter?: 'QUEUED' | 'DELAYED' | 'FAILED' | 'GAP' | 'ATTENTION';
}

export interface PerfRow {
  studentId: string; rollNumber: string; name: string; college: string | null; batchId: string; batch: string; courseId: string; course: string; batchCourseId: string;
  easy: number; medium: number; hard: number; solved: number; accessible: number; completionPct: number | null; points: number; rank: number;
  lastVerifiedAt: Date | null; linkState: string; syncStatus: string; lastSyncAt: Date | null;
  /** Live job state (QUEUED, DELAYED, UPDATING) or the last stored outcome. */
  syncDisplay: string; nextAutoSyncAt: Date | null; possibleGap: boolean; needsAttention: boolean;
}

/** Batches the user may report on. Trainers: assigned batches only. Archived batches are excluded from analytics. */
export async function scopedBatches(u: UserDoc, f: Filters) {
  const q: Record<string, unknown> = { status: { $ne: 'ARCHIVED' } };
  if (u.role === 'TRAINER') q._id = { $in: await trainerBatchIds(u) };
  if (f.batchId) q._id = u.role === 'TRAINER' ? { $in: ((q._id as any).$in as Types.ObjectId[]).filter((id) => String(id) === f.batchId) } : f.batchId;
  if (f.collegeId) q.collegeId = f.collegeId;
  return Batch.find(q).lean();
}

/** Visible content filtered by chapter and difficulty. */
function narrow(content: ChapterInfo[], f: Filters): ChapterInfo[] {
  return content
    .filter((c) => !f.chapterId || c.chapterId === f.chapterId)
    .map((c) => ({ ...c, problems: c.problems.filter((p) => !f.difficulty || p.difficulty === f.difficulty) }));
}

const COUNTING = new Set(['LINKED', 'VERIFIED']);
const linkStates = async (ids: Types.ObjectId[]) => {
  const links = await LeetcodeLink.find({ studentId: { $in: ids }, isCurrent: true }, 'studentId status consentedAt').lean();
  // Consent withdrawal stops verification immediately, so it must also stop counting as connected in analytics.
  return new Map(links.map((l) => [String(l.studentId), COUNTING.has(l.status) && !!l.consentedAt ? 'LINKED' : 'UNLINKED']));
};

/**
 * One row per (student, batch-course). Ranking is competition ranking within the batch-course on the filtered problem set.
 * Every number comes from stored, verified evidence; nothing is extrapolated.
 */
export async function performanceRows(u: UserDoc, f: Filters): Promise<{ rows: PerfRow[]; batches: Awaited<ReturnType<typeof scopedBatches>>; contexts: { bc: any; batch: any; course: any; content: ChapterInfo[]; studentIds: Types.ObjectId[] }[] }> {
  const batches = await scopedBatches(u, f);
  const bcs = await BatchCourse.find({ batchId: { $in: batches.map((b) => b._id) }, status: 'ACTIVE', ...(f.courseId ? { courseId: f.courseId } : {}) }).lean();
  const courses = new Map((await Course.find({ _id: { $in: bcs.map((b) => b.courseId) } }, 'title').lean()).map((c) => [String(c._id), c]));
  const batchMap = new Map(batches.map((b) => [String(b._id), b]));
  const scoring = await getScoring();
  const contexts = [];
  const rows: PerfRow[] = [];
  const allIds = new Set<string>();
  for (const bc of bcs) {
    const content = narrow(await visibleContent(bc._id, bc.courseId), f);
    const scope = scopeProblems([content]);
    const studentIds = (await Enrollment.distinct('studentId', { batchId: bc.batchId, status: 'ACTIVE' })) as Types.ObjectId[];
    contexts.push({ bc, batch: batchMap.get(String(bc.batchId)), course: courses.get(String(bc.courseId)), content, studentIds });
    studentIds.forEach((i) => allIds.add(String(i)));
    const scores = await scoreStudents(studentIds, scope, { scoring, from: f.from, to: f.to, dateBasis: f.dateBasis });
    const ordered = [...scores.values()].sort((a, b) => b.points - a.points || b.solved.size - a.solved.size);
    let prev: { points: number; rank: number } | null = null;
    ordered.forEach((s, i) => {
      const rank = prev && prev.points === s.points ? prev.rank : i + 1; prev = { points: s.points, rank };
      rows.push({
        studentId: s.studentId, rollNumber: '', name: '', college: null, batchId: String(bc.batchId), batch: batchMap.get(String(bc.batchId))?.name ?? '',
        courseId: String(bc.courseId), course: courses.get(String(bc.courseId))?.title ?? '', batchCourseId: String(bc._id),
        easy: s.easy, medium: s.medium, hard: s.hard, solved: s.solved.size, accessible: scope.size,
        completionPct: scope.size ? Math.round((s.solved.size / scope.size) * 1000) / 10 : null, points: s.points, rank,
        lastVerifiedAt: s.lastVerifiedAt, linkState: 'UNLINKED', syncStatus: 'IDLE', lastSyncAt: null,
        syncDisplay: 'IDLE', nextAutoSyncAt: null, possibleGap: false, needsAttention: false,
      });
    });
  }
  const ids = [...allIds].map((i) => new Types.ObjectId(i));
  const users = new Map((await User.find({ _id: { $in: ids }, status: 'ACTIVE' }, 'fullName rollNumber collegeId sync').lean()).map((x) => [String(x._id), x]));
  const colleges = new Map((await College.find({ _id: { $in: [...users.values()].map((x) => x.collegeId).filter(Boolean) } }, 'name').lean()).map((c) => [String(c._id), c.name]));
  const links = await linkStates(ids);
  const q = f.q?.trim().toLowerCase();
  const now = new Date();
  const jobs = new Map<string, any>((await LeetcodeSyncJob.find({ studentId: { $in: ids }, status: { $in: ['QUEUED', 'RUNNING'] } }, 'studentId status runAfter dueAt attempts').lean()).map((j: any) => [String(j.studentId), j]));
  const FAILED = new Set(['SYNC_FAILED', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'ACCOUNT_NOT_FOUND', 'SUBMISSIONS_UNAVAILABLE']);
  const out = rows
    .filter((r) => users.has(r.studentId))
    .map((r) => {
      const x = users.get(r.studentId)!;
      return { ...r, name: x.fullName, rollNumber: x.rollNumber ?? '', college: x.collegeId ? colleges.get(String(x.collegeId)) ?? null : null, linkState: links.get(r.studentId) ?? 'UNLINKED', syncStatus: x.sync?.status ?? 'IDLE', lastSyncAt: x.sync?.lastSuccessAt ?? null, ...syncFlags(x.sync, jobs.get(r.studentId), links.get(r.studentId) ?? 'UNLINKED', now, FAILED) };
    })
    .filter((r) => !f.syncFilter || (f.syncFilter === 'QUEUED' ? r.syncDisplay === 'QUEUED' : f.syncFilter === 'DELAYED' ? r.syncDisplay === 'DELAYED' : f.syncFilter === 'FAILED' ? FAILED.has(r.syncDisplay) : f.syncFilter === 'GAP' ? r.possibleGap : r.needsAttention))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.rollNumber.toLowerCase().includes(q))
    .filter((r) => !f.verification || r.linkState === f.verification)
    .filter((r) => f.minPct === undefined || (r.completionPct ?? 0) >= f.minPct)
    .filter((r) => f.maxPct === undefined || (r.completionPct ?? 0) <= f.maxPct)
    .filter((r) => !f.collegeId || users.get(r.studentId)?.collegeId?.toString() === f.collegeId || batchMap.get(r.batchId)?.collegeId?.toString() === f.collegeId);
  return { rows: out, contexts, batches };
}

function syncFlags(sync: any, job: any, linkState: string, now: Date, failed: Set<string>) {
  const syncDisplay = displayStatus(job, sync?.status, now);
  const possibleGap = !!sync?.possibleGap;
  return { syncDisplay, nextAutoSyncAt: sync?.nextAutoSyncAt ?? null, possibleGap, needsAttention: syncDisplay === 'DELAYED' || failed.has(syncDisplay) || possibleGap || linkState !== 'LINKED' };
}
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export async function overview(u: UserDoc, f: Filters) {
  const { rows, contexts, batches } = await performanceRows(u, f);
  const batchIds = batches.map((batch) => batch._id);
  const [pending, enrollments, batchColleges] = await Promise.all([
    PendingEnrollment.countDocuments({ batchId: { $in: batchIds }, status: 'PENDING' }),
    Enrollment.aggregate<{ _id: Types.ObjectId; students: Types.ObjectId[] }>([
      { $match: { batchId: { $in: batchIds }, status: 'ACTIVE' } },
      { $group: { _id: '$batchId', students: { $addToSet: '$studentId' } } },
    ]),
    College.find({ _id: { $in: batches.flatMap((batch) => batch.collegeId ? [batch.collegeId] : []) } }, 'name').lean(),
  ]);
  const ids = [...new Map(enrollments.flatMap((row) => row.students).map((id) => [String(id), id])).values()];
  const [users, links] = await Promise.all([User.find({ _id: { $in: ids } }, 'sync').lean(), linkStates(ids)]);
  const allEnrolled = ids.length;
  const studentsByBatch = new Map(enrollments.map((row) => [String(row._id), row.students.length]));
  const collegeNames = new Map(batchColleges.map((college) => [String(college._id), college.name]));
  const coursesByBatch = new Map<string, Set<string>>();
  for (const { bc, course } of contexts) {
    const id = String(bc.batchId);
    const titles = coursesByBatch.get(id) ?? new Set<string>();
    if (course?.title) titles.add(course.title);
    coursesByBatch.set(id, titles);
  }
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const syncCounts: Record<string, number> = {};
  for (const x of users) { const st = x.sync?.status ?? 'IDLE'; syncCounts[st] = (syncCounts[st] ?? 0) + 1; }
  const verified = [...links.values()].filter((s) => s === 'LINKED').length;
  const withWork = rows.filter((r) => r.accessible > 0);
  const diff = { EASY: { solved: 0, available: 0 }, MEDIUM: { solved: 0, available: 0 }, HARD: { solved: 0, available: 0 } };
  for (const c of contexts) {
    const scope = scopeProblems([c.content]);
    const n = c.studentIds.length;
    for (const p of scope.values()) diff[p.difficulty].available += n;
  }
  for (const r of rows) { diff.EASY.solved += r.easy; diff.MEDIUM.solved += r.medium; diff.HARD.solved += r.hard; }

  const byBatch = new Map<string, PerfRow[]>();
  for (const r of rows) byBatch.set(r.batchId, [...(byBatch.get(r.batchId) ?? []), r]);
  const batchComparison = batches.map((b) => {
    const rs = byBatch.get(String(b._id)) ?? [];
    const w = rs.filter((r) => r.accessible > 0);
    return { batchId: String(b._id), name: b.name, status: b.status, college: collegeNames.get(String(b.collegeId)) ?? null, courses: [...(coursesByBatch.get(String(b._id)) ?? [])], students: studentsByBatch.get(String(b._id)) ?? 0, avgCompletionPct: avg(w.map((r) => r.completionPct ?? 0)), verifiedCompletions: rs.reduce((a, r) => a + r.solved, 0) };
  });
  const byCourse = new Map<string, PerfRow[]>();
  for (const r of rows) byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r]);
  const courseCompletion = [...byCourse].map(([courseId, rs]) => {
    const w = rs.filter((r) => r.accessible > 0);
    return { courseId, title: rs[0].course, rows: rs.length, avgCompletionPct: avg(w.map((r) => r.completionPct ?? 0)), completed: w.filter((r) => r.solved === r.accessible).length };
  });
  const lastJob = await LeetcodeSyncLog.findOne({ kind: 'JOB' }).sort({ startedAt: -1 }).lean();
  return {
    totals: {
      batches: batches.length, courses: new Set(contexts.map((c) => String(c.bc.courseId))).size, enrolledStudents: allEnrolled, pendingEnrollments: pending,
      registeredStudents: allEnrolled, activeStudents7d: users.filter((x) => x.sync?.lastActiveAt && x.sync.lastActiveAt.getTime() > weekAgo).length,
      accessibleProblems: contexts.reduce((a, c) => a + scopeProblems([c.content]).size, 0), verifiedCompletions: rows.reduce((a, r) => a + r.solved, 0),
      avgCompletionPct: avg(withWork.map((r) => r.completionPct ?? 0)), completedAllAvailable: withWork.filter((r) => r.solved === r.accessible).length,
      lowProgress: withWork.filter((r) => (r.completionPct ?? 0) < 25).length,
    },
    verification: { studentsInScope: allEnrolled, verifiedLinks: verified, coveragePct: allEnrolled ? Math.round((verified / allEnrolled) * 1000) / 10 : null, linkStates: countBy([...ids.map((i) => links.get(String(i)) ?? 'UNLINKED')]) },
    sync: { byStatus: syncCounts, queued: rows.filter((r, i, a) => a.findIndex((x) => x.studentId === r.studentId) === i && r.syncDisplay === 'QUEUED').length, delayed: uniqueStudents(rows, (r) => r.syncDisplay === 'DELAYED'), failed: uniqueStudents(rows, (r) => ['SYNC_FAILED', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'ACCOUNT_NOT_FOUND', 'SUBMISSIONS_UNAVAILABLE'].includes(r.syncDisplay)), possibleGaps: uniqueStudents(rows, (r) => r.possibleGap), missingUsernames: allEnrolled - verified, attention: uniqueStudents(rows, (r) => r.needsAttention), lastJob: lastJob ? { status: lastJob.status, at: lastJob.finishedAt ?? lastJob.startedAt, counts: lastJob.counts } : null },
    difficulty: diff,
    batchComparison, courseCompletion,
    needsSupport: rows.filter((r) => r.linkState !== 'LINKED' || (r.accessible > 0 && r.completionPct !== null && r.completionPct < 25 && r.syncDisplay === 'SYNC_SUCCESS' && !r.possibleGap)).sort((a, b) => (a.completionPct ?? 0) - (b.completionPct ?? 0)).slice(0, 25),
  };
}

const uniqueStudents = (rows: PerfRow[], pred: (r: PerfRow) => boolean) => new Set(rows.filter(pred).map((r) => r.studentId)).size;
const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});

/** Per chapter of each batch-course: problems, students who completed it, average completion. */
export async function chapterStats(u: UserDoc, f: Filters) {
  const { contexts } = await performanceRows(u, { ...f, q: undefined, verification: undefined, minPct: undefined, maxPct: undefined });
  const scoring = await getScoring();
  const out = [];
  for (const c of contexts) {
    for (const ch of c.content) {
      const scope = scopeProblems([[ch]]);
      const scores = await scoreStudents(c.studentIds, scope, { scoring, from: f.from, to: f.to, dateBasis: f.dateBasis });
      const pcts = [...scores.values()].map((s) => (scope.size ? (s.solved.size / scope.size) * 100 : 0));
      out.push({ batch: c.batch?.name, course: c.course?.title, batchCourseId: String(c.bc._id), chapterId: ch.chapterId, chapter: ch.title, order: ch.order, problems: scope.size, students: c.studentIds.length,
        completedStudents: [...scores.values()].filter((s) => scope.size > 0 && s.solved.size === scope.size).length, avgCompletionPct: scope.size ? avg(pcts) : null });
    }
  }
  return out;
}

/** Per problem of each batch-course: how many enrolled students have verified it. */
export async function problemStats(u: UserDoc, f: Filters) {
  const { contexts } = await performanceRows(u, { ...f, q: undefined, verification: undefined, minPct: undefined, maxPct: undefined });
  const scoring = await getScoring();
  const out = [];
  for (const c of contexts) {
    const scope = scopeProblems([c.content]);
    const scores = await scoreStudents(c.studentIds, scope, { scoring, from: f.from, to: f.to, dateBasis: f.dateBasis });
    for (const ch of c.content) for (const p of ch.problems) {
      const solved = [...scores.values()].filter((s) => s.solved.has(p.slug)).length;
      out.push({ batch: c.batch?.name, course: c.course?.title, chapter: ch.title, problem: p.title, slug: p.slug, difficulty: p.difficulty, students: c.studentIds.length, verifiedSolved: solved,
        solvedPct: c.studentIds.length ? Math.round((solved / c.studentIds.length) * 1000) / 10 : null });
    }
  }
  return out;
}
