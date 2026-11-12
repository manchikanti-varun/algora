import { z } from 'zod';
export const roleSchema = z.enum(['STUDENT', 'ADMIN', 'SUPER_ADMIN']);
export type Role = z.infer<typeof roleSchema>;
export const userSchema = z.object({
  id: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  avatarUrl: z.url().optional(),
  role: roleSchema,
  username: z.string().optional(),
  accountStatus: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED']),
  registrationStatus: z.enum([
    'NOT_STARTED',
    'INCOMPLETE',
    'PENDING_VERIFICATION',
    'VERIFIED',
  ]),
});
export type PublicUser = z.infer<typeof userSchema>;
export const destinations = [
  '/student',
  '/student/register',
  '/student/profile',
  '/admin',
  '/super-admin',
  '/registration-required',
  '/account-pending',
  '/account-suspended',
] as const;
export const meSchema = z.object({
  user: userSchema,
  destination: z.enum(destinations),
});
export const statusSchema = z.object({
  available: z.boolean(),
  message: z.string(),
});
export const rolePaths: Record<Role, string> = {
  STUDENT: '/student',
  ADMIN: '/admin',
  SUPER_ADMIN: '/super-admin',
};
export function destinationFor(user: PublicUser) {
  if (['SUSPENDED', 'ARCHIVED'].includes(user.accountStatus))
    return '/account-suspended';
  if (
    user.role === 'STUDENT' &&
    ['NOT_STARTED', 'INCOMPLETE'].includes(user.registrationStatus)
  )
    return '/student/register';
  if (
    user.role === 'STUDENT' &&
    user.registrationStatus === 'PENDING_VERIFICATION'
  )
    return '/student/profile';
  if (
    user.accountStatus !== 'ACTIVE' ||
    (user.role === 'STUDENT' && user.registrationStatus !== 'VERIFIED')
  )
    return '/account-pending';
  return rolePaths[user.role];
}
