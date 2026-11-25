import { ProviderEvent, ProviderState } from '../../models';
import { breakerState, nextProbeAt, shouldOpen, type BreakerConfig } from './circuit-breaker';
import type { ProviderError } from './leetcode.types';

/** Cross-instance provider and upstream health. All writes are single atomic updates on `provider_state`. */
export const pKey = (id: string) => `provider:${id}`;
export const uKey = (u: string) => `upstream:${u}`;
const CORRELATION_WINDOW_MS = 2 * 60_000;

export type StateDoc = {
  _id: string; totalRequests?: number; successes?: number; failures?: number; rateLimited?: number; consecutiveFailures?: number;
  acceptedRetrievals?: number; lastAcceptedRetrievalAt?: Date;
  latencyEwmaMs?: number; lastSuccessAt?: Date; lastFailureAt?: Date; lastError?: string; lastErrorKind?: string;
  openedAt?: Date | null; openCount?: number; probeUntil?: Date | null; rateLimitedUntil?: Date | null;
  blockedUntil?: Date | null; blockedReason?: string; networkFailures?: { provider: string; at: Date }[];
};

export async function getStates(): Promise<Map<string, StateDoc>> {
  const docs = await ProviderState.find({}).lean<StateDoc[]>();
  return new Map(docs.map((d) => [d._id, d]));
}

export const event = (e: { type: string; provider?: string; toProvider?: string; kind?: string; message?: string; studentId?: unknown }) =>
  ProviderEvent.create(e as Record<string, unknown>).catch(() => {});

/** Success: reset failures, update latency (EWMA 0.2), close the breaker if it was open. */
export async function recordSuccess(id: string, latencyMs: number, retrievedAccepted = false) {
  const before = await ProviderState.findOneAndUpdate(
    { _id: pKey(id) },
    [{ $set: {
      kind: 'PROVIDER', totalRequests: { $add: [{ $ifNull: ['$totalRequests', 0] }, 1] }, successes: { $add: [{ $ifNull: ['$successes', 0] }, 1] },
      consecutiveFailures: 0, lastSuccessAt: '$$NOW', latencyEwmaMs: { $add: [{ $multiply: [{ $ifNull: ['$latencyEwmaMs', latencyMs] }, 0.8] }, latencyMs * 0.2] },
      openedAt: null, openCount: 0, probeUntil: null, rateLimitedUntil: null,
      ...(retrievedAccepted ? {
        acceptedRetrievals: { $add: [{ $ifNull: ['$acceptedRetrievals', 0] }, 1] }, lastAcceptedRetrievalAt: '$$NOW',
      } : {}),
    } }],
    { upsert: true, returnDocument: 'before', updatePipeline: true },
  ).lean<StateDoc>();
  if (before?.openedAt) await event({ type: 'CIRCUIT_CLOSED', provider: id, message: 'Recovered after a successful request' });
}

/** Provider-specific failure. Opens the circuit at the threshold, or immediately when a half-open probe fails. */
export async function recordFailure(id: string, err: ProviderError, cfg: BreakerConfig) {
  const after = await ProviderState.findOneAndUpdate(
    { _id: pKey(id) },
    { $setOnInsert: { kind: 'PROVIDER' }, $inc: { totalRequests: 1, failures: 1, consecutiveFailures: 1 }, $set: { lastFailureAt: new Date(), lastError: err.message.slice(0, 300), lastErrorKind: err.kind, probeUntil: null } },
    { upsert: true, returnDocument: 'after' },
  ).lean<StateDoc>();
  const prior = { consecutiveFailures: (after!.consecutiveFailures ?? 1) - 1, openedAt: after!.openedAt ?? null, openCount: after!.openCount ?? 0 };
  if (shouldOpen(prior, cfg)) {
    const r = await ProviderState.updateOne({ _id: pKey(id), openedAt: after!.openedAt ?? null }, { $set: { openedAt: new Date() }, $inc: { openCount: 1 } });
    if (r.modifiedCount) await event({ type: 'CIRCUIT_OPEN', provider: id, kind: err.kind, message: `Circuit opened after ${after!.consecutiveFailures} consecutive failures` });
  }
}

