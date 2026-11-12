import { z } from 'zod';
const schema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z
    .url()
    .refine(
      (v) => ['http:', 'https:'].includes(new URL(v).protocol),
      'HTTP URL required',
    ),
});
export const env = schema.parse({
  NEXT_PUBLIC_API_BASE_URL:
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    (process.env.NODE_ENV === 'production'
      ? undefined
      : 'http://localhost:5000/api/v1'),
});
