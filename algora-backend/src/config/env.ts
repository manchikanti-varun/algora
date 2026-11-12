import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()))
    .pipe(
      z
        .array(
          z.url().refine((value) => {
            const url = new URL(value);
            return (
              ['http:', 'https:'].includes(url.protocol) && url.origin === value
            );
          }, 'Expected an exact HTTP origin'),
        )
        .min(1),
    ),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});
const result = schema.safeParse(process.env);
if (!result.success)
  throw new Error(
    'Invalid backend environment: ' +
      result.error.issues.map((i) => i.path.join('.')).join(', '),
  );
export const env = result.data;
