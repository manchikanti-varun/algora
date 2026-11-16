import { z } from 'zod';
import parsePhoneNumber from 'libphonenumber-js/max';
import {
  idSchema,
  type AdminUnit,
  type Page,
} from '../administration/contracts.js';
export const verificationStatuses = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'REJECTED',
] as const;
export const departments = [
  'CSE',
  'IT',
  'ECE',
  'EEE',
  'Mechanical',
  'Civil',
  'Chemical',
  'Aerospace',
  'Biomedical',
  'Biotechnology',
  'Other',
] as const;
export const fullNameSchema = z
  .string()
  .trim()
  .transform((v) => v.normalize('NFC').replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2)
      .max(120)
      .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, 'Use a valid full name'),
  );
export const rollSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{10}$/, 'Use exactly 10 ASCII letters or digits')
  .transform((v) => v.toUpperCase())
  .pipe(
    z
      .string()
      .regex(
        /^[A-Z0-9]{10}$/,
        'Roll number must be exactly 10 ASCII letters or digits',
      ),
  );
export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .transform((v, ctx) => {
    const phone = v.startsWith('+')
      ? parsePhoneNumber(v, { extract: false })
      : undefined;
    if (!phone?.isValid() || phone.ext) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid phone number with +country code',
      });
      return z.NEVER;
    }
    return String(phone.number);
  });
export const codingFields = {
  leetCodeUsername: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,30}$/, 'Invalid LeetCode username'),
  codeforcesUsername: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{3,24}$/, 'Invalid Codeforces username'),
  codechefUsername: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{3,19}$/, 'Invalid CodeChef username'),
};
export const protectedFields = {
  fullName: fullNameSchema,
  rollNumber: rollSchema,
  collegeId: idSchema,
  department: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[\p{L}\p{N} &()./+-]+$/u, 'Invalid department'),
  yearOfStudy: z.number().int().min(1).max(4),
};
export const registerSchema = z
  .object({
    ...protectedFields,
    phoneNumber: phoneSchema,
    ...codingFields,
    confirmed: z.literal(true),
  })
  .strict();
export const editSchema = z
  .object({
    phoneNumber: phoneSchema,
    ...codingFields,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const changesSchema = z
  .object(protectedFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Select at least one correction');
const reason = z
  .string()
  .trim()
  .min(15)
  .max(1000)
  .refine(
    (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),
    'Invalid control characters',
  );
export const correctionSchema = z
  .object({
    requestedChanges: changesSchema,
    reason,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const verificationSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    method: z.literal('AUTHORIZED_MANUAL'),
    evidenceReference: reason,
    confirmed: z.literal(true),
  })
  .strict();
export const reviewSchema = z
  .object({
    reviewNote: reason,
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict();
export const rotateSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict();
export const studentListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    search: z.string().trim().max(100).default(''),
    collegeId: idSchema.optional(),
    status: z.enum(verificationStatuses).optional(),
  })
  .strict();
export type StudentList = z.infer<typeof studentListSchema>;
export type IdentityFields = z.infer<typeof changesSchema>;
export interface StudentProfileRecord extends Pick<
  z.infer<typeof registerSchema>,
  'fullName' | 'rollNumber' | 'collegeId' | 'department'
> {
  id: string;
  userId: string;
  yearOfStudy?: number;
  studentUsername: string;
  phoneNumber: string;
  leetCodeUsername: string;
  codeforcesUsername: string;
  codechefUsername: string;
  verificationStatus: (typeof verificationStatuses)[number];
  verifiedBy?: string;
  verifiedAt?: string;
  verificationMethod?: 'AUTHORIZED_MANUAL';
  verificationEvidence?: string;
  verificationNote?: string;
  qrCredentialVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Credential {
  profileId: string;
  version: number;
  tokenHash: string;
  ciphertext: string;
  nonce: string;
  tag: string;
  keyId: string;
}
export interface CorrectionRecord {
  id: string;
  studentProfileId: string;
  requesterUserId: string;
  sourceCollegeId: string;
  requestedChanges: IdentityFields;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  profileRevision: number;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote: string;
  createdAt: string;
}
export interface StudentUnit {
  admin: AdminUnit;
  profile(id: string): Promise<StudentProfileRecord | null>;
  own(userId: string): Promise<StudentProfileRecord | null>;
  profiles(
    o: StudentList,
    scope: string[] | null,
  ): Promise<Page<StudentProfileRecord>>;
  insert(
    data: Omit<StudentProfileRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<StudentProfileRecord>;
  update(
    id: string,
    revision: number,
    patch: Partial<StudentProfileRecord>,
  ): Promise<StudentProfileRecord | null>;
  registration(
    userId: string,
    status: 'PENDING_VERIFICATION' | 'VERIFIED',
  ): Promise<void>;
  lockCollege(id: string): Promise<boolean>;
  reserveRoll(roll: string, profileId: string): Promise<void>;
  rollOwner(roll: string): Promise<string | null>;
  credential(id: string): Promise<Credential | null>;
  putCredential(credential: Credential): Promise<void>;
  correction(id: string): Promise<CorrectionRecord | null>;
  corrections(
    o: StudentList,
    scope: string[] | null,
    ownId?: string,
  ): Promise<Page<CorrectionRecord>>;
  pendingCorrection(profileId: string): Promise<CorrectionRecord | null>;
  insertCorrection(
    data: Omit<CorrectionRecord, 'id' | 'createdAt'>,
  ): Promise<CorrectionRecord>;
  reviewCorrection(
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    actor: string,
    note: string,
  ): Promise<CorrectionRecord | null>;
}
export interface StudentRepository {
  ensureReady(): Promise<void>;
  read: StudentUnit;
  transaction<T>(work: (tx: StudentUnit) => Promise<T>): Promise<T>;
}
export function studentUsername(roll: string, name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 65)
    .replace(/-$/, '');
  // Non-Latin names retain their registered spelling; the username uses a safe, deterministic fallback.
  return roll.toLowerCase() + '-' + (slug || 'student');
}
export function safeProfile(p: StudentProfileRecord) {
  const { verificationEvidence, verifiedBy, ...safe } = p;
  void verificationEvidence;
  void verifiedBy;
  return safe;
}
