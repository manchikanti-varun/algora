export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Batch { _id: string; name: string; description?: string; status: string; startDate?: string; endDate?: string; college?: string | null; collegeId?: string | null; studentCount?: number; courseCount?: number; pendingCount?: number; trainers?: { _id: string; fullName: string; trainerId: string }[] }
export interface Course { _id: string; title: string; description?: string; status: string; chapterCount?: number; problemCount?: number; batchCount?: number; createdAt?: string }
export interface Problem { _id: string; title: string; url: string; slug: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; order: number; status: string }
export interface Chapter { _id: string; title: string; description?: string; order: number; status: string; problems: Problem[] }
export interface CourseDetail extends Course { chapters: Chapter[] }
export interface PerfRow {
  studentId: string; rollNumber: string; name: string; college: string | null; batchId: string; batch: string; courseId: string; course: string; batchCourseId: string;
  easy: number; medium: number; hard: number; solved: number; accessible: number; completionPct: number | null; points: number; rank: number;
  lastVerifiedAt: string | null; linkState: string; syncStatus: string; lastSyncAt: string | null;
}
export interface Overview {
  totals: { batches: number; courses: number; enrolledStudents: number; pendingEnrollments: number; registeredStudents: number; activeStudents7d: number; accessibleProblems: number; verifiedCompletions: number; avgCompletionPct: number | null; completedAllAvailable: number; lowProgress: number };
  verification: { studentsInScope: number; verifiedLinks: number; coveragePct: number | null; linkStates: Record<string, number> };
  sync: { byStatus: Record<string, number>; lastJob: { status: string; at: string; counts?: Record<string, number> } | null };
  difficulty: Record<'EASY' | 'MEDIUM' | 'HARD', { solved: number; available: number }>;
  batchComparison: { batchId: string; name: string; status: string; students: number; avgCompletionPct: number | null; verifiedCompletions: number }[];
  courseCompletion: { courseId: string; title: string; rows: number; avgCompletionPct: number | null; completed: number }[];
  needsSupport: PerfRow[];
}
export interface BoardRow { rank: number; studentId?: string; name: string; rollNumber?: string; solved: number; points: number; completionPct: number | null; easy: number; medium: number; hard: number; lastSyncAt: string | null; syncStatus: string; isMe?: boolean }
export interface Board { scope: { type: string; problems: number; students: number; batches?: number; note?: string }; items: BoardRow[]; total: number; page: number; pageSize: number }
