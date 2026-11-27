import type { Types } from 'mongoose';
import { BatchChapterAccess, BatchCourse, Batch, Chapter, Enrollment, Problem, SolveEvidence, User } from '../../models';
import { countingSources, verifiedLinkIds } from '../leetcode/evidence.repository';
import { getScoring, type Scoring } from './scoring';

type Diff = 'EASY' | 'MEDIUM' | 'HARD';
export interface ScopeProblem { slug: string; difficulty: Diff; title: string; url?: string }
export interface ChapterInfo { chapterId: string; title: string; order: number; problems: ScopeProblem[] }

/** Chapters and problems currently visible for a batch-course. Missing access record = hidden. Distinct by slug within each chapter. */
export async function visibleContent(batchCourseId: Types.ObjectId | string, courseId: Types.ObjectId | string): Promise<ChapterInfo[]> {
  const vis = await BatchChapterAccess.find({ batchCourseId, isVisible: true }, 'chapterId').lean();
  const chapters = await Chapter.find({ _id: { $in: vis.map((v) => v.chapterId) }, courseId, status: 'ACTIVE' }).sort({ order: 1 }).lean();
  const problems = await Problem.find({ chapterId: { $in: chapters.map((c) => c._id) }, status: 'ACTIVE' }).sort({ order: 1 }).lean();
  const byChapter = new Map<string, Map<string, ScopeProblem>>();
  for (const p of problems) {
    const chapterId = String(p.chapterId);
    let entries = byChapter.get(chapterId);
    if (!entries) byChapter.set(chapterId, entries = new Map());
    if (!entries.has(p.slug)) entries.set(p.slug, { slug: p.slug, difficulty: p.difficulty as Diff, title: p.title, url: p.url });
  }
  return chapters.map((c) => {
    const chapterId = String(c._id);
    return { chapterId, title: c.title, order: c.order, problems: [...(byChapter.get(chapterId)?.values() ?? [])] };
  });
}

/** A ranking scope counts each unique slug once. If a slug appears with different difficulties, the first (by chapter/problem order) wins. */
export function scopeProblems(chapterSets: ChapterInfo[][]): Map<string, ScopeProblem> {
  const m = new Map<string, ScopeProblem>();
  for (const chapters of chapterSets) for (const c of chapters) for (const p of c.problems) if (!m.has(p.slug)) m.set(p.slug, p);
  return m;
}

export interface StudentScore { studentId: string; solved: Set<string>; easy: number; medium: number; hard: number; points: number; lastVerifiedAt: Date | null }

export interface ScoreOpts { scoring?: Scoring; from?: Date; to?: Date; dateBasis?: 'verified' | 'submitted' }

/**
 * Evidence that counts: VERIFIED, counting source, belonging to the student's currently VERIFIED link, restricted to scope slugs.
 * Optional date range filters on firstVerifiedAt (when Algora first confirmed the problem).
 */
export async function scoreStudents(studentIds: Types.ObjectId[], scope: Map<string, ScopeProblem>, scoringOrOpts?: Scoring | ScoreOpts): Promise<Map<string, StudentScore>> {
  const opts: ScoreOpts = scoringOrOpts && 'EASY' in scoringOrOpts ? { scoring: scoringOrOpts } : (scoringOrOpts as ScoreOpts) ?? {};
  const sc = opts.scoring ?? (await getScoring());
  const out = new Map<string, StudentScore>(studentIds.map((id) => [String(id), { studentId: String(id), solved: new Set(), easy: 0, medium: 0, hard: 0, points: 0, lastVerifiedAt: null }]));
  if (!studentIds.length || !scope.size) return out;
  const links = await verifiedLinkIds(studentIds);
  if (!links.size) return out;
  const q: Record<string, unknown> = { linkId: { $in: [...links.values()] }, slug: { $in: [...scope.keys()] }, status: 'VERIFIED', source: { $in: countingSources() } };
  if (opts.from || opts.to) {
    const range = { ...(opts.from ? { $gte: opts.from } : {}), ...(opts.to ? { $lte: opts.to } : {}) };
    // 'verified': Algora first confirmed it in range. 'submitted': at least one OBSERVED accepted submission in range.
    if (opts.dateBasis === 'submitted') q.observedAt = { $elemMatch: range };
    else q.firstVerifiedAt = range;
  }
  const ev = await SolveEvidence.find(q, 'studentId linkId slug lastVerifiedAt').lean();
  for (const e of ev) {
    const sid = String(e.studentId);
    if (String(links.get(sid)) !== String(e.linkId)) continue;
    const s = out.get(sid)!;
    if (s.solved.has(e.slug)) continue; // each unique problem counts once
    s.solved.add(e.slug);
    if (e.lastVerifiedAt && (!s.lastVerifiedAt || e.lastVerifiedAt > s.lastVerifiedAt)) s.lastVerifiedAt = e.lastVerifiedAt;
    const d = scope.get(e.slug)!.difficulty;
    if (d === 'EASY') s.easy++; else if (d === 'MEDIUM') s.medium++; else s.hard++;
    s.points += sc[d];
  }
  return out;
}

export interface BoardRow { rank: number; studentId: string; name: string; rollNumber?: string; batch?: string; solved: number; points: number; completionPct: number | null; easy: number; medium: number; hard: number; lastSyncAt: Date | null; syncStatus: string }
export interface Board { scope: { type: 'BATCH_COURSE' | 'COURSE' | 'BATCH'; problems: number; students: number; batches?: number; note?: string }; rows: BoardRow[] }

