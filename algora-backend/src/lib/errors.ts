import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { log } from './logger';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', m);
export const forbidden = (m = 'Forbidden', code = 'FORBIDDEN') => new AppError(403, code, m);
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m: string, code = 'CONFLICT') => new AppError(409, code, m);

/** Parse and validate untrusted input with Zod. Throws a 400 AppError on failure. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Invalid input',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Route not found'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON' } });
    return;
  }
  if (err?.code === 11000) {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with these values already exists' } });
    return;
  }
  // Unknown: log server-side with the request id, return nothing internal.
  log.error('unhandled error', { reqId: req.id, method: req.method, path: req.baseUrl + req.path, error: err });
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId: req.id } });
};
