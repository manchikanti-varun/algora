import type { RequestHandler } from 'express';
export const health: RequestHandler = (_req, res) => {
  res.json({
    success: true,
    data: { service: 'algora-backend', status: 'ok' },
  });
};
