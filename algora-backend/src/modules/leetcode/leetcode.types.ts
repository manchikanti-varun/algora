/**
 * Normalised accepted submission. `submissionId` is null unless the provider really returned one; never invented.
 * Problem identity is always the canonical slug.
 */
export interface AcceptedSubmission {
  submissionId: string | null;
  username: string;
  problemTitle: string;
  problemSlug: string;
  status: 'ACCEPTED';
  submittedAt: Date | null;
  provider: string;
}

/**
 * Failure classes. `scope` decides failover:
 *  - PROVIDER: this provider/client is broken -> another eligible provider may be tried.
 *  - UPSTREAM: LeetCode itself refused or failed -> respected for ALL providers that depend on it; no failover.
 *  - USER: the answer is about the account (e.g. it does not exist) -> no failover, it would only repeat.
 */
export type ProviderErrorKind =
  | 'NOT_FOUND'
  | 'UPSTREAM_RATE_LIMITED' | 'UPSTREAM_ACCESS_DENIED' | 'UPSTREAM_UNAVAILABLE'
  | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'BAD_RESPONSE' | 'CLIENT_ERROR' | 'CONFIG_ERROR';
export type ErrorScope = 'PROVIDER' | 'UPSTREAM' | 'USER';
export const scopeOf = (k: ProviderErrorKind): ErrorScope =>
  k === 'NOT_FOUND' ? 'USER' : k.startsWith('UPSTREAM_') ? 'UPSTREAM' : 'PROVIDER';

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public retryAfterSec?: number,
    /** A network failure on a provider that talks to LeetCode directly: may be LeetCode, may be us. */
    public upstreamSuspect = false,
    /** The request provably never left this server (connection refused, DNS failure, configuration). */
    public notSent = false,
  ) { super(message); }
  get scope() { return scopeOf(this.kind); }
}

export const SYNC_STATES = ['IDLE', 'SYNCING', 'SYNC_SUCCESS', 'SYNC_FAILED', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'VERIFICATION_UNAVAILABLE', 'SYNC_PAUSED'] as const;
export type SyncState = (typeof SYNC_STATES)[number];
