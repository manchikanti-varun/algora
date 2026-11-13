import { Router, type RequestHandler } from 'express';
import { ZodError } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, requireCsrf, authContext } from '../auth/middleware.js';
import { SessionService } from '../auth/session-service.js';
import {
  productionAuthDependencies,
  type AuthDependencies,
} from '../auth/router.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { idSchema } from '../administration/contracts.js';
import { LearningService } from '../learning/service.js';
import { mongoLearningRepository } from '../learning/repository.js';
import type { LearningRepository } from '../learning/contracts.js';
import { AttendanceService } from './service.js';
import { listSchema, type AttendanceRepository } from './contracts.js';
import { mongoAttendanceRepository } from './repository.js';
export function attendanceRouter(
  auth: AuthDependencies = productionAuthDependencies,
  repo: AttendanceRepository = mongoAttendanceRepository,
  learning: LearningRepository = mongoLearningRepository,
) {
  const root = Router(),
    r = Router(),
    service = new AttendanceService(repo, new LearningService(learning));
  r.use(
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store, private');
      next();
    },
    requireAuth(new SessionService(auth.repository, env.SESSION_TTL)),
    (req, res, next) =>
      ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
        ? next()
        : requireCsrf(req, res, next),
  );
  r.use(
    rateLimit({
      windowMs: 60000,
      limit: 600,
      keyGenerator: (_req, res) => authContext(res).user.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many attendance requests')),
    }),
  );
  const id = (req: import('express').Request, key: string) =>
      idSchema.parse(req.params[key]),
    actor = (res: import('express').Response) => authContext(res).user.id,
    q = (req: import('express').Request) => listSchema.parse(req.query);
  const send =
    (
      work: (
        req: import('express').Request,
        res: import('express').Response,
      ) => Promise<unknown>,
    ): RequestHandler =>
    async (req, res, next) => {
      try {
        res.json({ success: true, data: await work(req, res) });
      } catch (e) {
        next(e);
      }
    };
  const base = '/batches/:batchId/attendance',
    session = base + '/sessions/:sessionId';
  r.get(
    '/students/me/attendance/batches',
    send((req, res) => service.ownBatches(actor(res), q(req))),
  );
  r.get(
    '/attendance/batches',
    send((req, res) => service.hub(actor(res), req.query)),
  );
  r.get(
    base,
    send((req, res) =>
      service.dashboard(actor(res), id(req, 'batchId'), q(req)),
    ),
  );
  r.post(
    base + '/sessions',
    send((req, res) =>
      service.create(
        actor(res),
        id(req, 'batchId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.get(
    session,
    send((req, res) =>
      service.detail(actor(res), id(req, 'batchId'), id(req, 'sessionId')),
    ),
  );
  for (const action of ['open', 'close', 'reopen', 'finalize'] as const)
    r.post(
      session + '/' + action,
      send((req, res) =>
        service.transition(
          actor(res),
          id(req, 'batchId'),
          id(req, 'sessionId'),
          action,
          req.body,
          res.locals.requestId,
        ),
      ),
    );
  r.post(
    session + '/scan',
    (_req, res, next) => {
      const age =
        Date.now() - new Date(authContext(res).session.createdAt).getTime();
      return !Number.isFinite(age) || age > 8 * 60 * 60 * 1000 || age < -60000
        ? next(
            new AppError(
              401,
              'SCANNER_SESSION_RENEWAL_REQUIRED',
              'Renew your staff session before scanning',
            ),
          )
        : next();
    },
    send((req, res) =>
      service.scan(
        actor(res),
        id(req, 'batchId'),
        id(req, 'sessionId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.get(
    session + '/roster',
    send((req, res) =>
      service.roster(
        actor(res),
        id(req, 'batchId'),
        id(req, 'sessionId'),
        q(req),
      ),
    ),
  );
  r.get(
    session + '/roster/refresh-preview',
    send((req, res) =>
      service.refreshPreview(
        actor(res),
        id(req, 'batchId'),
        id(req, 'sessionId'),
      ),
    ),
  );
  r.post(
    session + '/roster/refresh',
    send((req, res) =>
      service.refresh(
        actor(res),
        id(req, 'batchId'),
        id(req, 'sessionId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.post(
    session + '/roster/:profileId/excuse',
    send((req, res) =>
      service.excuse(
        actor(res),
        id(req, 'batchId'),
        id(req, 'sessionId'),
        id(req, 'profileId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.post(
    session + '/records/:recordId/correct',
    send((req, res) =>
      service.correct(
        actor(res),
        id(req, 'batchId'),
        id(req, 'sessionId'),
        id(req, 'recordId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.get(
    session + '/history',
    send((req, res) =>
      service.historyList(
        actor(res),
        id(req, 'batchId'),
        id(req, 'sessionId'),
        q(req),
      ),
    ),
  );
  r.get(
    base + '/reports',
    send((req, res) => service.reports(actor(res), id(req, 'batchId'), q(req))),
  );
  r.post(
    base + '/export',
    send((req, res) =>
      service.export(
        actor(res),
        id(req, 'batchId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.get(
    '/students/me/batches/:batchId/attendance',
    send((req, res) => service.own(actor(res), id(req, 'batchId'), q(req))),
  );
  root.use((req, res, next) =>
    /^\/students\/me\/attendance(?:\/|$)|^\/attendance(?:\/|$)|^\/batches\/[a-f0-9]{24}\/attendance(?:\/|$)|^\/students\/me\/batches\/[a-f0-9]{24}\/attendance(?:\/|$)/i.test(
      req.path,
    )
      ? r(req, res, next)
      : next(),
  );
  root.use(
    (
      error: unknown,
      _req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) =>
      next(
        error instanceof ZodError
          ? new AppError(
              400,
              'VALIDATION_ERROR',
              error.issues.map((i) => i.message).join('; '),
            )
          : error instanceof AppError
            ? error
            : new AppError(
                503,
                'ATTENDANCE_UNAVAILABLE',
                'Attendance is temporarily unavailable',
              ),
      ),
  );
  return root;
}
