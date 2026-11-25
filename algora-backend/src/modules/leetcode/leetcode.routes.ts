import { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env';
import { badRequest, parse } from '../../lib/errors';
import { pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { EvidenceConflict, ProviderEvent, User } from '../../models';
import { audit } from '../audit/audit';
import { ceilings, loadSettings, rawSettings, saveSettings, settingsSchema } from './integration-settings';
import { cooldownRemainingSec } from './sync.policy';
import { dueQueue, policy, requestSync, STALE_SYNCING_MS } from './leetcode-sync.service';
import { hasEligibleProvider, providerViews, runHealthChecks, upstreamBucket } from './provider-manager';
import { upstreamBlock } from './provider-health.service';
import { registry, providerEnvEnabled } from './providers/provider.registry';
import { availableTokens } from '../../lib/ratelimit';
import { linkView } from './links.service';

export const leetcodeRouter = Router();
leetcodeRouter.use(requireAuth);

export async function syncView(studentId: Types.ObjectId) {
  await loadSettings();
  const u = await User.findById(studentId, 'sync leetcodeUsername').lean();
  const s = u?.sync;
  const stale = s?.status === 'SYNCING' && (!s.lastAttemptAt || Date.now() - s.lastAttemptAt.getTime() > STALE_SYNCING_MS); // crash recovery for the UI
  const settings = await loadSettings();
  return {
    // Configured at all (a pause is a temporary state shown separately).
    syncEnabled: env.LEETCODE_SYNC_ENABLED && (await hasEligibleProvider(undefined, { ignorePause: true })),
    paused: env.LEETCODE_SYNC_ENABLED && settings.paused,
    status: stale ? 'SYNC_FAILED' : s?.status ?? 'IDLE', lastSuccessAt: s?.lastSuccessAt ?? null, lastAttemptAt: s?.lastAttemptAt ?? null,
    possibleGap: !!s?.possibleGap, coverage: s?.coverage ?? null, cooldownRemainingSec: cooldownRemainingSec(s?.lastAttemptAt, new Date(), policy()),
    hasUsername: !!u?.leetcodeUsername,
    link: await linkView(studentId),
  };
}

leetcodeRouter.get('/sync-status', requireRole('STUDENT'), async (req, res) => res.json(await syncView(req.user!._id)));

leetcodeRouter.post('/request-sync', requireRole('STUDENT'), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.enum(['MANUAL', 'TAB_RETURN']).default('MANUAL') }), req.body ?? {});
  const r = await requestSync(String(req.user!._id), reason);
  // Students never see provider names or failover details.
  const outcome = r.accepted ? { status: r.outcome.status, message: r.outcome.message, newlyVerified: r.outcome.newlyVerified, possibleGap: r.outcome.possibleGap, retryAfterSec: r.outcome.retryAfterSec, coverage: r.outcome.coverage } : undefined;
  res.status(r.accepted ? 200 : 429).json({ ...(r.accepted ? { outcome } : { reason: r.reason, retryAfterSec: r.retryAfterSec }), sync: await syncView(req.user!._id) });
});

// ---------- Super Admin: integration ----------
const admin = requireRole('SUPER_ADMIN');

