import type { Types } from 'mongoose';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { maybeTransaction } from '../../lib/lease';
import { randomToken } from '../../lib/normalize';
import { LeetcodeLink, linkFlags, User, type LinkStatus } from '../../models';
import { ProviderError } from './leetcode.types';
import { fetchProfileText, hasEligibleProvider } from './provider-manager';

type Id = Types.ObjectId | string;
const USERNAME = /^[A-Za-z0-9_-]{1,40}$/;
const PENDING_TTL_MS = 14 * 24 * 3600 * 1000;
const VERIFY_COOLDOWN_MS = 60_000;
export const newChallenge = () => `algora-verify-${randomToken(9)}`;

/** Mirrors the student's relevant username onto the user record for display only. Counting always uses the link. */
async function mirror(studentId: Id) {
  const cur = await LeetcodeLink.findOne({ studentId, isCurrent: true }, 'username').lean();
  const pend = cur ? null : await LeetcodeLink.findOne({ studentId, isPending: true }, 'username').lean();
  const username = cur?.username ?? pend?.username;
  if (username) await User.updateOne({ _id: studentId }, { $set: { leetcodeUsername: username } });
  else await User.updateOne({ _id: studentId }, { $unset: { leetcodeUsername: 1 } });
}

async function endLink(id: Id, status: LinkStatus, reason: string, by?: Id) {
  await LeetcodeLink.updateOne({ _id: id }, { $set: { status, ...linkFlags(status), endedAt: new Date(), endedReason: reason, ...(by ? { endedBy: by } : {}) } });
}

/** A pending request that was never verified within 14 days no longer reserves the username. */
export async function expireStalePending(usernameNorm: string) {
  const stale = await LeetcodeLink.findOne({ usernameNorm, isPending: true, requestedAt: { $lt: new Date(Date.now() - PENDING_TTL_MS) } });
  if (stale) await endLink(stale._id, 'REVOKED', 'EXPIRED');
}

/** Start (or replace) a link request. Never changes what counts: the established link stays in force until the new one is verified. */
export async function requestLink(studentId: Id, username: string, consent: boolean) {
  if (!consent) throw badRequest('Consent is required to link a LeetCode account');
  if (!USERNAME.test(username)) throw badRequest('Invalid LeetCode username');
  const norm = username.toLowerCase();
  const current = await LeetcodeLink.findOne({ studentId, isCurrent: true });
  if (current && current.usernameNorm === norm) throw conflict('This account is already linked to your profile', 'ALREADY_LINKED');
  await expireStalePending(norm);
  const pending = await LeetcodeLink.findOne({ studentId, isPending: true });
  if (pending) await endLink(pending._id, 'REVOKED', 'REPLACED_BY_NEW_REQUEST');
  try {
    const link = await LeetcodeLink.create({
      studentId, username, usernameNorm: norm, status: 'PENDING_VERIFICATION', ...linkFlags('PENDING_VERIFICATION'),
      kind: current ? 'CHANGE' : 'INITIAL', replacesLinkId: current?._id, challenge: newChallenge(), challengeIssuedAt: new Date(), consentedAt: new Date(),
    });
    await mirror(studentId);
    return link;
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('That LeetCode username is already linked to another student', 'USERNAME_IN_USE');
    throw e;
  }
}

/**
 * Prove ownership by finding the challenge in the profile text. Needs provider access: if none is available, nothing changes
 * and the link stays pending. On success the previous link (for a change request) is SUPERSEDED, so its evidence stops counting
 * and is not restored by changing the username back (that creates a new link).
 */
