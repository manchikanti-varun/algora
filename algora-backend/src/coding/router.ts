import { exportSchema } from './reports.js';
import { Router, type RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, requireCsrf, authContext } from '../auth/middleware.js';
import { SessionService } from '../auth/session-service.js';
import {
  productionAuthDependencies,
  type AuthDependencies,
} from '../auth/router.js';
import { env } from '../config/env.js';
import { idSchema } from '../administration/contracts.js';
import { AppError } from '../middleware/errors.js';
import { LearningService } from '../learning/service.js';
import { mongoLearningRepository } from '../learning/repository.js';
import type { LearningRepository } from '../learning/contracts.js';
import type { ProgressRepository } from './contracts.js';
import { mongoProgressRepository } from './repository.js';
import { CodingService } from './service.js';
export function codingRouter(
  auth: AuthDependencies = productionAuthDependencies,
  repo: ProgressRepository = mongoProgressRepository,
  learning: LearningRepository = mongoLearningRepository,
) {
  const root = Router(),
    r = Router(),
    service = new CodingService(repo, new LearningService(learning));
  r.use(
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store, private');
      res.set('Referrer-Policy', 'no-referrer');
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
      limit: 90,
      keyGenerator: (_req, res) => authContext(res).user.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many progress requests')),
    }),
  );
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
  const actor = (res: import('express').Response) => authContext(res).user.id;
  const id = (req: import('express').Request, key: string) =>
    idSchema.parse(req.params[key]);
  const page = z
    .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
    .strict();
  r.get(
    '/coding/accounts',
    send((_req, res) => service.accounts(actor(res))),
  );
  r.post(
    '/coding/accounts',
    send((req, res) =>
      service.link(actor(res), req.body, res.locals.requestId),
    ),
  );
  r.post(
    '/coding/accounts/:accountId/disconnect',
    send((req, res) =>
      service.disconnect(
        actor(res),
        id(req, 'accountId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.post(
    '/coding/accounts/:accountId/verify',
    send((req, res) =>
      service.beginOwnership(
        actor(res),
        authContext(res).session.tokenHash,
        id(req, 'accountId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.get('/coding/accounts/codeforces/callback', async (req, res, next) => {
    try {
      const d = z
        .object({
          state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          code: z.string().min(1).max(2048),
        })
        .strict()
        .parse(req.query);
      await service.finishOwnership(
        actor(res),
        authContext(res).session.tokenHash,
        d.state,
        d.code,
        res.locals.requestId,
      );
      res.redirect(
        303,
        env.FRONTEND_URL + '/student/coding-accounts?verification=complete',
      );
    } catch (e) {
      next(e);
    }
  });
  r.get(
    '/coding/batches',
    send((req, res) =>
      service.staffBatches(
        actor(res),
        page
          .extend({
            collegeId: idSchema.optional(),
            courseId: idSchema.optional(),
          })
          .parse(req.query).page,
        page
          .extend({
            collegeId: idSchema.optional(),
            courseId: idSchema.optional(),
          })
          .parse(req.query),
      ),
    ),
  );
  r.get(
    '/students/me/progress/batches',
    send((req, res) =>
      service.ownBatches(actor(res), page.parse(req.query).page),
    ),
  );
  r.get(
    '/students/me/batches/:batchId/progress/days/:day',
    send((req, res) =>
      service.day(
        actor(res),
        id(req, 'batchId'),
        z.coerce.number().int().min(1).max(1000000000).parse(req.params.day),
      ),
    ),
  );
  r.get(
    '/students/me/batches/:batchId/progress',
    send((req, res) =>
      service.dashboard(actor(res), id(req, 'batchId'), req.query),
    ),
  );
  r.get(
    '/batches/:batchId/progress/analytics',
    send((req, res) =>
      service.analytics(actor(res), id(req, 'batchId'), req.query),
    ),
  );
  r.get(
    '/batches/:batchId/progress',
    send((req, res) =>
      service.matrix(actor(res), id(req, 'batchId'), req.query),
    ),
  );
  r.get(
    '/batches/:batchId/progress/assignments/:assignmentId/evidence',
    send((req, res) =>
      service.evidence(
        actor(res),
        id(req, 'batchId'),
        id(req, 'assignmentId'),
        req.query,
      ),
    ),
  );
  r.post(
    '/batches/:batchId/progress/jobs/:jobId/retry',
    send((req, res) =>
      service.retry(
        actor(res),
        id(req, 'batchId'),
        id(req, 'jobId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.post(
    '/batches/:batchId/progress/refresh-batch',
    send((req, res) =>
      service.refreshBatch(
        actor(res),
        id(req, 'batchId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.post(
    '/batches/:batchId/progress/refresh',
    send((req, res) =>
      service.refresh(
        actor(res),
        id(req, 'batchId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.post(
    '/batches/:batchId/progress/export',
    rateLimit({
      windowMs: 60000,
      limit: 5,
      keyGenerator: (_req, res) => actor(res),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(
          new AppError(
            429,
            'EXPORT_RATE_LIMITED',
            'Wait before generating another report',
          ),
        ),
    }),
    send((req, res) => {
      const d = exportSchema.parse(req.body);
      return service.exported(
        actor(res),
        id(req, 'batchId'),
        d.filters,
        d.format,
        res.locals.requestId,
        d.reportType,
        d.includeDetails,
      );
    }),
  );
  r.use(
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
              'INVALID_INPUT',
              'Invalid coding progress request',
            )
          : error,
      ),
  );
  root.use((req, res, next) =>
    /^\/(?:coding(?:\/|$)|students\/me\/(?:progress|batches\/[^/]+\/progress)(?:\/|$)|batches\/[^/]+\/progress(?:\/|$))/.test(
      req.path,
    )
      ? r(req, res, next)
      : next(),
  );
  return root;
}
