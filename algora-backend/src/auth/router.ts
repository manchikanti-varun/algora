import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { parseCookie } from 'cookie';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { logger } from '../utils/logger.js';
import {
  googleProvider,
  newOAuthChecks,
  type GoogleProvider,
} from './google.js';
import { mongoAuthRepository } from './repository.js';
import {
  destination,
  publicUser,
  type AuthRepository,
  type Role,
} from './types.js';
import {
  csrfFor,
  hashToken,
  randomToken,
  SessionService,
} from './session-service.js';
import {
  authContext,
  clearSessionCookie,
  cookieOptions,
  oauthCookie,
  requireActiveAccount,
  requireAuth,
  requireCompletedRegistration,
  requireCsrf,
  requireRole,
  sessionCookie,
} from './middleware.js';
export interface AuthDependencies {
  repository: AuthRepository;
  google: GoogleProvider;
}
export const productionAuthDependencies: AuthDependencies = {
  repository: mongoAuthRepository,
  google: googleProvider,
};
export function authRouter(
  deps: AuthDependencies = productionAuthDependencies,
) {
  const router = Router();
  const repo = deps.repository;
  const service = new SessionService(repo, env.SESSION_TTL);
  const authenticated = requireAuth(service);
  // All unexpected repository errors fail closed and never reveal driver details.
  const safe =
    (handler: RequestHandler): RequestHandler =>
    async (req, res, next) => {
      try {
        await handler(req, res, next);
      } catch (error) {
        next(
          error instanceof AppError
            ? error
            : new AppError(
                503,
                'AUTH_UNAVAILABLE',
                'Authentication is temporarily unavailable',
              ),
        );
      }
    };
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store, private');
    res.set('Pragma', 'no-cache');
    next();
  });
  const loginLimit = rateLimit({
    windowMs: 600000,
    limit: env.LOGIN_RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new AppError(
          429,
          'LOGIN_RATE_LIMITED',
          'Too many sign-in attempts. Try again later',
        ),
      ),
  });
  router.get(
    '/status',
    safe(async (_req, res) => {
      let available = false;
      if (deps.google.configured()) {
        try {
          await repo.ensureReady();
          available = true;
        } catch {
          /* sanitized availability only */
        }
      }
      res.json({
        success: true,
        data: {
          available,
          message: available
            ? 'Continue securely with Google'
            : 'Google sign-in is unavailable until authentication configuration and database connectivity are ready',
        },
      });
    }),
  );
  router.get(
    '/google',
    loginLimit,
    safe(async (req, res) => {
      const loginIntent = z
        .object({ intent: z.literal('admin-access').optional() })
        .strict()
        .safeParse(req.query);
      if (!loginIntent.success)
        throw new AppError(
          400,
          'INVALID_REDIRECT',
          'Custom sign-in redirects are not allowed',
        );
      if (
        req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && req.headers.origin !== env.FRONTEND_URL)
      )
        throw new AppError(
          403,
          'ORIGIN_DENIED',
          'Sign-in must begin from Algora',
        );
      if (!deps.google.configured())
        throw new AppError(
          503,
          'AUTH_NOT_CONFIGURED',
          'Google sign-in is not configured',
        );
      await repo.ensureReady();
      const checks = newOAuthChecks();
      const browser = randomToken();
      const location = await deps.google.authorize(checks);
      await repo.storeTransaction({
        intent:
          loginIntent.data.intent === 'admin-access'
            ? 'ADMIN_ACCESS'
            : 'DEFAULT',
        stateHash: hashToken(checks.state),
        browserHash: hashToken(browser),
        verifier: checks.verifier,
        nonce: checks.nonce,
        expiresAt: new Date(Date.now() + 600000),
      });
      res.cookie(oauthCookie, browser, { ...cookieOptions, maxAge: 600000 });
      res.redirect(302, location);
    }),
  );
  router.get(
    '/google/callback',
    loginLimit,
    safe(async (req, res) => {
      const browser = parseCookie(req.headers.cookie ?? '')[oauthCookie];
      res.clearCookie(oauthCookie, cookieOptions);
      if (!deps.google.configured())
        throw new AppError(
          503,
          'AUTH_NOT_CONFIGURED',
          'Google sign-in is not configured',
        );
      const state = req.query.state;
      if (
        typeof state !== 'string' ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(state) ||
        !browser ||
        !/^[A-Za-z0-9_-]{43}$/.test(browser)
      )
        throw new AppError(
          400,
          'INVALID_STATE',
          'Sign-in request is invalid or expired',
        );
      await repo.ensureReady();
      const transaction = await repo.consumeTransaction(
        hashToken(state),
        hashToken(browser),
        new Date(),
      );
      if (!transaction)
        throw new AppError(
          400,
          'INVALID_STATE',
          'Sign-in request is invalid, expired or already used',
        );
      if (
        !transaction.verifier ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(transaction.verifier) ||
        !transaction.nonce
      )
        throw new AppError(400, 'INVALID_PKCE', 'Sign-in request is invalid');
      if (
        req.query.error ||
        typeof req.query.code !== 'string' ||
        !req.query.code ||
        req.query.code.length > 4096
      )
        throw new AppError(
          401,
          'OAUTH_FAILED',
          'Google sign-in was not completed',
        );
      const callback = new URL(
        env.GOOGLE_REDIRECT_URI ??
          env.FRONTEND_URL + '/backend/auth/google/callback',
      );
      callback.search = new URL(req.originalUrl, env.FRONTEND_URL).search;
      const identity = await deps.google.verify(callback, {
        state,
        verifier: transaction.verifier,
        nonce: transaction.nonce,
      });
      if (!identity.emailVerified)
        throw new AppError(
          401,
          'EMAIL_UNVERIFIED',
          'A verified Google email is required',
        );
      const user = await repo.upsertGoogle(identity);
      if (['SUSPENDED', 'ARCHIVED'].includes(user.accountStatus)) {
        await repo.revokeAll(user.id);
        clearSessionCookie(res);
        res.redirect(303, env.FRONTEND_URL + '/account-suspended');
        return;
      }
      const created = await service.create(user);
      // Recheck version/status after creation to close suspension/logout-all races.
      await service.authenticate(created.token);
      const previous = parseCookie(req.headers.cookie ?? '')[sessionCookie];
      if (previous && /^[A-Za-z0-9_-]{43}$/.test(previous))
        await repo.revokeSession(hashToken(previous));
      res.cookie(sessionCookie, created.token, {
        ...cookieOptions,
        expires: created.session.expiresAt,
      });
      logger.info(
        {
          event: 'auth.login',
          userId: user.id,
          requestId: res.locals.requestId,
        },
        'Authentication event',
      );
      res.redirect(
        303,
        env.FRONTEND_URL +
          (transaction.intent === 'ADMIN_ACCESS' && user.role === 'STUDENT'
            ? '/request-admin-access'
            : destination(user)),
      );
    }),
  );
  router.get(
    '/me',
    safe(authenticated),
    safe(async (_req, res) => {
      const { user } = authContext(res);
      res.json({
        success: true,
        data: { user: publicUser(user), destination: destination(user) },
      });
    }),
  );
  router.get(
    '/csrf',
    safe(authenticated),
    safe(async (_req, res) => {
      res.json({
        success: true,
        data: { csrfToken: csrfFor(authContext(res).session.tokenHash) },
      });
    }),
  );
  router.post(
    '/logout',
    safe(authenticated),
    requireCsrf,
    safe(async (_req, res) => {
      await service.logout(authContext(res));
      clearSessionCookie(res);
      logger.info(
        {
          event: 'auth.logout',
          userId: authContext(res).user.id,
          requestId: res.locals.requestId,
        },
        'Authentication event',
      );
      res.json({ success: true, data: { loggedOut: true } });
    }),
  );
  router.post(
    '/logout-all',
    safe(authenticated),
    requireCsrf,
    safe(async (_req, res) => {
      await service.logoutAll(authContext(res));
      clearSessionCookie(res);
      logger.info(
        {
          event: 'auth.logout_all',
          userId: authContext(res).user.id,
          requestId: res.locals.requestId,
        },
        'Authentication event',
      );
      res.json({ success: true, data: { loggedOut: true } });
    }),
  );
  router.post(
    '/refresh',
    safe(authenticated),
    requireCsrf,
    safe(async (_req, res) => {
      const created = await service.rotate(authContext(res));
      await service.authenticate(created.token);
      res.cookie(sessionCookie, created.token, {
        ...cookieOptions,
        expires: created.session.expiresAt,
      });
      res.json({ success: true, data: { rotated: true } });
    }),
  );
  // Access checks only: no course, enrollment or privileged business data exists.
  for (const [path, role] of [
    ['student', 'STUDENT'],
    ['admin', 'ADMIN'],
    ['super-admin', 'SUPER_ADMIN'],
  ] as const) {
    router.get(
      '/access/' + path,
      safe(authenticated),
      requireRole(role as Role),
      requireCompletedRegistration,
      requireActiveAccount,
      safe(async (_req, res) => {
        res.json({
          success: true,
          data: { authorized: true, user: publicUser(authContext(res).user) },
        });
      }),
    );
  }
  router.use(
    (
      error: unknown,
      _req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      const safeError =
        error instanceof AppError
          ? error
          : new AppError(
              503,
              'AUTH_UNAVAILABLE',
              'Authentication is temporarily unavailable',
            );
      logger.warn(
        { event: 'auth.denied', code: safeError.code },
        'Authentication event',
      );
      next(safeError);
    },
  );
  return router;
}
