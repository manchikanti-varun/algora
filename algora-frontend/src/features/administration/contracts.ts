import { z } from 'zod';
export const permissionKeys = [
  'college.view',
  'course.manage',
  'batch.manage',
  'student.view',
  'student.verify',
  'student.enroll',
  'attendance.manage',
  'report.view',
] as const;
export const permissionSchema = z.enum(permissionKeys);
export type Permission = z.infer<typeof permissionSchema>;
export const collegeSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  slug: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type College = z.infer<typeof collegeSchema>;
export const collegeOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  city: z.string().optional(),
  status: z.string().optional(),
});
export type CollegeOption = z.infer<typeof collegeOptionSchema>;
export const requestSchema = z.object({
  id: z.string(),
  requesterUserId: z.string(),
  fullName: z.string(),
  email: z.email(),
  requestedCollegeIds: z.array(z.string()),
  reason: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
  reviewNote: z.string(),
  internalNote: z.string().optional(),
  createdAt: z.string(),
  reviewedAt: z.string().optional(),
});
export type AccessRequest = z.infer<typeof requestSchema>;
export const requestDetailSchema = requestSchema.extend({
  colleges: z.array(collegeSchema),
});
export const adminSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.email(),
  username: z.string().optional(),
  role: z.string(),
  accountStatus: z.string(),
  revision: z.number(),
});
export type Admin = z.infer<typeof adminSchema>;
export const assignmentSchema = z.object({
  id: z.string(),
  adminUserId: z.string(),
  collegeId: z.string(),
  permissions: z.array(permissionSchema),
  status: z.enum(['ACTIVE', 'REVOKED']),
  assignedAt: z.string(),
  college: collegeSchema.nullable().optional(),
});
export const adminDetailSchema = z.object({
  user: adminSchema,
  assignments: z.array(assignmentSchema),
});
export const auditSchema = z.object({
  id: z.string(),
  actorUserId: z.string(),
  actorName: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  collegeId: z.string().optional(),
  createdAt: z.string(),
  requestId: z.string(),
  metadata: z.object({
    before: z.string().optional(),
    after: z.string().optional(),
    count: z.number().optional(),
    permissions: z.array(permissionSchema).optional(),
    previousPermissions: z.array(permissionSchema).optional(),
  }),
});
export type Audit = z.infer<typeof auditSchema>;
export const overviewSchema = z.object({
  totalColleges: z.number(),
  activeColleges: z.number(),
  totalAdmins: z.number(),
  activeAdmins: z.number(),
  pendingRequests: z.number(),
  recentActivity: z.array(auditSchema),
});
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });
}
export const collegeFormSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and hyphens'),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Use lowercase letters, numbers and hyphens',
    ),
  city: z.string().max(80),
  state: z.string().max(80),
  country: z.string().max(80),
});
export type CollegeForm = z.infer<typeof collegeFormSchema>;
export const requestFormSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(160),
  collegeIds: z.array(z.string()).min(1, 'Select at least one college').max(20),
  reason: z
    .string()
    .trim()
    .min(20, 'Please provide at least 20 characters')
    .max(2000),
});
export type RequestForm = z.infer<typeof requestFormSchema>;
export interface Grant {
  collegeId: string;
  permissions: Permission[];
}
