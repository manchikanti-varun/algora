import { availableTokens, refundToken, takeToken } from '../../lib/ratelimit';
import { env } from '../../config/env';
import type { BreakerConfig } from './circuit-breaker';
import { loadSettings, rawSettings, type Effective } from './integration-settings';
import { ProviderError, scopeOf } from './leetcode.types';
import {
  blockUpstream, claimProbe, event, getStates, healthOf, noteUpstreamNetworkFailure, noteUpstreamSuccess, pKey,
  recordAnswered, recordFailure, recordProviderRateLimited, recordSuccess, technicalHealthOf, upstreamBlock, type HealthStatus, type StateDoc, type TechnicalHealth,
} from './provider-health.service';
import { providerEnvEnabled, registry } from './providers/provider.registry';
import type { FetchResult, SubmissionProvider } from './providers/provider.interface';

export const upstreamBucket = (u: string) => `upstream:${u}`;
export const providerBucket = (id: string) => `provider:${id}`;
const burstOf = (perMin: number) => Math.max(5, perMin);
const breakerCfg = (s: Effective): BreakerConfig => ({ threshold: s.failureThreshold, baseOpenMs: s.recoveryMs, maxOpenMs: Math.max(s.recoveryMs, 15 * 60_000) });

export interface Attempt { provider: string; outcome: 'OK' | 'FAILED' | 'SKIPPED'; kind?: string; reason?: string; latencyMs?: number }
export type ManagerResult<T> =
  | { ok: true; value: T; provider: SubmissionProvider; attempts: Attempt[]; failedOver: boolean }
  | { ok: false; reason: 'PAUSED' | 'NO_ELIGIBLE_PROVIDER' | 'PROVIDERS_UNAVAILABLE' | 'GLOBAL_RATE_LIMITED' | 'UPSTREAM_BLOCKED' | 'NOT_FOUND' | 'ALL_FAILED'; error?: ProviderError; retryAfterSec?: number; attempts: Attempt[] };

export interface ProviderView {
  id: string; displayName: string; capabilities: SubmissionProvider['capabilities']; priority: number;
  envEnabled: boolean; adminEnabled: boolean; authorized: boolean; authorizationReason?: string; transportKind: string;
  /** Combined status used for provider selection (kept for compatibility). */
  status: HealthStatus; breaker: string; nextEligibleAt: Date | null;
  /** Three independent dimensions for display. */
  authorizationStatus: 'AUTHORIZED' | 'AUTHORIZATION_PENDING' | 'NOT_AUTHORIZED';
  activation: 'ACTIVE' | 'INACTIVE'; activationReason: string | null;
  technicalHealth: TechnicalHealth;
  totalRequests: number; successes: number; failures: number; rateLimited: number; consecutiveFailures: number; successRate: number | null;
  avgLatencyMs: number | null; lastSuccessAt: Date | null; lastFailureAt: Date | null; lastError: string | null; lastErrorKind: string | null;
  ratePerMin: number; tokensAvailable: number;
}

/** Enabled = switched on in the environment AND not disabled by an admin. Admins cannot enable what env did not. */
const isEnabled = (p: SubmissionProvider, s: Effective) => providerEnvEnabled(p.id) && !s.disabled.has(p.id);

export async function providerViews(): Promise<{ settings: Effective; views: ProviderView[]; states: Map<string, StateDoc> }> {
  const s = await loadSettings();
  const requestedAt = (await rawSettings()).permissionRequestedAt ?? null;
  const states = await getStates();
  const views: ProviderView[] = [];
  for (const p of orderByPriority(registry(), s)) {
    const d = states.get(pKey(p.id));
    const auth = p.authorization();
    const blocked = !!upstreamBlock(states, p.capabilities.upstream);
    const h = healthOf(d, { enabled: isEnabled(p, s), authorized: auth.authorized, upstreamBlocked: blocked, cfg: breakerCfg(s), timeoutMs: s.timeoutMs });
    const rate = s.providerRatePerMin(p.id);
    const total = d?.totalRequests ?? 0;
    views.push({
      id: p.id, displayName: p.displayName, capabilities: p.capabilities, priority: s.priority.indexOf(p.id),
      envEnabled: providerEnvEnabled(p.id), adminEnabled: !s.disabled.has(p.id), authorized: auth.authorized, authorizationReason: auth.reason, transportKind: p.transportKind,
      status: h.status, breaker: h.breaker, nextEligibleAt: h.nextEligibleAt,
      authorizationStatus: auth.authorized ? 'AUTHORIZED' : requestedAt && p.id !== 'mock' ? 'AUTHORIZATION_PENDING' : 'NOT_AUTHORIZED',
      ...activationOf(p, s, auth.authorized),
      technicalHealth: technicalHealthOf(d, { upstreamBlocked: blocked, cfg: breakerCfg(s), timeoutMs: s.timeoutMs }),
      totalRequests: total, successes: d?.successes ?? 0, failures: d?.failures ?? 0, rateLimited: d?.rateLimited ?? 0, consecutiveFailures: d?.consecutiveFailures ?? 0,
      successRate: total ? Math.round(((d?.successes ?? 0) / total) * 1000) / 10 : null, avgLatencyMs: d?.latencyEwmaMs != null ? Math.round(d.latencyEwmaMs) : null,
      lastSuccessAt: d?.lastSuccessAt ?? null, lastFailureAt: d?.lastFailureAt ?? null, lastError: d?.lastError ?? null, lastErrorKind: d?.lastErrorKind ?? null,
      ratePerMin: rate, tokensAvailable: await availableTokens(providerBucket(p.id), rate, burstOf(rate)),
    });
  }
  return { settings: s, views, states };
}

