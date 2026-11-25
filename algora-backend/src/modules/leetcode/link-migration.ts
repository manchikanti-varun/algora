import mongoose, { type ClientSession } from 'mongoose';
import { supportsTransactions } from '../../lib/lease';
import { LeetcodeLink, SolveEvidence, User } from '../../models';
import { endLinkForMigration, USERNAME } from './links.service';

const legacyStatuses = ['VERIFIED', 'REVALIDATION_REQUIRED', 'PENDING_VERIFICATION'] as const;

export async function migrateLeetcodeLinks(apply: boolean) {
  if (!apply) return migrate();
  if (!(await supportsTransactions())) throw new Error('Applying this migration requires a MongoDB replica set');
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => migrate(session)); }
  finally { await session.endSession(); }
}

async function migrate(session?: ClientSession) {
  const counts: Record<string, number> = {};
  const conflicts: { linkId: string; studentId: string; reason: string }[] = [];
  const bump = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  const legacy = await LeetcodeLink.find({ status: { $in: [...legacyStatuses] } }).sort({ createdAt: 1, _id: 1 }).session(session ?? null).lean();
  counts.legacyLinksFound = legacy.length;
  const active = await LeetcodeLink.find({ $or: [{ isActive: true }, { isCurrent: true }] }).session(session ?? null).lean();
  const byUsername = new Map<string, Set<string>>();
  const current = new Map<string, (typeof active)[number]>();
  const usernameKey = (link: (typeof active)[number]) => link.username.trim().toLowerCase();
  for (const link of active) {
    if (link.isCurrent) current.set(String(link.studentId), link);
    if (link.isActive) {
      const key = usernameKey(link);
      const holders = byUsername.get(key) ?? new Set<string>();
      holders.add(String(link._id));
      byUsername.set(key, holders);
    }
  }

  for (const link of legacy) {
    const studentId = String(link.studentId);
    const linkId = String(link._id);
    const username = link.username.trim();
    const key = usernameKey(link);
    const holders = byUsername.get(key) ?? new Set<string>();
    const existing = current.get(studentId);
    let reason: string | undefined;
    if (!link.consentedAt || link.endedAt) reason = 'skipped_no_consent';
    else if (!USERNAME.test(username)) reason = 'skipped_invalid_username';
    else if ([...holders].some((id) => id !== linkId)) reason = 'skipped_username_conflict';
    else if (link.status === 'PENDING_VERIFICATION' && link.replacesLinkId && String(link.replacesLinkId) !== String(existing?._id)) {
      reason = 'skipped_inactive_predecessor';
    } else if (existing && String(existing._id) !== linkId &&
      (link.status !== 'PENDING_VERIFICATION' || String(existing._id) !== String(link.replacesLinkId))) {
      reason = 'skipped_current_link_conflict';
    }
    if (reason) {
      bump(reason);
      conflicts.push({ linkId, studentId, reason });
      continue;
    }
    if (existing && String(existing._id) !== linkId) {
      bump('superseded_replaced_link');
      byUsername.get(usernameKey(existing))?.delete(String(existing._id));
      if (session) await endLinkForMigration(existing._id, 'MIGRATED_TO_ACCOUNT_LINKING', session);
    }
    bump(link.status === 'PENDING_VERIFICATION' ? 'pending_promoted' : 'verified_converted');
    holders.add(linkId);
    byUsername.set(key, holders);
    current.set(studentId, link);
    if (session) {
      await LeetcodeLink.updateOne({ _id: link._id, status: link.status }, {
        $set: {
          username, usernameNorm: key, status: 'LINKED', isActive: true, isCurrent: true, isPending: false,
          linkedAt: link.verifiedAt ?? link.createdAt ?? new Date(),
        },
        $unset: { challenge: 1, challengeIssuedAt: 1, lastVerifyAttemptAt: 1 },
      }, { session });
      await User.updateOne({ _id: link.studentId }, {
        $set: { leetcodeUsername: username, ...(link.status === 'PENDING_VERIFICATION' ? { sync: { status: 'IDLE' } } : {}) },
      }, { session });
    }
  }
  counts.evidenceRowsPreserved = await SolveEvidence.countDocuments().session(session ?? null);
  counts.revokedLinksUntouched = await LeetcodeLink.countDocuments({ status: 'REVOKED' }).session(session ?? null);
  return { applied: !!session, counts, conflicts };
}
