import { Types } from 'mongoose';
import { z } from 'zod';

export const objectId = z.string().refine((v) => Types.ObjectId.isValid(v) && String(new Types.ObjectId(v)) === v, 'Invalid id');
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
