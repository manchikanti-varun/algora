import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../utils/logger.js';
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const notFound: RequestHandler = (_req, _res, next) =>
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  void _next;
  const status =
    error instanceof AppError
      ? error.status
      : error?.type === 'entity.too.large'
        ? 413
        : error instanceof SyntaxError && 'body' in error
          ? 400
          : 500;
  const code =
    error instanceof AppError
      ? error.code
      : status === 413
        ? 'PAYLOAD_TOO_LARGE'
        : status === 400
          ? 'INVALID_JSON'
          : 'INTERNAL_ERROR';
  if (status >= 500)
    logger.error(
      { requestId: res.locals.requestId, method: req.method },
      'Request failed',
    );
  res.status(status).json({
    success: false,
    error: {
      code,
      message:
        error instanceof AppError
          ? error.message
          : status === 500
            ? 'An unexpected error occurred'
            : status === 413
              ? 'Request body too large'
              : 'Invalid JSON',
      requestId: res.locals.requestId,
    },
  });
};
