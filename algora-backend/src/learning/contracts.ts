import { z } from 'zod';
import { idSchema, type Page } from '../administration/contracts.js';
import { rollSchema, type StudentUnit } from '../students/contracts.js';
export const courseStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const batchStatuses = [
  'DRAFT',
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
] as const;
export const enrollmentStatuses = [
  'PENDING_REGISTRATION',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export const currentStatuses = [
  'PENDING_REGISTRATION',
  'PENDING_VERIFICATION',
  'ACTIVE',
] as const;
export const sources = [
  'MANUAL',
  'BULK_PASTE',
  'CSV',
  'EXCEL',
  'TRANSFER',
] as const;
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),
      'Invalid control characters',
    );
const code = text(2, 30)
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]+$/));
export const courseSchema = z
  .object({
    title: text(3, 160),
    code,
    slug: text(2, 100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: text(10, 5000),
    shortDescription: text(0, 240).default(''),
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
    estimatedDurationDays: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .nullable()
      .default(null),
    tags: z
      .array(text(1, 30).transform((v) => v.toLowerCase()))
      .max(12)
      .transform((v) => [...new Set(v)])
      .default([]),
    scope: z.enum(['PLATFORM', 'COLLEGE']),
    ownerCollegeId: idSchema.nullable().default(null),
    sharedCollegeIds: z
      .array(idSchema)
      .max(20)
      .refine((v) => new Set(v).size === v.length)
      .default([]),
  })
  .strict()
  .refine(
    (v) =>
      v.scope === 'COLLEGE'
        ? !!v.ownerCollegeId
        : !v.ownerCollegeId && v.sharedCollegeIds.length === 0,
    'College ownership is required only for college scope',
  );
export const courseEditSchema = courseSchema.safeExtend({
  expectedRevision: z.number().int().nonnegative(),
});
export const batchSchema = z
  .object({
    courseId: idSchema,
    collegeId: idSchema,
    name: text(3, 160),
    code,
    description: text(0, 2000).default(''),
    startDate: z.iso.date().nullable().default(null),
    endDate: z.iso.date().nullable().default(null),
    capacity: z.number().int().min(1).max(10000).nullable().default(null),
  })
  .strict()
  .refine(
    (v) => !v.startDate || !v.endDate || v.startDate <= v.endDate,
    'End date must not precede start date',
  );
export const batchEditSchema = z
  .object({
    name: batchSchema.shape.name,
    code: batchSchema.shape.code,
    description: batchSchema.shape.description,
    startDate: batchSchema.shape.startDate,
    endDate: batchSchema.shape.endDate,
    capacity: batchSchema.shape.capacity,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) => !v.startDate || !v.endDate || v.startDate <= v.endDate,
    'End date must not precede start date',
  );
export const transitionSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict();
export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    search: text(0, 100).default(''),
    collegeId: idSchema.optional(),
    courseId: idSchema.optional(),
    status: z
      .enum([
        'DRAFT',
        'PUBLISHED',
        'ARCHIVED',
        'ACTIVE',
        'COMPLETED',
        'PENDING',
        'PENDING_REGISTRATION',
        'PENDING_VERIFICATION',
        'WITHDRAWN',
        'CANCELLED',
      ])
      .optional(),
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
    scope: z.enum(['PLATFORM', 'COLLEGE']).optional(),
    sort: z
      .enum(['createdAt', 'title', 'name', 'rollNumber', 'startDate'])
      .default('createdAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
export type List = z.infer<typeof listSchema>;
export type CourseInput = z.infer<typeof courseSchema>;
export interface CourseRecord extends CourseInput {
  id: string;
  status: (typeof courseStatuses)[number];
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface Snapshot {
  title: string;
  code: string;
  slug: string;
  description: string;
  difficulty: string;
  courseRevision: number;
}
export interface BatchRecord extends z.infer<typeof batchSchema> {
  curriculumRevisionId?: string | null;
  id: string;
  status: (typeof batchStatuses)[number];
  enrollmentPolicy: 'ADMIN_ROLL_ONLY';
  snapshot: Snapshot;
  seatCount: number;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface EnrollmentRecord {
  id: string;
  batchId: string;
  collegeId: string;
  rollNumber: string;
  studentProfileId?: string;
  status: (typeof enrollmentStatuses)[number];
  source: (typeof sources)[number];
  reason: string;
  createdBy: string;
  activatedAt?: string;
  withdrawnAt?: string;
  transferredFrom?: string;
  transferredTo?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface Row {
  row: number;
  value: string;
  error?: string;
}
export interface Result {
  row: number;
  rollNumber: string;
  outcome: string;
  status?: EnrollmentRecord['status'];
  reason: string;
}
export interface HistoryRecord {
  id: string;
  enrollmentId: string;
  batchId: string;
  collegeId: string;
  actorUserId: string;
  action: string;
  before?: string;
  after: string;
  reason: string;
  createdAt: string;
}
export interface ImportRecord {
  id: string;
  actorUserId: string;
  batchId: string;
  tokenHash: string;
  requestKey: string;
  source: EnrollmentRecord['source'];
  rows: Row[];
  warnings: string[];
  expiresAt: string;
  status: 'PREVIEW' | 'COMPLETED';
  results: Result[];
  createdAt: string;
}
export const manualSchema = z
  .object({
    rollNumber: rollSchema,
    requestKey: z.uuid(),
    confirmed: z.literal(true),
  })
  .strict();
export const previewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PASTE'), text: text(1, 12000) }).strict(),
  z
    .object({ kind: z.enum(['CSV', 'XLSX']), base64: z.string().max(1400000) })
    .strict(),
]);
export const importSchema = z
  .object({
    previewToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    confirmed: z.literal(true),
  })
  .strict();
export const withdrawSchema = z
  .object({
    reason: text(10, 1000),
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict();
export const transferSchema = withdrawSchema.extend({
  destinationBatchId: idSchema,
});
export interface LearningUnit {
  students: StudentUnit;
  course(id: string): Promise<CourseRecord | null>;
  courses(
    o: List,
    colleges: string[] | null,
    manageable: string[],
  ): Promise<Page<CourseRecord>>;
  insertCourse(
    data: Omit<CourseRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CourseRecord>;
  updateCourse(
    id: string,
    revision: number,
    patch: Partial<CourseRecord>,
  ): Promise<CourseRecord | null>;
  batch(id: string): Promise<BatchRecord | null>;
  batches(o: List, colleges: string[] | null): Promise<Page<BatchRecord>>;
  insertBatch(
    data: Omit<BatchRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<BatchRecord>;
  updateBatch(
    id: string,
    revision: number,
    patch: Partial<BatchRecord>,
  ): Promise<BatchRecord | null>;
  lockBatch(id: string): Promise<boolean>;
  seat(id: string, delta: 1 | -1): Promise<boolean>;
  lockCourse(id: string): Promise<boolean>;
  prior(batchId: string, roll: string): Promise<EnrollmentRecord | null>;
  profileByRoll(roll: string): ReturnType<StudentUnit['own']>;
  enrollment(id: string): Promise<EnrollmentRecord | null>;
  current(
    batchId: string,
    roll: string,
    profileId?: string,
  ): Promise<EnrollmentRecord | null>;
  enrollments(
    batchId: string,
    o: List,
    history: boolean,
  ): Promise<Page<EnrollmentRecord>>;
  ownEnrollments(profileId: string, o: List): Promise<Page<EnrollmentRecord>>;
  insertEnrollment(
    data: Omit<EnrollmentRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<EnrollmentRecord>;
  updateEnrollment(
    id: string,
    revision: number,
    patch: Partial<EnrollmentRecord>,
  ): Promise<EnrollmentRecord | null>;
  history(data: Omit<HistoryRecord, 'id' | 'createdAt'>): Promise<void>;
  histories(batchId: string, o: List): Promise<Page<HistoryRecord>>;
  importByHash(hash: string): Promise<ImportRecord | null>;
  importByKey(
    actor: string,
    batch: string,
    key: string,
  ): Promise<ImportRecord | null>;
  insertImport(
    data: Omit<ImportRecord, 'id' | 'createdAt'>,
  ): Promise<ImportRecord>;
  completeImport(id: string, results: Result[]): Promise<void>;
  reconciliationRows(
    kind: string,
    target: string,
    cursor: string,
  ): Promise<EnrollmentRecord[]>;
}
export interface LearningRepository {
  ensureReady(): Promise<void>;
  read: LearningUnit;
  transaction<T>(work: (tx: LearningUnit) => Promise<T>): Promise<T>;
}
