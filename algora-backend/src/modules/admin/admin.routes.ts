import { collegeFields, collegeLabel, collegePatch, collegeSearch, registryFields } from '../colleges/registry';
import { applyCollegeMerge, previewCollegeMerge } from '../colleges/reconcile';
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { conflict, forbidden, notFound, parse } from '../../lib/errors';
import { randomToken, sha256 } from '../../lib/normalize';
import { objectId, pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { AuditLog, Batch, College, Enrollment, LeetcodeLink, LeetcodeSyncLog, PendingEnrollment, User } from '../../models';
import { audit } from '../audit/audit';
import { loadBatchFor, trainerBatchIds } from '../access';

export const collegesRouter = Router();
export const studentsRouter = Router();
export const auditRouter = Router();
export const pendingRouter = Router({ mergeParams: true });
for (const r of [collegesRouter, studentsRouter, auditRouter]) r.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));
const superOnly: import('express').RequestHandler = (req, _res, next) => (req.user!.role === 'SUPER_ADMIN' ? next() : next(forbidden()));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- Colleges ----------
collegesRouter.get('/', async (req, res) => {
  const q = parse(pagination.extend({ q: z.string().trim().max(60).optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  Object.assign(filter, collegeSearch(q.q));
  const [items, total] = await Promise.all([College.find(filter).sort({ name: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), College.countDocuments(filter)]);
  const ids = items.map((c) => c._id);
  const [students, batches] = await Promise.all([
    User.aggregate([{ $match: { role: 'STUDENT', collegeId: { $in: ids } } }, { $group: { _id: '$collegeId', n: { $sum: 1 } } }]),
    Batch.aggregate([{ $match: { collegeId: { $in: ids } } }, { $group: { _id: '$collegeId', n: { $sum: 1 } } }]),
  ]);
  const n = (arr: any[], id: unknown) => arr.find((x) => String(x._id) === String(id))?.n ?? 0;
  res.json({ total, page: q.page, pageSize: q.pageSize, items: items.map((c) => ({ ...c, students: n(students, c._id), batches: n(batches, c._id) })) });
});
collegesRouter.post('/', superOnly, async (req, res) => {
  const c = await College.create(await registryFields(parse(collegeFields, req.body)));
  await audit(req, 'college.create', { type: 'College', id: c._id });
  res.status(201).json(c);
});
collegesRouter.patch('/:id', superOnly, async (req, res) => {
  const id = parse(objectId, req.params.id);
  const input = parse(collegePatch, req.body);
  const c = await College.findById(id);
  if (!c) throw notFound('College not found');
  if (c.mergedInto) throw conflict('This college has been merged. Edit the canonical college instead.');
  if (input.name !== undefined || input.code !== undefined || input.aliases !== undefined) {
    c.set(await registryFields({ name: input.name ?? c.name, code: input.code ?? c.code, aliases: input.aliases ?? c.aliases ?? [] }, id));
  }
  if (input.status) c.status = input.status;
  if (input.status === 'ACTIVE' && !c.code) throw conflict('Assign a college code before restoring this college.');
  // Compare the revision so concurrent edits cannot silently discard aliases.
  const updated = await College.findOneAndUpdate({ _id: id, updatedAt: c.updatedAt, mergedInto: { $exists: false } },
    { $set: { name: c.name, ...(c.code ? { code: c.code, searchKeys: c.searchKeys } : {}), aliases: c.aliases, nameKey: c.nameKey, status: c.status } },
    { returnDocument: 'after' });
  if (!updated) throw conflict('This college changed. Refresh before editing it again.');
  await audit(req, 'college.update', { type: 'College', id }, { fields: Object.keys(input) });
  res.json(updated);
});

collegesRouter.post('/:id/reconcile', superOnly, async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { targetId, dryRun } = parse(z.object({ targetId: objectId, dryRun: z.boolean().default(true) }).strict(), req.body);
  res.json(dryRun ? await previewCollegeMerge(id, targetId) : await applyCollegeMerge(id, targetId, req.user));
});

// ---------- Students (management) ----------
/** Trainers see students enrolled in their batches only. Contact details are not included in lists. */
studentsRouter.get('/', async (req, res) => {
  const q = parse(pagination.extend({
    q: z.string().trim().max(60).optional(), collegeId: objectId.optional(), batchId: objectId.optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    /** Account-linking and synchronization issues a trainer needs to act on. */
    issue: z.enum(['MISSING_USERNAME', 'SYNC_FAILURE', 'POSSIBLE_GAP', 'NO_SUBMISSIONS', 'SUBMISSIONS_UNAVAILABLE', 'ACCOUNT_NOT_FOUND']).optional(),
  }), req.query);
  const filter: Record<string, unknown> = { role: 'STUDENT' };
  if (q.issue === 'SYNC_FAILURE') filter['sync.status'] = { $in: ['SYNC_FAILED', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'VERIFICATION_UNAVAILABLE'] };
  if (q.issue === 'POSSIBLE_GAP') filter['sync.possibleGap'] = true;
  if (q.issue === 'NO_SUBMISSIONS') filter['sync.status'] = 'NO_SUBMISSIONS_OBSERVED';
  if (q.issue === 'SUBMISSIONS_UNAVAILABLE') filter['sync.status'] = 'SUBMISSIONS_UNAVAILABLE';
  if (q.issue === 'ACCOUNT_NOT_FOUND') filter['sync.status'] = 'ACCOUNT_NOT_FOUND';
  let batchIds: Types.ObjectId[] | null = null;
  if (req.user!.role === 'TRAINER') batchIds = await trainerBatchIds(req.user!);
  if (q.batchId) batchIds = (batchIds ?? [new Types.ObjectId(q.batchId)]).filter((b) => String(b) === q.batchId);
  if (batchIds) filter._id = { $in: await Enrollment.distinct('studentId', { batchId: { $in: batchIds }, status: 'ACTIVE' }) };
  if (q.issue === 'MISSING_USERNAME') {
    const linked = await LeetcodeLink.distinct('studentId', { isCurrent: true });
    filter._id = { ...(filter._id as object | undefined), $nin: linked };
  }
  if (q.collegeId) filter.collegeId = q.collegeId;
  if (q.status) filter.status = q.status;
  if (q.q) filter.$or = [{ fullName: { $regex: escape(q.q), $options: 'i' } }, { rollNumber: { $regex: escape(q.q.toUpperCase()) } }];
  const [items, total] = await Promise.all([
    User.find(filter, 'fullName rollNumber collegeId status sync.status sync.lastSuccessAt sync.possibleGap sync.lastError sync.statusDetail createdAt').populate('collegeId', 'name code').sort({ rollNumber: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    User.countDocuments(filter),
  ]);
  const links = await LeetcodeLink.find({ studentId: { $in: items.map((i) => i._id) }, isCurrent: true }, 'studentId status username linkedAt').lean();
  const enr = await Enrollment.aggregate([{ $match: { studentId: { $in: items.map((i) => i._id) }, status: 'ACTIVE', ...(batchIds ? { batchId: { $in: batchIds } } : {}) } }, { $group: { _id: '$studentId', n: { $sum: 1 } } }]);
  res.json({ total, page: q.page, pageSize: q.pageSize, items: items.map((i) => {
    const cur = links.find((x) => String(x.studentId) === String(i._id));
    return { _id: i._id, fullName: i.fullName, rollNumber: i.rollNumber, college: collegeLabel(i.collegeId as any), status: i.status,
      syncStatus: i.sync?.status ?? 'IDLE', lastSyncAt: i.sync?.lastSuccessAt ?? null, possibleGap: !!i.sync?.possibleGap, syncError: i.sync?.lastError ?? null, syncDetail: i.sync?.statusDetail ?? null,
      link: cur ? { status: cur.status, username: cur.username, linkedAt: cur.linkedAt ?? null } : null, batches: enr.find((e) => String(e._id) === String(i._id))?.n ?? 0 };
  }) });
});

async function assertCanManageStudent(u: any, studentId: string) {
  if (u.role === 'SUPER_ADMIN') return;
  const ok = await Enrollment.exists({ studentId, batchId: { $in: await trainerBatchIds(u) }, status: 'ACTIVE' });
  if (!ok) throw notFound('Student not found');
}

studentsRouter.patch('/:id/status', superOnly, async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { status } = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).strict(), req.body);
  const u = await User.findOneAndUpdate({ _id: id, role: 'STUDENT' }, { $set: { status }, $inc: { sessionVersion: 1 } }, { returnDocument: 'after' });
  if (!u) throw notFound('Student not found');
  await audit(req, `student.${status === 'ACTIVE' ? 'reactivate' : 'suspend'}`, { type: 'User', id });
  res.json({ status: u.status });
});

/**
 * Trainer/Super Admin correction of a linked username. Uses the student's standing consent, is limited to the batches the
 * trainer manages, and is audited. It is a correction, not attestation: submissions are still verified automatically.
 */
studentsRouter.post(['/:id/leetcode/username', '/:id/leetcode/revoke'], async (req) => {
  await assertCanManageStudent(req.user!, parse(objectId, req.params.id));
  throw conflict('Review a student account request to change this association.', 'APPROVAL_REQUIRED');
});

// ---------- Pending enrollments (mounted under /batches/:id/pending) ----------
pendingRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));
pendingRouter.get('/', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, (req.params as any).id));
  const items = await PendingEnrollment.find({ batchId: batch._id }, 'rollNumber email status createdAt claimedAt').sort({ createdAt: -1 }).lean();
  res.json({ items });
});
/** Rotate the claim code. The new code is shown ONCE; only its hash is stored. */
pendingRouter.post('/:pendingId/regenerate', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, (req.params as any).id), { writable: true });
  const pid = parse(objectId, req.params.pendingId);
  const claimCode = randomToken(9);
  const p = await PendingEnrollment.findOneAndUpdate({ _id: pid, batchId: batch._id, status: 'PENDING' }, { $set: { claimCodeHash: sha256(claimCode) } }, { returnDocument: 'after' });
  if (!p) throw notFound('Pending enrollment not found');
  await audit(req, 'pending.regenerate', { type: 'PendingEnrollment', id: pid });
  res.json({ rollNumber: p.rollNumber, claimCode });
});
pendingRouter.delete('/:pendingId', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, (req.params as any).id), { writable: true });
  const pid = parse(objectId, req.params.pendingId);
  const p = await PendingEnrollment.findOneAndUpdate({ _id: pid, batchId: batch._id, status: 'PENDING' }, { $set: { status: 'CANCELLED' } });
  if (!p) throw notFound('Pending enrollment not found');
  await audit(req, 'pending.cancel', { type: 'PendingEnrollment', id: pid });
  res.status(204).end();
});

// ---------- Audit logs (Super Admin) ----------
auditRouter.get('/', superOnly, async (req, res) => {
  const q = parse(pagination.extend({ action: z.string().trim().max(60).optional(), actorId: objectId.optional(), targetType: z.string().trim().max(40).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.action) filter.action = { $regex: `^${escape(q.action)}` };
  if (q.actorId) filter.actorId = q.actorId;
  if (q.targetType) filter.targetType = q.targetType;
  if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const [items, total] = await Promise.all([AuditLog.find(filter).populate('actorId', 'fullName role').sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), AuditLog.countDocuments(filter)]);
  res.json({ total, page: q.page, pageSize: q.pageSize, items });
});

/** Recent synchronization logs for the integration health page. */
auditRouter.get('/sync-logs', superOnly, async (req, res) => {
  const q = parse(pagination, req.query);
  const [items, total] = await Promise.all([LeetcodeSyncLog.find({}).sort({ startedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate('studentId', 'fullName rollNumber').lean(), LeetcodeSyncLog.countDocuments({})]);
  res.json({ total, page: q.page, pageSize: q.pageSize, items });
});
