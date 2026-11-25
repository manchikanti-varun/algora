import crypto from 'node:crypto';

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const normalizeRoll = (r: string) => r.trim().toUpperCase();
export const nameKey = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** "Varun  Manchikanti" -> "varunmanchikanti" */
export function slugifyName(full: string): string {
  return full
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
