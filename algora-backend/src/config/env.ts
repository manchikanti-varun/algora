import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');
const flag = bool;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().trim().regex(/^mongodb(?:\+srv)?:\/\/\S+$/, 'must be a MongoDB connection URI'),
  GOOGLE_CLIENT_ID: z.string().trim().min(1),
  // Missing or malformed => the process refuses to start (fail secure).
  SUPER_ADMIN_EMAIL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email()),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  /** Previous secret, accepted for verification only, so the secret can be rotated without signing everyone out. */
  SESSION_SECRET_PREVIOUS: z.string().min(32).optional().or(z.literal('').transform(() => undefined)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  FRONTEND_URL: z.string().url(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

const integrationSchema = z.object({
  LEETCODE_SYNC_ENABLED: bool,
  /** Run the background scheduler in this process. Set false on API replicas when a separate worker service runs it. */
  LEETCODE_SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** Automatic synchronization interval in bootcamp hours, measured from each student's last SUCCESSFUL sync. */
  LEETCODE_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(30),
  /**
   * The basis on which Algora accesses LeetCode data. This is a statement about OUR access arrangement, not a LeetCode key.
   * Without a basis (NONE) no provider that reaches LeetCode is authorised.
   */
  LEETCODE_ACCESS_BASIS: z.enum(['NONE', 'TERMS', 'WRITTEN_PERMISSION', 'LICENSED_THIRD_PARTY', 'INSTITUTIONAL', 'COMMERCIAL', 'OWN_RISK']).optional(),
  /** Reference to the document behind the access basis (written permission, contract, licence). */
  LEETCODE_ACCESS_REF: z.string().trim().max(200).optional(),
  /** @deprecated Fallback for LEETCODE_ACCESS_REF only when WRITTEN_PERMISSION is explicitly configured. Kept for existing deployments. */
  LEETCODE_PERMISSION_REF: z.string().trim().max(200).optional(),
  /** Comma-separated provider ids in preferred order. Admins may reorder at runtime; unknown ids fail validation. */
  LEETCODE_PROVIDER_PRIORITY: z.string().trim().default('direct,leetcode-query')
    .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(['direct', 'alfa', 'leetcode-query', 'mock'])).min(1)),
  LEETCODE_DIRECT_ENABLED: flag,
  LEETCODE_ALFA_ENABLED: flag,
  LEETCODE_QUERY_ENABLED: flag,
  /** Development/test only. Refused in production. */
  LEETCODE_MOCK_ENABLED: flag,
  LEETCODE_ALFA_BASE_URL: z.string().trim().url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, 'Must be an HTTPS URL without credentials, query, or fragment').optional().or(z.literal('').transform(() => undefined)),
  /** Access reference for the Alfa deployment used ("self-hosted" for our own instance). */
  LEETCODE_ALFA_PERMISSION_REF: z.string().trim().max(200).optional(),
  LEETCODE_ALFA_CACHE_SEC: z.coerce.number().int().min(0).max(3600).default(300),
  LEETCODE_QUERY_MODE: z.enum(['accepted', 'all-status']).default('accepted'),
  /** Ceilings. Shared LeetCode upstream budget (all providers together) and per-provider budgets. Admin settings can only lower them. */
  LEETCODE_GLOBAL_RATE_PER_MIN: z.coerce.number().int().min(1).max(600).default(10),
  LEETCODE_DIRECT_RATE_PER_MIN: z.coerce.number().int().min(1).max(600).optional(),
  LEETCODE_ALFA_RATE_PER_MIN: z.coerce.number().int().min(1).max(600).default(2),
  LEETCODE_QUERY_RATE_PER_MIN: z.coerce.number().int().min(1).max(600).optional(),
  /** Manual update cooldown per student, measured from their last manual request. Not shared with automatic attempts. */
  LEETCODE_STUDENT_COOLDOWN_SEC: z.coerce.number().int().min(10).default(600),
  LEETCODE_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  LEETCODE_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  LEETCODE_PROVIDER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(50).default(5),
  LEETCODE_PROVIDER_RECOVERY_INTERVAL_SEC: z.coerce.number().int().min(10).max(3600).default(120),
  /** Extra providers tried after the first one fails for a provider-specific reason. */
  LEETCODE_MAX_FAILOVER: z.coerce.number().int().min(0).max(5).default(1),
  /** A consenting account used only for admin-triggered health checks. */
  LEETCODE_HEALTHCHECK_USERNAME: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  LEETCODE_CONTACT: z.string().trim().max(120).optional(),
  /** Bootcamp hours, e.g. "09:30-16:30". Outside this window only the reduced-frequency sweep runs. */
  LEETCODE_BOOTCAMP_HOURS: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/).refine((hours) => hours.slice(0, 5) < hours.slice(6), 'Start must precede end').default('09:30-16:30'),
  LEETCODE_BOOTCAMP_DAYS: z.string().regex(/^[0-6](,[0-6])*$/).default('1,2,3,4,5'),
  LEETCODE_TZ_OFFSET_MIN: z.coerce.number().int().min(-720).max(840).default(330),
  /** Optional term dates for the default calendar. Outside them only the reduced off-hours sweep runs. Per-batch overrides exist. */
  LEETCODE_BOOTCAMP_START: z.coerce.date().optional(),
  LEETCODE_BOOTCAMP_END: z.coerce.date().optional(),
});