export async function verifyOwnership(studentId: Id) {
  const link = (await LeetcodeLink.findOne({ studentId, isPending: true })) ?? (await LeetcodeLink.findOne({ studentId, status: 'REVALIDATION_REQUIRED' }));
  if (!link) throw notFound('No LeetCode account is waiting for verification');
  if (!(await hasEligibleProvider('profileText'))) throw new AppError(503, 'VERIFICATION_UNAVAILABLE', 'Automatic verification is not available yet. Your request stays pending.');
  if (link.lastVerifyAttemptAt && Date.now() - link.lastVerifyAttemptAt.getTime() < VERIFY_COOLDOWN_MS) {
    throw new AppError(429, 'COOLDOWN', 'Please wait before trying again', { retryAfterSec: Math.ceil((VERIFY_COOLDOWN_MS - (Date.now() - link.lastVerifyAttemptAt.getTime())) / 1000) });
  }
  // Atomic claim of the attempt slot so two instances cannot both pass the cooldown.
  const claimed = await LeetcodeLink.findOneAndUpdate(
    { _id: link._id, $or: [{ lastVerifyAttemptAt: { $exists: false } }, { lastVerifyAttemptAt: { $lte: new Date(Date.now() - VERIFY_COOLDOWN_MS) } }] },
    { $set: { lastVerifyAttemptAt: new Date() } }, { returnDocument: 'after' },
  );
  if (!claimed) throw new AppError(429, 'COOLDOWN', 'Please wait before trying again');
  const r = await fetchProfileText(link.username, studentId);
  if (!r.ok) {
    if (r.reason === 'NOT_FOUND') throw new AppError(404, 'LEETCODE_USER_NOT_FOUND', 'That LeetCode username was not found');
    throw new AppError(503, 'VERIFICATION_UNAVAILABLE', 'Verification is temporarily unavailable. Try again later.');
  }
  const text = r.value;
  if (!link.challenge || !text.includes(link.challenge)) return { verified: false as const, reason: 'CODE_NOT_FOUND' as const };

  await maybeTransaction(async (session) => {
    if (link.status === 'PENDING_VERIFICATION' && link.replacesLinkId) {
      await LeetcodeLink.updateOne({ _id: link.replacesLinkId, isCurrent: true }, { $set: { status: 'SUPERSEDED', ...linkFlags('SUPERSEDED'), endedAt: new Date(), endedReason: 'REPLACED_BY_VERIFIED_CHANGE' } }, { session });
    }
    await LeetcodeLink.updateOne({ _id: link._id }, { $set: { status: 'VERIFIED', ...linkFlags('VERIFIED'), verifiedAt: link.verifiedAt ?? new Date(), lastValidatedAt: new Date() } }, { session });
  });
  await mirror(studentId);
  // A new account starts a fresh sync history. Evidence of a superseded link is retained but no longer counts.
  await User.updateOne({ _id: studentId }, { $set: { 'sync.status': 'IDLE', 'sync.consecutiveFailures': 0, 'sync.possibleGap': false }, $unset: { 'sync.lastAttemptAt': 1, 'sync.nextEligibleAt': 1, 'sync.lastSuccessAt': 1 } });
  return { verified: true as const };
}

/** Student withdraws their link, or an administrator revokes it. Evidence is kept; it stops counting. */
export async function revokeLinks(studentId: Id, reason: string, by?: Id) {
  const active = await LeetcodeLink.find({ studentId, isActive: true });
  for (const l of active) await endLink(l._id, 'REVOKED', reason, by);
  await mirror(studentId);
  return active.length;
}

/** Administrator demands fresh proof of ownership. Evidence from this link stops counting until it is re-verified. */
export async function requireRevalidation(studentId: Id) {
  const link = await LeetcodeLink.findOneAndUpdate(
    { studentId, status: 'VERIFIED' },
    { $set: { status: 'REVALIDATION_REQUIRED', ...linkFlags('REVALIDATION_REQUIRED'), challenge: newChallenge(), challengeIssuedAt: new Date() }, $unset: { lastVerifyAttemptAt: 1 } },
    { returnDocument: 'after' },
  );
  if (!link) throw notFound('No verified LeetCode account to revalidate');
  return link;
}

export type LinkState = 'UNLINKED' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'REVALIDATION_REQUIRED' | 'REVOKED';

/** What the UI needs. The challenge is only returned while it is useful. */
export async function linkView(studentId: Id) {
  const [current, pending, last] = await Promise.all([
    LeetcodeLink.findOne({ studentId, isCurrent: true }).lean(),
    LeetcodeLink.findOne({ studentId, isPending: true }).lean(),
    LeetcodeLink.findOne({ studentId }).sort({ createdAt: -1 }).lean(),
  ]);
  let state: LinkState = 'UNLINKED';
  if (current) state = current.status === 'VERIFIED' ? 'VERIFIED' : 'REVALIDATION_REQUIRED';
  else if (pending) state = 'PENDING_VERIFICATION';
  else if (last?.status === 'REVOKED') state = 'REVOKED';
  const open = current?.status === 'REVALIDATION_REQUIRED' ? current : pending;
  return {
    state,
    current: current ? { username: current.username, status: current.status, verifiedAt: current.verifiedAt ?? null } : null,
    request: pending ? { username: pending.username, kind: pending.kind, requestedAt: pending.requestedAt } : null,
    challenge: open?.challenge ?? null,
    verificationAvailable: await hasEligibleProvider('profileText'),
    consentedAt: (current ?? pending)?.consentedAt ?? null,
    countsEvidence: state === 'VERIFIED',
  };
}
