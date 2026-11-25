import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { unauthorized } from '../../lib/errors';
import { normalizeEmail } from '../../lib/normalize';

export interface GoogleIdentity { sub: string; email: string; name: string; picture?: string }

const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

/**
 * Verifies signature (Google certs), audience (our client id), expiry and issuer
 * (google-auth-library checks accounts.google.com variants), then requires a verified email.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('missing claims');
    if (p.email_verified !== true) throw unauthorized('Google email is not verified');
    return { sub: p.sub, email: normalizeEmail(p.email), name: p.name?.trim() || p.email.split('@')[0], picture: p.picture };
  } catch (e: any) {
    if (e?.status === 401) throw e;
    throw unauthorized('Invalid Google credential');
  }
}
