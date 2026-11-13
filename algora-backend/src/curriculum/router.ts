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
import { AppError } from '../middleware/errors.js';
import { idSchema } from '../administration/contracts.js';
import { LearningService } from '../learning/service.js';
import { mongoLearningRepository } from '../learning/repository.js';
import type { LearningRepository } from '../learning/contracts.js';
import { querySchema, type CurriculumRepository } from './contracts.js';
import { CurriculumService } from './service.js';
import { mongoCurriculumRepository } from './repository.js';
export function curriculumRouter(
  auth: AuthDependencies = productionAuthDependencies,
  repo: CurriculumRepository = mongoCurriculumRepository,
  learning: LearningRepository = mongoLearningRepository,
) {
  const root = Router(),
    r = Router(),
    s = new CurriculumService(repo, new LearningService(learning));
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
      windowMs: 3600000,
      limit: 300,
      keyGenerator: (_req, res) => authContext(res).user.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many curriculum requests')),
    }),
  );
  const actor = (res: import('express').Response) => authContext(res).user.id;
  const id = (req: import('express').Request, key: string) =>
    idSchema.parse(req.params[key]);
  const q = (req: import('express').Request) => querySchema.parse(req.query);
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
  const base = '/courses/:courseId/curriculum';
  const revision = base + '/revisions/:revisionId';
  r.get(
    base,
    send((req, res) => s.revisions(actor(res), id(req, 'courseId'), q(req))),
  );
  r.post(
    base + '/drafts',
    send((req, res) =>
      s.newDraft(
        actor(res),
        id(req, 'courseId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.get(
    revision,
    send((req, res) =>
      s.revision(
        actor(res),
        id(req, 'courseId'),
        id(req, 'revisionId'),
        q(req),
      ),
    ),
  );
  r.post(
    revision + '/clone',
    send((req, res) => {
      z.object({ confirmed: z.literal(true) })
        .strict()
        .parse(req.body);
      return s.newDraft(
        actor(res),
        id(req, 'courseId'),
        { sourceRevisionId: id(req, 'revisionId') },
        res.locals.requestId,
      );
    }),
  );
  r.post(
    revision + '/publish',
    send((req, res) =>
      s.publish(
        actor(res),
        id(req, 'courseId'),
        id(req, 'revisionId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.get(
    revision + '/days/:dayId/preview',
    send((req, res) =>
      s.preview(
        actor(res),
        id(req, 'courseId'),
        id(req, 'revisionId'),
        id(req, 'dayId'),
      ),
    ),
  );
  r.post(
    revision + '/days',
    send((req, res) =>
      s.saveDay(
        actor(res),
        id(req, 'courseId'),
        id(req, 'revisionId'),
        undefined,
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.patch(
    revision + '/days/:dayId',
    send((req, res) =>
      s.saveDay(
        actor(res),
        id(req, 'courseId'),
        id(req, 'revisionId'),
        id(req, 'dayId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.delete(
    revision + '/days/:dayId',
    send((req, res) =>
      s.removeDay(
        actor(res),
        id(req, 'courseId'),
        id(req, 'revisionId'),
        id(req, 'dayId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.post(
    revision + '/days/reorder',
    send((req, res) =>
      s.reorder(
        actor(res),
        id(req, 'courseId'),
        id(req, 'revisionId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.get(
    '/problems',
    send((req, res) => s.problems(actor(res), q(req))),
  );
  r.post(
    '/problems',
    send((req, res) =>
      s.saveProblem(actor(res), req.body, undefined, res.locals.requestId),
    ),
  );
  r.get(
    '/problems/:problemId',
    send((req, res) => s.problem(actor(res), id(req, 'problemId'))),
  );
  r.patch(
    '/problems/:problemId',
    send((req, res) =>
      s.saveProblem(
        actor(res),
        req.body,
        id(req, 'problemId'),
        res.locals.requestId,
      ),
    ),
  );
  r.get(
    '/problems/:problemId/editorials',
    send((req, res) => s.editorials(actor(res), id(req, 'problemId'), q(req))),
  );
  r.post(
    '/problems/:problemId/editorials',
    send((req, res) =>
      s.saveEditorial(
        actor(res),
        id(req, 'problemId'),
        undefined,
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.get(
    '/problems/:problemId/editorials/:editorialId',
    send((req, res) =>
      s.editorial(actor(res), id(req, 'problemId'), id(req, 'editorialId')),
    ),
  );
  r.patch(
    '/problems/:problemId/editorials/:editorialId',
    send((req, res) =>
      s.saveEditorial(
        actor(res),
        id(req, 'problemId'),
        id(req, 'editorialId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.post(
    '/problems/:problemId/editorials/:editorialId/publish',
    send((req, res) =>
      s.publishEditorial(
        actor(res),
        id(req, 'problemId'),
        id(req, 'editorialId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  r.post(
    '/problems/:problemId/editorials/:editorialId/clone',
    send((req, res) => {
      z.object({ confirmed: z.literal(true) })
        .strict()
        .parse(req.body);
      return s.cloneEditorial(
        actor(res),
        id(req, 'problemId'),
        id(req, 'editorialId'),
        res.locals.requestId,
      );
    }),
  );
  r.get(
    '/batches/:batchId/curriculum',
    send((req, res) => s.batch(actor(res), id(req, 'batchId'), q(req))),
  );
  r.get(
    '/batches/:batchId/curriculum/days',
    send((req, res) => s.batchDays(actor(res), id(req, 'batchId'), q(req))),
  );
  r.get(
    '/batches/:batchId/curriculum/history',
    send((req, res) => s.history(actor(res), id(req, 'batchId'), q(req))),
  );
  r.get(
    '/batches/:batchId/curriculum/assignment-preview',
    send((req, res) => {
      const d = z.object({ revisionId: idSchema }).strict().parse(req.query);
      return s.assignmentPreview(actor(res), id(req, 'batchId'), d.revisionId);
    }),
  );
  r.post(
    '/batches/:batchId/curriculum/assign',
    send((req, res) =>
      s.assign(actor(res), id(req, 'batchId'), req.body, res.locals.requestId),
    ),
  );
  r.post(
    '/batches/:batchId/curriculum/days/:dayId/release',
    send((req, res) =>
      s.release(
        actor(res),
        id(req, 'batchId'),
        id(req, 'dayId'),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  const number = (req: import('express').Request) =>
    z.coerce.number().int().min(1).max(1000000000).parse(req.params.dayNumber);
  r.get(
    '/students/me/courses/:courseId',
    send((req, res) =>
      s.studentCourse(actor(res), id(req, 'courseId'), q(req)),
    ),
  );
  r.get(
    '/students/me/batches/:batchId/curriculum',
    send((req, res) => s.studentBatch(actor(res), id(req, 'batchId'), q(req))),
  );
  r.get(
    '/students/me/batches/:batchId/days/:dayNumber',
    send((req, res) =>
      s.studentDay(actor(res), id(req, 'batchId'), number(req)),
    ),
  );
  r.get(
    '/students/me/batches/:batchId/days/:dayNumber/problems/:problemId/editorial',
    send((req, res) =>
      s.studentEditorial(
        actor(res),
        id(req, 'batchId'),
        number(req),
        id(req, 'problemId'),
      ),
    ),
  );
  root.use((req, res, next) =>
    /^\/courses\/[a-f0-9]{24}\/curriculum(?:\/|$)|^\/problems(?:\/|$)|^\/batches\/[a-f0-9]{24}\/curriculum(?:\/|$)|^\/students\/me\/(?:courses\/[a-f0-9]{24}|batches\/[a-f0-9]{24}\/(?:curriculum|days))(?:\/|$)/i.test(
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
                'CURRICULUM_UNAVAILABLE',
                'Curriculum management is temporarily unavailable',
              ),
      ),
  );
  return root;
}
