import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ZodError, z } from 'zod';
import { SessionService } from '../auth/session-service.js';
import {
  requireAuth,
  requireRole,
  requireCsrf,
  authContext,
} from '../auth/middleware.js';
import {
  productionAuthDependencies,
  type AuthDependencies,
} from '../auth/router.js';
import { env } from '../config/env.js';
import { idSchema } from '../administration/contracts.js';
import { AppError } from '../middleware/errors.js';
import { studentListSchema, type StudentRepository } from './contracts.js';
import { mongoStudentRepository } from './repository.js';
import { StudentService } from './service.js';
export function studentsRouter(
  auth: AuthDependencies = productionAuthDependencies,
  repo: StudentRepository = mongoStudentRepository,
) {
  const root = Router();
  const s = new StudentService(repo);
  const authenticated = requireAuth(
    new SessionService(auth.repository, env.SESSION_TTL),
  );
  const send =
    (
      work: (
        req: import('express').Request,
        res: import('express').Response,
      ) => Promise<unknown>,
      status = 200,
    ): RequestHandler =>
    async (req, res, next) => {
      try {
        res.status(status).json({ success: true, data: await work(req, res) });
      } catch (e) {
        next(e);
      }
    };
  const actor = (r: import('express').Response) => authContext(r).user.id;
  const csrf: RequestHandler = (req, res, next) =>
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      ? next()
      : requireCsrf(req, res, next);
  const limiter = (limit: number) =>
    rateLimit({
      windowMs: 3600000,
      limit,
      keyGenerator: (_req, res) => actor(res),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(
          new AppError(
            429,
            'RATE_LIMITED',
            'Too many attempts; try again later',
          ),
        ),
    });
  const student = Router();
  student.use(authenticated, requireRole('STUDENT'), csrf);
  student.get(
    '/registration-options',
    send((req, res) =>
      s.options(actor(res), studentListSchema.parse(req.query)),
    ),
  );
  student.get(
    '/roll-number-availability',
    limiter(120),
    send((req, res) => {
      const q = z.object({ rollNumber: z.string() }).strict().parse(req.query);
      return s.availability(actor(res), q.rollNumber);
    }),
  );
  student.post(
    '/register',
    limiter(10),
    send(
      (req, res) => s.register(actor(res), req.body, res.locals.requestId),
      201,
    ),
  );
  student.get(
    '/me',
    send((_req, res) => s.me(actor(res))),
  );
  student.patch(
    '/me',
    limiter(30),
    send((req, res) => s.edit(actor(res), req.body, res.locals.requestId)),
  );
  student.get(
    '/me/qr',
    limiter(120),
    send((_req, res) => s.qr(actor(res))),
  );
  student.post(
    '/me/qr/rotate',
    limiter(5),
    send((req, res) => s.rotate(actor(res), req.body, res.locals.requestId)),
  );
  student.get(
    '/me/correction-requests',
    send((req, res) =>
      s.ownCorrections(actor(res), studentListSchema.parse(req.query)),
    ),
  );
  student.post(
    '/me/correction-requests',
    limiter(10),
    send(
      (req, res) =>
        s.requestCorrection(actor(res), req.body, res.locals.requestId),
      201,
    ),
  );
  student.post(
    '/me/correction-requests/:requestId/cancel',
    send((req, res) =>
      s.cancel(
        actor(res),
        idSchema.parse(req.params.requestId),
        res.locals.requestId,
      ),
    ),
  );
  root.use(
    [
      '/students',
      '/admin/students',
      '/super-admin/students',
      '/admin/student-correction-requests',
      '/super-admin/student-correction-requests',
    ],
    (_req, res, next) => {
      res.set({
        'Cache-Control': 'no-store, private',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
      });
      next();
    },
  );
  root.use('/students', student);
  for (const [path, role] of [
    ['admin', 'ADMIN'],
    ['super-admin', 'SUPER_ADMIN'],
  ] as const) {
    const staff = Router();
    staff.use(authenticated, requireRole(role), csrf);
    staff.get(
      '/students',
      send((req, res) =>
        s.directory(actor(res), studentListSchema.parse(req.query)),
      ),
    );
    staff.get(
      '/students/:studentId',
      send((req, res) =>
        s.detail(actor(res), idSchema.parse(req.params.studentId)),
      ),
    );
    staff.post(
      '/students/:studentId/verify',
      send((req, res) =>
        s.verify(
          actor(res),
          idSchema.parse(req.params.studentId),
          req.body,
          false,
          res.locals.requestId,
        ),
      ),
    );
    staff.post(
      '/students/:studentId/reject-verification',
      send((req, res) =>
        s.verify(
          actor(res),
          idSchema.parse(req.params.studentId),
          req.body,
          true,
          res.locals.requestId,
        ),
      ),
    );
    staff.get(
      '/student-correction-requests',
      send((req, res) =>
        s.corrections(actor(res), studentListSchema.parse(req.query)),
      ),
    );
    for (const action of ['approve', 'reject'] as const)
      staff.post(
        '/student-correction-requests/:requestId/' + action,
        send((req, res) =>
          s.review(
            actor(res),
            idSchema.parse(req.params.requestId),
            req.body,
            action === 'approve',
            res.locals.requestId,
          ),
        ),
      );
    // Match only Phase 4 routes: do not intercept existing Phase 3 routes.
    root.use('/' + path, (req, res, next) =>
      /^\/(students|student-correction-requests)(\/|$)/.test(req.path)
        ? staff(req, res, next)
        : next(),
    );
  }
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
                'STUDENTS_UNAVAILABLE',
                'Student management is temporarily unavailable',
              ),
      ),
  );
  return root;
}
