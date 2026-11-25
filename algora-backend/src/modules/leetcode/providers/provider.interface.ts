import type { AcceptedSubmission } from '../leetcode.types';

export type ProviderId = string;

export interface ProviderCapabilities {
  /** True when the endpoint returns ACCEPTED submissions only. False = all statuses, filtered locally (smaller effective window). */
  acceptedOnly: boolean;
  /** Maximum rows the endpoint returns per request (LeetCode caps the public lists at 20). */
  windowSize: number;
  submissionIds: boolean;
  timestamps: boolean;
  /** Can read the public profile summary (used to prove account ownership). */
  profileText: boolean;
  /** Data source behind the provider. Providers sharing an upstream share its rate limits and restrictions. */
  upstream: 'leetcode-graphql' | string;
  /** The provider talks to the upstream from THIS server (Direct, LeetCode Query) rather than through a relay (Alfa). */
  reachesUpstreamDirectly: boolean;
  /** Worst-case staleness of the provider's own response cache. */
  cacheTtlSec: number;
}

export interface FetchResult {
  submissions: AcceptedSubmission[];
  /** Rows the provider returned before filtering (all statuses for all-status providers). */
  rawCount: number;
  /** Requested window (after capping at windowSize). rawCount >= limit means older rows may be cut off. */
  limit: number;
  /** Timestamp of the oldest row in the raw window (any status). */
  oldestRawAt: Date | null;
  acceptedOnly: boolean;
  /** Newest point in time the data is guaranteed to reflect (fetch time minus the provider's cache TTL). */
  dataAsOf: Date;
  stats?: { dropped: number; futureTimestamps: number; duplicates: number };
}

export interface Authorization { authorized: boolean; reason?: string }

/**
 * Every provider implements this. Nothing outside src/modules/leetcode depends on a concrete provider.
 * Adding a provider = implement this + register it in provider.registry.ts.
 */
export interface SubmissionProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  /** 'network' for a real transport, 'mock' for test/dev transports. Mock data never becomes production evidence. */
  readonly transportKind: 'network' | 'mock';
  authorization(): Authorization;
  /** Accepted submissions, newest first. Throws ProviderError (already classified). */
  fetchAccepted(username: string, limit: number, signal: AbortSignal): Promise<FetchResult>;
  /** Public profile summary text. Throws ProviderError. */
  fetchProfileText(username: string, signal: AbortSignal): Promise<string>;
}
