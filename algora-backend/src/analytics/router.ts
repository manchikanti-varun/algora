import { Router, type RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { rateLimit } from 'express-rate-limit';
import {
  productionAuthDependencies,
  type AuthDependencies,
} from '../auth/router.js';
import { requireAuth, requireCsrf, authContext } from '../auth/middleware.js';
import { SessionService } from '../auth/session-service.js';
import { env } from '../config/env.js';
import { idSchema } from '../administration/contracts.js';
import { AppError } from '../middleware/errors.js';
import { CodingService } from '../coding/service.js';
import { mongoProgressRepository } from '../coding/repository.js';
import type { ProgressRepository } from '../coding/contracts.js';
import { LearningService } from '../learning/service.js';
import { mongoLearningRepository } from '../learning/repository.js';
import type { LearningRepository } from '../learning/contracts.js';
import { AnalyticsService } from './service.js';
import { mongoAnalyticsSource, type AnalyticsSource } from './repository.js';
export function analyticsRouter(
  auth: AuthDependencies = productionAuthDependencies,
  repo: ProgressRepository = mongoProgressRepository,
  learning: LearningRepository = mongoLearningRepository,
  source: AnalyticsSource = mongoAnalyticsSource,
) {
  const r = Router(),
    authority = new LearningService(learning),
    service = new AnalyticsService(
      new CodingService(repo, authority),
      authority,
      repo,
      source,
    );
  r.use(
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store, private');
      next();
    },
    requireAuth(new SessionService(auth.repository, env.SESSION_TTL)),
  );
  const send =
    (
      work: (user: string, req: import('express').Request) => Promise<unknown>,
    ): RequestHandler =>
    async (req, res, next) => {
      try {
        res.json({
          success: true,
          data: await work(authContext(res).user.id, req),
        });
      } catch (e) {
        next(
          e instanceof ZodError
            ? new AppError(400, 'INVALID_INPUT', 'Invalid analytics filters')
            : e,
        );
      }
    };
  r.post(
    '/batches/:batchId/attendance/export',
    requireCsrf,
    rateLimit({
      windowMs: 60000,
      limit: 5,
      keyGenerator: (_req, res) => authContext(res).user.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (req, res, next) => {
      try {
        const d = z
          .object({
            format: z.enum(['CSV', 'XLSX']),
            filters: z.unknown(),
            confirmed: z.literal(true),
          })
          .strict()
          .parse(req.body);
        res.json({
          success: true,
          data: await service.exportAttendance(
            authContext(res).user.id,
            idSchema.parse(req.params.batchId),
            d.filters,
            d.format,
            res.locals.requestId,
          ),
        });
      } catch (e) {
        next(
          e instanceof ZodError
            ? new AppError(400, 'INVALID_INPUT', 'Invalid analytics export')
            : e,
        );
      }
    },
  );
  r.get(
    '/batches/:batchId/readiness',
    send((u, r) =>
      service.readiness(u, idSchema.parse(r.params.batchId), r.query),
    ),
  );
  r.get(
    '/platform',
    send((u, r) => service.overview(u, r.query, true)),
  );
  r.get(
    '/overview',
    send((u, r) => service.overview(u, r.query)),
  );
  r.get(
    '/follow-up',
    send((u, r) => service.overview(u, r.query)),
  );
  r.get(
    '/batches/:batchId',
    send((u, r) => service.batch(u, idSchema.parse(r.params.batchId), r.query)),
  );
  r.get(
    '/batches/:batchId/days/:day',
    send((u, r) =>
      service.batch(u, idSchema.parse(r.params.batchId), {
        ...r.query,
        day: r.params.day,
      }),
    ),
  );
  r.get(
    '/me',
    send((u, r) => service.personal(u, r.query)),
  );
  return r;
}
