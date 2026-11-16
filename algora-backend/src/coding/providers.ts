import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../middleware/errors.js';
import {
  handleSchema,
  type Adapter,
  type Platform,
  type ProviderPage,
  type Submission,
} from './contracts.js';
export const digest = (v: string) =>
  createHash('sha256').update(v).digest('hex');
export class ProviderCooldown extends AppError {
  constructor(public retryAfterMs: number) {
    super(429, 'PROVIDER_RATE_LIMITED', 'Codeforces requested a cooldown');
  }
}
export function retryAfterMs(value: string | null, now = Date.now()) {
  const parsed =
    value && /^\d+$/.test(value)
      ? Number(value) * 1000
      : value
        ? Date.parse(value) - now
        : 60000;
  return Number.isFinite(parsed)
    ? Math.max(60000, Math.min(900000, parsed))
    : 60000;
}
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const rawSubmission = z.object({
  id: positive,
  creationTimeSeconds: positive,
  problem: z.object({
    contestId: positive,
    index: z.string().regex(/^[A-Z][A-Z0-9]{0,3}$/),
    problemsetName: z.string().optional(),
  }),
  author: z.object({
    members: z
      .array(z.object({ handle: handleSchema, ghost: z.boolean().optional() }))
      .min(1)
      .max(100),
    ghost: z.boolean().optional(),
  }),
  programmingLanguage: z.string().min(1).max(100),
  verdict: z.string().max(80).optional(),
  testset: z.string().max(30),
});
const verdicts = new Set([
  'OK',
  'WRONG_ANSWER',
  'TIME_LIMIT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'RUNTIME_ERROR',
  'COMPILATION_ERROR',
  'PRESENTATION_ERROR',
  'IDLENESS_LIMIT_EXCEEDED',
  'FAILED',
  'CRASHED',
  'CHALLENGED',
  'SKIPPED',
  'REJECTED',
]);
export function parseCodeforces(
  body: unknown,
  handle: string,
  offset: number,
  now = new Date(),
): ProviderPage {
  const envelope = z
    .object({ status: z.literal('OK'), result: z.array(z.unknown()).max(100) })
    .safeParse(body);
  if (!envelope.success)
    throw new AppError(
      503,
      'PROVIDER_RESPONSE_INVALID',
      'Codeforces response could not be validated',
    );
  const submissions: Submission[] = [];
  let partial = false;
  const seen = new Set<string>();
  for (const raw of envelope.data.result) {
    const parsed = rawSubmission.safeParse(raw);
    if (!parsed.success) {
      partial = true;
      continue;
    }
    const s = parsed.data,
      member = s.author.members[0];
    if (
      s.author.members.length !== 1 ||
      !member ||
      member.ghost ||
      s.author.ghost ||
      member.handle.toLowerCase() !== handle.toLowerCase() ||
      s.problem.problemsetName
    ) {
      partial = true;
      continue;
    }
    if (!s.verdict || !verdicts.has(s.verdict) || s.testset !== 'TESTS') {
      partial = true;
      continue;
    }
    const milliseconds = s.creationTimeSeconds * 1000;
    if (milliseconds > now.getTime() + 60000 || milliseconds < 946684800000) {
      partial = true;
      continue;
    }
    const id = String(s.id);
    if (seen.has(id)) {
      partial = true;
      continue;
    }
    seen.add(id);
    const normalized = {
      id,
      problemKey: s.problem.contestId + '-' + s.problem.index,
      handle: member.handle,
      verdict: s.verdict,
      accepted: s.verdict === 'OK',
      language: s.programmingLanguage,
      submittedAt: new Date(milliseconds).toISOString(),
      sourceUrl:
        'https://codeforces.com/contest/' +
        s.problem.contestId +
        '/submission/' +
        id,
    };
    submissions.push({
      ...normalized,
      digest: digest(JSON.stringify(normalized)),
    });
  }
  const complete = envelope.data.result.length < 100;
  return {
    submissions,
    nextOffset: complete ? null : offset + 100,
    complete,
    partial,
  };
}
export async function fetchCodeforcesIdentity(handle: string) {
  handleSchema.parse(handle);
  const url = new URL('https://codeforces.com/api/user.info');
  url.searchParams.set('handles', handle);
  url.searchParams.set('checkHistoricHandles', 'false');
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new AppError(
      503,
      'PROVIDER_UNAVAILABLE',
      'Codeforces identity is unavailable',
    );
  }
  if (response.status === 429)
    throw new ProviderCooldown(
      retryAfterMs(response.headers.get('retry-after')),
    );
  if (!response.ok)
    throw new AppError(
      503,
      'PROVIDER_UNAVAILABLE',
      'Codeforces identity is unavailable',
    );
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(
      503,
      'PROVIDER_RESPONSE_INVALID',
      'Missing identity response',
    );
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 32768) {
        await reader.cancel();
        throw new AppError(
          503,
          'PROVIDER_RESPONSE_INVALID',
          'Invalid identity response size',
        );
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new AppError(
      503,
      'PROVIDER_RESPONSE_INVALID',
      'Codeforces identity response is incomplete',
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(
      503,
      'PROVIDER_RESPONSE_INVALID',
      'Invalid identity response',
    );
  }
  const parsed = z
    .object({
      status: z.literal('OK'),
      result: z
        .array(
          z.object({ handle: handleSchema, registrationTimeSeconds: positive }),
        )
        .length(1),
    })
    .safeParse(body);
  const user = parsed.success ? parsed.data.result[0] : null;
  if (!user || user.handle.toLowerCase() !== handle.toLowerCase())
    throw new AppError(
      409,
      'OWNERSHIP_MISMATCH',
      'External handle changed; verify ownership again',
    );
  return user.registrationTimeSeconds;
}
export const codeforcesAdapter: Adapter = {
  platform: 'CODEFORCES',
  identity: fetchCodeforcesIdentity,
  available: true,
  reason: 'Official public API; verified OIDC account required',
  version: 'cf-api-v1/1',
  async fetchPage(handle, offset) {
    handleSchema.parse(handle);
    if (!Number.isSafeInteger(offset) || offset < 1 || offset > 100001)
      throw new AppError(400, 'INVALID_CURSOR', 'Invalid provider cursor');
    const url = new URL('https://codeforces.com/api/user.status');
    url.searchParams.set('handle', handle);
    url.searchParams.set('from', String(offset));
    url.searchParams.set('count', '100');
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw new AppError(
        503,
        'PROVIDER_UNAVAILABLE',
        'Codeforces is temporarily unavailable',
      );
    }
    if (response.status === 429)
      throw new ProviderCooldown(
        retryAfterMs(response.headers.get('retry-after')),
      );
    if (!response.ok)
      throw new AppError(
        503,
        'PROVIDER_UNAVAILABLE',
        'Codeforces is temporarily unavailable',
      );
    const reader = response.body?.getReader();
    if (!reader)
      throw new AppError(
        503,
        'PROVIDER_RESPONSE_INVALID',
        'Missing provider response',
      );
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 1024 * 1024) throw new Error('limit');
        chunks.push(value);
      }
    } catch {
      await reader.cancel().catch(() => undefined);
      throw new AppError(
        503,
        'PROVIDER_RESPONSE_INVALID',
        'Invalid provider response size',
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new AppError(
        503,
        'PROVIDER_RESPONSE_INVALID',
        'Invalid provider JSON',
      );
    }
    return parseCodeforces(body, handle, offset);
  },
};
const unavailable = (platform: Platform): Adapter => ({
  platform,
  available: false,
  reason:
    'No approved ownership and authoritative submission integration is configured. Scraping and session-cookie access are disabled.',
  version: 'unavailable/1',
  async fetchPage() {
    throw new AppError(
      503,
      'VERIFICATION_UNAVAILABLE',
      'Verified integration is unavailable for this platform',
    );
  },
});
export const adapters: Record<Platform, Adapter> = {
  CODEFORCES: codeforcesAdapter,
  LEETCODE: unavailable('LEETCODE'),
  CODECHEF: unavailable('CODECHEF'),
};
