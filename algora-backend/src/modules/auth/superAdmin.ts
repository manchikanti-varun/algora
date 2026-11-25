import { env } from '../../config/env';
import { conflict } from '../../lib/errors';
import { User } from '../../models';
import type { GoogleIdentity } from './google';

/**
 * Revoke any Super Admin whose email no longer equals SUPER_ADMIN_EMAIL.
 * Bumps sessionVersion so their cookies stop working immediately.
 */
export async function reconcileSuperAdmin(): Promise<number> {
  const r = await User.updateMany(
    { role: 'SUPER_ADMIN', status: 'ACTIVE', email: { $ne: env.SUPER_ADMIN_EMAIL } },
    { $set: { status: 'REVOKED' }, $inc: { sessionVersion: 1 } },
  );
  return r.modifiedCount;
}

/** Called when a verified Google identity's email equals SUPER_ADMIN_EMAIL. */
export async function loginOrCreateSuperAdmin(id: GoogleIdentity) {
  await reconcileSuperAdmin();
  const existing = await User.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: env.SUPER_ADMIN_EMAIL });
  if (existing) {
    // Same email but a different Google account: refuse rather than hand over privileges.
    if (existing.googleSub !== id.sub) throw conflict('Super Admin identity mismatch', 'IDENTITY_CONFLICT');
    return existing;
  }
  // Email is already used by a non-admin or previously revoked account: never silently elevate.
  if (await User.exists({ $or: [{ email: id.email }, { googleSub: id.sub }] })) {
    throw conflict('This account cannot be promoted automatically. Resolve the conflict manually.', 'ACCOUNT_CONFLICT');
  }
  return User.create({
    googleSub: id.sub,
    email: id.email,
    role: 'SUPER_ADMIN',
    fullName: id.name,
    picture: id.picture,
  });
}