/** Competition ranking by points (ties share a rank: 1,2,2,4). Deterministic order inside ties: solved desc, then roll number. */
export async function buildBoard(type: Board['scope']['type'], studentIds: Types.ObjectId[], scope: Map<string, ScopeProblem>, extra: { batches?: number; note?: string } = {}, includeRoll = false): Promise<Board> {
  const ids = [...new Map(studentIds.map((i) => [String(i), i])).values()];
  const [scores, users] = await Promise.all([scoreStudents(ids, scope), User.find({ _id: { $in: ids }, status: 'ACTIVE' }, 'fullName rollNumber sync').lean()]);
  const sorted = users
    .map((u) => ({ u, s: scores.get(String(u._id))! }))
    .sort((a, b) => b.s.points - a.s.points || b.s.solved.size - a.s.solved.size || (a.u.rollNumber ?? '').localeCompare(b.u.rollNumber ?? ''));
  const rows: BoardRow[] = [];
  sorted.forEach(({ u, s }, i) => {
    const rank = i > 0 && rows[i - 1].points === s.points ? rows[i - 1].rank : i + 1;
    rows.push({
      rank, studentId: String(u._id), name: u.fullName, ...(includeRoll ? { rollNumber: u.rollNumber ?? undefined } : {}), solved: s.solved.size, points: s.points,
      completionPct: scope.size ? Math.round((s.solved.size / scope.size) * 1000) / 10 : null, easy: s.easy, medium: s.medium, hard: s.hard,
      lastSyncAt: u.sync?.lastSuccessAt ?? null, syncStatus: u.sync?.status ?? 'IDLE',
    });
  });
  return { scope: { type, problems: scope.size, students: rows.length, ...extra }, rows };
}

async function enrolledIn(batchIds: (Types.ObjectId | string)[]) {
  return Enrollment.distinct('studentId', { batchId: { $in: batchIds }, status: 'ACTIVE' });
}

export async function batchCourseBoard(bcId: string, includeRoll = false): Promise<Board | null> {
  const bc = await BatchCourse.findOne({ _id: bcId, status: 'ACTIVE' }).lean();
  if (!bc) return null;
  const content = await visibleContent(bc._id, bc.courseId);
  return buildBoard('BATCH_COURSE', await enrolledIn([bc.batchId]), scopeProblems([content]), {}, includeRoll);
}

/**
 * Course-wide: only problems visible in EVERY participating batch-course are compared, so batches that have unlocked
 * different amounts are ranked on the same problem set. If a batch has nothing visible, the common set is empty.
 */
export async function courseBoard(courseId: string, includeRoll = false): Promise<Board> {
  const bcs = await BatchCourse.find({ courseId, status: 'ACTIVE' }).lean();
  const batches = await Batch.find({ _id: { $in: bcs.map((b) => b.batchId) }, status: 'ACTIVE' }, '_id').lean();
  const live = bcs.filter((b) => batches.some((x) => String(x._id) === String(b.batchId)));
  const sets = await Promise.all(live.map(async (b) => scopeProblems([await visibleContent(b._id, courseId)])));
  let common = new Map<string, ScopeProblem>();
  if (sets.length) { common = new Map(sets[0]); for (const s of sets.slice(1)) for (const k of [...common.keys()]) if (!s.has(k)) common.delete(k); }
  const board = await buildBoard('COURSE', await enrolledIn(live.map((b) => b.batchId)), common, { batches: live.length, note: 'Compared on problems unlocked in every participating batch' });
  // Batch context is advisory only: a student in two batches is shown with both, never ranked twice.
  const [enrollments, batchDocs] = await Promise.all([
    Enrollment.find({ studentId: { $in: board.rows.map((r) => r.studentId) }, batchId: { $in: live.map((b) => b.batchId) }, status: 'ACTIVE' }, 'studentId batchId').lean(),
    Batch.find({ _id: { $in: live.map((b) => b.batchId) } }, 'name').lean(),
  ]);
  const batchNames = new Map(batchDocs.map((b) => [String(b._id), b.name]));
  for (const row of board.rows) {
    row.batch = enrollments.filter((e) => String(e.studentId) === row.studentId).map((e) => batchNames.get(String(e.batchId))).filter(Boolean).join(', ') || undefined;
  }
  return board;
}

/** Combined batch: union of visible problems across all active courses, each unique slug once. */
export async function batchBoard(batchId: string, includeRoll = false): Promise<Board> {
  const bcs = await BatchCourse.find({ batchId, status: 'ACTIVE' }).lean();
  const sets = await Promise.all(bcs.map((b) => visibleContent(b._id, b.courseId)));
  return buildBoard('BATCH', await enrolledIn([batchId]), scopeProblems(sets), {}, includeRoll);
}

export function paginate<T>(rows: T[], page: number, pageSize: number) { return rows.slice((page - 1) * pageSize, page * pageSize); }

/**
 * Leaderboards are recomputed from evidence on demand. Under load every dashboard asks for the same 1-2 boards, so results are
 * memoised in-process for a few seconds. Staleness is bounded by BOARD_TTL_MS; a successful sync that adds evidence clears it
 * on the instance that ran the sync.
 */
const BOARD_TTL_MS = 10_000;
const boardCache = new Map<string, { at: number; p: Promise<Board | null> }>();
export function cachedBoard(key: string, fn: () => Promise<Board | null>): Promise<Board | null> {
  if (process.env.ALGORA_BOARD_CACHE === 'off') return fn();
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.p;
  const p = fn().catch((e) => { boardCache.delete(key); throw e; });
  boardCache.set(key, { at: Date.now(), p });
  if (boardCache.size > 2000) boardCache.delete(boardCache.keys().next().value!);
  return p;
}
export const clearBoardCache = () => boardCache.clear();