const parsed = schema
  .superRefine((v, ctx) => {
    // Unfilled template values (any environment): name every one so the fix is obvious.
    for (const [k, val] of Object.keys(v).map((key) => [key, process.env[key]] as const)) if (typeof val === 'string' && val.includes('REPLACE_WITH_')) ctx.addIssue({ code: 'custom', path: [k], message: 'still contains a REPLACE_WITH_ placeholder' });
    const prod = v.NODE_ENV === 'production';
    if (prod) {
      if (!v.FRONTEND_URL.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['FRONTEND_URL'], message: 'must be an https:// URL in production' });
      if (/^(.)\1+$/.test(v.SESSION_SECRET) || /change|secret|example|password/i.test(v.SESSION_SECRET)) ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'looks like a placeholder; generate one with: openssl rand -base64 48' });
      if (/localhost|127\.0\.0\.1/.test(v.MONGODB_URI) && process.env.ALLOW_LOCAL_MONGODB !== 'true') ctx.addIssue({ code: 'custom', path: ['MONGODB_URI'], message: 'points at localhost in production' });
      if (v.SESSION_SECRET_PREVIOUS && v.SESSION_SECRET_PREVIOUS === v.SESSION_SECRET) ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET_PREVIOUS'], message: 'must differ from SESSION_SECRET' });
    }
  })
  .safeParse(process.env);
if (!parsed.success) {
  // Never print values, only which keys are wrong.
  const keys = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'invalid environment configuration', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }) + '\n');
  console.error(`Invalid environment configuration:\n  ${keys}`);
  throw new Error('Invalid environment configuration');
}

export type AccessBasis = 'NONE' | 'TERMS' | 'WRITTEN_PERMISSION' | 'LICENSED_THIRD_PARTY' | 'INSTITUTIONAL' | 'COMMERCIAL' | 'OWN_RISK';

type IntegrationKey = keyof typeof integrationSchema.shape;
const integrationInput = Object.fromEntries(Object.keys(integrationSchema.shape).flatMap((key) => {
  const value = process.env[key]?.trim();
  return value ? [[key, value]] : [];
}));
const issues: Partial<Record<IntegrationKey, string>> = {};
for (const key of Object.keys(integrationSchema.shape) as IntegrationKey[]) {
  const value = integrationInput[key];
  if (value?.includes('REPLACE_WITH_')) {
    issues[key] = 'contains an unfilled template placeholder';
  } else {
    const result = integrationSchema.shape[key].safeParse(value);
    if (!result.success) issues[key] = result.error.issues.map((issue) => issue.message).join('; ');
  }
  if (issues[key]) delete integrationInput[key];
}
const integration = integrationSchema.parse(integrationInput);
if (integration.LEETCODE_BOOTCAMP_START && integration.LEETCODE_BOOTCAMP_END &&
  integration.LEETCODE_BOOTCAMP_START > integration.LEETCODE_BOOTCAMP_END) {
  issues.LEETCODE_BOOTCAMP_END = 'must be on or after LEETCODE_BOOTCAMP_START';
}
export const leetcodeConfigIssues = issues;

const { LEETCODE_PERMISSION_REF, ...leetcode } = integration;
export const env = {
  ...parsed.data,
  ...leetcode,
  FRONTEND_ORIGIN: new URL(parsed.data.FRONTEND_URL).origin,
  isProd: parsed.data.NODE_ENV === 'production',
  LEETCODE_ACCESS_BASIS: leetcode.LEETCODE_ACCESS_BASIS ?? 'NONE' as AccessBasis,
  // Legacy reference is accepted only with an explicit written-permission basis.
  LEETCODE_ACCESS_REF: leetcode.LEETCODE_ACCESS_REF ??
    (leetcode.LEETCODE_ACCESS_BASIS === 'WRITTEN_PERMISSION' ? LEETCODE_PERMISSION_REF : undefined),
};
