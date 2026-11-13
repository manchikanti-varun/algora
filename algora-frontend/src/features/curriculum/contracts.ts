import { z } from 'zod';
export const pageSchema = <T>(schema: z.ZodType<T>) =>
  z.object({
    items: z.array(schema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });
export const revisionSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  revisionNumber: z.number(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  revision: z.number(),
  dayCount: z.number(),
  sourceRevisionId: z.string().optional(),
  publishedAt: z.string().optional(),
  courseSnapshot: z
    .object({
      title: z.string(),
      description: z.string(),
      difficulty: z.string(),
    })
    .optional(),
});
export type Revision = z.infer<typeof revisionSchema>;
const str = (max: number) => z.string().max(max);
export const problemForm = z.object({
  platform: z.enum(['LEETCODE', 'CODEFORCES', 'CODECHEF']),
  title: z.string().trim().min(2).max(180),
  url: z
    .url()
    .refine(
      (v) => v.startsWith('https://'),
      'Use an official HTTPS problem URL',
    ),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'UNKNOWN']),
  topics: z.array(z.string().trim().min(1).max(60)).max(30),
  description: str(10000),
  ownerCollegeId: z.string().nullable(),
});
export const problemSchema = problemForm.extend({
  id: z.string(),
  platformProblemId: z.string(),
  revision: z.number(),
  canManage: z.boolean().optional(),
});
export type Problem = z.infer<typeof problemSchema>;
export type ProblemForm = z.infer<typeof problemForm>;
export const approachSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  intuition: str(15000),
  bruteForce: str(15000),
  optimizedApproach: str(15000),
  steps: z.array(z.string().min(1).max(2000)).max(50),
  timeComplexity: str(300),
  spaceComplexity: str(300),
  notes: str(5000),
});
export const editorialBody = z
  .object({
    title: z.string().min(2).max(180),
    introduction: str(15000),
    approaches: z.array(approachSchema).min(1).max(15),
    examples: z
      .array(
        z.object({
          id: z.uuid(),
          input: str(4000),
          output: str(4000),
          walkthrough: str(10000),
        }),
      )
      .max(20),
    codeSolutions: z
      .array(
        z.object({
          id: z.uuid(),
          approachId: z.uuid(),
          language: z.enum(['JAVA', 'PYTHON', 'CPP', 'JAVASCRIPT']),
          code: z.string().min(1).max(20000),
        }),
      )
      .max(20),
    additionalNotes: str(15000),
  })
  .refine(
    (v) =>
      v.codeSolutions.every((c) =>
        v.approaches.some((a) => a.id === c.approachId),
      ),
    'Choose an approach for every code solution',
  );
export const editorialSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  versionNumber: z.number(),
  status: z.enum(['DRAFT', 'PUBLISHED']),
  revision: z.number(),
  ownerCollegeId: z.string().nullable(),
  body: editorialBody,
  canManage: z.boolean().optional(),
});
export type Editorial = z.infer<typeof editorialSchema>;
export const topicSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  description: str(4000),
  estimatedMinutes: z.number().int().min(1).max(1440).nullable(),
});
export const resourceSchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(180),
    type: z.enum(['ARTICLE', 'VIDEO', 'DOCUMENT', 'NOTES', 'EXTERNAL_LINK']),
    description: str(2000),
    url: z
      .url()
      .refine((v) => v.startsWith('https://'), 'Use HTTPS')
      .nullable(),
    notes: str(15000),
    visibility: z.enum(['STUDENT', 'INSTRUCTOR_ONLY']),
  })
  .refine(
    (v) => (v.type === 'NOTES' ? !!v.notes : !!v.url),
    'Notes require text; external resources require HTTPS',
  );
