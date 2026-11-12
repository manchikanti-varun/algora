import { z } from 'zod';
export const courseFields = {
  title: z.string().trim().min(3).max(160),
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]+$/),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(10).max(5000),
  shortDescription: z.string().max(240),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  estimatedDurationDays: z.number().int().min(1).max(1000).nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12),
  scope: z.enum(['PLATFORM', 'COLLEGE']),
  ownerCollegeId: z.string().nullable(),
  sharedCollegeIds: z.array(z.string()).max(20),
};
export const courseFormSchema = z
  .object(courseFields)
  .refine(
    (v) => (v.scope === 'PLATFORM' ? !v.ownerCollegeId : !!v.ownerCollegeId),
    'Select a college owner',
  );
export const courseSchema = z.object({
  ...courseFields,
  id: z.string(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  revision: z.number(),
  canManage: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Course = z.infer<typeof courseSchema>;
export type CourseForm = z.infer<typeof courseFormSchema>;
export const snapshotSchema = z.object({
  title: z.string(),
  code: z.string(),
  slug: z.string(),
  description: z.string(),
  difficulty: z.string(),
  courseRevision: z.number(),
});
export const batchFormSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    code: z
      .string()
      .trim()
      .min(2)
      .max(30)
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]+$/),
    description: z.string().max(2000),
    courseId: z.string().min(1, 'Select a course'),
    collegeId: z.string().min(1, 'Select a college'),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    capacity: z.number().int().min(1).max(10000).nullable(),
  })
  .refine(
    (v) => !v.startDate || !v.endDate || v.startDate <= v.endDate,
    'End date must not precede start date',
  );
export const batchSchema = batchFormSchema.safeExtend({
  id: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED']),
  enrollmentPolicy: z.literal('ADMIN_ROLL_ONLY'),
  snapshot: snapshotSchema,
  seatCount: z.number(),
  revision: z.number(),
  canManage: z.boolean(),
  canEnroll: z.boolean(),
  canViewRoster: z.boolean(),
  canViewHistory: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Batch = z.infer<typeof batchSchema>;
export type BatchForm = z.infer<typeof batchFormSchema>;
export const enrollmentStatuses = [
  'PENDING_REGISTRATION',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export const enrollmentSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  collegeId: z.string(),
  rollNumber: z.string(),
  studentProfileId: z.string().optional(),
  status: z.enum(enrollmentStatuses),
  source: z.string(),
  reason: z.string(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  transferredFrom: z.string().optional(),
  transferredTo: z.string().optional(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;
export const resultSchema = z.object({
  row: z.number(),
  rollNumber: z.string(),
  outcome: z.string(),
  status: z.enum(enrollmentStatuses).optional(),
  reason: z.string(),
});
export type ImportResult = z.infer<typeof resultSchema>;
export const previewSchema = z.object({
  previewToken: z.string(),
  operationId: z.string(),
  expiresAt: z.string(),
  warnings: z.array(z.string()),
  results: z.array(resultSchema),
});
export const importResultSchema = z.object({
  operationId: z.string(),
  replayed: z.boolean(),
  warnings: z.array(z.string()),
  results: z.array(resultSchema),
});
export const historySchema = z.object({
  id: z.string(),
  enrollmentId: z.string(),
  action: z.string(),
  before: z.string().optional(),
  after: z.string(),
  reason: z.string(),
  createdAt: z.string(),
});
export const pageSchema = <T>(schema: z.ZodType<T>) =>
  z.object({
    items: z.array(schema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });
export const collegeOptionsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string().optional(),
      permissions: z.array(z.string()).optional(),
    }),
  ),
  total: z.number().optional(),
  totalPages: z.number().optional(),
});
