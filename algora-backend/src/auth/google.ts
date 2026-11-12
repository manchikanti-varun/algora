import * as oidc from 'openid-client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import type { GoogleIdentity } from './types.js';
export interface OAuthChecks {
  state: string;
  nonce: string;
  verifier: string;
}
export interface GoogleProvider {
  configured(): boolean;
  authorize(checks: OAuthChecks): Promise<string>;
  verify(callback: URL, checks: OAuthChecks): Promise<GoogleIdentity>;
}
let configuration: Promise<oidc.Configuration> | undefined;
async function config() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new AppError(
      503,
      'AUTH_NOT_CONFIGURED',
      'Google sign-in is not configured',
    );
  configuration ??= oidc
    .discovery(
      new URL('https://accounts.google.com'),
      env.GOOGLE_CLIENT_ID,
      {
        client_secret: env.GOOGLE_CLIENT_SECRET,
        id_token_signed_response_alg: 'RS256',
      },
      undefined,
      { execute: [oidc.enableNonRepudiationChecks], timeout: 10 },
    )
    .catch(() => {
      configuration = undefined;
      throw new AppError(
        503,
        'GOOGLE_UNAVAILABLE',
        'Google sign-in is temporarily unavailable',
      );
    });
  return configuration;
}
export const googleProvider: GoogleProvider = {
  configured: () =>
    Boolean(
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_REDIRECT_URI,
    ),
  async authorize(checks) {
    const conf = await config();
    return oidc.buildAuthorizationUrl(conf, {
      redirect_uri: env.GOOGLE_REDIRECT_URI!,
      response_type: 'code',
      scope: 'openid email profile',
      state: checks.state,
      nonce: checks.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(checks.verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).href;
  },
  async verify(callback, checks) {
    const conf = await config();
    try {
      const tokens = await oidc.authorizationCodeGrant(conf, callback, {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.verifier,
        idTokenExpected: true,
      });
      // The library verifies signature (JWKS), issuer, audience, nonce and token times.
      const identity = z
        .object({
          sub: z.string().min(1).max(255),
          email: z.email().max(320),
          email_verified: z.literal(true),
          name: z.string().min(1).max(160).optional(),
          picture: z
            .url()
            .max(2048)
            .refine((v) => v.startsWith('https://'))
            .optional(),
        })
        .safeParse(tokens.claims());
      if (!identity.success)
        throw new AppError(
          401,
          'GOOGLE_IDENTITY_INVALID',
          'A verified Google email is required',
        );
      return {
        sub: identity.data.sub,
        email: identity.data.email.toLowerCase(),
        emailVerified: true,
        displayName: identity.data.name ?? 'Algora learner',
        avatarUrl: identity.data.picture,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        401,
        'OAUTH_FAILED',
        'Google sign-in could not be verified',
      );
    }
  },
};
export const newOAuthChecks = (): OAuthChecks => ({
  state: oidc.randomState(),
  nonce: oidc.randomNonce(),
  verifier: oidc.randomPKCECodeVerifier(),
});