export const assignmentSchema = z.object({
  problemId: z.string().min(1),
  category: z.enum(['REQUIRED', 'OPTIONAL', 'CHALLENGE']),
  instructorNote: str(2000),
  editorialId: z.string().nullable(),
  editorialVisibility: z.enum(['HIDDEN', 'VISIBLE']),
});
export const dayForm = z
  .object({
    dayNumber: z.number().int().min(1).max(1000000000),
    title: z.string().min(2).max(180),
    description: str(12000),
    learningObjectives: z.array(z.string().min(1).max(500)).max(50),
    topics: z.array(topicSchema).max(100),
    resources: z.array(resourceSchema).max(100),
    problemAssignments: z.array(assignmentSchema).max(100),
    publicationStatus: z.enum([
      'DRAFT',
      'SCHEDULED',
      'PUBLISHED',
      'UNPUBLISHED',
    ]),
    publishAt: z.string().nullable(),
  })
  .refine(
    (v) => v.publicationStatus !== 'SCHEDULED' || !!v.publishAt,
    'Scheduled days require a publication time',
  )
  .refine(
    (v) =>
      new Set(v.problemAssignments.map((a) => a.problemId)).size ===
      v.problemAssignments.length,
    'Do not assign the same problem twice',
  );
export const daySchema = z.object({
  id: z.string(),
  courseId: z.string(),
  curriculumRevisionId: z.string(),
  dayNumber: z.number(),
  title: z.string(),
  description: z.string(),
  learningObjectives: z.array(z.string()),
  topics: z.array(topicSchema),
  resources: z.array(resourceSchema),
  problemAssignments: z.array(assignmentSchema.passthrough()),
  publicationStatus: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED']),
  publishAt: z.string().nullable(),
});
export type Day = z.infer<typeof daySchema>;
export type DayForm = z.infer<typeof dayForm>;
export const revisionDetail = z.object({
  revision: revisionSchema,
  days: pageSchema(daySchema),
});
export const studentDaySchema = z.object({
  id: z.string(),
  dayNumber: z.number(),
  title: z.string(),
  description: z.string(),
  learningObjectives: z.array(z.string()),
  topics: z.array(topicSchema),
  resources: z.array(z.object(resourceSchema.shape).omit({ visibility: true })),
  problemAssignments: z.array(
    z.object({
      problemId: z.string(),
      category: z.enum(['REQUIRED', 'OPTIONAL', 'CHALLENGE']),
      instructorNote: z.string(),
      problem: z.object({
        id: z.string(),
        platform: z.string(),
        platformProblemId: z.string(),
        title: z.string(),
        url: z.string(),
        difficulty: z.string(),
        topics: z.array(z.string()),
        description: z.string(),
      }),
      editorialAvailable: z.boolean(),
      editorial: z
        .object({
          id: z.string(),
          versionNumber: z.number(),
          body: editorialBody,
        })
        .optional(),
    }),
  ),
});
export type StudentDay = z.infer<typeof studentDaySchema>;
export const studentDayResponse = z.object({
  batch: z.object({ id: z.string(), name: z.string(), courseId: z.string() }),
  revision: z.object({ id: z.string(), revisionNumber: z.number() }),
  day: studentDaySchema,
});
export const studentBatchSchema = z.object({
  batch: z.object({
    id: z.string(),
    name: z.string(),
    courseId: z.string(),
    courseTitle: z.string(),
    collegeId: z.string(),
    collegeName: z.string().optional(),
  }),
  revision: z
    .object({
      id: z.string(),
      revisionNumber: z.number(),
      courseSnapshot: z
        .object({
          title: z.string(),
          description: z.string(),
          difficulty: z.string(),
        })
        .optional(),
    })
    .nullable(),
  days: pageSchema(
    z.object({
      id: z.string(),
      dayNumber: z.number(),
      title: z.string(),
      topics: z.array(z.string()),
      resourceCount: z.number(),
      problemCount: z.number(),
    }),
  ),
  message: z.string(),
});
export const batchAssignmentSchema = z.object({
  batch: z.object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    revision: z.number(),
    seatCount: z.number(),
    curriculumRevisionId: z.string().nullable().optional(),
  }),
  assignedRevision: revisionSchema.nullable(),
  options: pageSchema(revisionSchema),
  releases: z.array(
    z.object({
      id: z.string(),
      dayId: z.string(),
      restricted: z.boolean(),
      revision: z.number(),
    }),
  ),
});
export const impactSchema = z.object({
  batchId: z.string(),
  batchRevision: z.number(),
  previousRevisionId: z.string().nullable(),
  newRevisionId: z.string(),
  newDayCount: z.number(),
  activeMemberships: z.number(),
  batchStatus: z.string(),
  impactFingerprint: z.string(),
});
export const dayLabel = (n: number) => 'Day ' + String(n).padStart(2, '0');
