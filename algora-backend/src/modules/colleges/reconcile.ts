import type { Types } from 'mongoose';
import { conflict, notFound } from '../../lib/errors';
import { maybeTransaction, supportsTransactions } from '../../lib/lease';
import { nameKey } from '../../lib/normalize';
import { Batch, College, User } from '../../models';
import { audit } from '../audit/audit';
import { activeCollege, collegeLabel } from './registry';

export interface CollegeMergePreview {
  source: string;
  target: string;
  students: number;
  batches: number;
  alreadyMerged: boolean;
}

/** Dry run for merging a duplicate college into a canonical one. Never writes. */
export async function previewCollegeMerge(sourceId: string | Types.ObjectId, targetId: string | Types.ObjectId): Promise<CollegeMergePreview> {
  if (String(sourceId) === String(targetId)) throw conflict('Select a different canonical college.');
  const [source, target, students, batches] = await Promise.all([
    College.findById(sourceId).lean(),
    activeCollege(String(targetId)),
    User.countDocuments({ collegeId: sourceId }),
    Batch.countDocuments({ collegeId: sourceId }),
  ]);
  if (!source) throw notFound('College not found');
  return {
    source: collegeLabel(source) ?? String(sourceId),
    target: collegeLabel(target) ?? String(targetId),
    students, batches,
    alreadyMerged: String(source.mergedInto ?? '') === String(targetId),
  };
}

/**
 * Move every student and batch reference from a duplicate to the canonical college, archive the duplicate and keep it
 * for history. Idempotent: repeating the same merge reports `alreadyMerged` and changes nothing.
 */
export async function applyCollegeMerge(sourceId: string | Types.ObjectId, targetId: string | Types.ObjectId, actor?: { _id: unknown; role: string }) {
  if (String(sourceId) === String(targetId)) throw conflict('Select a different canonical college.');
  if (!(await supportsTransactions())) throw conflict('College reconciliation is temporarily unavailable.');
  return maybeTransaction(async (session) => {
    const source = await College.findById(sourceId).session(session!);
    if (!source) throw notFound('College not found');
    if (String(source.mergedInto ?? '') === String(targetId)) return { alreadyMerged: true, students: 0, batches: 0 };
    if (source.mergedInto) throw conflict('This college already has a different canonical record.');
    const target = await activeCollege(String(targetId), session, true);
    source.status = 'ARCHIVED';
    source.mergedInto = target._id;
    await source.save({ session });
    const students = await User.updateMany({ collegeId: source._id }, { $set: { collegeId: target._id } }, { session });
    const batches = await Batch.updateMany({ collegeId: source._id }, { $set: { collegeId: target._id } }, { session });
    const counts = { students: students.modifiedCount, batches: batches.modifiedCount };
    await audit(null, 'college.reconcile', { type: 'College', id: source._id }, { targetId: String(target._id), ...counts }, actor, session);
    return { alreadyMerged: false, ...counts };
  });
}

export interface CollegeRegistryReport {
  generatedAt: string;
  totals: { colleges: number; active: number; archived: number; merged: number; missingCode: number; aliasConflicts: number; manualReview: number };
  colleges: { _id: string; name: string; code: string | null; label: string; status: string; students: number; batches: number; aliases: string[] }[];
  missingCodes: { _id: string; name: string; students: number; batches: number }[];
  /** A normalized name or alias that more than one unmerged record claims. Never resolved automatically. */
  aliasConflicts: { key: string; colleges: { _id: string; label: string }[] }[];
  /** Groups that look like the same institution. Nothing is merged automatically. */
  duplicateCandidates: { key: string; suggestedTargetId: string; colleges: { _id: string; label: string; status: string; students: number; batches: number }[] }[];
  /** Only these pairs may be passed to --merge; every pair still needs a human decision. */
  proposedMappings: { sourceId: string; targetId: string; reason: string }[];
  manualReview: { _id: string; label: string; reason: string }[];
}

