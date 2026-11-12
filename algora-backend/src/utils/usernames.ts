import { AppError } from '../middleware/errors.js';
import type { Role } from '../auth/types.js';
export function normalizeName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
export function isValidUsername(value: string, role: Role) {
  if (value.length < 5 || value.length > 80 || value !== value.toLowerCase())
    return false;
  return role === 'SUPER_ADMIN'
    ? /^sa-[a-z]+$/.test(value)
    : role === 'ADMIN'
      ? /^ad-[a-z]+$/.test(value)
      : /^[a-z0-9]+-[a-z]+(?:-[a-z]+)+$/.test(value);
}
export function assertPermanentUsername(
  previous: string | undefined,
  next: string,
) {
  if (previous && previous !== next)
    throw new AppError(409, 'USERNAME_IMMUTABLE', 'Username cannot be changed');
}
