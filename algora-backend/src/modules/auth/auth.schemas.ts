import { z } from 'zod';
import { objectId } from '../../lib/validate';

const name = z.string().trim().min(1).max(60);
export const idTokenSchema = z.object({ idToken: z.string().min(20).max(4096) });

export const studentRegisterSchema = idTokenSchema.extend({
  firstName: name,
  lastName: name,
  rollNumber: z.string().trim().regex(/^[A-Za-z0-9]{10}$/, 'Roll number must be exactly 10 letters/digits').transform((v) => v.toUpperCase()),
  collegeId: objectId,
  mobile: z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Invalid mobile number'),
  leetcodeUsername: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Invalid LeetCode username'),
  claimCode: z.string().trim().max(64).optional(),
  /** Agreement that Algora may read this LeetCode account's public accepted submissions. */
  leetcodeConsent: z.literal(true, { message: 'Consent is required to link your LeetCode account' }),
});

export const trainerRequestSchema = idTokenSchema.extend({
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
  collegeId: objectId.optional(),
  note: z.string().trim().max(1000).optional(),
});
