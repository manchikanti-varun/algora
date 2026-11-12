import { Router } from 'express';
import { health } from '../controllers/health.js';
export function apiRouter(ready: () => Promise<boolean>) {
  const router = Router();
  router.get('/health', health);
  router.get('/ready', async (_req, res) => {
    const available = await ready();
    res.status(available ? 200 : 503).json(
      available
        ? {
            success: true,
            data: { service: 'algora-backend', status: 'ready' },
          }
        : {
            success: false,
            error: {
              code: 'NOT_READY',
              message: 'Service dependencies unavailable',
              requestId: res.locals.requestId,
            },
          },
    );
  });
  return router;
}
