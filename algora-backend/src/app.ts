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
export function createApp(
  ready = databaseReady,
  auth?: AuthDependencies,
  administration?: AdminRepository,
) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId);
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
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) =>
        req.path === '/api/v1/health' || req.path === '/api/v1/ready',
      handler: (_req, res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many requests')),
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/v1/auth', authRouter(auth));
  app.use('/api/v1', administrationRouter(auth, administration));
  app.use('/api/v1', apiRouter(ready));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
