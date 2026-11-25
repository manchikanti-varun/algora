import type { ClientSession, Types } from 'mongoose';
import { badRequest, conflict } from '../../lib/errors';
import { maybeTransaction } from '../../lib/lease';
import { LeetcodeLink, linkFlags, User, type LinkStatus } from '../../models';
import { clearBoardCache } from '../progress/progress.service';

type Id = Types.ObjectId | string;
export const USERNAME = /^[A-Za-z0-9_-]{1,40}$/;

/** Trim outer whitespace and case-fold for the uniqueness key. Internal whitespace is not a valid LeetCode username. */
export const normalizeUsername = (u: string) => u.trim();

export type LinkState = 'LINKED' | 'UNLINKED';

/** Mirror the username and reset its synchronization state in the same transaction as the link. */
async function resetSyncState(studentId: Id, username: string | null, session?: ClientSession) {
  await User.updateOne(
    { _id: studentId },
    {
      $set: { 'sync.status': 'IDLE', 'sync.consecutiveFailures': 0, 'sync.possibleGap': false, ...(username ? { leetcodeUsername: username } : {}) },
      $unset: {
        'sync.lastAttemptAt': 1, 'sync.nextEligibleAt': 1, 'sync.lastSuccessAt': 1, 'sync.lastError': 1,
        'sync.statusDetail': 1, 'sync.coverage': 1, 'sync.lastProvider': 1, ...(username ? {} : { leetcodeUsername: 1 }),
      },
    },
    { session },
  );
}

/** Used only by the link migration: end a superseded link without changing its student's sync state. */
export async function endLinkForMigration(id: Id, reason: string, session: ClientSession) {
  await endLink(id, 'SUPERSEDED', reason, undefined, session);
}

async function endLink(id: Id, status: LinkStatus, reason: string, by?: Id, session?: ClientSession | null) {
  await LeetcodeLink.updateOne(
    { _id: id } as Record<string, unknown>,
    { $set: { status, ...linkFlags(status), endedAt: new Date(), endedReason: reason, ...(by ? { endedBy: by } : {}) } },
    session ? { session } : {},
  );
}

export interface LinkOptions {
  /** Student agreed to Algora reading this account's public accepted submissions. */
  consent?: boolean;
  /** Set when an authorised trainer corrects the username on the student's standing consent. */
  by?: Id;
  reason?: string;
}

/**
 * Link (or change) a LeetCode username. No provider request is made: linking must work while synchronization is
 * unavailable. The username is NOT proof of account ownership; it is the account whose public submissions Algora reads.
 *
 * A change ends the previous link immediately (it stops being synchronized and stops counting) and creates a NEW link, so
 * evidence is never transferred to the new account.
 */
export async function linkAccount(studentId: Id, rawUsername: string, opts: LinkOptions = {}) {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME.test(username)) throw badRequest('Invalid LeetCode username');
  const norm = username.toLowerCase();
  try {
    const result = await maybeTransaction(async (session) => {
      const current = await LeetcodeLink.findOne({ studentId, isCurrent: true }).session(session ?? null);
      if (current?.usernameNorm === norm) throw conflict('This account is already linked to your profile', 'ALREADY_LINKED');
      const consentedAt = opts.consent ? new Date() : current?.consentedAt;
      if (!consentedAt) throw conflict('Consent is required to link a LeetCode account', 'CONSENT_REQUIRED');
      if (!session && await LeetcodeLink.exists({ usernameNorm: norm, isActive: true })) {
        throw conflict('That LeetCode username is already linked', 'USERNAME_IN_USE');
      }
      if (current) await endLink(current._id, 'SUPERSEDED', opts.reason ?? 'USERNAME_CHANGED', opts.by, session);
      const [link] = await LeetcodeLink.create(
        [
          {
            studentId,
            username,
            usernameNorm: norm,
            status: 'LINKED',
            ...linkFlags('LINKED'),
            kind: current ? 'CHANGE' : 'INITIAL',
            replacesLinkId: current?._id,
            consentedAt,
            linkedAt: new Date(),
            requestedAt: new Date(),
          },
        ],
        { session },
      );
      await resetSyncState(studentId, username, session);
      return link;
    });
    clearBoardCache();
    return result;
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('That LeetCode username is already linked to another student', 'USERNAME_IN_USE');
    throw e;
  }
}

/** Student withdraws their link, or an administrator revokes it. Evidence is kept; it stops counting. */
export async function revokeLinks(studentId: Id, reason: string, by?: Id) {
  const count = await maybeTransaction(async (session) => {
    const revoked = await LeetcodeLink.updateMany({ studentId, isActive: true }, {
      $set: { status: 'REVOKED', ...linkFlags('REVOKED'), endedAt: new Date(), endedReason: reason, ...(by ? { endedBy: by } : {}) },
    }, { session });
    await resetSyncState(studentId, null, session);
    return revoked.modifiedCount;
  });
  clearBoardCache();
  return count;
}

/**
 * Trainer/Super Admin correction. Uses the student's standing consent; if they never consented, the correction is refused
 * and the student must link themselves. Audited by the caller.
 */
export async function correctUsername(studentId: Id, username: string, by: Id) {
  return linkAccount(studentId, username, { by, reason: 'TRAINER_CORRECTED_USERNAME' });
}

/** What the UI needs. There is no challenge, request or verification step in this model. */
export async function linkView(studentId: Id) {
  const current = await LeetcodeLink.findOne({ studentId, isCurrent: true }).lean();
  const linked = !!current?.consentedAt && (current.status === 'LINKED' || current.status === 'VERIFIED');
  const state: LinkState = linked ? 'LINKED' : 'UNLINKED';
  return {
    state,
    username: linked ? current.username : null,
    current: linked ? { username: current.username, linkedAt: current.linkedAt ?? current.createdAt ?? null } : null,
    countsEvidence: linked,
    consentedAt: linked ? current.consentedAt : null,
  };
}

/** Used by callers that need the countable link document (not just the view). */
export async function currentLink(studentId: Id) {
  return LeetcodeLink.findOne({ studentId, isCurrent: true }).lean();
}
