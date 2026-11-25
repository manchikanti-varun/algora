import { ProviderError, type AcceptedSubmission, type ProviderErrorKind } from '../leetcode.types';
import type { AccountProbeResult, FetchResult, ProviderCapabilities, SubmissionProvider } from './provider.interface';

/**
 * DEVELOPMENT AND TEST ONLY. Serves data you put into it. Its evidence is stored with source MOCK_DEV, which never counts
 * in production; configuration refuses to enable it in production.
 */
export class MockProvider implements SubmissionProvider {
  readonly displayName: string;
  readonly transportKind = 'mock' as const;
  capabilities: ProviderCapabilities = { acceptedOnly: true, windowSize: 20, submissionIds: false, timestamps: true, accountProbe: true, upstream: 'mock-upstream', reachesUpstreamDirectly: true, cacheTtlSec: 0 };
  calls = 0;
  probeCalls = 0;
  private data = new Map<string, AcceptedSubmission[]>();
  private calendar = new Map<string, number | null>();
  failWith: ProviderErrorKind | null = null;
  retryAfterSec?: number;
  latencyMs = 0;
  windowSize = 20;
  constructor(readonly id = 'mock', private authorized = true) { this.displayName = `Mock (${id})`; }
  authorization() { return this.authorized ? { authorized: true } : { authorized: false, reason: 'mock not authorised' }; }
  setAuthorized(v: boolean) { this.authorized = v; }

  solve(username: string, slug: string, at: Date = new Date(), title = slug.replace(/-/g, ' '), submissionId: string | null = null) {
    const k = username.toLowerCase();
    const list = this.data.get(k) ?? [];
    list.unshift({ submissionId, username, problemTitle: title, problemSlug: slug.toLowerCase(), status: 'ACCEPTED', submittedAt: at, provider: this.id });
    this.data.set(k, list);
  }
  /** An account that exists but has no recent accepted submissions. */
  register(username: string, calendarTotal: number | null = 0) {
    const k = username.toLowerCase();
    if (!this.data.has(k)) this.data.set(k, []);
    this.calendar.set(k, calendarTotal);
  }
  clearAccepted(username: string) { this.data.set(username.toLowerCase(), []); }
  /** Synthesized activity when the provider cannot see submissions; used to model incomplete visibility. */
  setCalendarTotal(username: string, n: number | null) { this.calendar.set(username.toLowerCase(), n); }
  private async wait(signal?: AbortSignal) {
    this.calls++;
    if (this.latencyMs) await new Promise<void>((res, rej) => { const t = setTimeout(res, this.latencyMs); signal?.addEventListener('abort', () => { clearTimeout(t); rej(new ProviderError('PROVIDER_TIMEOUT', 'timeout')); }, { once: true }); });
    if (this.failWith) throw new ProviderError(this.failWith, `mock ${this.failWith}`, this.retryAfterSec ?? (this.failWith.includes('RATE_LIMITED') ? 30 : undefined), this.failWith === 'PROVIDER_UNAVAILABLE' || this.failWith === 'PROVIDER_TIMEOUT');
  }
  async fetchAccepted(username: string, limit: number, signal?: AbortSignal): Promise<FetchResult> {
    await this.wait(signal);
    const all = this.data.get(username.toLowerCase());
    if (!all) throw new ProviderError('NOT_FOUND', 'user not found');
    const cap = Math.min(limit, this.windowSize);
    const rows = all.slice(0, cap).map((r) => ({ ...r, provider: this.id }));
    return { submissions: rows, rawCount: rows.length, limit: cap, oldestRawAt: rows.at(-1)?.submittedAt ?? null, acceptedOnly: this.capabilities.acceptedOnly, dataAsOf: new Date() };
  }
  async probeAccount(username: string, _signal?: AbortSignal): Promise<AccountProbeResult> {
    this.probeCalls++; // counted separately: a probe is not a submission request
    const k = username.toLowerCase();
    if (!this.data.has(k)) return { exists: false, calendarTotal: null };
    return { exists: true, calendarTotal: this.calendar.get(k) ?? (this.data.get(k)?.length ?? 0) };
  }
}