/** The provider's OWN rate limit (e.g. a relay's per-IP limiter). Not a breaker failure. */
export async function recordProviderRateLimited(id: string, retryAfterSec: number | undefined, fallbackMs: number) {
  const until = new Date(Date.now() + (retryAfterSec ? retryAfterSec * 1000 : fallbackMs));
  await ProviderState.updateOne({ _id: pKey(id) }, { $setOnInsert: { kind: 'PROVIDER' }, $inc: { totalRequests: 1, rateLimited: 1 }, $max: { rateLimitedUntil: until }, $set: { lastFailureAt: new Date(), lastErrorKind: 'PROVIDER_RATE_LIMITED', lastError: 'Provider rate limit' } }, { upsert: true });
}

/** The provider answered correctly but about something we cannot change (e.g. user not found). Counts as healthy. */
export async function recordAnswered(id: string, latencyMs: number) { await recordSuccess(id, latencyMs); }

/**
 * LeetCode itself refused or failed. Blocks EVERY provider that depends on this upstream until the block expires.
 * Durations: Retry-After when given; otherwise rate limit = recovery interval, access denied = 30 min, outage = recovery interval.
 * $max: a block can only be extended, never shortened by a later, milder signal.
 */
export async function blockUpstream(upstream: string, err: ProviderError, recoveryMs: number, viaProvider: string) {
  const ms = err.retryAfterSec ? err.retryAfterSec * 1000 : err.kind === 'UPSTREAM_ACCESS_DENIED' ? 30 * 60_000 : recoveryMs;
  const until = new Date(Date.now() + ms);
  await ProviderState.updateOne({ _id: uKey(upstream) }, { $setOnInsert: { kind: 'UPSTREAM' }, $max: { blockedUntil: until }, $set: { blockedReason: err.kind, lastFailureAt: new Date(), lastError: err.message.slice(0, 300) }, $inc: { failures: 1, ...(err.kind === 'UPSTREAM_RATE_LIMITED' ? { rateLimited: 1 } : {}) } }, { upsert: true });
  await ProviderState.updateOne({ _id: pKey(viaProvider) }, { $setOnInsert: { kind: 'PROVIDER' }, $inc: { totalRequests: 1 }, $set: { lastErrorKind: err.kind, lastError: err.message.slice(0, 300), lastFailureAt: new Date() } }, { upsert: true });
  await event({ type: 'UPSTREAM_BLOCK', provider: viaProvider, kind: err.kind, message: `${upstream} blocked until ${until.toISOString()}: ${err.message}` });
}

/**
 * Network failures from DIFFERENT providers that reach the same upstream directly within 2 minutes mean the upstream
 * (or our route to it) is down, not one client. Then the upstream is blocked for the recovery interval.
 */
export async function noteUpstreamNetworkFailure(upstream: string, provider: string, recoveryMs: number): Promise<boolean> {
  const now = new Date();
  const doc = await ProviderState.findOneAndUpdate(
    { _id: uKey(upstream) },
    { $setOnInsert: { kind: 'UPSTREAM' }, $push: { networkFailures: { $each: [{ provider, at: now }], $slice: -10 } } },
    { upsert: true, returnDocument: 'after' },
  ).lean<StateDoc>();
  const recent = new Set((doc?.networkFailures ?? []).filter((f) => now.getTime() - new Date(f.at).getTime() <= CORRELATION_WINDOW_MS).map((f) => f.provider));
  if (recent.size >= 2) {
    await ProviderState.updateOne({ _id: uKey(upstream) }, { $max: { blockedUntil: new Date(now.getTime() + recoveryMs) }, $set: { blockedReason: 'UPSTREAM_UNAVAILABLE', networkFailures: [] } });
    await event({ type: 'UPSTREAM_BLOCK', provider, kind: 'UPSTREAM_UNAVAILABLE', message: `${upstream} unreachable from ${[...recent].join(', ')}` });
    return true;
  }
  return false;
}
export const noteUpstreamSuccess = (upstream: string) => ProviderState.updateOne({ _id: uKey(upstream), 'networkFailures.0': { $exists: true } }, { $set: { networkFailures: [] } });

