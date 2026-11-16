import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { handleSchema } from './contracts.js';
export interface OwnershipChecks {
  state: string;
  nonce: string;
}
export interface CodingOwnership {
  configured(): boolean;
  authorize(checks: OwnershipChecks): string;
  verify(
    code: string,
    nonce: string,
  ): Promise<{ subject: string; handle: string; issuedAt: string }>;
}
const rejected = () =>
  new AppError(
    401,
    'OWNERSHIP_PROOF_INVALID',
    'Codeforces ownership could not be verified',
  );
export function verifyCodeforcesToken(
  token: string,
  secret: string,
  clientId: string,
  nonce: string,
  now = Date.now(),
) {
  if (token.length > 16384) throw rejected();
  const parts = token.split('.');
  if (parts.length !== 3) throw rejected();
  const [header, payload, signature] = parts as [string, string, string];
  try {
    const h = z
      .object({ alg: z.literal('HS256'), typ: z.string().optional() })
      .strict()
      .parse(JSON.parse(Buffer.from(header, 'base64url').toString('utf8')));
    if (h.typ && h.typ !== 'JWT') throw rejected();
    const expected = createHmac('sha256', secret)
      .update(header + '.' + payload)
      .digest();
    const actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw rejected();
    const claims = z
      .object({
        iss: z.literal('https://codeforces.com'),
        sub: z.string().min(1).max(255),
        aud: z.literal(clientId),
        exp: z.number().int(),
        iat: z.number().int(),
        nonce: z.literal(nonce),
        handle: handleSchema,
      })
      .parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    const seconds = now / 1000;
    if (
      claims.exp <= seconds ||
      claims.iat > seconds + 30 ||
      claims.iat < seconds - 600 ||
      claims.exp <= claims.iat
    )
      throw rejected();
    return {
      subject: claims.sub,
      handle: claims.handle,
      issuedAt: new Date(claims.iat * 1000).toISOString(),
    };
  } catch {
    throw rejected();
  }
}
export const codingOwnership: CodingOwnership = {
  configured: () =>
    Boolean(
      env.CODEFORCES_CLIENT_ID &&
      env.CODEFORCES_CLIENT_SECRET &&
      env.CODEFORCES_REDIRECT_URI,
    ),
  authorize({ state, nonce }) {
    if (!this.configured())
      throw new AppError(
        503,
        'OWNERSHIP_NOT_CONFIGURED',
        'Codeforces ownership integration is not configured',
      );
    const url = new URL('https://codeforces.com/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: env.CODEFORCES_CLIENT_ID!,
      redirect_uri: env.CODEFORCES_REDIRECT_URI!,
      response_type: 'code',
      scope: 'openid',
      state,
      nonce,
    }).toString();
    return url.href;
  },
  async verify(code, nonce) {
    if (!this.configured())
      throw new AppError(
        503,
        'OWNERSHIP_NOT_CONFIGURED',
        'Codeforces ownership integration is not configured',
      );
    try {
      const response = await fetch('https://codeforces.com/oauth/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: env.CODEFORCES_REDIRECT_URI!,
          client_id: env.CODEFORCES_CLIENT_ID!,
          client_secret: env.CODEFORCES_CLIENT_SECRET!,
        }),
      });
      if (!response.ok) throw rejected();
      const reader = response.body?.getReader();
      if (!reader) throw rejected();
      let length = 0;
      const parts: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 32768) {
          await reader.cancel();
          throw rejected();
        }
        parts.push(value);
      }
      const tokens = z
        .object({ id_token: z.string().min(1).max(16384) })
        .parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
      // Access/refresh tokens and raw ID tokens never leave this function or enter storage.
      return verifyCodeforcesToken(
        tokens.id_token,
        env.CODEFORCES_CLIENT_SECRET!,
        env.CODEFORCES_CLIENT_ID!,
        nonce,
      );
    } catch {
      throw rejected();
    }
  },
};
