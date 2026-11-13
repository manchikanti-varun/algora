import { z } from 'zod';
import { isIP } from 'node:net';
import { idSchema, type Page } from '../administration/contracts.js';
import type {
  LearningUnit,
  BatchRecord,
  Snapshot,
} from '../learning/contracts.js';
export const platforms = ['LEETCODE', 'CODEFORCES', 'CODECHEF'] as const;
export const languages = ['JAVA', 'PYTHON', 'CPP', 'JAVASCRIPT'] as const;
export const dayStatuses = [
  'DRAFT',
  'SCHEDULED',
  'PUBLISHED',
  'UNPUBLISHED',
] as const;
export const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),
      'Control characters are not allowed',
    );
export function safeHttps(value: string) {
  try {
    const u = new URL(value),
      host = u.hostname.replace(/^\[|\]$/g, '');
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      (u.port && u.port !== '443') ||
      isIP(host) ||
      !host.includes('.') ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
const https = z
  .string()
  .trim()
  .max(2048)
  .refine(
    safeHttps,
    'Use a public HTTPS URL without credentials or a private host',
  );
export function canonicalProblem(
  platform: (typeof platforms)[number],
  value: string,
) {
  if (!safeHttps(value)) throw new Error('Invalid problem URL');
  const u = new URL(value);
  if (u.search || u.hash || /%/.test(u.pathname))
    throw new Error(
      'Problem links must not contain redirects, query parameters or encoded paths',
    );
  let id = '',
    url = '';
  if (
    platform === 'LEETCODE' &&
    ['leetcode.com', 'www.leetcode.com'].includes(u.hostname)
  ) {
    const m =
      /^\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/description)?\/?$/.exec(
        u.pathname,
      );
    if (m) {
      id = m[1]!;
      url = 'https://leetcode.com/problems/' + id + '/';
    }
  }
  if (
    platform === 'CODEFORCES' &&
    ['codeforces.com', 'www.codeforces.com'].includes(u.hostname)
  ) {
    const m =
      /^\/(?:problemset\/problem\/(\d{1,9})\/([A-Za-z][A-Za-z0-9]{0,3})|contest\/(\d{1,9})\/problem\/([A-Za-z][A-Za-z0-9]{0,3}))\/?$/.exec(
        u.pathname,
      );
    if (m) {
      const contest = String(Number(m[1] ?? m[3])),
        index = (m[2] ?? m[4])!.toUpperCase();
      if (Number(contest) > 0) {
        id = contest + '-' + index;
        url =
          'https://codeforces.com/problemset/problem/' + contest + '/' + index;
      }
    }
  }
  if (
    platform === 'CODECHEF' &&
    ['codechef.com', 'www.codechef.com'].includes(u.hostname)
  ) {
    const m = /^\/(?:[A-Za-z0-9_-]+\/)?problems\/([A-Za-z0-9_]{1,40})\/?$/.exec(
      u.pathname,
    );
    if (m) {
      id = m[1]!.toUpperCase();
      url = 'https://www.codechef.com/problems/' + id;
    }
  }
  if (!id) throw new Error('Use a supported official problem URL');
  return { platformProblemId: id, url };
}
const problemObject = z
  .object({
    platform: z.enum(platforms),
    platformProblemId: text(1, 100).optional(),
    title: text(2, 180),
    url: https,
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'UNKNOWN']),
    topics: z.array(text(1, 60)).max(30).default([]),
    description: text(0, 10000).default(''),
    ownerCollegeId: idSchema.nullable().default(null),
  })
  .strict();
export const problemInput = problemObject.transform((v, ctx) => {
  try {
    const canonical = canonicalProblem(v.platform, v.url);
    if (
      v.platformProblemId &&
      v.platformProblemId !== canonical.platformProblemId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Problem ID does not match the canonical URL',
      });
      return z.NEVER;
    }
    return { ...v, ...canonical };
  } catch (e) {
    ctx.addIssue({
      code: 'custom',
      message: e instanceof Error ? e.message : 'Invalid problem URL',
    });
    return z.NEVER;
  }
});
export const problemPatch = problemObject
  .extend({ expectedRevision: z.number().int().nonnegative() })
  .transform((v, ctx) => {
    const parsed = problemInput.safeParse(
      Object.fromEntries(
        Object.entries(v).filter(([k]) => k !== 'expectedRevision'),
      ),
    );
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: 'custom',
          message: issue.message,
          path: issue.path,
        });
      return z.NEVER;
    }
    return { ...parsed.data, expectedRevision: v.expectedRevision };
  });
const uid = z.uuid();
const distinct = (rows: { id: string }[]) =>
  new Set(rows.map((r) => r.id)).size === rows.length;
const topic = z
  .object({
    id: uid,
    title: text(1, 160),
    description: text(0, 4000).default(''),
    estimatedMinutes: z
      .number()
      .int()
      .min(1)
      .max(1440)
      .nullable()
      .default(null),
  })
  .strict();
