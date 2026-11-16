import { z } from 'zod';
import parsePhoneNumber from 'libphonenumber-js/max';
export const rollSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{10}$/, 'Use exactly 10 ASCII letters or digits')
  .transform((v) => v.toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9]{10}$/, 'Exactly 10 letters or digits; no spaces'),
  );
export const nameSchema = z
  .string()
  .trim()
  .transform((v) => v.normalize('NFC').replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2)
      .max(120)
      .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, 'Enter a valid full name'),
  );
export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .refine((v) => {
    const p = v.startsWith('+')
      ? parsePhoneNumber(v, { extract: false })
      : undefined;
    return !!p?.isValid() && !p.ext;
  }, 'Include a valid +country code');
export const academicFields = {
  fullName: nameSchema,
  rollNumber: rollSchema,
  collegeId: z.string().regex(/^[a-f0-9]{24}$/i, 'Choose an active college'),
  department: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[\p{L}\p{N} &()./+-]+$/u),
  yearOfStudy: z
    .number({ error: 'Choose 1st, 2nd, 3rd or 4th Year' })
    .int()
    .min(1)
    .max(4),
};
export const contactFields = {
  phoneNumber: phoneSchema,
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
export const registrationSchema = z.object({
  ...academicFields,
  ...contactFields,
});
export type RegistrationInput = z.input<typeof registrationSchema>;
export const profileSchema = z.object({
  collegeName: z.string().optional(),
  id: z.string(),
  userId: z.string(),
  ...academicFields,
  yearOfStudy: academicFields.yearOfStudy.nullish(),
  ...contactFields,
  studentUsername: z.string(),
  verificationStatus: z.enum(['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED']),
  verificationMethod: z.string().optional(),
  verifiedAt: z.string().optional(),
  verificationNote: z.string().optional(),
  revision: z.number(),
  qrCredentialVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StudentProfile = z.infer<typeof profileSchema>;
export const meStudentSchema = z.object({
  profile: profileSchema,
  email: z.email(),
  college: z
    .object({ id: z.string(), name: z.string(), status: z.string() })
    .nullable(),
  qrIssuanceAvailable: z.boolean(),
});
export const correctionSchema = z.object({
  id: z.string(),
  studentProfileId: z.string(),
  requesterUserId: z.string(),
  sourceCollegeId: z.string(),
  requestedChanges: z.object(academicFields).partial(),
  reason: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
  profileRevision: z.number(),
  reviewNote: z.string(),
  createdAt: z.string(),
});
export type Correction = z.infer<typeof correctionSchema>;
export const optionsSchema = z.object({
  colleges: z.object({
    items: z.array(
      z.object({ id: z.string(), name: z.string(), code: z.string() }),
    ),
    page: z.number(),
    totalPages: z.number(),
    total: z.number(),
    pageSize: z.number(),
  }),
  departments: z.array(z.string()),
  qrIssuanceAvailable: z.boolean(),
});
export const pageSchema = <T>(item: z.ZodType<T>) =>
  z.object({
    items: z.array(item),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  });

export const yearLabel = (year: number | null | undefined) =>
  year
    ? (['1st Year', '2nd Year', '3rd Year', '4th Year'][year - 1] ??
      'Not provided')
    : 'Not provided';
