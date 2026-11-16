import { z } from 'zod';
export const platforms = ['CODEFORCES', 'LEETCODE', 'CODECHEF'] as const;
export const accountSchema = z.object({
  id: z.string(),
  platform: z.enum(platforms),
  handle: z.string(),
  status: z.enum([
    'UNLINKED',
    'PENDING_VERIFICATION',
    'VERIFIED',
    'VERIFICATION_UNAVAILABLE',
    'REVOKED',
  ]),
  active: z.boolean(),
  revision: z.number(),
  method: z.enum(['OIDC', 'UNAVAILABLE']),
  verifiedAt: z.string().nullable(),
  proofExpiresAt: z.string().nullable(),
  proofExpired: z.boolean().optional(),
  syncStatus: z.string(),
  lastCheckedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export const accountsSchema = z.object({
  syncEnabled: z.boolean().optional(),
  accounts: z.array(accountSchema),
  capabilities: z.array(
    z.object({
      platform: z.enum(platforms),
      submissions: z.boolean(),
      ownership: z.boolean(),
      reason: z.string(),
      ownershipReason: z.string(),
    }),
  ),
});
export const metricsSchema = z.object({
  assigned: z.number(),
  solved: z.number(),
  attempted: z.number(),
  unavailable: z.number(),
  verifiedCoverage: z.number(),
  completionPercent: z.number(),
});
export const progressItemSchema = z.object({
  id: z.string(),
  dayId: z.string(),
  dayNumber: z.number(),
  problemId: z.string(),
  platform: z.enum(platforms),
  problemKey: z.string(),
  title: z.string(),
  url: z.url().refine((v) => {
    const u = new URL(v);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search &&
      !u.hash &&
      ['codeforces.com', 'leetcode.com', 'www.codechef.com'].includes(
        u.hostname,
      )
    );
  }),
  status: z.enum([
    'NOT_STARTED',
    'ATTEMPTED_VERIFIED',
    'SOLVED_VERIFIED',
    'VERIFICATION_UNAVAILABLE',
  ]),
  reason: z.string().nullable(),
  solvedAt: z.string().nullable(),
  firstAttemptAt: z.string().nullable(),
  latestEvidenceId: z.string().nullable(),
  syncStatus: z.string(),
});
export const dashboardSchema = z.object({
  batchId: z.string(),
  batchName: z.string(),
  course: z.string(),
  studentProfileId: z.string(),
  enrollmentId: z.string(),
  eligibleAfter: z.string().nullable(),
  summary: metricsSchema,
  filteredSummary: metricsSchema.optional(),
  platforms: z.array(metricsSchema.extend({ platform: z.enum(platforms) })),
  days: z.array(metricsSchema.extend({ day: z.number() })),
  items: z.array(progressItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
  jobs: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      coverage: z.string(),
      error: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
});
export const matrixSchema = z.object({
  batchId: z.string(),
  batchName: z.string(),
  items: z.array(
    dashboardSchema.extend({
      id: z.string(),
      name: z.string(),
      rollNumber: z.string(),
    }),
  ),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export const batchesSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), name: z.string(), course: z.string() }),
  ),
  page: z.number(),
  totalPages: z.number(),
});
export const evidenceSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      platform: z.enum(platforms),
      providerSubmissionId: z.string(),
      problemId: z.string(),
      assignmentId: z.string(),
      handle: z.string(),
      verdict: z.string(),
      language: z.string(),
      submittedAt: z.string(),
      fetchedAt: z.string(),
      sourceUrl: z.url().refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          !u.port &&
          !u.search &&
          !u.hash &&
          u.hostname === 'codeforces.com'
        );
      }),
      sourceType: z.literal('OFFICIAL_API'),
      confidence: z.literal('TRUSTED'),
      adapterVersion: z.string(),
      accountRevision: z.number(),
    }),
  ),
});

export const analyticsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      dayNumber: z.number(),
      title: z.string(),
      platform: z.enum(platforms),
      eligibleStudents: z.number(),
      solved: z.number(),
      attempted: z.number(),
      unavailable: z.number(),
      notStarted: z.number(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});