const resource = z
  .object({
    id: uid,
    title: text(1, 180),
    type: z.enum(['ARTICLE', 'VIDEO', 'DOCUMENT', 'NOTES', 'EXTERNAL_LINK']),
    description: text(0, 2000).default(''),
    url: https.nullable().default(null),
    notes: text(0, 15000).default(''),
    visibility: z.enum(['STUDENT', 'INSTRUCTOR_ONLY']).default('STUDENT'),
  })
  .strict()
  .refine(
    (v) => (v.type === 'NOTES' ? v.notes.length > 0 : !!v.url),
    'Notes require text; external resources require HTTPS URLs',
  );
const assignment = z
  .object({
    problemId: idSchema,
    category: z.enum(['REQUIRED', 'OPTIONAL', 'CHALLENGE']),
    instructorNote: text(0, 2000).default(''),
    editorialId: idSchema.nullable().default(null),
    editorialVisibility: z.enum(['HIDDEN', 'VISIBLE']).default('HIDDEN'),
  })
  .strict();
export const dayInput = z
  .object({
    dayNumber: z.number().int().min(1).max(1000000000),
    title: text(2, 180),
    description: text(0, 12000).default(''),
    learningObjectives: z.array(text(1, 500)).max(50).default([]),
    topics: z
      .array(topic)
      .max(100)
      .refine(distinct, 'Duplicate topic IDs')
      .default([]),
    resources: z
      .array(resource)
      .max(100)
      .refine(distinct, 'Duplicate resource IDs')
      .default([]),
    problemAssignments: z
      .array(assignment)
      .max(100)
      .refine(
        (v) => new Set(v.map((p) => p.problemId)).size === v.length,
        'Duplicate problem assignments',
      )
      .default([]),
    publicationStatus: z.enum(dayStatuses).default('DRAFT'),
    publishAt: z.iso
      .datetime({ offset: true })
      .transform((v) => new Date(v).toISOString())
      .nullable()
      .default(null),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) => v.publicationStatus !== 'SCHEDULED' || !!v.publishAt,
    'Scheduled days require a publication timestamp',
  );
export type DayInput = z.infer<typeof dayInput>;
const approach = z
  .object({
    id: uid,
    title: text(1, 160),
    intuition: text(0, 15000).default(''),
    bruteForce: text(0, 15000).default(''),
    optimizedApproach: text(0, 15000).default(''),
    steps: z.array(text(1, 2000)).max(50).default([]),
    timeComplexity: text(0, 300).default(''),
    spaceComplexity: text(0, 300).default(''),
    notes: text(0, 5000).default(''),
  })
  .strict();
export const editorialBody = z
  .object({
    title: text(2, 180),
    introduction: text(0, 15000).default(''),
    approaches: z.array(approach).min(1).max(15).refine(distinct),
    examples: z
      .array(
        z
          .object({
            id: uid,
            input: text(0, 4000),
            output: text(0, 4000),
            walkthrough: text(0, 10000),
          })
          .strict(),
      )
      .max(20)
      .refine(distinct)
      .default([]),
    codeSolutions: z
      .array(
        z
          .object({
            id: uid,
            approachId: uid,
            language: z.enum(languages),
            code: z.string().min(1).max(20000),
          })
          .strict(),
      )
      .max(20)
      .refine(distinct)
      .default([]),
    additionalNotes: text(0, 15000).default(''),
  })
  .strict()
  .refine(
    (v) =>
      v.codeSolutions.every((c) =>
        v.approaches.some((a) => a.id === c.approachId),
      ),
    'Code solutions must reference an approach',
  )
  .refine(
    (v) =>
      new Set(v.codeSolutions.map((c) => c.approachId + ':' + c.language))
        .size === v.codeSolutions.length,
    'Duplicate language for an approach',
  )
  .refine(
    (v) => Buffer.byteLength(JSON.stringify(v), 'utf8') <= 256 * 1024,
    'Editorial exceeds 256 KiB',
  );
export const editorialInput = z
  .object({
    body: editorialBody,
    ownerCollegeId: idSchema.nullable().default(null),
  })
  .strict();
export const editorialPatch = editorialInput.extend({
  expectedRevision: z.number().int().nonnegative(),
});
export const expectedSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict();
export const draftSchema = z
  .object({ sourceRevisionId: idSchema.nullable().default(null) })
  .strict();
export const reorderSchema = z
  .object({
    dayIds: z
      .array(idSchema)
      .min(1)
      .refine((v) => new Set(v).size === v.length),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const assignmentInput = z
  .object({
    curriculumRevisionId: idSchema,
    expectedBatchRevision: z.number().int().nonnegative(),
    expectedPreviousRevisionId: idSchema.nullable(),
    impactFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reason: text(15, 1000),
    confirmed: z.literal(true),
  })
  .strict();
export const releaseInput = z
  .object({
    restricted: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
    reason: text(15, 1000),
    confirmed: z.literal(true),
  })
  .strict();
export const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    search: text(0, 100).default(''),
    platform: z.enum(platforms).optional(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'UNKNOWN']).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  })
  .strict();
