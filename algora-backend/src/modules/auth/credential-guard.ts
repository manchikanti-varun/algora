import type { Request, Response } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { sha256 } from '../../lib/normalize';
import { takeToken } from '../../lib/ratelimit';
import { verifyGoogleIdToken, type GoogleIdentity } from './google';

type Action = 'login' | 'registration' | 'trainer-access';
const limits = { login: 12, registration: 6, 'trainer-access': 4 };
const invalid = new Map<string, number>();
const inFlight = new Map<string, Promise<GoogleIdentity>>();
const waiting: Array<() => void> = [];
let active = 0;

function rateLimited(res: Response, seconds: number): never {
  res.setHeader('Retry-After', seconds);
  throw new AppError(429, 'RATE_LIMITED', 'We’re receiving a lot of sign-in requests. Please try again in a moment.');
}

async function verify(token: string, res: Response) {
  const key = sha256(token);
  if ((invalid.get(key) ?? 0) > Date.now()) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in with Google again to continue.');
  const pending = inFlight.get(key);
  if (pending) return pending;
  if (waiting.length >= 384) rateLimited(res, 5);

  const result = (async () => {
    if (active >= 32) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await verifyGoogleIdToken(token);
    } catch (error) {
      if (error instanceof AppError && error.status === 401) {
        if (invalid.size >= 2048) invalid.delete(invalid.keys().next().value!);
        invalid.set(key, Date.now() + 15_000);
      }
      throw error;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  })();
  inFlight.set(key, result);
  try { return await result; }
  finally { inFlight.delete(key); }
}

/** Identity budgets only use Google-verified subjects. IP comes from the configured proxy trust boundary. */
export async function checkedGoogleIdentity(req: Request, res: Response, token: string, action: Action) {
  if (env.NODE_ENV === 'test') return verifyGoogleIdToken(token);
  const ip = sha256(ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? ''));
  let identity;
  try {
    identity = await verify(token, res);
  } catch (error) {
    if (error instanceof AppError && error.status === 401 && !(await takeToken(`auth:invalid:${ip}`, 20, 20, true))) rateLimited(res, 60);
    throw error;
  }
  const limit = limits[action];
  if (!(await takeToken(`auth:${action}:${sha256(identity.sub)}`, limit, limit, true))) rateLimited(res, 60);
  return identity;
}