function activationOf(p: SubmissionProvider, s: Effective, authorized: boolean): { activation: 'ACTIVE' | 'INACTIVE'; activationReason: string | null } {
  if (!env.LEETCODE_SYNC_ENABLED) return { activation: 'INACTIVE', activationReason: 'LEETCODE_SYNC_ENABLED is false' };
  if (!providerEnvEnabled(p.id)) return { activation: 'INACTIVE', activationReason: 'Not enabled in the server environment' };
  if (s.disabled.has(p.id)) return { activation: 'INACTIVE', activationReason: 'Disabled by the Super Admin' };
  if (!authorized) return { activation: 'INACTIVE', activationReason: 'Not authorised' };
  if (s.paused) return { activation: 'INACTIVE', activationReason: 'Synchronization paused' };
  return { activation: 'ACTIVE', activationReason: null };
}

function orderByPriority(list: SubmissionProvider[], s: Effective) {
  const idx = (id: string) => { const i = s.priority.indexOf(id); return i < 0 ? 999 : i; };
  return [...list].sort((a, b) => idx(a.id) - idx(b.id));
}

/** Upstream of the highest-priority enabled + authorised provider (for budgeting a scheduler pass). */
export async function primaryUpstream(): Promise<string | null> {
  const s = await loadSettings();
  return orderByPriority(registry(), s).find((p) => isEnabled(p, s) && p.authorization().authorized)?.capabilities.upstream ?? null;
}

/** Any provider that could ever serve requests right now (enabled + authorised), ignoring health. Cheap; no DB reads besides settings. */
export async function hasEligibleProvider(capability?: 'profileText', opts: { ignorePause?: boolean } = {}): Promise<boolean> {
  const s = await loadSettings();
  if (s.paused && !opts.ignorePause) return false;
  return registry().some((p) => isEnabled(p, s) && p.authorization().authorized && (!capability || p.capabilities[capability]));
}

/**
 * Ordered candidates in STRICT priority order. Excludes disabled, unauthorised, circuit-open (until a half-open probe is
 * available) and providers inside their own Retry-After window. Degraded providers (recent failures, high latency) keep their
 * place: demoting them would starve them of traffic, so they would never recover or close their breaker (sticky failover).
 * Repeated failures and timeouts open the breaker, which is what removes a bad provider; a half-open probe restores it.
 */
function candidates(s: Effective, states: Map<string, StateDoc>, capability?: 'profileText') {
  const out: { p: SubmissionProvider; halfOpenAt?: Date; tier: number }[] = [];
  let enabledAuthorized = 0;
  for (const p of orderByPriority(registry(), s)) {
    if (!isEnabled(p, s) || !p.authorization().authorized) continue;
    if (capability && !p.capabilities[capability]) continue;
    enabledAuthorized++;
    const d = states.get(pKey(p.id));
    const h = healthOf(d, { enabled: true, authorized: true, upstreamBlocked: false, cfg: breakerCfg(s), timeoutMs: s.timeoutMs });
    if (h.status === 'CIRCUIT_OPEN' || h.status === 'RATE_LIMITED') continue;
    out.push({ p, halfOpenAt: h.breaker === 'HALF_OPEN' && d?.openedAt ? new Date(d.openedAt) : undefined, tier: h.status === 'DEGRADED' ? 1 : 0 });
  }
  return { list: out, enabledAuthorized };
}

/**
 * Run one operation through ONE eligible provider, failing over only for provider-specific failures.
 *  - Upstream (LeetCode) restrictions or outages stop immediately and block every provider on that upstream.
 *  - "User not found" stops immediately (another provider would give the same answer).
 *  - Each attempt consumes one token of the shared upstream budget and one of the provider's own budget. Failover therefore
 *    never exceeds the shared LeetCode budget.
 *  - At most 1 + LEETCODE_MAX_FAILOVER attempts per call, so there are no retry loops.
 */
