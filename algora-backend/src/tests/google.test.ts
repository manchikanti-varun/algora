import { beforeEach, describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import * as oidc from 'openid-client';
const fixtures = vi.hoisted(() => ({
  claims: {} as Record<string, unknown>,
  invalidSignature: false,
  missingToken: false,
  tokenBodies: [] as string[],
}));
vi.mock('../config/env.js', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'test-only-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/backend/auth/google/callback',
    LOG_LEVEL: 'silent',
  },
}));
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
vi.mock('openid-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openid-client')>();
  return {
    ...actual,
    discovery: vi.fn(async (_issuer, _id, _metadata, _auth, options) => {
      const configuration = new actual.Configuration(
        {
          issuer: 'https://accounts.google.com',
          authorization_endpoint:
            'https://accounts.google.com/o/oauth2/v2/auth',
          token_endpoint: 'https://oauth2.googleapis.com/token',
          jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          response_types_supported: ['code'],
          id_token_signing_alg_values_supported: ['RS256'],
        },
        'test-google-client',
        {
          client_secret: 'test-only-secret',
          id_token_signed_response_alg: 'RS256',
        },
      );
      configuration[actual.customFetch] = async (input, init) => {
        const url = String(input);
        if (url.includes('/certs'))
          return new Response(
            JSON.stringify({
              keys: [
                {
                  ...keys.publicKey.export({ format: 'jwk' }),
                  kid: 'fixture-key',
                  alg: 'RS256',
                  use: 'sig',
                },
              ],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        fixtures.tokenBodies.push(String(init?.body));
        const header = Buffer.from(
          JSON.stringify({ alg: 'RS256', kid: 'fixture-key' }),
        ).toString('base64url');
        const payload = Buffer.from(JSON.stringify(fixtures.claims)).toString(
          'base64url',
        );
        const signingInput = header + '.' + payload;
        const signature = fixtures.invalidSignature
          ? Buffer.from('not-a-valid-signature').toString('base64url')
          : sign(
              'RSA-SHA256',
              Buffer.from(signingInput),
              keys.privateKey,
            ).toString('base64url');
        return new Response(
          JSON.stringify({
            access_token: 'fixture-only-access-token',
            token_type: 'Bearer',
            ...(fixtures.missingToken
              ? {}
              : { id_token: signingInput + '.' + signature }),
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      };
      for (const configure of options?.execute ?? []) configure(configuration);
      return configuration;
    }),
  };
});
import { googleProvider } from '../auth/google.js';
const checks = {
  state: 'fixture-state',
  nonce: 'fixture-nonce',
  verifier: 'v'.repeat(43),
};
const callback = () =>
  new URL(
    'http://localhost:3000/backend/auth/google/callback?code=fixture-code&state=' +
      checks.state,
  );
beforeEach(() => {
  const now = Math.floor(Date.now() / 1000);
  fixtures.claims = {
    iss: 'https://accounts.google.com',
    aud: 'test-google-client',
    sub: 'stable-google-subject',
    email: 'learner@example.test',
    email_verified: true,
    name: 'Test Learner',
    nonce: checks.nonce,
    iat: now,
    exp: now + 600,
  };
  fixtures.invalidSignature = false;
  fixtures.missingToken = false;
  fixtures.tokenBodies.length = 0;
});
describe('real OIDC verification with signed, test-only fixtures', () => {
  it('verifies a valid signed Google identity and sends PKCE to token exchange', async () => {
    expect(await googleProvider.verify(callback(), checks)).toMatchObject({
      sub: 'stable-google-subject',
      emailVerified: true,
    });
    expect(fixtures.tokenBodies[0]).toContain(
      'code_verifier=' + checks.verifier,
    );
    expect(oidc.discovery).toHaveBeenCalledWith(
      expect.any(URL),
      'test-google-client',
      expect.any(Object),
      undefined,
      expect.objectContaining({ execute: [oidc.enableNonRepudiationChecks] }),
    );
  });
  it('uses S256, state, nonce, fixed redirect and minimal scopes', async () => {
    const url = new URL(await googleProvider.authorize(checks));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(
      await oidc.calculatePKCECodeChallenge(checks.verifier),
    );
    expect(url.searchParams.get('nonce')).toBe(checks.nonce);
    expect(url.searchParams.get('state')).toBe(checks.state);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });
  it('rejects invalid signatures', async () => {
    fixtures.invalidSignature = true;
    await expect(
      googleProvider.verify(callback(), checks),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' });
  });
  it.each([
    ['iss', 'https://evil.example'],
    ['aud', 'another-client'],
    ['nonce', 'wrong-nonce'],
    ['exp', 1],
  ])('rejects an invalid %s claim', async (key, value) => {
    fixtures.claims[key] = value;
    await expect(
      googleProvider.verify(callback(), checks),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' });
  });
  it('requires a verified email', async () => {
    fixtures.claims.email_verified = false;
    await expect(
      googleProvider.verify(callback(), checks),
    ).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_INVALID' });
  });
  it('requires an ID token', async () => {
    fixtures.missingToken = true;
    await expect(
      googleProvider.verify(callback(), checks),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' });
  });
  it('validates returned OAuth state in the library too', async () => {
    const url = callback();
    url.searchParams.set('state', 'other-state');
    await expect(googleProvider.verify(url, checks)).rejects.toMatchObject({
      code: 'OAUTH_FAILED',
    });
  });
});
