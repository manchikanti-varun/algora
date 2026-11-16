import { z } from 'zod';
import type { UserRecord } from '../auth/types.js';
import { AppError } from '../middleware/app-error.js';
export const permissions = [
  'college.view',
  'course.manage',
  'batch.manage',
  'student.view',
  'student.verify',
  'student.enroll',
  'attendance.manage',
  'progress.view',
  'progress.manage',
  'report.view',
] as const;
export type Permission = (typeof permissions)[number];
export const collegeStatuses = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export const requestStatuses = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export const auditActions = [
  'CODING_ACCOUNT_LINKED',
  'CODING_ACCOUNT_VERIFIED',
  'CODING_ACCOUNT_REVOKED',
  'CODING_SYNC_QUEUED',
  'CODING_SYNC_FINISHED',
  'CODING_PROGRESS_RECONCILED',
  'CODING_REPORT_EXPORTED',
  'ATTENDANCE_SESSION_CREATED',
  'ATTENDANCE_SESSION_OPENED',
  'ATTENDANCE_SESSION_CLOSED',
  'ATTENDANCE_SESSION_REOPENED',
  'ATTENDANCE_SESSION_FINALIZED',
  'ATTENDANCE_QR_MARKED',
  'ATTENDANCE_ROSTER_REFRESHED',
  'ATTENDANCE_RECORD_CORRECTED',
  'ATTENDANCE_REPORT_EXPORTED',
  'CURRICULUM_DRAFT_CREATED',
  'CURRICULUM_CLONED',
  'CURRICULUM_PUBLISHED',
  'LEARNING_DAY_CREATED',
  'LEARNING_DAY_UPDATED',
  'LEARNING_DAY_REMOVED',
  'LEARNING_DAYS_REORDERED',
  'TOPICS_UPDATED',
  'RESOURCES_UPDATED',
  'PROBLEM_ASSIGNMENTS_UPDATED',
  'PROBLEM_CREATED',
  'PROBLEM_UPDATED',
  'EDITORIAL_CREATED',
  'EDITORIAL_UPDATED',
  'EDITORIAL_PUBLISHED',
  'BATCH_CURRICULUM_ASSIGNED',
  'BATCH_CURRICULUM_UPGRADED',
  'LEARNING_DAY_RESTRICTED',
  'LEARNING_DAY_UNRESTRICTED',
  'COURSE_CREATED',
  'COURSE_UPDATED',
  'COURSE_PUBLISHED',
  'COURSE_ARCHIVED',
  'BATCH_CREATED',
  'BATCH_UPDATED',
  'BATCH_ACTIVATED',
  'BATCH_COMPLETED',
  'BATCH_ARCHIVED',
  'ENROLLMENT_CREATED',
  'PENDING_ENROLLMENT_CREATED',
  'ENROLLMENT_ACTIVATED',
  'ENROLLMENT_WITHDRAWN',
  'ENROLLMENT_TRANSFERRED',
  'BULK_IMPORT_COMPLETED',
  'IMPORT_CONFLICTS',
  'ENROLLMENT_RECONCILED',
  'ENROLLMENT_RECONCILIATION_RETRIED',
  'STUDENT_REGISTERED',
  'STUDENT_PROFILE_UPDATED',
  'STUDENT_VERIFIED',
  'STUDENT_VERIFICATION_REJECTED',
  'STUDENT_QR_ISSUED',
  'STUDENT_QR_ROTATED',
  'STUDENT_CORRECTION_REQUESTED',
  'STUDENT_CORRECTION_CANCELLED',
  'STUDENT_CORRECTION_APPROVED',
  'STUDENT_CORRECTION_REJECTED',
  'STUDENT_IDENTITY_CORRECTED',
  'SUPER_ADMIN_PROVISIONED',
  'COLLEGE_CREATED',
  'COLLEGE_UPDATED',
  'COLLEGE_STATUS_CHANGED',
  'ADMIN_REQUEST_SUBMITTED',
  'ADMIN_REQUEST_CANCELLED',
  'ADMIN_REQUEST_APPROVED',
  'ADMIN_REQUEST_REJECTED',
  'ADMIN_ROLE_GRANTED',
  'ADMIN_SUSPENDED',
  'ADMIN_REACTIVATED',
  'COLLEGE_ASSIGNED',
  'COLLEGE_ACCESS_REVOKED',
  'ADMIN_PERMISSIONS_UPDATED',
] as const;
export type CollegeStatus = (typeof collegeStatuses)[number];
export type RequestStatus = (typeof requestStatuses)[number];
export type AuditAction = (typeof auditActions)[number];
export interface CollegeRecord {
  id: string;
  name: string;
  code: string;
  slug: string;
  city: string;
  state: string;
  country: string;
  status: CollegeStatus;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface RequestRecord {
  id: string;
  requesterUserId: string;
  fullName: string;
  email: string;
  requestedCollegeIds: string[];
  reason: string;
  status: RequestStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote: string;
  internalNote: string;
  createdAt: string;
  updatedAt: string;
}
export interface AssignmentRecord {
  id: string;
  adminUserId: string;
  collegeId: string;
  permissions: Permission[];
  status: 'ACTIVE' | 'REVOKED';
  assignedBy: string;
  assignedAt: string;
  updatedBy: string;
  updatedAt: string;
}
export interface AuditRecord {
  id: string;
  actorUserId: string;
  actorName: string;
  action: AuditAction;
  targetType:
    | 'USER'
    | 'COLLEGE'
    | 'ADMIN_REQUEST'
    | 'ASSIGNMENT'
    | 'STUDENT_PROFILE'
    | 'COURSE'
    | 'BATCH'
    | 'ENROLLMENT'
    | 'IMPORT'
    | 'RECONCILIATION'
    | 'COURSE'
    | 'BATCH'
    | 'ENROLLMENT'
    | 'IMPORT'
    | 'RECONCILIATION'
    | 'CURRICULUM'
    | 'LEARNING_DAY'
    | 'CODING_PROBLEM'
    | 'EDITORIAL'
    | 'ATTENDANCE_SESSION'
    | 'CODING_ACCOUNT'
    | 'CODING_SYNC'
    | 'CODING_PROGRESS';
  targetId: string;
  collegeId?: string;
  metadata: {
    before?: string;
    after?: string;
    count?: number;
    permissions?: Permission[];
    previousPermissions?: Permission[];
  };
  requestId: string;
  createdAt: string;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
export interface ListOptions {
  page: number;
  pageSize: number;
  search: string;
  status?: string;
  sort: string;
  direction: 'asc' | 'desc';
  action?: AuditAction;
  collegeId?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}
export interface Grant {
  collegeId: string;
  permissions: Permission[];
}
export type AuditInput = Omit<AuditRecord, 'id' | 'createdAt'>;
export interface AdminUnit {
  user(id: string): Promise<UserRecord | null>;
  userBySubject(subject: string): Promise<UserRecord | null>;
  superAdmin(): Promise<UserRecord | null>;
  lockUser(id: string, version: number): Promise<boolean>;
  promote(
    id: string,
    subject: string,
    username: string,
    role: 'ADMIN' | 'SUPER_ADMIN',
    version: number,
  ): Promise<UserRecord | null>;
  changeAdmin(
    id: string,
    version: number,
    status: 'ACTIVE' | 'SUSPENDED',
  ): Promise<UserRecord | null>;
  invalidate(id: string, version: number): Promise<boolean>;
  revokeSessions(id: string): Promise<void>;
  college(id: string): Promise<CollegeRecord | null>;
  colleges(
    options: ListOptions,
    eligibleOnly?: boolean,
  ): Promise<Page<CollegeRecord>>;
  insertCollege(data: CollegeInput, actor: string): Promise<CollegeRecord>;
  updateCollege(
    id: string,
    revision: number,
    data: Partial<CollegeInput> & { status?: CollegeStatus },
    actor: string,
  ): Promise<CollegeRecord | null>;
  request(id: string): Promise<RequestRecord | null>;
  requests(
    options: ListOptions,
    requester?: string,
  ): Promise<Page<RequestRecord>>;
  pendingRequest(userId: string): Promise<RequestRecord | null>;
  insertRequest(user: UserRecord, data: RequestInput): Promise<RequestRecord>;
  reviewRequest(
    id: string,
    status: Exclude<RequestStatus, 'PENDING'>,
    actor: string,
    note: string,
    internalNote: string,
  ): Promise<RequestRecord | null>;
  assignments(adminId: string): Promise<AssignmentRecord[]>;
  putAssignment(
    adminId: string,
    grant: Grant,
    actor: string,
  ): Promise<AssignmentRecord>;
  revokeAssignment(id: string, actor: string): Promise<void>;
  admins(options: ListOptions): Promise<Page<UserRecord>>;
  audit(input: AuditInput): Promise<void>;
  audits(options: ListOptions): Promise<Page<AuditRecord>>;
  overview(): Promise<{
    totalColleges: number;
    activeColleges: number;
    totalAdmins: number;
    activeAdmins: number;
    pendingRequests: number;
    recentActivity: AuditRecord[];
  }>;
}
export interface AdminRepository {
  ensureReady(): Promise<void>;
  read: AdminUnit;
  transaction<T>(work: (unit: AdminUnit) => Promise<T>): Promise<T>;
}
export class UniqueConflict extends AppError {
  constructor(public field: string) {
    super(409, 'DUPLICATE_RECORD', 'A unique record already exists');
  }
}
export const idSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid identifier')
  .transform((value) => value.toLowerCase());
const text = (min: number, max: number, multiline = false) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (v) =>
        !(
          multiline
            ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
            : /[\u0000-\u001f\u007f]/
        ).test(v),
      'Control characters are not allowed',
    );
export const collegeInputSchema = z
  .object({
    name: text(2, 160),
    code: text(2, 30)
      .transform((v) => v.normalize('NFKD').toUpperCase().replace(/\s/g, ''))
      .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/)),
    slug: text(2, 80)
      .transform((v) => v.toLowerCase())
      .pipe(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
    city: text(0, 80).default(''),
    state: text(0, 80).default(''),
    country: text(0, 80).default(''),
  })
  .strict();
