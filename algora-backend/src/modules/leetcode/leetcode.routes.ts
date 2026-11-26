import { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { env, leetcodeConfigIssues } from '../../config/env';
import { badRequest, parse } from '../../lib/errors';
import { pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { EvidenceConflict, LeetcodeSyncJob, ProviderEvent, User } from '../../models';
import { audit } from '../audit/audit';
import { ceilings, effectiveSources, loadSettings, rawSettings, saveSettings, settingsSchema } from './integration-settings';
import { manualEligibility } from './sync.policy';
import { policy } from './leetcode-sync.service';
import { activeJob, requestManualSync } from './sync-queue';
import { DELAY_THRESHOLD_MS, displayStatus, queueMetrics } from './sync-metrics';
import { requestStats } from './request-stats';
import { hasEligibleProvider, providerViews, runHealthChecks, upstreamBucket } from './provider-manager';
import { upstreamBlock } from './provider-health.service';
import { accessSummary, registry, providerEnvEnabled } from './providers/provider.registry';
import { availableTokens } from '../../lib/ratelimit';
import { burstOf } from './provider-manager';
import { linkView } from './links.service';

export const leetcodeRouter = Router();
leetcodeRouter.use(requireAuth);

/** Everything the student UI needs, from the database. Timestamps are authoritative: the browser only counts down to them. */
export async function syncView(studentId: Types.ObjectId) {
  const settings = await loadSettings();
  const now = new Date();
  const [u, job, last] = await Promise.all([User.findById(studentId, 'sync leetcodeUsername').lean(), activeJob(studentId), LeetcodeSyncJob.findOne({ studentId, status: { $in: ['SUCCEEDED', 'FAILED'] } }, 'status trigger finishedAt result.newlyVerified result.status').sort({ finishedAt: -1 }).lean()]);
  const s = u?.sync;
  const pol = policy();
  const manual = manualEligibility(s?.lastManualRequestAt, now, pol);
  const backoffUntil = s?.nextEligibleAt && s.nextEligibleAt > now ? s.nextEligibleAt : null;
  const nextManualAt = backoffUntil && (!manual.nextEligibleAt || backoffUntil > manual.nextEligibleAt) ? backoffUntil : manual.eligible ? null : manual.nextEligibleAt;
  const remaining = nextManualAt ? Math.max(0, Math.ceil((nextManualAt.getTime() - now.getTime()) / 1000)) : 0;
  const stale = s?.status === 'SYNCING' && !job;
  const link = await linkView(studentId);
  const syncEnabled = env.LEETCODE_SYNC_ENABLED && (await hasEligibleProvider({ ignorePause: true }));
  return {
    serverTime: now,
    // Configured at all (a pause is a temporary state shown separately).
    syncEnabled, paused: env.LEETCODE_SYNC_ENABLED && settings.paused,
    status: displayStatus(job, stale ? 'SYNC_FAILED' : s?.status, now), statusDetail: s?.statusDetail ?? null,
    lastSuccessAt: s?.lastSuccessAt ?? null, lastAttemptAt: s?.lastAttemptAt ?? null, lastManualRequestAt: s?.lastManualRequestAt ?? null,
    nextAutoSyncAt: link.state === 'LINKED' && syncEnabled && !settings.paused ? s?.nextAutoSyncAt ?? null : null,
    autoIntervalMin: settings.autoIntervalMin,
    nextManualAt, cooldownRemainingSec: remaining, canRequest: syncEnabled && !settings.paused && link.state === 'LINKED' && remaining === 0 && !job,
    job: job ? { id: String(job._id), attempts: job.attempts ?? 0, status: job.status, trigger: job.trigger, enqueuedAt: job.enqueuedAt, runAfter: job.runAfter, startedAt: job.startedAt ?? null, delayed: job.status === 'QUEUED' && now.getTime() - job.runAfter.getTime() > DELAY_THRESHOLD_MS } : null,
    lastResult: s?.status ?? null,
    lastJob: last ? { status: last.status, trigger: last.trigger, finishedAt: last.finishedAt ?? null, newlyVerified: last.result?.newlyVerified ?? 0, outcome: last.result?.status ?? null } : null,
    possibleGap: !!s?.possibleGap, coverage: s?.coverage ?? null,
    hasUsername: !!u?.leetcodeUsername,
    link,
  };
}
leetcodeRouter.get('/sync-status', requireRole('STUDENT'), async (req, res) => res.json(await syncView(req.user!._id)));
/**
 * The ONLY student entry point to external synchronization. It queues a job (or returns the existing one); it never calls
 * LeetCode itself. The student is always the authenticated user: there is no student id in the request.
 */
leetcodeRouter.post('/request-sync', requireRole('STUDENT'), async (req, res) => {
  const r = await requestManualSync(String(req.user!._id));
  if (r.kind === 'COOLDOWN') return res.status(429).json({ reason: 'COOLDOWN', retryAfterSec: r.retryAfterSec, nextEligibleAt: r.nextEligibleAt, sync: await syncView(req.user!._id) });
  if (r.kind === 'UNAVAILABLE') {
    const message = r.reason === 'PAUSED' ? 'Synchronization is paused by the administrator' : r.reason === 'NO_LINK' ? 'Link your LeetCode account first' : 'Automatic verification is not enabled yet';
    return res.json({ accepted: false, outcome: { status: r.reason === 'PAUSED' ? 'SYNC_PAUSED' : 'VERIFICATION_UNAVAILABLE', message, newlyVerified: 0, possibleGap: false }, sync: await syncView(req.user!._id) });
  }
  res.status(202).json({ accepted: true, created: r.kind === 'QUEUED', job: { id: r.job.id, status: r.job.status, trigger: r.job.trigger }, sync: await syncView(req.user!._id) });
});
// ---------- Super Admin: integration ----------
const admin = requireRole('SUPER_ADMIN');

/** Overall integration view for the dashboard. Never returns credentials, base URLs or permission references. */
leetcodeRouter.get('/integration', admin, async (_req, res) => {
  const { settings, views, states } = await providerViews();
  const upstream = upstreamBlock(states, 'leetcode-graphql');
  const eligible = views.filter((v) => v.envEnabled && v.adminEnabled && v.authorized);
  const access = accessSummary();
  const stored = await rawSettings();
  const selected = settings.paused ? null : eligible.find((v) => v.status === 'HEALTHY' || v.status === 'DEGRADED') ?? null;
  const [queue, requests, failures, gaps, reduced, conflicts] = await Promise.all([
    queueMetrics(), requestStats(),
    User.countDocuments({ role: 'STUDENT', 'sync.status': { $in: ['SYNC_FAILED', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'ACCOUNT_NOT_FOUND', 'SUBMISSIONS_UNAVAILABLE', 'VERIFICATION_UNAVAILABLE'] } }),
    User.countDocuments({ role: 'STUDENT', 'sync.possibleGap': true }),
    User.countDocuments({ role: 'STUDENT', 'sync.coverage': 'REDUCED' }),
    EvidenceConflict.countDocuments({ at: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }),
  ]);
  // One overall state and the exact reason synchronization is (un)available.
  const enabledViews = views.filter((v) => v.envEnabled && v.adminEnabled);
  const primary = eligible[0] ?? null;
  const [overall, overallReason] = !env.LEETCODE_SYNC_ENABLED ? ['DISABLED', 'LEETCODE_SYNC_ENABLED is false']
    : !enabledViews.length ? ['DISABLED', 'No provider is enabled (set LEETCODE_DIRECT_ENABLED=true)']
    : !access.activated && !eligible.length ? ['AWAITING_ACTIVATION', access.reason]
    : !eligible.length ? ['DISABLED', views.find((v) => v.envEnabled)?.stateReason ?? 'No eligible provider']
    : settings.paused ? ['PAUSED', 'Synchronization paused by the Super Admin']
    : upstream ? [upstream.reason === 'UPSTREAM_RATE_LIMITED' ? 'RATE_LIMITED' : upstream.reason === 'UPSTREAM_ACCESS_DENIED' ? 'UPSTREAM_RESTRICTED' : 'UNAVAILABLE', primary?.stateReason ?? upstream.reason]
    : [primary!.state, primary!.stateReason];
  const tokens = await availableTokens(upstreamBucket('leetcode-graphql'), settings.ratePerMin, burstOf(settings.ratePerMin));
  res.json({
    overall, overallReason, syncEnabled: env.LEETCODE_SYNC_ENABLED, paused: settings.paused, configurationIssues: leetcodeConfigIssues,
    activation: { basis: access.basis, activated: access.activated, reason: access.reason },
    lastSuccessfulSyncAt: (await User.findOne({ role: 'STUDENT', 'sync.lastSuccessAt': { $exists: true } }, 'sync.lastSuccessAt').sort({ 'sync.lastSuccessAt': -1 }).lean())?.sync?.lastSuccessAt ?? null,
    selectedProvider: selected?.id ?? null, priority: settings.priority,
    upstream: { id: 'leetcode-graphql', blocked: !!upstream, blockedUntil: upstream?.until ?? null, reason: upstream?.reason ?? null, ratePerMin: settings.ratePerMin, tokensAvailable: tokens, utilizationPct: Math.round((1 - tokens / burstOf(settings.ratePerMin)) * 100), requests },
    providers: views,
    queue,
    schedule: { bootcampHours: env.LEETCODE_BOOTCAMP_HOURS, bootcampDays: env.LEETCODE_BOOTCAMP_DAYS, tzOffsetMin: env.LEETCODE_TZ_OFFSET_MIN, termStart: env.LEETCODE_BOOTCAMP_START ?? null, termEnd: env.LEETCODE_BOOTCAMP_END ?? null },
    students: { withFailures: failures, possibleGaps: gaps, reducedCoverage: reduced }, conflicts7d: conflicts,
    settings: { ...stored, sources: effectiveSources(stored), effective: { ratePerMin: settings.ratePerMin, autoIntervalMin: settings.autoIntervalMin, offHoursIntervalMin: settings.offHoursIntervalMin, studentCooldownSec: settings.studentCooldownSec, concurrency: settings.concurrency, providerRatePerMin: Object.fromEntries(registry().map((p) => [p.id, settings.providerRatePerMin(p.id)])) }, ceilings: ceilings() },
    healthCheckConfigured: !!env.LEETCODE_HEALTHCHECK_USERNAME,
  });
});

/** Update runtime controls. Bounded by the environment: cannot enable/authorise providers or exceed rate ceilings. */
leetcodeRouter.put('/integration/settings', admin, async (req, res) => {
  // Partial update merged onto the stored settings, so e.g. pausing never resets priority or disabled providers.
  // `null` on a numeric override clears it, so the environment default applies again (JSON drops `undefined`).
  const CLEARABLE = ['ratePerMin', 'autoIntervalMin', 'offHoursIntervalMin', 'studentCooldownSec', 'concurrency'];
  const body: Record<string, unknown> = { ...(req.body ?? {}) };
  const cleared = CLEARABLE.filter((k) => body[k] === null);
  for (const k of cleared) delete body[k];
  const parsed = parse(settingsSchema.partial().strict(), body);
  const sent = new Set(Object.keys(body));
  const patch = Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))); // zod fills defaults; keep only what was sent
  const merged: Record<string, unknown> = { ...(await rawSettings()), ...patch };
  for (const k of cleared) delete merged[k];
  const v = settingsSchema.parse(merged);
  const known = registry().map((p) => p.id);
  const unknown = [...(v.priority ?? []), ...v.disabled, ...Object.keys(v.providerRatePerMin)].filter((id) => !known.includes(id));
  if (unknown.length) throw badRequest(`Unknown provider(s): ${[...new Set(unknown)].join(', ')}`);
  const c = ceilings();
  if (v.ratePerMin && v.ratePerMin > c.ratePerMin) throw badRequest(`ratePerMin cannot exceed the configured ceiling (${c.ratePerMin}/min)`);
  for (const [id, n] of Object.entries(v.providerRatePerMin)) if (n > (c.provider[id] ?? c.ratePerMin)) throw badRequest(`${id} rate cannot exceed its ceiling (${c.provider[id] ?? c.ratePerMin}/min)`);
  if (v.concurrency && v.concurrency > env.LEETCODE_CONCURRENCY) throw badRequest(`concurrency cannot exceed the configured ceiling (${env.LEETCODE_CONCURRENCY})`);
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

/** Failed and cancelled jobs for review (sanitised: no provider details). */
leetcodeRouter.get('/integration/jobs', admin, async (req, res) => {
  const q = parse(pagination.extend({ status: z.enum(['FAILED', 'CANCELLED', 'QUEUED', 'RUNNING', 'SUCCEEDED']).default('FAILED') }), req.query);
  const [items, total] = await Promise.all([LeetcodeSyncJob.find({ status: q.status }, 'studentId trigger status attempts enqueuedAt startedAt finishedAt result.status result.error cancelReason').sort({ enqueuedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate('studentId', 'fullName rollNumber').lean(), LeetcodeSyncJob.countDocuments({ status: q.status })]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});
/** Students with a possible evidence gap (not an accusation: the 20-record window may simply have been outrun). */
leetcodeRouter.get('/integration/gaps', admin, async (req, res) => {
  const q = parse(pagination, req.query);
  const f: Record<string, unknown> = { role: 'STUDENT', 'sync.possibleGap': true };
  const [items, total] = await Promise.all([User.find(f, 'fullName rollNumber sync.lastGapAt sync.lastSuccessAt').sort({ 'sync.lastGapAt': -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), User.countDocuments(f)]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize, note: 'A full 20-record window with no overlap with earlier observations. Older accepted submissions may not be recoverable.' });
});
/** Back-compat summary (older dashboard code). */
leetcodeRouter.get('/health', admin, async (_req, res) => {
  const { views, settings } = await providerViews();
  const sel = views.find((v) => v.envEnabled && v.adminEnabled && v.authorized && (v.status === 'HEALTHY' || v.status === 'DEGRADED'));
  res.json({ enabled: env.LEETCODE_SYNC_ENABLED && !!views.find((v) => v.envEnabled && v.authorized && v.adminEnabled), provider: sel?.id ?? 'none', breaker: sel?.breaker ?? 'CLOSED', ratePerMin: settings.ratePerMin });
});
