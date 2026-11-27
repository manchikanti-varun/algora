import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { forbidden, unauthorized, AppError } from '../lib/errors';
import { User, type Role, type UserDoc } from '../models';
import { csrfValid, SESSION_COOKIE, verifySession } from '../modules/auth/session';

declare global {
  namespace Express {
    interface Request { user?: UserDoc; sessionToken?: string }
  }
}

/** Loads the user from the session and re-validates status, session version and Super Admin eligibility on every request. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const p = verifySession(token);
  if (!p) return next(unauthorized());
  const user = await User.findById(p.uid).lean<UserDoc>();
  if (!user || user.status !== 'ACTIVE' || user.sessionVersion !== p.sv) return next(unauthorized('Session expired'));
  if (user.role === 'SUPER_ADMIN' && user.email !== env.SUPER_ADMIN_EMAIL) return next(unauthorized('Session expired'));
  req.user = user;
  req.sessionToken = token;
  next();
};

export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) =>
  roles.includes(req.user!.role as Role) ? next() : next(forbidden());

/** Credential bootstrap accepts only JSON from the configured browser origin. */
export const credentialOriginProtection: RequestHandler = (req, _res, next) => {
  if (req.headers.origin !== env.FRONTEND_ORIGIN) return next(new AppError(403, 'BAD_ORIGIN', 'Origin not allowed'));
  if (!req.is('application/json')) return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected application/json'));
  next();
};

/** Origin check for every unsafe request, plus a session-bound CSRF token for authenticated ones. */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && origin !== env.FRONTEND_ORIGIN) return next(new AppError(403, 'BAD_ORIGIN', 'Origin not allowed'));
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    const sent = req.header('x-csrf-token');
    if (!sent || !csrfValid(sent, token)) return next(new AppError(403, 'BAD_CSRF', 'Invalid CSRF token'));
  } else if (!origin && env.isProd) {
    return next(new AppError(403, 'BAD_ORIGIN', 'Origin required'));
  }
  next();
};
