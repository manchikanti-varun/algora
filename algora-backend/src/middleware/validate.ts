import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from './errors.js';
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return next(
        new AppError(400, 'VALIDATION_ERROR', 'Invalid request body'),
      );
    req.body = parsed.data;
    next();
  };
