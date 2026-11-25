import { z } from 'zod';
import { classifyException, classifyGraphqlErrors, classifyRelayHttp } from '../provider-error.classifier';
import { ProviderError } from '../leetcode.types';
import { normalizeRows } from '../submission-normalizer';
import type { Authorization, FetchResult, ProviderCapabilities, SubmissionProvider } from './provider.interface';
import type { HttpTransport } from './transport';

const acBody = z.object({ count: z.number().int().nonnegative(), submission: z.array(z.unknown()) });

/**
 * Provider 2: Alfa LeetCode API (relay). Endpoint verified in its source: GET /:username/acSubmission?limit=N runs
 * recentAcSubmissionList and returns { count, submission[] } with title, titleSlug, timestamp, statusDisplay, lang (no id).
 * Its server caches responses (apicache, 5 min by default) and rate-limits per IP (120/h by default). It replies HTTP 200
 * with GraphQL `errors` or plain text on failure, so the body is always classified.
 */
export class AlfaProvider implements SubmissionProvider {
  readonly id = 'alfa';
  readonly displayName = 'Alfa LeetCode API';
  readonly capabilities: ProviderCapabilities;
  constructor(private transport: HttpTransport, private baseUrl: string, private auth: () => Authorization, private ua: string, cacheTtlSec = 300) {
    this.capabilities = { acceptedOnly: true, windowSize: 20, submissionIds: false, timestamps: true, accountProbe: false, upstream: 'leetcode-graphql', reachesUpstreamDirectly: false, cacheTtlSec };
  }
  get transportKind() { return this.transport.kind; }
  authorization() { return this.auth(); }

  private async get(path: string, signal: AbortSignal): Promise<unknown> {
    if (!this.baseUrl) throw new ProviderError('CONFIG_ERROR', 'LEETCODE_ALFA_BASE_URL is not set', undefined, false, true);
    let res;
    try { res = await this.transport.send({ url: `${this.baseUrl.replace(/\/+$/, '')}${path}`, method: 'GET', signal, headers: { 'user-agent': this.ua, accept: 'application/json' } }); }
    catch (e) { throw classifyException(e, false); }
    const body = await res.text().catch(() => '');
    const err = classifyRelayHttp({ status: res.status, headers: res.headers, body });
    if (err) throw err;
    let j: any;
    try { j = JSON.parse(body); } catch { throw new ProviderError('BAD_RESPONSE', 'Invalid JSON from provider'); }
    if (j && typeof j === 'object' && 'errors' in j) throw classifyGraphqlErrors(j.errors);
    return j;
  }

  async fetchAccepted(username: string, limit: number, signal: AbortSignal): Promise<FetchResult> {
    const lim = Math.min(limit, this.capabilities.windowSize);
    const j = await this.get(`/${encodeURIComponent(username)}/acSubmission?limit=${lim}`, signal);
    const p = acBody.safeParse(j);
    if (!p.success) throw new ProviderError('BAD_RESPONSE', 'Unexpected acSubmission shape');
    const { submissions, stats } = normalizeRows(p.data.submission, { username, provider: this.id, assumeAccepted: true });
    return { submissions, rawCount: stats.raw, limit: lim, oldestRawAt: stats.oldestRawAt, acceptedOnly: true, dataAsOf: new Date(Date.now() - this.capabilities.cacheTtlSec * 1000), stats };
  }

}
