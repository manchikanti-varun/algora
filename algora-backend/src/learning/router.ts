import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ZodError, z } from 'zod';
import { requireAuth, requireCsrf, authContext } from '../auth/middleware.js';
import { SessionService } from '../auth/session-service.js';
import {
  productionAuthDependencies,
  type AuthDependencies,
} from '../auth/router.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { idSchema } from '../administration/contracts.js';
import { listSchema, type LearningRepository } from './contracts.js';
import { mongoLearningRepository } from './repository.js';
import { LearningService } from './service.js';
import { reconciliationStatus, retryReconciliation } from './worker.js';
export function learningRouter(
  auth: AuthDependencies = productionAuthDependencies,
  repo: LearningRepository = mongoLearningRepository,
) {
  const root = Router(),
    s = new LearningService(repo);
  const authenticated = requireAuth(
    new SessionService(auth.repository, env.SESSION_TTL),
  );
  const csrf: RequestHandler = (req, res, next) =>
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      ? next()
      : requireCsrf(req, res, next);
  const actor = (res: import('express').Response) => authContext(res).user.id;
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
  const router = Router();
  router.use(
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store, private');
      next();
    },
    authenticated,
    csrf,
  );
  const limited = rateLimit({
    windowMs: 3600000,
    limit: 30,
    keyGenerator: (_req, res) => actor(res),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many import attempts')),
  });
  router.get(
    '/courses',
    send((req, res) => s.courses(actor(res), listSchema.parse(req.query))),
  );
  router.get(
    '/courses/:courseId',
    send((req, res) =>
      s.course(actor(res), idSchema.parse(req.params.courseId)),
    ),
  );
  router.post(
    '/courses',
    send((req, res) =>
      s.saveCourse(actor(res), req.body, undefined, res.locals.requestId),
    ),
  );
  router.patch(
    '/courses/:courseId',
    send((req, res) =>
      s.saveCourse(
        actor(res),
        req.body,
        idSchema.parse(req.params.courseId),
        res.locals.requestId,
      ),
    ),
  );
  for (const [action, status] of [
    ['publish', 'PUBLISHED'],
    ['archive', 'ARCHIVED'],
  ] as const)
    router.post(
      '/courses/:courseId/' + action,
      send((req, res) =>
        s.courseStatus(
          actor(res),
          idSchema.parse(req.params.courseId),
          status,
          req.body,
          res.locals.requestId,
        ),
      ),
    );
  router.get(
    '/batches',
    send((req, res) => s.batches(actor(res), listSchema.parse(req.query))),
  );
  router.get(
    '/batches/:batchId',
    send((req, res) => s.batch(actor(res), idSchema.parse(req.params.batchId))),
  );
  router.post(
    '/batches',
    send((req, res) =>
      s.saveBatch(actor(res), req.body, undefined, res.locals.requestId),
    ),
  );
  router.patch(
    '/batches/:batchId',
    send((req, res) =>
      s.saveBatch(
        actor(res),
        req.body,
        idSchema.parse(req.params.batchId),
        res.locals.requestId,
      ),
    ),
  );
  for (const [action, status] of [
    ['activate', 'ACTIVE'],
    ['complete', 'COMPLETED'],
    ['archive', 'ARCHIVED'],
  ] as const)
    router.post(
      '/batches/:batchId/' + action,
      send((req, res) =>
        s.batchStatus(
          actor(res),
          idSchema.parse(req.params.batchId),
          status,
          req.body,
          res.locals.requestId,
        ),
      ),
    );
  router.get(
    '/batches/:batchId/enrollments',
    send((req, res) =>
      s.enrollments(
        actor(res),
        idSchema.parse(req.params.batchId),
        listSchema.parse(req.query),
      ),
    ),
  );
  router.post(
    '/batches/:batchId/enrollments',
    limited,
    send((req, res) =>
      s.manual(
        actor(res),
        idSchema.parse(req.params.batchId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  router.post(
    '/batches/:batchId/enrollments/preview',
    limited,
    send((req, res) =>
      s.preview(actor(res), idSchema.parse(req.params.batchId), req.body),
    ),
  );
  router.post(
    '/batches/:batchId/enrollments/import',
    limited,
    send((req, res) =>
      s.import(
        actor(res),
        idSchema.parse(req.params.batchId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  router.post(
    '/batches/:batchId/enrollments/:enrollmentId/withdraw',
    send((req, res) =>
      s.withdraw(
        actor(res),
        idSchema.parse(req.params.batchId),
        idSchema.parse(req.params.enrollmentId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  router.post(
    '/batches/:batchId/enrollments/:enrollmentId/transfer',
    send((req, res) =>
      s.transfer(
        actor(res),
        idSchema.parse(req.params.batchId),
        idSchema.parse(req.params.enrollmentId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  router.get(
    '/batches/:batchId/enrollment-history',
    send((req, res) =>
      s.enrollments(
        actor(res),
        idSchema.parse(req.params.batchId),
        listSchema.parse(req.query),
        true,
      ),
    ),
  );
  router.get(
    '/batches/:batchId/enrollment-events',
    send((req, res) =>
      s.history(
        actor(res),
        idSchema.parse(req.params.batchId),
        listSchema.parse(req.query),
      ),
    ),
  );
  for (const kind of ['courses', 'batches'])
    router.get(
      '/students/me/' + kind,
      send((req, res) => s.own(actor(res), listSchema.parse(req.query))),
    );
  router.get(
    '/learning/reconciliation',
    send(async (_req, res) => {
      if (authContext(res).user.role !== 'SUPER_ADMIN')
        throw new AppError(403, 'FORBIDDEN', 'Super Admin access required');
      await repo.ensureReady();
      return reconciliationStatus();
    }),
  );
  router.post(
    '/learning/reconciliation/retry',
    send(async (req, res) => {
      if (authContext(res).user.role !== 'SUPER_ADMIN')
        throw new AppError(403, 'FORBIDDEN', 'Super Admin access required');
      const d = z
        .object({
          kind: z.enum(['USER', 'PROFILE', 'COLLEGE', 'COURSE', 'BATCH']),
          targetId: idSchema,
          confirmed: z.literal(true),
        })
        .strict()
        .parse(req.body);
      await repo.ensureReady();
      return retryReconciliation(
        d.kind,
        d.targetId,
        actor(res),
        res.locals.requestId,
      );
    }),
  );
  root.use((req, res, next) =>
    /^\/(courses|batches|learning)(\/|$)/.test(req.path) ||
    /^\/students\/me\/(courses|batches)$/.test(req.path)
      ? router(req, res, next)
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
                'LEARNING_UNAVAILABLE',
                'Course and enrollment management is temporarily unavailable',
              ),
      ),
  );
  return root;
}
