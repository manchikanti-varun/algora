import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import { SessionService } from '../auth/session-service.js';
import {
  authContext,
  requireAuth,
  requireRole,
  requireActiveAccount,
  requireCsrf,
} from '../auth/middleware.js';
import {
  productionAuthDependencies,
  type AuthDependencies,
} from '../auth/router.js';
import { AppError } from '../middleware/errors.js';
import { mongoAdminRepository, storageError } from './repository.js';
import { AdministrationService } from './service.js';
import {
  idSchema,
  listSchema,
  permissions,
  scopedCollege,
  type AdminRepository,
} from './contracts.js';
import { requireCollegePermission } from './middleware.js';
import { env } from '../config/env.js';
export function administrationRouter(
  auth: AuthDependencies = productionAuthDependencies,
  repository: AdminRepository = mongoAdminRepository,
) {
  const root = Router();
  const service = new AdministrationService(repository);
  const authenticated = requireAuth(
    new SessionService(auth.repository, env.SESSION_TTL),
  );
  const csrf: RequestHandler = (req, res, next) =>
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      ? next()
      : requireCsrf(req, res, next);
  const send =
    (
      work: (
        req: import('express').Request,
        res: import('express').Response,
      ) => Promise<unknown> | unknown,
      status = 200,
    ): RequestHandler =>
    async (req, res, next) => {
      try {
        res.status(status).json({ success: true, data: await work(req, res) });
      } catch (error) {
        next(error);
      }
    };
  const actor = (res: import('express').Response) => authContext(res).user.id;
  root.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store, private');
    next();
  });
  const superAdmin = Router();
  superAdmin.use(
    authenticated,
    requireRole('SUPER_ADMIN'),
    requireActiveAccount,
    csrf,
  );
  superAdmin.get(
    '/overview',
    send((_req, res) => service.overview(actor(res))),
  );
  superAdmin.get(
    '/permissions',
    send(() => ({
      permissions: permissions.map((key) => ({
        key,
        label: key.replace('.', ' · '),
        availableNow: [
          'college.view',
          'student.view',
          'student.verify',
          'course.manage',
          'batch.manage',
          'student.enroll',
          'report.view',
        ].includes(key),
      })),
    })),
  );
  superAdmin.get(
    '/colleges',
    send((req, res) =>
      service.colleges(actor(res), listSchema('colleges').parse(req.query)),
    ),
  );
  superAdmin.post(
    '/colleges',
    send(
      (req, res) =>
        service.createCollege(actor(res), req.body, res.locals.requestId),
      201,
    ),
  );
  superAdmin.get(
    '/colleges/:collegeId',
    send((req, res) =>
      service.college(actor(res), idSchema.parse(req.params.collegeId)),
    ),
  );
  superAdmin.patch(
    '/colleges/:collegeId',
    send((req, res) =>
      service.updateCollege(
        actor(res),
        idSchema.parse(req.params.collegeId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  superAdmin.patch(
    '/colleges/:collegeId/status',
    send((req, res) =>
      service.collegeStatus(
        actor(res),
        idSchema.parse(req.params.collegeId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  superAdmin.get(
    '/admin-requests',
    send((req, res) =>
      service.requests(actor(res), listSchema('requests').parse(req.query)),
    ),
  );
  superAdmin.get(
    '/admin-requests/:requestId',
    send((req, res) =>
      service.request(actor(res), idSchema.parse(req.params.requestId)),
    ),
  );
  superAdmin.post(
    '/admin-requests/:requestId/approve',
    send((req, res) =>
      service.approve(
        actor(res),
        idSchema.parse(req.params.requestId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  superAdmin.post(
    '/admin-requests/:requestId/reject',
    send((req, res) =>
      service.reject(
        actor(res),
        idSchema.parse(req.params.requestId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  superAdmin.get(
    '/admins',
    send((req, res) =>
      service.admins(actor(res), listSchema('admins').parse(req.query)),
    ),
  );
  superAdmin.get(
    '/admins/:adminId',
    send((req, res) =>
      service.admin(actor(res), idSchema.parse(req.params.adminId)),
    ),
  );
  superAdmin.patch(
    '/admins/:adminId/assignments',
    send((req, res) =>
      service.assignments(
        actor(res),
        idSchema.parse(req.params.adminId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  superAdmin.patch(
    '/admins/:adminId/status',
    send((req, res) =>
      service.adminStatus(
        actor(res),
        idSchema.parse(req.params.adminId),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  superAdmin.get(
    '/audit-logs',
    send((req, res) =>
      service.audits(actor(res), listSchema('audit').parse(req.query)),
    ),
  );
  root.use('/super-admin', superAdmin);
  const requests = Router();
  requests.use(authenticated, requireRole('STUDENT', 'ADMIN'), csrf);
  const submissionLimit = rateLimit({
    windowMs: 3600000,
    limit: 3,
    keyGenerator: (_req, res) => actor(res),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new AppError(
          429,
          'REQUEST_RATE_LIMITED',
          'Please wait before submitting another request',
        ),
      ),
  });
  requests.get(
    '/eligible-colleges',
    requireRole('STUDENT'),
    send((req, res) =>
      service.eligibleColleges(
        actor(res),
        listSchema('colleges').parse(req.query),
      ),
    ),
  );
  requests.get(
    '/me',
    send((req, res) =>
      service.ownRequests(actor(res), listSchema('requests').parse(req.query)),
    ),
  );
  requests.post(
    '/',
    requireRole('STUDENT'),
    submissionLimit,
    send(
      (req, res) => service.submit(actor(res), req.body, res.locals.requestId),
      201,
    ),
  );
  requests.post(
    '/:requestId/cancel',
    requireRole('STUDENT'),
    send((req, res) =>
      service.cancel(
        actor(res),
        idSchema.parse(req.params.requestId),
        res.locals.requestId,
      ),
    ),
  );
  root.use('/admin-access-requests', requests);
  const admin = Router();
  admin.use(authenticated, requireRole('ADMIN'), requireActiveAccount, csrf);
  admin.get(
    '/me',
    send((_req, res) => service.ownAdmin(actor(res))),
  );
  admin.get(
    '/colleges',
    send((_req, res) => service.ownColleges(actor(res))),
  );
  admin.get(
    '/colleges/:collegeId',
    requireCollegePermission(service, 'college.view'),
    send((_req, res) => scopedCollege(res.locals.college)),
  );
  root.use('/admin', admin);
  root.use(
    (
      error: unknown,
      _req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      if (error instanceof ZodError) {
        next(new AppError(400, 'VALIDATION_ERROR', 'Request data is invalid'));
        return;
      }
      try {
        storageError(error);
      } catch (safe) {
        next(safe);
      }
    },
  );
  return root;
}
