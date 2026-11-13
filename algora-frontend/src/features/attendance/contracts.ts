import { z } from 'zod';
export const page = <T>(item: z.ZodType<T>) =>
  z.object({
    items: z.array(item),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });
export const sessionSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  collegeId: z.string(),
  courseId: z.string(),
  curriculumRevisionId: z.string(),
  learningDayId: z.string(),
  dayNumber: z.number(),
  dayTitle: z.string(),
  batchName: z.string(),
  collegeName: z.string(),
  courseTitle: z.string(),
  sessionType: z.enum(['MORNING', 'AFTERNOON']),
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED', 'FINALIZED']),
  revision: z.number(),
  rosterCount: z.number(),
  openedAt: z.string().optional(),
  closedAt: z.string().optional(),
  finalizedAt: z.string().optional(),
});
export type AttendanceSession = z.infer<typeof sessionSchema>;
export const countsSchema = z.object({
  present: z.number(),
  absent: z.number(),
  excused: z.number(),
  unmarked: z.number(),
  total: z.number(),
});
export const detailSchema = z.object({
  session: sessionSchema,
  counts: countsSchema,
});
export const dashboardSchema = z.object({
  batch: z.object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    courseTitle: z.string(),
  }),
  revision: z.object({ id: z.string(), revisionNumber: z.number() }).nullable(),
  days: page(
    z.object({
      id: z.string(),
      dayNumber: z.number(),
      title: z.string(),
      released: z.boolean(),
      sessions: z.array(
        z.object({
          sessionType: z.enum(['MORNING', 'AFTERNOON']),
          session: sessionSchema.nullable(),
          counts: countsSchema.nullable(),
        }),
      ),
    }),
  ),
  message: z.string(),
});
export const rosterRow = z.object({
  id: z.string(),
  studentProfileId: z.string(),
  studentName: z.string(),
  rollNumber: z.string(),
  status: z.enum(['PRESENT', 'ABSENT', 'EXCUSED', 'UNMARKED']),
  record: z
    .object({
      id: z.string(),
      revision: z.number(),
      markedAt: z.string(),
      source: z.string(),
    })
    .nullable(),
});
export type RosterEntry = z.infer<typeof rosterRow>;
export const rosterSchema = z.object({
  session: sessionSchema,
  counts: countsSchema,
  rows: page(rosterRow),
});
export const historySchema = page(
  z.object({
    id: z.string(),
    action: z.string(),
    previousStatus: z.string().optional(),
    newStatus: z.string(),
    actorUserId: z.string(),
    actorName: z.string(),
    reason: z.string(),
    createdAt: z.string(),
  }),
);
export const refreshSchema = z.object({
  sessionId: z.string(),
  sessionRevision: z.number(),
  existing: z.number(),
  additions: z.number(),
  impactFingerprint: z.string(),
});
export const scanResponse = z.object({
  outcome: z.enum(['MARKED', 'ALREADY_MARKED']),
  student: z.object({ name: z.string(), rollNumber: z.string() }),
  status: z.string(),
});
export type ScanResult = z.infer<typeof scanResponse>;
export const summarySchema = z.object({
  present: z.number(),
  absent: z.number(),
  excused: z.number(),
  percentage: z.number().nullable(),
});
export const reportRow = z.object({
  sessionId: z.string(),
  studentProfileId: z.string(),
  rollNumber: z.string(),
  studentName: z.string(),
  college: z.string(),
  course: z.string(),
  batch: z.string(),
  dayNumber: z.number(),
  dayTitle: z.string(),
  sessionType: z.string(),
  sessionStatus: z.string(),
  status: z.string(),
  markedAt: z.string().nullable(),
  finalizedAt: z.string().nullable(),
  official: z.boolean(),
});
export const reportSchema = z.object({
  rows: page(reportRow),
  summary: summarySchema,
  students: page(
    summarySchema.extend({
      studentProfileId: z.string(),
      studentName: z.string(),
      rollNumber: z.string(),
    }),
  ),
  days: page(summarySchema.extend({ dayNumber: z.number() })),
  comparison: z.object({ MORNING: summarySchema, AFTERNOON: summarySchema }),
  policy: z.string(),
});
export const ownSchema = page(
  z.object({
    id: z.string(),
    dayNumber: z.number(),
    dayTitle: z.string(),
    sessionType: z.string(),
    sessionStatus: z.string(),
    status: z.string(),
    openedAt: z.string().optional(),
    markedAt: z.string().optional(),
    finalizedAt: z.string().optional(),
    official: z.boolean(),
  }),
).extend({ message: z.string() });
export const exportResponse = z.object({
  filename: z.string(),
  mime: z.string(),
  base64: z.string(),
  rowCount: z.number(),
});
export const basePath = (batch: string) => '/batches/' + batch + '/attendance';
export const dayLabel = (n: number) => 'Day ' + String(n).padStart(2, '0');