export type CollegeInput = z.infer<typeof collegeInputSchema>;
export const collegePatchSchema = collegeInputSchema
  .partial()
  .extend({ expectedRevision: z.number().int().min(0) })
  .strict()
  .refine((v) => Object.keys(v).length > 1, 'At least one field is required');
export const collegeStatusSchema = z
  .object({
    status: z.enum(collegeStatuses),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export const requestInputSchema = z
  .object({
    fullName: text(2, 160),
    collegeIds: z
      .array(idSchema)
      .min(1)
      .max(20)
      .refine(
        (v) => new Set(v).size === v.length,
        'Duplicate colleges are not allowed',
      ),
    reason: text(20, 2000, true),
  })
  .strict();
export type RequestInput = z.infer<typeof requestInputSchema>;
export const grantSchema = z
  .object({
    collegeId: idSchema,
    permissions: z
      .array(z.enum(permissions))
      .min(1)
      .max(permissions.length)
      .refine(
        (v) =>
          new Set(v).size === v.length &&
          v.includes('college.view') &&
          (!v.includes('student.verify') || v.includes('student.view')),
        'Include college.view, avoid duplicates and include student.view for student.verify',
      ),
  })
  .strict();
export const grantsSchema = z
  .array(grantSchema)
  .max(20)
  .refine(
    (v) => new Set(v.map((g) => g.collegeId)).size === v.length,
    'Duplicate assignments are not allowed',
  );
export const approveSchema = z
  .object({
    assignments: grantsSchema.refine(
      (v) => v.length > 0,
      'Select at least one college',
    ),
    reviewNote: text(0, 1000, true).default(''),
    internalNote: text(0, 1000, true).default(''),
  })
  .strict();
export const rejectSchema = z
  .object({
    reviewNote: text(10, 1000, true),
    internalNote: text(0, 1000, true).default(''),
  })
  .strict();
export const assignmentsSchema = z
  .object({
    assignments: grantsSchema,
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export const adminStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export function listSchema(kind: 'colleges' | 'requests' | 'admins' | 'audit') {
  const statuses =
    kind === 'colleges'
      ? collegeStatuses
      : kind === 'requests'
        ? requestStatuses
        : ['ACTIVE', 'SUSPENDED'];
  const sorts =
    kind === 'colleges'
      ? ['name', 'code', 'createdAt', 'status']
      : kind === 'admins'
        ? ['displayName', 'createdAt', 'accountStatus']
        : kind === 'requests'
          ? ['createdAt', 'fullName', 'status']
          : ['createdAt', 'action'];
  return z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
      search: z.string().trim().max(100).default(''),
      status: z
        .string()
        .refine((v) => statuses.includes(v as never), 'Invalid status')
        .optional(),
      sort: z
        .string()
        .refine((v) => sorts.includes(v), 'Invalid sort')
        .default('createdAt'),
      direction: z.enum(['asc', 'desc']).default('desc'),
      action: z.enum(auditActions).optional(),
      collegeId: idSchema.optional(),
      actorUserId: idSchema.optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
    })
    .strict()
    .refine(
      (v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to),
      'Invalid date range',
    );
}
export const pageDefaults: ListOptions = {
  page: 1,
  pageSize: 10,
  search: '',
  sort: 'createdAt',
  direction: 'desc',
};
export function ownRequest(record: RequestRecord) {
  const { internalNote, reviewedBy, ...safe } = record;
  void internalNote;
  void reviewedBy;
  return safe;
}
export function scopedCollege(record: CollegeRecord) {
  const { createdBy, updatedBy, ...safe } = record;
  void createdBy;
  void updatedBy;
  return safe;
}
export function adminProfile(user: UserRecord) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    username: user.username,
    role: user.role,
    accountStatus: user.accountStatus,
    revision: user.sessionVersion,
  };
}
