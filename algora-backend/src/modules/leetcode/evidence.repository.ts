import type { ClientSession, Types } from 'mongoose';
import { env } from '../../config/env';
import { COUNTING_LINK_STATUSES, COUNTING_SOURCES, EvidenceConflict, LeetcodeLink, ObservedSubmission, SolveEvidence } from '../../models';
import type { AcceptedSubmission } from './leetcode.types';

/** Sources that currently count. MOCK_DEV never counts (or is written) in production. */
export const countingSources = () => (env.isProd ? ['AUTOMATED_PROVIDER'] : [...COUNTING_SOURCES]);

export interface LinkCtx { studentId: Types.ObjectId | string; linkId: Types.ObjectId | string; username: string }

const TIMESTAMP_TOLERANCE_MS = 120_000;

/**
 * Persist one sync's observations as ONE bulk write. Call it inside `withFencedWrite` so a worker that lost its lease
 * cannot insert or update anything. Idempotent and monotonic across providers:
 *  - one row per (student, link, slug, source): a problem seen through Direct and later through Alfa is ONE row
 *    (`providers` lists both), so switching providers never duplicates points;
 *  - earliest/latest observed timestamps only move outward; firstVerifiedAt is set once; nothing is deleted or downgraded.
 * Conflicts (only detectable when providers return submission ids): an id reported with a different slug is NOT used
 * (no unsupported verification); an id reported with a different timestamp keeps the problem verified but the conflicting
 * timestamp is not used. Both are recorded in `evidence_conflicts`.
 * Returns the number of slugs verified for the first time.
 */
export async function recordObservations(
  ctx: LinkCtx,
  submissions: AcceptedSubmission[],
  meta: { source: 'AUTOMATED_PROVIDER' | 'MOCK_DEV'; provider: string; futureTimestamps?: number },
  now: Date,
  session?: ClientSession,
): Promise<number> {
  if (meta.source === 'MOCK_DEV' && env.isProd) throw new Error('MOCK_DEV evidence is not allowed in production');
  const conflicts: Record<string, unknown>[] = [];
  if (meta.futureTimestamps) conflicts.push({ studentId: ctx.studentId, linkId: ctx.linkId, type: 'FUTURE_TIMESTAMP', provider: meta.provider, received: { count: meta.futureTimestamps } });

  // Cross-provider consistency on submission ids.
  let usable = submissions;
  const withId = submissions.filter((s) => s.submissionId);
  if (withId.length) {
    const known = new Map((await ObservedSubmission.find({ linkId: ctx.linkId, submissionId: { $in: withId.map((s) => s.submissionId!) } }).session(session ?? null).lean()).map((o) => [o.submissionId, o]));
    usable = [];
    const obsOps = [];
    for (const s of submissions) {
      if (!s.submissionId) { usable.push(s); continue; }
      const k = known.get(s.submissionId);
      if (k && k.slug !== s.problemSlug) {
        conflicts.push({ studentId: ctx.studentId, linkId: ctx.linkId, type: 'SUBMISSION_SLUG_MISMATCH', submissionId: s.submissionId, slug: s.problemSlug, expected: { slug: k.slug }, received: { slug: s.problemSlug }, provider: meta.provider });
        continue;
      }
      if (k && k.submittedAt && s.submittedAt && Math.abs(new Date(k.submittedAt).getTime() - s.submittedAt.getTime()) > TIMESTAMP_TOLERANCE_MS) {
        conflicts.push({ studentId: ctx.studentId, linkId: ctx.linkId, type: 'TIMESTAMP_MISMATCH', submissionId: s.submissionId, slug: s.problemSlug, expected: { submittedAt: k.submittedAt }, received: { submittedAt: s.submittedAt }, provider: meta.provider });
        usable.push({ ...s, submittedAt: null });
        continue;
      }
      usable.push(s);
      obsOps.push({ updateOne: { filter: { linkId: ctx.linkId, submissionId: s.submissionId }, update: { $setOnInsert: { studentId: ctx.studentId, slug: s.problemSlug, submittedAt: s.submittedAt, firstSeenAt: now }, $addToSet: { providers: meta.provider } }, upsert: true } });
    }
    if (obsOps.length) await ObservedSubmission.bulkWrite(obsOps as any, { ordered: false, session });
  }
  if (conflicts.length) await EvidenceConflict.insertMany(conflicts.map((c) => ({ ...c, at: now })), { session });

  const bySlug = new Map<string, AcceptedSubmission[]>();
  for (const s of usable) bySlug.set(s.problemSlug.toLowerCase(), [...(bySlug.get(s.problemSlug.toLowerCase()) ?? []), s]);
  if (!bySlug.size) return 0;
  const username = ctx.username.toLowerCase();
  const ops = [...bySlug].map(([slug, subs]) => {
    const times = subs.map((s) => s.submittedAt).filter((d): d is Date => !!d);
    const ids = subs.map((s) => s.submissionId).filter((i): i is string => !!i);
    const update: Record<string, unknown> = {
      $set: { status: 'VERIFIED', lastVerifiedAt: now, provider: meta.provider, title: subs[0].problemTitle, ...(ids.length ? { submissionId: ids[0] } : {}) },
      $setOnInsert: { firstVerifiedAt: now },
      $addToSet: { providers: meta.provider, ...(times.length ? { observedAt: { $each: times } } : {}) },
    };
    if (times.length) {
      update.$min = { earliestObservedSolvedAt: new Date(Math.min(...times.map((d) => d.getTime()))) };
      update.$max = { latestObservedSolvedAt: new Date(Math.max(...times.map((d) => d.getTime()))) };
    }
    return { updateOne: { filter: { studentId: ctx.studentId, linkId: ctx.linkId, slug, leetcodeUsername: username, source: meta.source }, update, upsert: true } };
  });
  const r = await SolveEvidence.bulkWrite(ops as any, { ordered: false, session });
  return r.upsertedCount;
}

/** Student withdrew consent and asked for deletion: remove every LeetCode-derived record for them. */
export async function purgeStudentLeetcodeData(studentId: Types.ObjectId | string) {
  const [e, o, c] = await Promise.all([
    SolveEvidence.deleteMany({ studentId }), ObservedSubmission.deleteMany({ studentId }), EvidenceConflict.deleteMany({ studentId }),
  ]);
  return { evidence: e.deletedCount, observed: o.deletedCount, conflicts: c.deletedCount };
}

/** Student -> id of their currently linked account. Only these links' evidence counts. */
export async function verifiedLinkIds(studentIds: (Types.ObjectId | string)[]): Promise<Map<string, Types.ObjectId>> {
  // Consent is required for evidence to count (withdrawal = unlink, which revokes the link).
  const links = await LeetcodeLink.find(
    { studentId: { $in: studentIds }, status: { $in: [...COUNTING_LINK_STATUSES] }, isCurrent: true, consentedAt: { $type: 'date' } },
    'studentId',
  ).lean();
  return new Map(links.map((l) => [String(l.studentId), l._id]));
}

/** Evidence that counts for a student: VERIFIED, counting source, and belonging to the student's currently linked account. */
export async function countableEvidence(studentId: Types.ObjectId | string) {
  const link = (await verifiedLinkIds([studentId])).get(String(studentId));
  if (!link) return [];
  return SolveEvidence.find({ studentId, linkId: link, status: 'VERIFIED', source: { $in: countingSources() } } as Record<string, unknown>).lean();
}
