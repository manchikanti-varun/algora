import { describe, expect, it } from 'vitest';
import { classifyException, classifyGraphqlErrors, classifyLibraryError, classifyRelayHttp, classifyUpstreamHttp } from '../src/modules/leetcode/provider-error.classifier';
import { normalizeRows, parseTimestamp } from '../src/modules/leetcode/submission-normalizer';
import { scopeOf } from '../src/modules/leetcode/leetcode.types';

const h = (o: Record<string, string> = {}) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
describe('error classification', () => {
  it('direct LeetCode answers', () => {
    expect(classifyUpstreamHttp({ status: 200, headers: h(), body: '{}' })).toBeNull();
    expect(classifyUpstreamHttp({ status: 429, headers: h({ 'retry-after': '30' }), body: '' })).toMatchObject({ kind: 'UPSTREAM_RATE_LIMITED', retryAfterSec: 30 });
    expect(classifyUpstreamHttp({ status: 403, headers: h(), body: 'nope' })!.kind).toBe('UPSTREAM_ACCESS_DENIED');
    expect(classifyUpstreamHttp({ status: 503, headers: h(), body: '' })!.kind).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyUpstreamHttp({ status: 200, headers: h({ 'cf-mitigated': 'challenge' }), body: '' })!.kind).toBe('UPSTREAM_ACCESS_DENIED');
    expect(classifyUpstreamHttp({ status: 400, headers: h(), body: '' })!.kind).toBe('CLIENT_ERROR');
  });
  it('relay (Alfa) answers keep provider failures provider-scoped but never hide a LeetCode block', () => {
    expect(classifyRelayHttp({ status: 429, headers: h(), body: 'Too many request from this IP' })!.kind).toBe('PROVIDER_RATE_LIMITED');
    expect(classifyRelayHttp({ status: 502, headers: h(), body: 'Bad gateway' })!.kind).toBe('PROVIDER_UNAVAILABLE');
    expect(classifyRelayHttp({ status: 404, headers: h(), body: 'Cannot GET /x' })!.kind).toBe('CONFIG_ERROR');
    expect(classifyRelayHttp({ status: 200, headers: h(), body: "Unexpected token '<'" })!.kind).toBe('UPSTREAM_ACCESS_DENIED');
    expect(classifyRelayHttp({ status: 200, headers: h(), body: 'fetch failed' })!.kind).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyRelayHttp({ status: 200, headers: h(), body: '{"count":0}' })).toBeNull();
  });
  it('GraphQL errors, exceptions and library errors', () => {
    expect(classifyGraphqlErrors([{ message: 'That user does not exist.' }]).kind).toBe('NOT_FOUND');
    expect(classifyGraphqlErrors([{ message: 'Too many requests' }]).kind).toBe('UPSTREAM_RATE_LIMITED');
    expect(classifyGraphqlErrors([{ message: 'weird' }]).kind).toBe('BAD_RESPONSE');
    expect(classifyException(Object.assign(new Error('x'), { name: 'AbortError' }), true)).toMatchObject({ kind: 'PROVIDER_TIMEOUT', upstreamSuspect: true });
    expect(classifyException(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), false)).toMatchObject({ kind: 'PROVIDER_UNAVAILABLE', upstreamSuspect: false });
    expect(classifyException(new TypeError('x is undefined'), true).kind).toBe('CLIENT_ERROR');
    expect(classifyLibraryError(new Error('HTTP 403 Forbidden: <html>')).kind).toBe('UPSTREAM_ACCESS_DENIED');
    expect(scopeOf('UPSTREAM_RATE_LIMITED')).toBe('UPSTREAM'); expect(scopeOf('BAD_RESPONSE')).toBe('PROVIDER'); expect(scopeOf('NOT_FOUND')).toBe('USER');
  });
});
describe('normalizer', () => {
  it('slugs, timestamps (s and ms), status filter, duplicates, malformed rows, future timestamps; ids only when present', () => {
    const now = new Date(1_700_000_000_000);
    const r = normalizeRows([
      { id: 1, title: 'Two Sum', titleSlug: 'Two-Sum', timestamp: '1699999000' },
      { id: 1, title: 'Two Sum', titleSlug: 'two-sum', timestamp: '1699999000' },
      { title: 'A', titleSlug: 'a', timestamp: 1699999000000 },
      { title: 'Bad', titleSlug: 'bad slug!', timestamp: '1' },
      { nope: true },
      { title: 'F', titleSlug: 'f', timestamp: String(1_700_000_000 + 86400) },
      { title: 'W', titleSlug: 'w', timestamp: '1699999500', statusDisplay: 'Wrong Answer' },
    ], { username: 'u', provider: 'p', assumeAccepted: true, now });
    expect(r.submissions.map((s) => [s.problemSlug, s.submissionId, s.submittedAt?.getTime() ?? null])).toEqual([['two-sum', '1', 1699999000000], ['a', null, 1699999000000], ['f', null, null]]);
    expect(r.stats).toMatchObject({ raw: 7, dropped: 2, duplicates: 1, futureTimestamps: 1 });
    const all = normalizeRows([{ titleSlug: 'x', statusDisplay: 'Accepted', timestamp: '1' }, { titleSlug: 'y', statusDisplay: 'Runtime Error', timestamp: '2' }], { username: 'u', provider: 'p', assumeAccepted: false });
    expect(all.submissions.map((s) => s.problemSlug)).toEqual(['x']);
    expect(all.stats.oldestRawAt!.getTime()).toBe(1000);
    expect(parseTimestamp('abc')).toBeNull(); expect(parseTimestamp(-1)).toBeNull();
  });
});