export function upstreamBlock(states: Map<string, StateDoc>, upstream: string, now = Date.now()) {
  const d = states.get(uKey(upstream));
  return d?.blockedUntil && new Date(d.blockedUntil).getTime() > now ? { until: new Date(d.blockedUntil), reason: d.blockedReason ?? 'UPSTREAM_UNAVAILABLE' } : null;
}

/** One half-open probe across the whole cluster: atomically claim it for `ttlMs`. */
export async function claimProbe(id: string, openedAt: Date, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const r = await ProviderState.updateOne(
    { _id: pKey(id), openedAt, $or: [{ probeUntil: null }, { probeUntil: { $exists: false } }, { probeUntil: { $lte: now } }] },
    { $set: { probeUntil: new Date(now.getTime() + ttlMs) } },
  );
  return r.modifiedCount === 1;
}

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'CIRCUIT_OPEN' | 'DISABLED' | 'ACCESS_NOT_AUTHORIZED';

/** Derived status for display and candidate ordering. */
export function healthOf(d: StateDoc | undefined, opts: { enabled: boolean; authorized: boolean; upstreamBlocked: boolean; cfg: BreakerConfig; timeoutMs: number }, now = Date.now()): { status: HealthStatus; breaker: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; nextEligibleAt: Date | null } {
  const breaker = d ? breakerState({ consecutiveFailures: d.consecutiveFailures ?? 0, openedAt: d.openedAt ? new Date(d.openedAt) : null, openCount: d.openCount ?? 0 }, opts.cfg, now) : 'CLOSED';
  const probeAt = d?.openedAt ? nextProbeAt({ consecutiveFailures: 0, openedAt: new Date(d.openedAt), openCount: d.openCount ?? 0 }, opts.cfg) : null;
  const rl = d?.rateLimitedUntil && new Date(d.rateLimitedUntil).getTime() > now ? new Date(d.rateLimitedUntil) : null;
  if (!opts.authorized) return { status: 'ACCESS_NOT_AUTHORIZED', breaker, nextEligibleAt: null };
  if (!opts.enabled) return { status: 'DISABLED', breaker, nextEligibleAt: null };
  if (breaker === 'OPEN') return { status: 'CIRCUIT_OPEN', breaker, nextEligibleAt: probeAt };
  if (rl) return { status: 'RATE_LIMITED', breaker, nextEligibleAt: rl };
  if (opts.upstreamBlocked) return { status: 'UNAVAILABLE', breaker, nextEligibleAt: null };
  const total = d?.totalRequests ?? 0;
  const failRate = total ? (d!.failures ?? 0) / total : 0;
  if ((d?.consecutiveFailures ?? 0) > 0 || breaker === 'HALF_OPEN') return { status: 'DEGRADED', breaker, nextEligibleAt: probeAt };
  if (total >= 10 && failRate > 0.2) return { status: 'DEGRADED', breaker, nextEligibleAt: null };
  if ((d?.latencyEwmaMs ?? 0) > opts.timeoutMs * 0.7) return { status: 'DEGRADED', breaker, nextEligibleAt: null };
  return { status: 'HEALTHY', breaker, nextEligibleAt: null };
}

export type TechnicalHealth = 'UNTESTED' | 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'CIRCUIT_OPEN';

/**
 * Technical health only, measured from real requests, independent of authorisation and activation.
 * UNTESTED = this provider has never been called (it cannot have been, while not authorised).
 */
export function technicalHealthOf(d: StateDoc | undefined, opts: { upstreamBlocked: boolean; cfg: BreakerConfig; timeoutMs: number }, now = Date.now()): TechnicalHealth {
  if (!d || !(d.totalRequests ?? 0)) return 'UNTESTED';
  const h = healthOf(d, { enabled: true, authorized: true, upstreamBlocked: opts.upstreamBlocked, cfg: opts.cfg, timeoutMs: opts.timeoutMs }, now);
  return h.status === 'DISABLED' || h.status === 'ACCESS_NOT_AUTHORIZED' ? 'UNTESTED' : h.status;
}
