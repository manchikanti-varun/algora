import { z } from 'zod';
import { env } from '../../config/env';
import { Setting } from '../../models';
import { registry } from './providers/provider.registry';

/**
 * Runtime controls a Super Admin can change. They are bounded by the environment: an admin can pause, disable, reorder,
 * lower limits and concurrency and change intervals and the manual cooldown, but can never enable a provider the environment did not enable, never mark
 * a provider authorised, and never raise a rate above its environment ceiling.
 */
export const settingsSchema = z.object({
  paused: z.boolean().default(false),
  priority: z.array(z.string()).max(10).optional(),
  disabled: z.array(z.string()).max(10).default([]),
  ratePerMin: z.number().int().min(1).max(600).optional(),
  providerRatePerMin: z.record(z.string(), z.number().int().min(1).max(600)).default({}),
  /** Automatic sync interval in bootcamp hours (minutes after the last SUCCESSFUL sync). Defaults to LEETCODE_SYNC_INTERVAL_MINUTES. */
  autoIntervalMin: z.number().int().min(5).max(240).optional(),
  /** Reduced interval outside bootcamp hours. 0 disables automatic sync outside bootcamp hours (default). */
  offHoursIntervalMin: z.number().int().min(0).max(1440).refine((n) => n === 0 || n >= 15, 'must be 0 (disabled) or at least 15').optional(),
  /** Manual update cooldown per student. Defaults to LEETCODE_STUDENT_COOLDOWN_SEC. */
  studentCooldownSec: z.number().int().min(10).max(3600).optional(),
  /** Worker concurrency. Can only lower LEETCODE_CONCURRENCY. */
  concurrency: z.number().int().min(1).max(10).optional(),
  /** Record-keeping only: when the written-permission request to LeetCode was sent. Never authorises anything. */
  permissionRequestedAt: z.string().datetime().optional().nullable(),
});
export type IntegrationSettings = z.infer<typeof settingsSchema>;

export const ceilings = () => ({
  ratePerMin: env.LEETCODE_GLOBAL_RATE_PER_MIN,
  provider: {
    direct: env.LEETCODE_DIRECT_RATE_PER_MIN ?? env.LEETCODE_GLOBAL_RATE_PER_MIN,
    alfa: env.LEETCODE_ALFA_RATE_PER_MIN,
    'leetcode-query': env.LEETCODE_QUERY_RATE_PER_MIN ?? env.LEETCODE_GLOBAL_RATE_PER_MIN,
    mock: env.LEETCODE_GLOBAL_RATE_PER_MIN,
  } as Record<string, number>,
});

export interface Effective {
  paused: boolean; priority: string[]; disabled: Set<string>; ratePerMin: number; providerRatePerMin: (id: string) => number;
  autoIntervalMin: number; offHoursIntervalMin: number; studentCooldownSec: number; concurrency: number;
  timeoutMs: number; failureThreshold: number; recoveryMs: number; maxFailover: number;
}

let cache: { at: number; v: Effective } | null = null;
const TTL = 3000;

export function compute(s: IntegrationSettings): Effective {
  const c = ceilings();
  const known = registry().map((p) => p.id);
  const base = (env.LEETCODE_PROVIDER_PRIORITY as string[]).filter((id) => known.includes(id));
  const extra = known.filter((id) => !base.includes(id));
  const pr = (s.priority ?? []).filter((id) => known.includes(id));
  const priority = [...pr, ...[...base, ...extra].filter((id) => !pr.includes(id))];
  return {
    paused: s.paused, priority, disabled: new Set(s.disabled),
    ratePerMin: Math.min(c.ratePerMin, s.ratePerMin ?? c.ratePerMin),
    providerRatePerMin: (id) => Math.min(c.provider[id] ?? c.ratePerMin, s.providerRatePerMin[id] ?? Infinity),
    autoIntervalMin: s.autoIntervalMin ?? env.LEETCODE_SYNC_INTERVAL_MINUTES, offHoursIntervalMin: s.offHoursIntervalMin ?? 0,
    concurrency: Math.min(env.LEETCODE_CONCURRENCY, s.concurrency ?? env.LEETCODE_CONCURRENCY),
    studentCooldownSec: s.studentCooldownSec ?? env.LEETCODE_STUDENT_COOLDOWN_SEC,
    timeoutMs: env.LEETCODE_PROVIDER_TIMEOUT_MS, failureThreshold: env.LEETCODE_PROVIDER_FAILURE_THRESHOLD,
    recoveryMs: env.LEETCODE_PROVIDER_RECOVERY_INTERVAL_SEC * 1000, maxFailover: env.LEETCODE_MAX_FAILOVER,
  };
}

export async function loadSettings(force = false): Promise<Effective> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.v;
  const doc = await Setting.findById('leetcode').lean();
  const parsed = settingsSchema.safeParse(doc?.value ?? {});
  const v = compute(parsed.success ? parsed.data : settingsSchema.parse({}));
  cache = { at: Date.now(), v };
  return v;
}
/** Last loaded settings (sync access for pure policy code). Falls back to environment defaults. */
export const snapshot = (): Effective => cache?.v ?? compute(settingsSchema.parse({}));
export const invalidateSettings = () => { cache = null; };

export async function rawSettings(): Promise<IntegrationSettings> {
  const doc = await Setting.findById('leetcode').lean();
  const p = settingsSchema.safeParse(doc?.value ?? {});
  return p.success ? p.data : settingsSchema.parse({});
}
export async function saveSettings(v: IntegrationSettings, by: unknown) {
  await Setting.updateOne({ _id: 'leetcode' }, { $set: { value: v, updatedBy: by } }, { upsert: true });
  invalidateSettings();
  return loadSettings(true);
}
/**
 * Precedence, highest first: (1) runtime settings saved by the Super Admin, bounded by (2) environment ceilings
 * (rates, concurrency, provider enablement, authorisation: runtime can only lower or pause), then (3) environment defaults
 * (interval, cooldown). `effectiveSources` tells the dashboard where each effective value came from.
 */
export function effectiveSources(s: IntegrationSettings) {
  const src = (v: unknown) => (v === undefined ? 'environment' : 'runtime');
  return {
    ratePerMin: src(s.ratePerMin), autoIntervalMin: src(s.autoIntervalMin), offHoursIntervalMin: s.offHoursIntervalMin === undefined ? 'default' : 'runtime',
    studentCooldownSec: src(s.studentCooldownSec), concurrency: src(s.concurrency),
  };
}
