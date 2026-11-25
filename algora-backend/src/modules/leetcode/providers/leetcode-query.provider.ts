import { classifyGraphqlErrors, classifyLibraryError } from '../provider-error.classifier';
import { ProviderError } from '../leetcode.types';
import { normalizeRows } from '../submission-normalizer';
import type { Authorization, FetchResult, ProviderCapabilities, SubmissionProvider } from './provider.interface';

/** The subset of the `leetcode-query` LeetCode class this adapter uses. Injected so tests never touch the network. */
export interface LeetCodeQueryClient {
  graphql(q: { query: string; variables: Record<string, unknown> }): Promise<{ data?: any; errors?: unknown }>;
  recent_submissions(username: string, limit?: number): Promise<{ title: string; titleSlug: string; timestamp: string; statusDisplay: string }[]>;
  user(username: string): Promise<{ matchedUser: { profile?: { aboutMe?: string } } | null }>;
}

const AC_QUERY = 'query ($username: String!, $limit: Int) { recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp } }';

/**
 * Provider 3: `leetcode-query` npm package, from this server.
 *  - mode 'accepted' (default): sends the accepted-only query through the library's graphql() (same coverage as Direct).
 *  - mode 'all-status': uses the library's recent_submissions(), which returns ALL statuses; accepted rows are filtered
 *    locally, so failed attempts shrink the effective window. Reported as reduced coverage (acceptedOnly=false).
 * The real client is created lazily, only when the provider is authorised and first used (its constructor contacts LeetCode).
 */
export class LeetCodeQueryProvider implements SubmissionProvider {
  readonly id = 'leetcode-query';
  readonly displayName = 'LeetCode Query';
  readonly capabilities: ProviderCapabilities;
  private client: Promise<LeetCodeQueryClient> | null = null;
  constructor(private makeClient: () => Promise<LeetCodeQueryClient>, private auth: () => Authorization, readonly transportKind: 'network' | 'mock', private mode: 'accepted' | 'all-status' = 'accepted') {
    this.capabilities = { acceptedOnly: mode === 'accepted', windowSize: 20, submissionIds: mode === 'accepted', timestamps: true, profileText: true, upstream: 'leetcode-graphql', reachesUpstreamDirectly: true, cacheTtlSec: 0 };
  }
  authorization() { return this.auth(); }
  private c() { if (!this.client) this.client = this.makeClient().catch((e) => { this.client = null; throw new ProviderError('CONFIG_ERROR', `leetcode-query unavailable: ${String((e as Error)?.message ?? e)}`); }); return this.client; }

  private async guard<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw new ProviderError('PROVIDER_TIMEOUT', 'aborted', undefined, true);
    const abort = new Promise<never>((_, rej) => signal.addEventListener('abort', () => rej(new ProviderError('PROVIDER_TIMEOUT', 'Provider request timed out', undefined, true)), { once: true }));
    try { return await Promise.race([fn(), abort]); }
    catch (e) { if (e instanceof ProviderError) throw e; throw classifyLibraryError(e); }
  }

  async fetchAccepted(username: string, limit: number, signal: AbortSignal): Promise<FetchResult> {
    const lim = Math.min(limit, this.capabilities.windowSize);
    const client = await this.c();
    if (this.mode === 'accepted') {
      const r = await this.guard(signal, () => client.graphql({ query: AC_QUERY, variables: { username, limit: lim } }));
      if (r?.errors) throw classifyGraphqlErrors(r.errors);
      const list = r?.data?.recentAcSubmissionList;
      if (list === null) throw new ProviderError('NOT_FOUND', 'LeetCode user not found');
      if (!Array.isArray(list)) throw new ProviderError('BAD_RESPONSE', 'recentAcSubmissionList is not a list');
      const { submissions, stats } = normalizeRows(list, { username, provider: this.id, assumeAccepted: true });
      return { submissions, rawCount: stats.raw, limit: lim, oldestRawAt: stats.oldestRawAt, acceptedOnly: true, dataAsOf: new Date(), stats };
    }
    const list = await this.guard(signal, () => client.recent_submissions(username, lim));
    if (!Array.isArray(list)) throw new ProviderError('BAD_RESPONSE', 'recent_submissions is not a list');
    const { submissions, stats } = normalizeRows(list, { username, provider: this.id, assumeAccepted: false });
    return { submissions, rawCount: stats.raw, limit: lim, oldestRawAt: stats.oldestRawAt, acceptedOnly: false, dataAsOf: new Date(), stats };
  }

  async fetchProfileText(username: string, signal: AbortSignal): Promise<string> {
    const client = await this.c();
    const r = await this.guard(signal, () => client.user(username));
    if (!r?.matchedUser) throw new ProviderError('NOT_FOUND', 'LeetCode user not found');
    return String(r.matchedUser.profile?.aboutMe ?? '');
  }
}

/** Real client factory. Only called for an authorised, enabled provider. */
export async function realLeetCodeQueryClient(): Promise<LeetCodeQueryClient> {
  const mod = await import('leetcode-query');
  return new mod.LeetCode() as unknown as LeetCodeQueryClient;
}
