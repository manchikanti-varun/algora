import type { RequestHandler, Response } from 'express';
import { parseCookie } from 'cookie';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import type { Role } from './types.js';
import {
  type AuthContext,
  SessionService,
  validCsrf,
} from './session-service.js';
export const sessionCookie =
  env.NODE_ENV === 'production' ? '__Host-algora_session' : 'algora_session';
export const oauthCookie =
  env.NODE_ENV === 'production' ? '__Host-algora_oauth' : 'algora_oauth';
export const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
export function clearSessionCookie(res: Response) {
  res.clearCookie(sessionCookie, cookieOptions);
}
export function authContext(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}
export const requireAuth =
  (service: SessionService): RequestHandler =>
  async (req, res, next) => {
    try {
      res.locals.auth = await service.authenticate(
        parseCookie(req.headers.cookie ?? '')[sessionCookie],
      );
      next();
    } catch (error) {
      if (error instanceof AppError && [401, 403].includes(error.status))
        clearSessionCookie(res);
      next(error);
    }
  };
export const requireRole =
  (...allowed: Role[]): RequestHandler =>
  (_req, res, next) => {
    if (!res.locals.auth)
      return next(new AppError(401, 'AUTH_REQUIRED', 'Please sign in'));
    if (!allowed.includes(authContext(res).user.role))
      return next(
        new AppError(
          403,
          'FORBIDDEN',
          'You do not have access to this workspace',
        ),
      );
    next();
  };
export const requireActiveAccount: RequestHandler = (_req, res, next) => {
  const user = authContext(res)?.user;
  if (!user) return next(new AppError(401, 'AUTH_REQUIRED', 'Please sign in'));
  if (user.accountStatus !== 'ACTIVE')
    return next(
      new AppError(
        403,
        ['SUSPENDED', 'ARCHIVED'].includes(user.accountStatus)
          ? 'ACCOUNT_SUSPENDED'
          : 'ACCOUNT_PENDING',
        'Account is not active',
      ),
    );
  next();
};
export const requireCompletedRegistration: RequestHandler = (
  _req,
  res,
  next,
) => {
  const user = authContext(res)?.user;
  if (!user) return next(new AppError(401, 'AUTH_REQUIRED', 'Please sign in'));
  if (user.role === 'STUDENT' && user.registrationStatus !== 'VERIFIED')
    return next(
      new AppError(
        403,
        user.registrationStatus === 'PENDING_VERIFICATION'
          ? 'ACCOUNT_PENDING'
          : 'REGISTRATION_REQUIRED',
        'Registration must be completed and verified before accessing this workspace',
      ),
    );
  next();
};
export const requireCsrf: RequestHandler = (req, res, next) => {
  if (
    req.headers.origin !== env.FRONTEND_URL ||
    req.headers['sec-fetch-site'] === 'cross-site' ||
    !res.locals.auth ||
    !validCsrf(authContext(res).session.tokenHash, req.headers['x-csrf-token'])
  )
    return next(
      new AppError(403, 'CSRF_REJECTED', 'Request could not be verified'),
    );
  next();
};
