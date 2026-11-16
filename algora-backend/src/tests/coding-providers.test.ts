import { it, expect, afterEach, vi, describe } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import {
  retryAfterMs,
  parseCodeforces,
  adapters,
  codeforcesAdapter,
  fetchCodeforcesIdentity,
} from '../coding/providers.js';
import { verifyCodeforcesToken } from '../coding/ownership.js';
import { rawSubmission } from './coding-fixtures.js';
import {
  handleSchema,
  linkSchema,
  querySchema,
  refreshSchema,
} from '../coding/contracts.js';
const now = new Date();
afterEach(() => vi.unstubAllGlobals());
it('accepts official final accepted submissions with canonical identity and UTC provenance', () => {
  const page = parseCodeforces(
    { status: 'OK', result: [rawSubmission(now)] },
    'Learner',
    1,
    now,
  );
  expect(page.complete).toBe(true);
  expect(page.submissions[0]).toMatchObject({
    accepted: true,
    problemKey: '123-A',
    verdict: 'OK',
    id: '123456',
  });
  expect(page.submissions[0]?.digest).toMatch(/^[a-f0-9]{64}$/);
});
it.each([
  'WRONG_ANSWER',
  'TIME_LIMIT_EXCEEDED',
  'COMPILATION_ERROR',
  'RUNTIME_ERROR',
])('records %s as a verified attempt, never a solve', (verdict) =>
  expect(
    parseCodeforces(
      { status: 'OK', result: [rawSubmission(now, { verdict })] },
      'learner',
      1,
      now,
    ).submissions[0]?.accepted,
  ).toBe(false),
);
it.each([
  { verdict: undefined },
  { verdict: 'TESTING' },
  { verdict: 'FUTURE_UNKNOWN' },
  { testset: 'PRETESTS' },
  { creationTimeSeconds: undefined },
  { creationTimeSeconds: 999999999999 },
  { problem: { index: 'A' } },
  { problem: { contestId: 123, index: 'A', problemsetName: 'gym' } },
  { author: { members: [{ handle: 'other' }] } },
  { author: { members: [{ handle: 'learner' }, { handle: 'teammate' }] } },
  { author: { members: [{ handle: 'learner', ghost: true }] } },
])(
  'rejects ambiguous, pending, unsupported or malformed evidence %j',
  (patch) => {
    const p = parseCodeforces(
      { status: 'OK', result: [rawSubmission(now, patch)] },
      'learner',
      1,
      now,
    );
    expect(p.submissions).toHaveLength(0);
    expect(p.partial).toBe(true);
  },
);
it('deduplicates provider submission IDs in one page', () => {
  const row = rawSubmission(now);
  expect(
    parseCodeforces({ status: 'OK', result: [row, row] }, 'learner', 1, now)
      .submissions,
  ).toHaveLength(1);
});
it('returns a durable next offset for full pages', () => {
  const rows = Array.from({ length: 100 }, (_, i) =>
    rawSubmission(now, { id: i + 1 }),
  );
  expect(
    parseCodeforces({ status: 'OK', result: rows }, 'learner', 101, now),
  ).toMatchObject({ nextOffset: 201, complete: false });
});
it.each([
  {},
  null,
  { status: 'FAILED', comment: 'no user' },
  { status: 'OK', result: 'wrong' },
])('fails closed for invalid envelopes %j', (body) =>
  expect(() => parseCodeforces(body, 'learner', 1, now)).toThrow(),
);
it.each(['LEETCODE', 'CODECHEF'] as const)(
  '%s has an honest unavailable adapter',
  async (platform) => {
    expect(adapters[platform].available).toBe(false);
    await expect(
      adapters[platform].fetchPage('learner', 1),
    ).rejects.toMatchObject({ code: 'VERIFICATION_UNAVAILABLE' });
  },
);
it('requests only the fixed official submissions endpoint with redirects forbidden', async () => {
  const mocked = vi.fn(
    async () => new Response(JSON.stringify({ status: 'OK', result: [] })),
  );
  vi.stubGlobal('fetch', mocked);
  await codeforcesAdapter.fetchPage('learner', 1);
  const url = new URL(String(mocked.mock.calls[0]?.[0]));
  expect(url.origin).toBe('https://codeforces.com');
  expect(url.pathname).toBe('/api/user.status');
  expect(url.searchParams.get('includeSources')).toBeNull();
  expect(mocked.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
});
it('honors rate limit failures without exposing raw provider bodies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('private body', { status: 429 })),
  );
  await expect(codeforcesAdapter.fetchPage('learner', 1)).rejects.toMatchObject(
    { code: 'PROVIDER_RATE_LIMITED' },
  );
});
it('rejects oversize and invalid JSON responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('x'.repeat(1048577))),
  );
  await expect(codeforcesAdapter.fetchPage('learner', 1)).rejects.toMatchObject(
    { code: 'PROVIDER_RESPONSE_INVALID' },
  );
});
it('checks exact current handle and stable registration fingerprint without historic aliases', async () => {
  const mock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: 'OK',
          result: [{ handle: 'learner', registrationTimeSeconds: 1000000000 }],
        }),
      ),
  );
  vi.stubGlobal('fetch', mock);
  expect(await fetchCodeforcesIdentity('learner')).toBe(1000000000);
  expect(String(mock.mock.calls[0]?.[0])).toContain(
    'checkHistoricHandles=false',
  );
});
it('rejects renamed or reassigned account identity responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'OK',
            result: [
              { handle: 'renamed', registrationTimeSeconds: 1000000000 },
            ],
          }),
        ),
    ),
  );
  await expect(fetchCodeforcesIdentity('learner')).rejects.toMatchObject({
    code: 'OWNERSHIP_MISMATCH',
  });
});
describe('official HS256 OIDC ownership proof validation', () => {
  const secret = randomBytes(32).toString('base64url');
  const client = 'test-client';
  const nonce = 'test-one-time-nonce';
  const claims = () => ({
    iss: 'https://codeforces.com',
    sub: 'stable-subject',
    aud: client,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    nonce,
    handle: 'learner',
  });
  const token = (
    patch: Record<string, unknown> = {},
    alg = 'HS256',
    key = secret,
  ) => {
    const h = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString(
        'base64url',
      ),
      p = Buffer.from(JSON.stringify({ ...claims(), ...patch })).toString(
        'base64url',
      );
    return (
      h +
      '.' +
      p +
      '.' +
      createHmac('sha256', key)
        .update(h + '.' + p)
        .digest('base64url')
    );
  };
  it('validates a signed issuer/audience/nonce/time/handle proof', () =>
    expect(verifyCodeforcesToken(token(), secret, client, nonce)).toMatchObject(
      { subject: 'stable-subject', handle: 'learner' },
    ));
  it.each([
    { iss: 'https://attacker.invalid' },
    { aud: 'other-client' },
    { nonce: 'replayed' },
    { exp: 1 },
    { iat: 1 },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
    { sub: '' },
    { handle: '<script>' },
  ])('rejects bad claims %j', (patch) =>
    expect(() =>
      verifyCodeforcesToken(token(patch), secret, client, nonce),
    ).toThrow(),
  );
  it('rejects alg:none and wrong signatures', () => {
    expect(() =>
      verifyCodeforcesToken(token({}, 'none'), secret, client, nonce),
    ).toThrow();
    expect(() =>
      verifyCodeforcesToken(token({}, 'HS256', 'wrong'), secret, client, nonce),
    ).toThrow();
  });
});
it.each(['https://internal', '<script>', 'has space', 'x', 'a'.repeat(33)])(
  'rejects unsafe handle %s',
  (value) => expect(handleSchema.safeParse(value).success).toBe(false),
);
it('rejects self-reported status or submission injection in link/refresh contracts', () => {
  expect(
    linkSchema.safeParse({
      platform: 'CODEFORCES',
      handle: 'learner',
      expectedRevision: null,
      confirmed: true,
      status: 'VERIFIED',
    }).success,
  ).toBe(false);
  expect(
    refreshSchema.safeParse({
      platform: 'CODEFORCES',
      confirmed: true,
      submissionId: '123',
    }).success,
  ).toBe(false);
});
it('bounds pagination, day and date filters', () => {
  expect(querySchema.safeParse({ pageSize: 1000 }).success).toBe(false);
  expect(
    querySchema.safeParse({
      from: '2026-12-01T00:00:00Z',
      to: '2026-01-01T00:00:00Z',
    }).success,
  ).toBe(false);
});

it('bounds official Retry-After cooldowns conservatively', () => {
  expect(retryAfterMs('120')).toBe(120000);
  expect(retryAfterMs('999999')).toBe(900000);
  expect(retryAfterMs('invalid')).toBe(60000);
  expect(retryAfterMs(null)).toBe(60000);
});

it('maps interrupted identity response streams to a safe retryable provider failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('network interrupted'));
            },
          }),
        ),
    ),
  );
  await expect(fetchCodeforcesIdentity('learner')).rejects.toMatchObject({
    code: 'PROVIDER_RESPONSE_INVALID',
    status: 503,
  });
});