export async function runWithFailover<T>(
  op: (p: SubmissionProvider, signal: AbortSignal) => Promise<T>,
  ctx: { capability?: 'profileText'; studentId?: unknown; isProbe?: boolean } = {},
): Promise<ManagerResult<T>> {
  const s = await loadSettings();
  const attempts: Attempt[] = [];
  if (s.paused) return { ok: false, reason: 'PAUSED', attempts };
  const states = await getStates();
  const { list, enabledAuthorized } = candidates(s, states, ctx.capability);
  if (!enabledAuthorized) return { ok: false, reason: 'NO_ELIGIBLE_PROVIDER', attempts };
  if (!list.length) {
    const next = [...states.values()].map((d) => d.rateLimitedUntil ?? null).filter(Boolean) as Date[];
    return { ok: false, reason: 'PROVIDERS_UNAVAILABLE', attempts, retryAfterSec: next.length ? Math.max(1, Math.ceil((Math.min(...next.map((d) => new Date(d).getTime())) - Date.now()) / 1000)) : Math.ceil(s.recoveryMs / 1000) };
  }
  let lastErr: ProviderError | undefined;
  let tried = 0;
  for (const c of list) {
    if (tried > s.maxFailover) break;
    const { p } = c;
    const upstream = p.capabilities.upstream;
    const blocked = upstreamBlock(await getStatesCached(states, tried), upstream);
    if (blocked) return { ok: false, reason: 'UPSTREAM_BLOCKED', attempts, retryAfterSec: Math.max(1, Math.ceil((blocked.until.getTime() - Date.now()) / 1000)), error: lastErr ?? new ProviderError(blocked.reason as ProviderError['kind'], 'LeetCode is currently restricted or unavailable') };
    const uRate = s.ratePerMin, pRate = s.providerRatePerMin(p.id);
    if (!(await takeToken(upstreamBucket(upstream), uRate, burstOf(uRate)))) {
      return { ok: false, reason: 'GLOBAL_RATE_LIMITED', attempts, retryAfterSec: Math.ceil(60 / uRate) }; // shared budget: never fail over around it
    }
    if (!(await takeToken(providerBucket(p.id), pRate, burstOf(pRate)))) {
      await refundToken(upstreamBucket(upstream), burstOf(uRate));
      attempts.push({ provider: p.id, outcome: 'SKIPPED', reason: 'PROVIDER_BUDGET' });
      continue;
    }
    if (c.halfOpenAt && !(await claimProbe(p.id, c.halfOpenAt, s.timeoutMs + 5000))) {
      await refundToken(upstreamBucket(upstream), burstOf(uRate));
      await refundToken(providerBucket(p.id), burstOf(pRate));
      attempts.push({ provider: p.id, outcome: 'SKIPPED', reason: 'PROBE_IN_FLIGHT' });
      continue;
    }
    tried++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), s.timeoutMs);
    const t0 = Date.now();
    try {
      const value = await op(p, ctl.signal);
      const ms = Date.now() - t0;
      await recordSuccess(p.id, ms);
      if (p.capabilities.reachesUpstreamDirectly) await noteUpstreamSuccess(upstream);
      attempts.push({ provider: p.id, outcome: 'OK', latencyMs: ms });
      const failedOver = attempts.some((a) => a.outcome === 'FAILED');
      if (failedOver) await event({ type: 'FAILOVER', provider: attempts.find((a) => a.outcome === 'FAILED')!.provider, toProvider: p.id, kind: attempts.find((a) => a.outcome === 'FAILED')!.kind, studentId: ctx.studentId });
      return { ok: true, value, provider: p, attempts, failedOver };
    } catch (raw) {
      const e = raw instanceof ProviderError ? raw : new ProviderError('CLIENT_ERROR', String((raw as Error)?.message ?? raw).slice(0, 200));
      const ms = Date.now() - t0;
      lastErr = e;
      attempts.push({ provider: p.id, outcome: 'FAILED', kind: e.kind, latencyMs: ms });
      const scope = scopeOf(e.kind);
      if (scope === 'USER') { await recordAnswered(p.id, ms); return { ok: false, reason: 'NOT_FOUND', error: e, attempts }; }
      if (scope === 'UPSTREAM') {
        await blockUpstream(upstream, e, s.recoveryMs, p.id);
        return { ok: false, reason: 'UPSTREAM_BLOCKED', error: e, attempts, retryAfterSec: e.retryAfterSec ?? Math.ceil((e.kind === 'UPSTREAM_ACCESS_DENIED' ? 30 * 60_000 : s.recoveryMs) / 1000) };
      }
      // A request that never left this server did not use LeetCode's capacity: return the shared token so the next provider
      // can be tried even when the shared budget is tight. (It still counts against this provider's health.)
      if (e.notSent || e.kind === 'CONFIG_ERROR') await refundToken(upstreamBucket(upstream), burstOf(uRate));
      if (e.kind === 'PROVIDER_RATE_LIMITED') await recordProviderRateLimited(p.id, e.retryAfterSec, s.recoveryMs);
      else await recordFailure(p.id, e, breakerCfg(s));
      await event({ type: 'PROVIDER_ERROR', provider: p.id, kind: e.kind, message: e.message.slice(0, 300), studentId: ctx.studentId });
      if (e.upstreamSuspect && p.capabilities.reachesUpstreamDirectly) await noteUpstreamNetworkFailure(upstream, p.id, s.recoveryMs);
      // provider-specific: try the next eligible provider
    } finally { clearTimeout(timer); }
  }
  if (attempts.some((a) => a.outcome === 'FAILED')) await event({ type: 'ALL_FAILED', kind: lastErr?.kind, message: attempts.map((a) => `${a.provider}:${a.kind ?? a.reason}`).join(', '), studentId: ctx.studentId });
  return { ok: false, reason: attempts.some((a) => a.outcome === 'FAILED') ? 'ALL_FAILED' : 'PROVIDERS_UNAVAILABLE', error: lastErr, attempts, retryAfterSec: Math.ceil(s.recoveryMs / 1000) };
}

