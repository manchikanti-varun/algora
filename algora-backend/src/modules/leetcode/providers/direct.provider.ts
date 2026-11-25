import { classifyException, classifyGraphqlErrors, classifyUpstreamHttp } from '../provider-error.classifier';
import { ProviderError } from '../leetcode.types';
import { normalizeRows } from '../submission-normalizer';
import type { AccountProbeResult, Authorization, FetchResult, ProviderCapabilities, SubmissionProvider } from './provider.interface';
import type { HttpTransport } from './transport';

const ENDPOINT = 'https://leetcode.com/graphql';
const AC_QUERY = 'query algoraAc($username: String!, $limit: Int!) { recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp } }';
const EXISTS_QUERY = 'query algoraExists($username: String!) { matchedUser(username: $username) { username submissionCalendar } }';

/** Provider 1: thin GraphQL client, accepted-only list, from this server. */
export class DirectProvider implements SubmissionProvider {
  readonly id = 'direct';
  readonly displayName = 'Direct LeetCode API';
  readonly capabilities: ProviderCapabilities = { acceptedOnly: true, windowSize: 20, submissionIds: true, timestamps: true, accountProbe: true, upstream: 'leetcode-graphql', reachesUpstreamDirectly: true, cacheTtlSec: 0 };
  constructor(private transport: HttpTransport, private auth: () => Authorization, private ua: string) {}
  get transportKind() { return this.transport.kind; }
  authorization() { return this.auth(); }

  private async gql(query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<any> {
    let res;
    try {
      res = await this.transport.send({ url: ENDPOINT, method: 'POST', signal, headers: { 'content-type': 'application/json', 'user-agent': this.ua, referer: 'https://leetcode.com' }, body: JSON.stringify({ query, variables }) });
    } catch (e) { throw classifyException(e, true); }
    const body = await res.text().catch(() => '');
    const httpErr = classifyUpstreamHttp({ status: res.status, headers: res.headers, body });
    if (httpErr) throw httpErr;
    let j: any;
    try { j = JSON.parse(body); } catch {
      // A 200 that is not JSON from LeetCode is a block/challenge page.
      throw new ProviderError('UPSTREAM_ACCESS_DENIED', 'LeetCode returned a non-JSON page');
    }
    if (j?.errors) throw classifyGraphqlErrors(j.errors);
    if (!j || typeof j !== 'object' || !('data' in j)) throw new ProviderError('BAD_RESPONSE', 'Missing data');
    return j.data;
  }

  /**
   * An empty list is returned as an empty result, not as NOT_FOUND: LeetCode returns [] both for an account with no recent
   * accepted submissions and for accounts whose submissions are not publicly visible. Disambiguation belongs to the sync
   * service, which probes account existence (cached) only when it matters.
   */
  async fetchAccepted(username: string, limit: number, signal: AbortSignal): Promise<FetchResult> {
    const lim = Math.min(limit, this.capabilities.windowSize);
    const data = await this.gql(AC_QUERY, { username, limit: lim }, signal);
    const list = data?.recentAcSubmissionList;
    if (list === null) throw new ProviderError('NOT_FOUND', 'LeetCode user not found');
    if (!Array.isArray(list)) throw new ProviderError('BAD_RESPONSE', 'recentAcSubmissionList is not a list');
    const { submissions, stats } = normalizeRows(list, { username, provider: this.id, assumeAccepted: true });
    return { submissions, rawCount: stats.raw, limit: lim, oldestRawAt: stats.oldestRawAt, acceptedOnly: true, dataAsOf: new Date(), stats };
  }

  /** Public account existence and calendar activity. Never used to read a profile, and never treated as proof of ownership. */
  async probeAccount(username: string, signal: AbortSignal): Promise<AccountProbeResult> {
    const data = await this.gql(EXISTS_QUERY, { username }, signal);
    const user = data?.matchedUser;
    if (!user) return { exists: false, calendarTotal: null };
    let calendarTotal: number | null = null;
    try {
      const cal = JSON.parse(String(user.submissionCalendar ?? '{}')) as Record<string, unknown>;
      calendarTotal = Object.values(cal).reduce<number>((a, v) => a + (Number(v) || 0), 0);
    } catch { /* unparseable calendar: activity unknown */ }
    return { exists: true, calendarTotal };
  }
}
