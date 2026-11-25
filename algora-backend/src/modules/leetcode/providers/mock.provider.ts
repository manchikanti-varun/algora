import { ProviderError, type AcceptedSubmission, type ProviderErrorKind } from '../leetcode.types';
import type { FetchResult, ProviderCapabilities, SubmissionProvider } from './provider.interface';

/**
 * DEVELOPMENT AND TEST ONLY. Serves data you put into it. Its evidence is stored with source MOCK_DEV, which never counts
 * in production; configuration refuses to enable it in production.
 */
export class MockProvider implements SubmissionProvider {
  readonly displayName: string;
  readonly transportKind = 'mock' as const;
  capabilities: ProviderCapabilities = { acceptedOnly: true, windowSize: 20, submissionIds: false, timestamps: true, profileText: true, upstream: 'mock-upstream', reachesUpstreamDirectly: true, cacheTtlSec: 0 };
  calls = 0;
  private data = new Map<string, AcceptedSubmission[]>();
  private about = new Map<string, string>();
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
  setProfileText(username: string, text: string) { this.about.set(username.toLowerCase(), text); }
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
  async fetchProfileText(username: string, signal?: AbortSignal): Promise<string> {
    await this.wait(signal);
    if (!this.data.has(username.toLowerCase()) && !this.about.has(username.toLowerCase())) throw new ProviderError('NOT_FOUND', 'user not found');
    return this.about.get(username.toLowerCase()) ?? '';
  }
}