/** Overall integration view for the dashboard. Never returns credentials, base URLs or permission references. */
leetcodeRouter.get('/integration', admin, async (_req, res) => {
  const { settings, views, states } = await providerViews();
  const upstream = upstreamBlock(states, 'leetcode-graphql');
  const eligible = views.filter((v) => v.envEnabled && v.adminEnabled && v.authorized);
  const selected = eligible.find((v) => v.status === 'HEALTHY' || v.status === 'DEGRADED') ?? null;
  const [queue, failures, gaps, reduced, conflicts] = await Promise.all([
    env.LEETCODE_SYNC_ENABLED ? dueQueue() : Promise.resolve({ eligible: 0, due: [], syncing: 0 }),
    User.countDocuments({ role: 'STUDENT', 'sync.status': { $in: ['SYNC_FAILED', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED'] } }),
    User.countDocuments({ role: 'STUDENT', 'sync.possibleGap': true }),
    User.countDocuments({ role: 'STUDENT', 'sync.coverage': 'REDUCED' }),
    EvidenceConflict.countDocuments({ at: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }),
  ]);
  const overall = !env.LEETCODE_SYNC_ENABLED ? 'DISABLED' : settings.paused ? 'PAUSED' : !eligible.length ? 'NO_AUTHORIZED_PROVIDER'
    : upstream ? 'UPSTREAM_BLOCKED' : eligible.every((v) => v.status === 'HEALTHY') ? 'HEALTHY' : eligible.some((v) => v.status === 'HEALTHY' || v.status === 'DEGRADED') ? 'DEGRADED' : 'UNAVAILABLE';
  const tokens = await availableTokens(upstreamBucket('leetcode-graphql'), settings.ratePerMin, Math.max(5, settings.ratePerMin));
  res.json({
    overall, syncEnabled: env.LEETCODE_SYNC_ENABLED, paused: settings.paused, permissionConfigured: !!env.LEETCODE_PERMISSION_REF,
    selectedProvider: selected?.id ?? null, priority: settings.priority,
    upstream: { id: 'leetcode-graphql', blocked: !!upstream, blockedUntil: upstream?.until ?? null, reason: upstream?.reason ?? null, ratePerMin: settings.ratePerMin, tokensAvailable: tokens, utilizationPct: Math.round((1 - tokens / Math.max(5, settings.ratePerMin)) * 100) },
    providers: views,
    queue: { eligibleStudents: queue.eligible, due: queue.due.length, syncing: queue.syncing },
    students: { withFailures: failures, possibleGaps: gaps, reducedCoverage: reduced }, conflicts7d: conflicts,
    settings: { ...(await rawSettings()), effective: { ratePerMin: settings.ratePerMin, activeIntervalMin: settings.activeIntervalMin, idleIntervalMin: settings.idleIntervalMin, offHoursIntervalMin: settings.offHoursIntervalMin, studentCooldownSec: settings.studentCooldownSec, providerRatePerMin: Object.fromEntries(registry().map((p) => [p.id, settings.providerRatePerMin(p.id)])) }, ceilings: ceilings() },
    healthCheckConfigured: !!env.LEETCODE_HEALTHCHECK_USERNAME,
  });
});

/** Update runtime controls. Bounded by the environment: cannot enable/authorise providers or exceed rate ceilings. */
leetcodeRouter.put('/integration/settings', admin, async (req, res) => {
  // Partial update merged onto the stored settings, so e.g. pausing never resets priority or disabled providers.
  const parsed = parse(settingsSchema.partial().strict(), req.body);
  const sent = new Set(Object.keys(req.body ?? {}));
  const patch = Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))); // zod fills defaults; keep only what was sent
  const v = settingsSchema.parse({ ...(await rawSettings()), ...patch });
  const known = registry().map((p) => p.id);
  const unknown = [...(v.priority ?? []), ...v.disabled, ...Object.keys(v.providerRatePerMin)].filter((id) => !known.includes(id));
  if (unknown.length) throw badRequest(`Unknown provider(s): ${[...new Set(unknown)].join(', ')}`);
  const c = ceilings();
  if (v.ratePerMin && v.ratePerMin > c.ratePerMin) throw badRequest(`ratePerMin cannot exceed the configured ceiling (${c.ratePerMin}/min)`);
  for (const [id, n] of Object.entries(v.providerRatePerMin)) if (n > (c.provider[id] ?? c.ratePerMin)) throw badRequest(`${id} rate cannot exceed its ceiling (${c.provider[id] ?? c.ratePerMin}/min)`);
  const before = await rawSettings();
  const enabledNow = (id: string) => !v.disabled.includes(id);
  const wouldEnableUnavailable = known.filter((id) => before.disabled.includes(id) && enabledNow(id) && !providerEnvEnabled(id));
  await saveSettings(v, req.user!._id);
  await audit(req, 'integration.settings', { type: 'Setting', id: 'leetcode' }, { before, after: v, ignoredEnable: wouldEnableUnavailable });
  res.json({ ok: true, note: wouldEnableUnavailable.length ? `Not enabled by environment, remains off: ${wouldEnableUnavailable.join(', ')}` : undefined });
});

leetcodeRouter.post('/integration/health-check', admin, async (req, res) => {
  const r = await runHealthChecks();
  await audit(req, 'integration.health_check', { type: 'Integration', id: 'leetcode' }, r);
  res.json(r);
});

leetcodeRouter.get('/integration/events', admin, async (req, res) => {
  const q = parse(pagination.extend({ type: z.enum(['FAILOVER', 'PROVIDER_ERROR', 'UPSTREAM_BLOCK', 'CIRCUIT_OPEN', 'CIRCUIT_CLOSED', 'HEALTH_CHECK', 'ALL_FAILED']).optional() }), req.query);
  const filter = q.type ? { type: q.type } : {};
  const [items, total] = await Promise.all([ProviderEvent.find(filter).sort({ at: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate('studentId', 'fullName rollNumber').lean(), ProviderEvent.countDocuments(filter)]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});

leetcodeRouter.get('/integration/conflicts', admin, async (req, res) => {
  const q = parse(pagination, req.query);
  const [items, total] = await Promise.all([EvidenceConflict.find({}).sort({ at: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate('studentId', 'fullName rollNumber').lean(), EvidenceConflict.countDocuments({})]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});

/** Back-compat summary (older dashboard code). */
leetcodeRouter.get('/health', admin, async (_req, res) => {
  const { views, settings } = await providerViews();
  const sel = views.find((v) => v.envEnabled && v.adminEnabled && v.authorized && (v.status === 'HEALTHY' || v.status === 'DEGRADED'));
  res.json({ enabled: env.LEETCODE_SYNC_ENABLED && !!views.find((v) => v.envEnabled && v.authorized && v.adminEnabled), provider: sel?.id ?? 'none', breaker: sel?.breaker ?? 'CLOSED', ratePerMin: settings.ratePerMin });
});
