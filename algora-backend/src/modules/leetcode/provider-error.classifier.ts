import { ProviderError, type ProviderErrorKind } from './leetcode.types';

const CHALLENGE = /captcha|cf-chl|challenge-platform|just a moment|attention required|verify you are human|access denied/i;
const NOT_EXIST = /user(name)? does not exist|that user does not exist|user not found|no such user/i;
const RATE_WORDS = /too many requests|rate limit/i;

const retryAfter = (h: { get(n: string): string | null }) => {
  const v = h.get('retry-after');
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(1, Math.min(n, 24 * 3600));
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.max(1, Math.ceil((d - Date.now()) / 1000)) : undefined;
};

export interface HttpView { status: number; headers: { get(n: string): string | null }; body: string }

/**
 * Classify an HTTP answer that came DIRECTLY from LeetCode (Direct provider, LeetCode Query).
 * Returns null when the answer is a usable 200.
 */
export function classifyUpstreamHttp(r: HttpView): ProviderError | null {
  const challenge = r.headers.get('cf-mitigated') === 'challenge' || (r.status !== 200 && CHALLENGE.test(r.body.slice(0, 4000)));
  if (challenge) return new ProviderError('UPSTREAM_ACCESS_DENIED', 'LeetCode returned an access challenge', retryAfter(r.headers));
  if (r.status === 429) return new ProviderError('UPSTREAM_RATE_LIMITED', 'LeetCode rate limited the request', retryAfter(r.headers));
  if (r.status === 401 || r.status === 403) return new ProviderError('UPSTREAM_ACCESS_DENIED', `LeetCode denied access (HTTP ${r.status})`, retryAfter(r.headers));
  if (r.status >= 500) return new ProviderError('UPSTREAM_UNAVAILABLE', `LeetCode HTTP ${r.status}`, retryAfter(r.headers));
  if (r.status !== 200) return new ProviderError('CLIENT_ERROR', `Unexpected HTTP ${r.status} from LeetCode`);
  return null;
}

/** Classify GraphQL `errors` (HTTP 200) from LeetCode, whether received directly or relayed. */
export function classifyGraphqlErrors(errors: unknown): ProviderError {
  const msg = JSON.stringify(errors ?? '').slice(0, 2000);
  if (NOT_EXIST.test(msg)) return new ProviderError('NOT_FOUND', 'LeetCode user not found');
  if (RATE_WORDS.test(msg)) return new ProviderError('UPSTREAM_RATE_LIMITED', 'LeetCode reported a rate limit');
  if (CHALLENGE.test(msg)) return new ProviderError('UPSTREAM_ACCESS_DENIED', 'LeetCode reported an access restriction');
  return new ProviderError('BAD_RESPONSE', 'Unexpected GraphQL error');
}

/**
 * Classify an answer from a RELAY provider (Alfa). Its own failures are provider-specific. Because Alfa replies HTTP 200 with
 * the text of a JSON parse error when LeetCode sends HTML (a block/challenge page), that case is treated conservatively as an
 * upstream access restriction, so we never fail over around a LeetCode block.
 */
export function classifyRelayHttp(r: HttpView): ProviderError | null {
  if (r.status === 429) return new ProviderError('PROVIDER_RATE_LIMITED', 'Provider rate limit', retryAfter(r.headers));
  if (r.status === 401 || r.status === 403) return new ProviderError('CONFIG_ERROR', `Provider refused the request (HTTP ${r.status})`);
  if (r.status === 404 && !r.body.trim().startsWith('{')) return new ProviderError('CONFIG_ERROR', 'Provider endpoint not found (check base URL)');
  if (r.status >= 500) return new ProviderError('PROVIDER_UNAVAILABLE', `Provider HTTP ${r.status}`, retryAfter(r.headers));
  if (r.status !== 200) return new ProviderError('BAD_RESPONSE', `Unexpected provider HTTP ${r.status}`);
  const t = r.body.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) {
    if (/unexpected token|is not valid json|json at position|<!doctype|<html/i.test(t) || CHALLENGE.test(t)) {
      return new ProviderError('UPSTREAM_ACCESS_DENIED', 'Provider relayed a non-JSON answer from LeetCode (likely a block or challenge)');
    }
    if (/fetch failed|econnreset|enotfound|etimedout|socket/i.test(t)) return new ProviderError('UPSTREAM_UNAVAILABLE', 'Provider could not reach LeetCode');
    return new ProviderError('BAD_RESPONSE', 'Provider returned a non-JSON body');
  }
  return null;
}

/** Network/transport exceptions (no HTTP answer). */
export function classifyException(e: unknown, upstreamDirect: boolean): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string } };
  const code = err?.code ?? err?.cause?.code ?? '';
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new ProviderError('PROVIDER_TIMEOUT', 'Provider request timed out', undefined, upstreamDirect);
  }
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|UND_ERR/.test(code) || /fetch failed|network|socket/i.test(err?.message ?? '')) {
    const notSent = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH/.test(code); // no connection was established
    return new ProviderError('PROVIDER_UNAVAILABLE', `Network error: ${code || err?.message}`, undefined, upstreamDirect, notSent);
  }
  return new ProviderError('CLIENT_ERROR', `Client error: ${String(err?.message ?? e).slice(0, 200)}`);
}

/** Parse `HTTP 429 Too Many Requests: ...` style messages thrown by HTTP client libraries (leetcode-query). */
export function classifyLibraryError(e: unknown): ProviderError {
  const m = /HTTP (\d{3})[^:]*:?\s*([\s\S]*)$/.exec(String((e as Error)?.message ?? ''));
  if (m) {
    const r = classifyUpstreamHttp({ status: Number(m[1]), headers: { get: () => null }, body: m[2] ?? '' });
    if (r) return r;
  }
  return classifyException(e, true);
}

export const isKind = (e: unknown, ...k: ProviderErrorKind[]) => e instanceof ProviderError && k.includes(e.kind);
