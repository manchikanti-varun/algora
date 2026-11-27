import crypto from 'node:crypto';
import type { Response } from 'express';
import { env } from '../../config/env';
import { safeEqual } from '../../lib/normalize';

export const SESSION_COOKIE = 'algora_session';
const TTL_MS = 7 * 24 * 3600 * 1000;

const hmacWith = (secret: string, data: string, label: string) => crypto.createHmac('sha256', secret).update(`${label}:${data}`).digest('base64url');
/** New signatures always use SESSION_SECRET. */
const hmac = (data: string, label: string) => hmacWith(env.SESSION_SECRET, data, label);
/** Verification also accepts SESSION_SECRET_PREVIOUS during a rotation window. */
const verifies = (sig: string, data: string, label: string) =>
  safeEqual(sig, hmac(data, label)) || (!!env.SESSION_SECRET_PREVIOUS && safeEqual(sig, hmacWith(env.SESSION_SECRET_PREVIOUS, data, label)));

interface Payload { uid: string; sv: number; exp: number; nonce?: string }

export function signSession(uid: string, sv: number): string {
  const body = Buffer.from(JSON.stringify({ uid, sv, exp: Date.now() + TTL_MS, nonce: crypto.randomUUID() } satisfies Payload)).toString('base64url');
  return `${body}.${hmac(body, 'session')}`;
}

export function verifySession(token: string | undefined): Payload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !verifies(sig, body, 'session')) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload;
    if (typeof p.uid !== 'string' || typeof p.sv !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** CSRF token bound to the session cookie. Returned in JSON; sent back in X-CSRF-Token. */
export const csrfTokenFor = (sessionToken: string) => hmac(sessionToken, 'csrf');
/** CSRF check accepting tokens minted with the previous secret during rotation. */
export const csrfValid = (sent: string, sessionToken: string) => verifies(sent, sessionToken, 'csrf');

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax', // frontend proxies /api/v1 so the cookie is first-party
    maxAge: TTL_MS,
    path: '/',
  });
}
export const clearSessionCookie = (res: Response) =>
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: '/' });
