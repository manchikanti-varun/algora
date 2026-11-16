import { z } from 'zod';
import { idSchema } from '../administration/contracts.js';
import { platforms, ownershipStates } from '../coding/contracts.js';
export const analyticsQuery = z
  .object({
    collegeId: idSchema.optional(),
    courseId: idSchema.optional(),
    batchId: idSchema.optional(),
    day: z.coerce.number().int().min(1).max(1000000000).optional(),
    platform: z.enum(platforms).optional(),
    year: z.coerce.number().int().min(1).max(4).optional(),
    search: z.string().trim().max(100).default(''),
    verification: z.enum(ownershipStates).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    sort: z
      .enum([
        'roll',
        'name',
        'completion',
        'attendance',
        'lastSuccess',
        'reason',
      ])
      .default('roll'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    reason: z
      .enum([
        'REPEATED_ABSENCE',
        'LOW_COMPLETION',
        'ACCOUNT_VERIFICATION',
        'SYNC_FAILED',
        'SYNC_STALE',
        'PENDING_REGISTRATION',
        'MISSING_YEAR',
      ])
      .optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (
      !!q.from !== !!q.to ||
      (q.from &&
        q.to &&
        (Date.parse(q.to) < Date.parse(q.from) ||
          Date.parse(q.to) - Date.parse(q.from) > 366 * 86400000))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Supply both dates in order within 366 days',
      });
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuery>;
export const followUpPolicy = {
  repeatedAbsences: 2,
  minimumOpportunities: 5,
  minimumCoverage: 0.8,
  lowCompletion: 0.4,
  staleHours: 24,
} as const;
export const ratio = (n: number, d: number) => (d ? n / d : null);
export const paging = <T>(rows: T[], q: AnalyticsQuery) => ({
  items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
  total: rows.length,
  page: q.page,
  pageSize: q.pageSize,
  totalPages: Math.ceil(rows.length / q.pageSize),
});
