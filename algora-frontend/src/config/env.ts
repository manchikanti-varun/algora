import { z } from 'zod';
const schema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z
    .string()
    .refine(
      (v) =>
        v === '/backend' ||
        (process.env.NODE_ENV !== 'production' && /^https?:\/\//.test(v)),
      'Use /backend for production same-origin authentication',
    ),
});
export const env = schema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? '/backend',
});
