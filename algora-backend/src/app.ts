import { API_VERSION } from './operations/checks.js';
import { analyticsRouter } from './analytics/router.js';
import type { AnalyticsSource } from './analytics/repository.js';
import { codingRouter } from './coding/router.js';
import type { ProgressRepository } from './coding/contracts.js';
import { attendanceRouter } from './attendance/router.js';
import type { AttendanceRepository } from './attendance/contracts.js';
import { curriculumRouter } from './curriculum/router.js';
import type { CurriculumRepository } from './curriculum/contracts.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { databaseReady } from './config/database.js';
import { logger } from './utils/logger.js';
import { AppError, errorHandler, notFound } from './middleware/errors.js';
import { apiRouter } from './routes/index.js';
import { authRouter, type AuthDependencies } from './auth/router.js';
import { administrationRouter } from './administration/router.js';
import type { AdminRepository } from './administration/contracts.js';
import { studentsRouter } from './students/router.js';
import type { StudentRepository } from './students/contracts.js';
import { learningRouter } from './learning/router.js';
import type { LearningRepository } from './learning/contracts.js';
export function createApp(
  ready = databaseReady,
  auth?: AuthDependencies,
  administration?: AdminRepository,
  students?: StudentRepository,
  learning?: LearningRepository,
  curriculum?: CurriculumRepository,
  attendance?: AttendanceRepository,
  coding?: ProgressRepository,
  analytics?: AnalyticsSource,
) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId);
    res.setHeader('X-Algora-API-Version', API_VERSION);
    const start = Date.now();
    res.on('finish', () =>
      logger.info(
        {
          requestId: res.locals.requestId,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        'HTTP request',
      ),
    );
    next();
  });
  app.use((req, _res, next) =>
    req.get('X-Algora-API-Version') &&
    req.get('X-Algora-API-Version') !== API_VERSION
      ? next(
          new AppError(
            409,
            'API_VERSION_MISMATCH',
            'Application versions differ; refresh or contact the operator',
          ),
        )
      : next(),
  );
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin: (origin, cb) =>
        !origin || env.CORS_ORIGINS.includes(origin)
          ? cb(null, true)
          : cb(new AppError(403, 'ORIGIN_DENIED', 'Origin not allowed')),
      exposedHeaders: ['X-Request-ID'],
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: (req) =>
        /^\/api\/v1\/(?:batches\/[a-f0-9]{24}\/attendance|attendance)(?:\/|$)/i.test(
          req.path,
        )
          ? 480
          : env.API_RATE_LIMIT,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) =>
        req.path === '/api/v1/health' || req.path === '/api/v1/ready',
      handler: (_req, res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many requests')),
    }),
  );
  const importJson = express.json({ limit: '1500kb' });
  app.use((req, res, next) =>
    /^\/api\/v1\/batches\/[a-f0-9]{24}\/enrollments\/preview$/i.test(req.path)
      ? importJson(req, res, next)
      : next(),
  );
  const contentJson = express.json({ limit: '512kb' });
  app.use((req, res, next) =>
    /^\/api\/v1\/(?:courses\/[^/]+\/curriculum|problems)(?:\/|$)/.test(req.path)
      ? contentJson(req, res, next)
      : next(),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/v1/auth', authRouter(auth));
  app.use(
    '/api/v1/analytics',
    analyticsRouter(auth, coding, learning, analytics),
  );
  app.use('/api/v1', codingRouter(auth, coding, learning));
  app.use('/api/v1', attendanceRouter(auth, attendance, learning));
  app.use('/api/v1', curriculumRouter(auth, curriculum, learning));
  app.use('/api/v1', learningRouter(auth, learning));
  app.use('/api/v1', studentsRouter(auth, students));
  app.use('/api/v1', administrationRouter(auth, administration));
  app.use('/api/v1', apiRouter(ready));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
