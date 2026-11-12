import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  FRONTEND_URL: z
    .url()
    .default('http://localhost:3000')
    .refine((v) => new URL(v).origin === v, 'Expected exact origin'),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.url().optional(),
  SESSION_TTL: z.coerce.number().int().min(300).max(2592000).default(604800),
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
const oauth = [
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI,
];
if (oauth.some(Boolean) && !oauth.every(Boolean))
  throw new Error('Configure all Google OAuth variables together');
if (!env.CORS_ORIGINS.includes(env.FRONTEND_URL))
  throw new Error('FRONTEND_URL must be in CORS_ORIGINS');
if (
  env.GOOGLE_REDIRECT_URI &&
  env.GOOGLE_REDIRECT_URI !== env.FRONTEND_URL + '/backend/auth/google/callback'
)
  throw new Error(
    'Google callback must use the frontend same-origin backend rewrite',
  );
if (
  env.NODE_ENV === 'production' &&
  (!env.FRONTEND_URL.startsWith('https://') ||
    env.CORS_ORIGINS.some((v) => !v.startsWith('https://')))
)
  throw new Error('Production origins require HTTPS');
