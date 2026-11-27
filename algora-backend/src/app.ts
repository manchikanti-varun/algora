import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { SESSION_COOKIE, verifySession } from './modules/auth/session';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './lib/errors';
import { requestLogger } from './lib/logger';

/** Set by server.ts once start-up work has completed. */
export const readiness = { startupDone: process.env.NODE_ENV === 'test' };
import { csrfProtection } from './middleware/auth';
import { authRouter } from './modules/auth/auth.routes';
import { batchesRouter } from './modules/batches/batches.routes';
import { chaptersRouter, coursesRouter, problemsRouter } from './modules/courses/courses.routes';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { leetcodeRouter } from './modules/leetcode/leetcode.routes';
import { leaderboardsRouter, settingsRouter } from './modules/progress/progress.routes';
import { analyticsRouter, reportsRouter } from './modules/analytics/analytics.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { auditRouter, collegesRouter, pendingRouter, studentsRouter } from './modules/admin/admin.routes';
import { manageRequestsRouter } from './modules/student/requests';
import { studentRouter } from './modules/student/student.routes';
import { trainerRequestsRouter, trainersRouter } from './modules/trainers/trainers.routes';
import { attendanceRouter } from './modules/attendance/attendance.routes';

export function createApp() {
  const app = express();
  // Number of reverse proxies in front of the app (Railway edge = 1). Verify in staging; see docs/DEPLOYMENT.md.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(helmet());
  // Only the configured frontend origin gets CORS headers; anything else gets none.
  app.use(cors({ origin: (origin, cb) => cb(null, origin === env.FRONTEND_ORIGIN), credentials: true, maxAge: 600 }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(requestLogger);
  /** Liveness: the process is up and connected. Railway health check. */
  app.get('/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1;
    res.status(db ? 200 : 503).json({ ok: db, db: db ? 'up' : 'down' });
  });
  /** Readiness: DB answers a ping and start-up (indexes, Super Admin reconciliation) has finished. */
  app.get('/ready', async (_req, res) => {
    const ping = await mongoose.connection.db?.admin().ping().then(() => true, () => false);
    const ready = !!ping && readiness.startupDone;
    res.status(ready ? 200 : 503).json({ ready, db: ping ? 'up' : 'down', startup: readiness.startupDone ? 'done' : 'pending' });
  });

  const api = express.Router();
  // Key by signed-in user when the session cookie is valid (traffic arrives through the Vercel proxy, so many users may share
  // an IP), otherwise by client IP.
  const keyGenerator = (req: express.Request) => { const s = verifySession(req.cookies?.[SESSION_COOKIE]); return s ? `u:${s.uid}` : `ip:${ipKeyGenerator(req.ip ?? '')}`; };
  const limiter = (windowMs: number, limit: number, key = keyGenerator) =>
    rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: key, skip: () => env.NODE_ENV === 'test',
      handler: (_req, res) => void res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'We’re receiving a lot of requests. Please try again in a moment.' } }) });
  const addressKey = (req: express.Request) => ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? '');
  const ordinary = limiter(60_000, 300);
  const sessionReads = limiter(60_000, 1500);
  const credentialIP = limiter(60_000, 1000, addressKey);
  const credentialInstance = limiter(60_000, 3600, () => 'credential-instance');
  const credentials = (req: express.Request) => req.method === 'POST'
    && ['/auth/google', '/auth/register/student', '/trainer-requests'].includes(req.path.replace(/\/$/, '').toLowerCase());
  const publicRead = (req: express.Request) => req.method === 'GET'
    && ['/auth/me', '/auth/colleges'].includes(req.path.replace(/\/$/, '').toLowerCase());
  api.use((req, res, next) => credentials(req) ? credentialIP(req, res, (error) => {
    if (error) return next(error);
    credentialInstance(req, res, next);
  }) : (publicRead(req) ? sessionReads : ordinary)(req, res, next));
  api.use(csrfProtection);
  api.use('/auth', authRouter);
  api.use('/trainer-requests', trainerRequestsRouter);
  api.use('/trainers', trainersRouter);
  api.use('/courses', coursesRouter);
  api.use('/chapters', chaptersRouter);
  api.use('/problems', problemsRouter);
  api.use('/problem-library', catalogRouter);
  api.use('/batches/:id/pending', pendingRouter);
  api.use('/batches', express.text({ type: 'text/csv', limit: '1mb' }), batchesRouter);
  api.use('/student', studentRouter);
  api.use('/leetcode', leetcodeRouter);
  api.use('/settings', settingsRouter);
  api.use('/leaderboards', leaderboardsRouter);
  api.use('/analytics', analyticsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/reports', limiter(60_000, 20), reportsRouter);
  api.use('/colleges', collegesRouter);
  api.use('/student-requests', manageRequestsRouter);
  api.use('/students', studentsRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/audit-logs', auditRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