/** Re-read upstream state after a failed attempt (another instance or our own attempt may have blocked it). */
async function getStatesCached(initial: Map<string, StateDoc>, tried: number) { return tried === 0 ? initial : getStates(); }

export const fetchAccepted = (username: string, limit: number, studentId?: unknown) =>
  runWithFailover<FetchResult>((p, signal) => p.fetchAccepted(username, limit, signal), { studentId });

export const fetchProfileText = (username: string, studentId?: unknown) =>
  runWithFailover<string>((p, signal) => p.fetchProfileText(username, signal), { capability: 'profileText', studentId });

/**
 * Admin-triggered, controlled health check: one tiny request per enabled + authorised provider against a CONSENTING account
 * (LEETCODE_HEALTHCHECK_USERNAME). Respects upstream blocks and every rate budget; does not fail over.
 */
export async function runHealthChecks(username = env.LEETCODE_HEALTHCHECK_USERNAME) {
  const s = await loadSettings();
  if (!username) return { ran: false as const, reason: 'LEETCODE_HEALTHCHECK_USERNAME is not configured' };
  const out: { provider: string; result: string; latencyMs?: number }[] = [];
  for (const p of orderByPriority(registry(), s)) {
    if (!isEnabled(p, s) || !p.authorization().authorized) { out.push({ provider: p.id, result: 'SKIPPED_NOT_ELIGIBLE' }); continue; }
    const states = await getStates();
    if (upstreamBlock(states, p.capabilities.upstream)) { out.push({ provider: p.id, result: 'SKIPPED_UPSTREAM_BLOCKED' }); continue; }
    if (!(await takeToken(upstreamBucket(p.capabilities.upstream), s.ratePerMin, burstOf(s.ratePerMin)))) { out.push({ provider: p.id, result: 'SKIPPED_RATE_BUDGET' }); continue; }
    if (!(await takeToken(providerBucket(p.id), s.providerRatePerMin(p.id), burstOf(s.providerRatePerMin(p.id))))) { await refundToken(upstreamBucket(p.capabilities.upstream), burstOf(s.ratePerMin)); out.push({ provider: p.id, result: 'SKIPPED_PROVIDER_BUDGET' }); continue; }
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), s.timeoutMs); const t0 = Date.now();
    try {
      await p.fetchAccepted(username, 1, ctl.signal);
      await recordSuccess(p.id, Date.now() - t0);
      out.push({ provider: p.id, result: 'OK', latencyMs: Date.now() - t0 });
    } catch (raw) {
      const e = raw instanceof ProviderError ? raw : new ProviderError('CLIENT_ERROR', String(raw));
      if (scopeOf(e.kind) === 'UPSTREAM') await blockUpstream(p.capabilities.upstream, e, s.recoveryMs, p.id);
      else if (e.kind === 'PROVIDER_RATE_LIMITED') await recordProviderRateLimited(p.id, e.retryAfterSec, s.recoveryMs);
      else if (scopeOf(e.kind) === 'PROVIDER') await recordFailure(p.id, e, breakerCfg(s));
      out.push({ provider: p.id, result: e.kind, latencyMs: Date.now() - t0 });
    } finally { clearTimeout(timer); }
  }
  await event({ type: 'HEALTH_CHECK', message: out.map((o) => `${o.provider}:${o.result}`).join(', ') });
  return { ran: true as const, results: out };
}