/** Read-only report of legacy records and likely duplicates, used before a manual reconciliation. */
export async function collegeRegistryReport(): Promise<CollegeRegistryReport> {
  const colleges = await College.find({}, 'name code aliases status mergedInto').lean();
  const ids = colleges.map((c) => c._id);
  const [students, batches] = await Promise.all([
    User.aggregate([{ $match: { role: 'STUDENT', collegeId: { $in: ids } } }, { $group: { _id: '$collegeId', n: { $sum: 1 } } }]),
    Batch.aggregate([{ $match: { collegeId: { $in: ids } } }, { $group: { _id: '$collegeId', n: { $sum: 1 } } }]),
  ]);
  const n = (rows: any[], id: unknown) => rows.find((row) => String(row._id) === String(id))?.n ?? 0;
  const rows = colleges.map((c) => ({
    _id: String(c._id), name: c.name, code: c.code ?? null, status: c.status, mergedInto: c.mergedInto ? String(c.mergedInto) : null,
    aliases: c.aliases ?? [], students: n(students, c._id), batches: n(batches, c._id),
  }));
  const activeRows = rows.filter((r) => !r.mergedInto);
  const groups = new Map<string, typeof rows>();
  for (const row of activeRows) {
    const key = nameKey(row.name).replace(/[^a-z0-9]/g, '');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const duplicateCandidates = [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => {
      const canonical = members.find((m) => m.status === 'ACTIVE' && m.code) ?? members.find((m) => m.status === 'ACTIVE') ?? members[0];
      return {
        key,
        suggestedTargetId: canonical._id,
        colleges: members.map((m) => ({ _id: m._id, label: m.code ? `${m.name} [${m.code}]` : m.name, status: m.status, students: m.students, batches: m.batches })),
      };
    });

  // Legacy rows may predate the registry's unique search keys, so verify aliases rather than assuming them.
  const claimed = new Map<string, { _id: string; label: string }[]>();
  for (const row of activeRows) {
    const label = row.code ? `${row.name} [${row.code}]` : row.name;
    for (const value of [row.name, row.code, ...row.aliases]) {
      if (!value) continue;
      const key = nameKey(value);
      const list = claimed.get(key) ?? [];
      if (!list.some((item) => item._id === row._id)) list.push({ _id: row._id, label });
      claimed.set(key, list);
    }
  }
  const aliasConflicts = [...claimed.entries()].filter(([, members]) => members.length > 1).map(([key, colleges]) => ({ key, colleges }));

  const proposedMappings = duplicateCandidates.flatMap((group) =>
    group.colleges.filter((c) => c._id !== group.suggestedTargetId).map((c) => ({ sourceId: c._id, targetId: group.suggestedTargetId, reason: `same normalized name: ${group.key}` })));
  const manualReview = new Map<string, { _id: string; label: string; reason: string }>();
  for (const row of rows.filter((r) => !r.code && !r.mergedInto)) manualReview.set(row._id, { _id: row._id, label: row.name, reason: 'missing college code' });
  for (const group of duplicateCandidates) for (const c of group.colleges) manualReview.set(c._id, { _id: c._id, label: c.label, reason: 'possible duplicate institution' });
  for (const conflict of aliasConflicts) for (const c of conflict.colleges) manualReview.set(c._id, { _id: c._id, label: c.label, reason: `alias conflict: ${conflict.key}` });

  return {
    generatedAt: new Date().toISOString(),
    colleges: rows.map((r) => ({ _id: r._id, name: r.name, code: r.code, label: r.code ? `${r.name} [${r.code}]` : r.name, status: r.mergedInto ? 'MERGED' : r.status ?? 'ACTIVE', students: r.students, batches: r.batches, aliases: r.aliases })),
    totals: {
      colleges: rows.length,
      active: rows.filter((r) => r.status !== 'ARCHIVED' && !r.mergedInto).length,
      archived: rows.filter((r) => r.status === 'ARCHIVED' && !r.mergedInto).length,
      merged: rows.filter((r) => r.mergedInto).length,
      missingCode: rows.filter((r) => !r.code && !r.mergedInto).length,
      aliasConflicts: aliasConflicts.length,
      manualReview: manualReview.size,
    },
    missingCodes: rows.filter((r) => !r.code && !r.mergedInto).map((r) => ({ _id: r._id, name: r.name, students: r.students, batches: r.batches })),
    aliasConflicts, duplicateCandidates, proposedMappings,
    manualReview: [...manualReview.values()],
  };
}