export type Query = z.infer<typeof querySchema>;
export interface RevisionRecord {
  id: string;
  courseId: string;
  revisionNumber: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  revision: number;
  sourceRevisionId?: string;
  courseSnapshot?: Snapshot;
  createdBy: string;
  publishedBy?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  dayCount: number;
}
export interface DayRecord extends Omit<DayInput, 'expectedRevision'> {
  id: string;
  courseId: string;
  curriculumRevisionId: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProblemRecord extends z.infer<typeof problemInput> {
  id: string;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface EditorialRecord {
  id: string;
  problemId: string;
  versionNumber: number;
  status: 'DRAFT' | 'PUBLISHED';
  sourceEditorialId?: string;
  ownerCollegeId: string | null;
  body: z.infer<typeof editorialBody>;
  revision: number;
  createdBy: string;
  publishedBy?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface FrozenAssignment extends z.infer<typeof assignment> {
  problem: ProblemRecord;
  editorial: EditorialRecord | null;
}
export interface FrozenDay extends Omit<DayRecord, 'problemAssignments'> {
  problemAssignments: FrozenAssignment[];
}
export interface ReleaseRecord {
  id: string;
  batchId: string;
  curriculumRevisionId: string;
  dayId: string;
  restricted: boolean;
  revision: number;
  reason: string;
  updatedBy: string;
  updatedAt: string;
}
export interface AssignmentHistory {
  id: string;
  batchId: string;
  previousRevisionId: string | null;
  newRevisionId: string;
  actorUserId: string;
  reason: string;
  activeMemberships: number;
  createdAt: string;
}
export interface CurriculumUnit {
  learning: LearningUnit;
  hasAttendance(batchId: string): Promise<boolean>;
  revisions(
    course: string,
    q: Query,
    publishedOnly?: boolean,
  ): Promise<Page<RevisionRecord>>;
  revision(id: string): Promise<RevisionRecord | null>;
  nextRevision(course: string): Promise<number>;
  insertRevision(
    data: Omit<RevisionRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<RevisionRecord>;
  touchDraft(id: string, expected: number): Promise<boolean>;
  publishRevision(
    id: string,
    expected: number,
    actor: string,
    snapshot: Snapshot,
    count: number,
  ): Promise<boolean>;
  days(revision: string, q: Query): Promise<Page<DayRecord>>;
  allDays(revision: string): Promise<DayRecord[]>;
  day(id: string): Promise<DayRecord | null>;
  insertDay(
    data: Omit<DayRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<DayRecord>;
  updateDay(
    id: string,
    revisionId: string,
    data: Omit<DayInput, 'expectedRevision'>,
    actor: string,
  ): Promise<DayRecord | null>;
  removeDay(id: string, revisionId: string): Promise<void>;
  reorder(revisionId: string, ids: string[]): Promise<void>;
  freezeDay(revisionId: string, data: FrozenDay): Promise<void>;
  frozenDays(revisionId: string, q: Query): Promise<Page<FrozenDay>>;
  frozenDay(revisionId: string, number: number): Promise<FrozenDay | null>;
  frozenDayById(revisionId: string, dayId: string): Promise<FrozenDay | null>;
  allFrozenDays(revisionId: string): Promise<FrozenDay[]>;
  problems(q: Query): Promise<Page<ProblemRecord>>;
  problem(id: string): Promise<ProblemRecord | null>;
  insertProblem(
    data: Omit<ProblemRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProblemRecord>;
  updateProblem(
    id: string,
    expected: number,
    patch: Partial<ProblemRecord>,
  ): Promise<ProblemRecord | null>;
  lockProblem(id: string): Promise<boolean>;
  editorials(
    problemId: string,
    q: Query,
    owners: string[] | null,
  ): Promise<Page<EditorialRecord>>;
  editorial(id: string): Promise<EditorialRecord | null>;
  nextEditorial(problemId: string): Promise<number>;
  insertEditorial(
    data: Omit<EditorialRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<EditorialRecord>;
  updateEditorial(
    id: string,
    expected: number,
    body: EditorialRecord['body'],
  ): Promise<EditorialRecord | null>;
  publishEditorial(
    id: string,
    expected: number,
    actor: string,
  ): Promise<EditorialRecord | null>;
  releases(batch: string, revision: string): Promise<ReleaseRecord[]>;
  putRelease(
    batch: string,
    revision: string,
    day: string,
    expected: number,
    restricted: boolean,
    reason: string,
    actor: string,
  ): Promise<ReleaseRecord | null>;
  assignmentHistory(batch: string, q: Query): Promise<Page<AssignmentHistory>>;
  insertAssignmentHistory(
    data: Omit<AssignmentHistory, 'id' | 'createdAt'>,
  ): Promise<void>;
  studentBatches(
    userId: string,
    courseId: string,
    q: Query,
  ): Promise<Page<BatchRecord>>;
}
export interface CurriculumRepository {
  ensureReady(): Promise<void>;
  read: CurriculumUnit;
  transaction<T>(work: (tx: CurriculumUnit) => Promise<T>): Promise<T>;
}
