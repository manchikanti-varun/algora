export type Diff = 'EASY' | 'MEDIUM' | 'HARD';
/** A course in one of the student's batches ("course and batch"). */
export interface Ctx { batchCourseId: string; batchId: string; batchName: string; courseId: string; courseTitle: string }
export interface DiffCount { solved: number; total: number }
export interface ChapterProblem { slug: string; title: string; url?: string; difficulty: Diff; verified: boolean }
export interface ChapterProgress { chapterId: string; title: string; order: number; total: number; solved: number; completionPct: number | null; difficulty: Record<Diff, DiffCount>; problems: ChapterProblem[] }
export interface Dashboard {
  contexts: Ctx[];
  selected: { batchCourseId: string; batchName: string; courseTitle: string } | null;
  sync: { status: string; lastSuccessAt: string | null; possibleGap: boolean; note: string };
  summary: { accessibleProblems: number; verifiedSolved: number; completionPct: number | null; points: number; batchRank: number | null; courseRank: number | null; unlockedChapters: number; completedChapters: number; scoring: Record<Diff, number> } | null;
  difficulty: Record<Diff, DiffCount> | null;
  chapters: ChapterProgress[];
}
