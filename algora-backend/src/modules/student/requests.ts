import { activeCollege, collegeLabel } from '../colleges/registry';
import { lockRolls } from '../batches/roll-lock';
import { Router, type Request } from 'express';
import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import { maybeTransaction, supportsTransactions } from '../../lib/lease';
import { objectId, pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { Batch, College, Enrollment, LeetcodeLink, PendingEnrollment, StudentRequest, TrainerBatchAssignment, User, type UserDoc } from '../../models';
import { audit } from '../audit/audit';
import { linkAccount, revokeLinks, USERNAME } from '../leetcode/links.service';
import { clearBoardCache } from '../progress/progress.service';

const reason = z.string().trim().min(3).max(500);
const rollNumber = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/);
const profile = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  mobile: z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
  collegeId: objectId.optional(), rollNumber: rollNumber.optional(), reason,
}).strict();
const leetcode = z.object({ username: z.string().trim().regex(USERNAME), consent: z.literal(true), reason }).strict();
const profileKeys = ['firstName', 'lastName', 'mobile', 'rollNumber', 'collegeId'] as const;

export async function submitProfileRequest(req: Request) {
  const { reason, ...requested } = parse(profile, req.body);
  const student = req.user!;
  const changed = profileKeys.filter((key) => requested[key] !== undefined && requested[key] !== (key === 'collegeId' ? student.collegeId?.toString() : student[key]));
  if (!changed.length) throw badRequest('Enter at least one change');
  const before = Object.fromEntries(changed.map((key) => [key, student[key]?.toString()]));
  const after = Object.fromEntries(changed.map((key) => [key, requested[key]]));
  if (after.collegeId) {
    after.collegeLabel = collegeLabel(await activeCollege(after.collegeId)) ?? undefined;
    before.collegeLabel = collegeLabel(student.collegeId ? await College.findById(student.collegeId).lean() : null) ?? undefined;
  }
  return submit(req, { kind: 'PROFILE', current: before, requested: after, reason });
}

export async function submitLinkRequest(req: Request, unlink = false) {
  const input = unlink ? parse(z.object({ reason }).strict(), req.body) : parse(leetcode, req.body);
  if (!(await supportsTransactions())) throw conflict('Account requests are temporarily unavailable.');
  return maybeTransaction(async (session) => {
    // Serialize with consent withdrawal even when no association exists yet.
    await User.updateOne({ _id: req.user!._id }, { $inc: { consentRevision: 1 } }, { session });
    const current = await LeetcodeLink.findOne({ studentId: req.user!._id, isCurrent: true }).session(session!);
    if (unlink) {
      if (!current) throw conflict('There is no approved association to unlink.');
      return submit(req, { kind: 'LEETCODE', current: { username: current.username }, requested: {}, reason: input.reason,
        previousLinkId: current._id, linkAction: 'UNLINK' }, session);
    }
    const username = (input as { username?: string }).username;
    if (!username) throw badRequest('Enter a LeetCode username.');
    const norm = username.toLowerCase();
    if (current?.usernameNorm === norm && current.consentedAt) throw conflict('This account is already linked to your profile', 'ALREADY_LINKED');
    if (await LeetcodeLink.exists({ usernameNorm: norm, isActive: true, studentId: { $ne: req.user!._id } }).session(session!)) {
      throw conflict('That LeetCode username is already linked to another student', 'USERNAME_IN_USE');
    }
    return submit(req, { kind: 'LEETCODE', current: { username: current?.username }, requested: { username },
      reason: input.reason, previousLinkId: current?._id, linkAction: 'LINK' }, session);
  });
}

interface Submission {
  kind: 'PROFILE' | 'LEETCODE';
  current: object;
  requested: object;
  reason: string;
  previousLinkId?: UserDoc['_id'];
  linkAction?: 'LINK' | 'UNLINK';
}

async function submit(req: Request, input: Submission, session?: ClientSession) {
  const [item] = await StudentRequest.create([{ studentId: req.user!._id, ...input, status: 'PENDING' }], { session });
  await audit(req, 'student.request.submitted', { type: 'StudentRequest', id: item._id }, { kind: input.kind }, undefined, session);
  return item;
}

const statusFilter = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
async function list(req: Request, scope: object, management = false) {
  const query = parse(pagination.extend({ status: statusFilter.optional(), kind: z.enum(['PROFILE', 'LEETCODE']).optional() }), req.query);
  const filter = { ...scope, ...(query.status ? { status: query.status } : {}), ...(query.kind ? { kind: query.kind } : {}) };
  const rows = StudentRequest.find(filter).select('-previousLinkId -__v')
    .sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize);
  rows.populate('reviewedBy', 'fullName role');
  if (management) rows.populate('studentId', 'fullName rollNumber');
  const [items, total] = await Promise.all([rows.lean(), StudentRequest.countDocuments(filter)]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export const ownRequestsRouter = Router();
ownRequestsRouter.get('/', async (req, res) => res.json(await list(req, { studentId: req.user!._id })));
ownRequestsRouter.post('/:id/cancel', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const item = await StudentRequest.findOneAndUpdate({ _id: id, studentId: req.user!._id, status: 'PENDING' },
    { $set: { status: 'CANCELLED', reviewedAt: new Date() } }, { returnDocument: 'after' });
  if (!item) throw notFound('Pending request not found');
  await audit(req, 'student.request.cancelled', { type: 'StudentRequest', id });
  res.json({ status: item.status });
});

async function trainerScope(user: UserDoc, studentId?: UserDoc['_id'], session?: ClientSession) {
  const assigned = await TrainerBatchAssignment.distinct('batchId', { trainerId: user._id, status: 'ACTIVE' }).session(session ?? null);
  const batches = await Batch.distinct('_id', { _id: { $in: assigned }, status: 'ACTIVE' }).session(session ?? null);
  const filter = { batchId: { $in: batches }, status: 'ACTIVE' as const, ...(studentId ? { studentId } : {}) };
  return Enrollment.distinct('studentId', filter as any).session(session ?? null);
}

export const manageRequestsRouter = Router();
manageRequestsRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));
manageRequestsRouter.get('/', async (req, res) => {
  const scope = req.user!.role === 'TRAINER' ? { studentId: { $in: await trainerScope(req.user!) } } : {};
  res.json(await list(req, scope, true));
});
manageRequestsRouter.post('/:id/review', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { status, rejectionReason } = parse(z.discriminatedUnion('status', [
    z.object({ status: z.literal('APPROVED'), rejectionReason: z.undefined().optional() }).strict(),
    z.object({ status: z.literal('REJECTED'), rejectionReason: reason }).strict(),
  ]), req.body);
  const reviewer = req.user!;
  if (!(await supportsTransactions())) throw conflict('Request review is temporarily unavailable');
  await maybeTransaction(async (session) => {
    const item = await StudentRequest.findById(id).session(session!);
    if (!item || (reviewer.role === 'TRAINER' && !(await trainerScope(reviewer, item.studentId, session)).length)) throw notFound('Request not found');
    if (item.status !== 'PENDING') throw conflict('This request has already been reviewed');
    if (status === 'APPROVED') {
      const student = await User.findOne({ _id: item.studentId, role: 'STUDENT', status: 'ACTIVE' }).session(session!);
      if (!student) throw conflict('The student account is inactive');
      if (item.kind === 'PROFILE') {
        for (const key of profileKeys) {
          const value = item.requested[key];
          if (value === undefined || value === null) continue;
          if (student[key]?.toString() !== item.current[key]) throw conflict('The profile changed after this request was submitted.');
          if (key === 'collegeId') {
            student.collegeId = (await activeCollege(value, session, true))._id;
          } else if (key === 'rollNumber') {
            const rolls = [student.rollNumber, value].filter((r): r is string => !!r);
            await lockRolls(rolls, session);
            if (await User.exists({ _id: { $ne: student._id }, rollNumber: value }).session(session!)) {
              throw conflict('This roll number is already registered.', 'ROLL_NUMBER_TAKEN');
            }
            if (await PendingEnrollment.exists({ rollNumber: { $in: rolls }, status: 'PENDING' }).session(session!)) {
              throw conflict('Resolve pending enrollment reservations before approving this roll number change.', 'ROLL_NUMBER_RESERVED');
            }
            student.rollNumber = value;
          } else {
            student[key] = value;
          }
        }
        if (item.requested.firstName !== undefined || item.requested.lastName !== undefined) {
          student.fullName = `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim();
        }
        await student.save({ session });
      } else {
        const current = await LeetcodeLink.findOne({ studentId: student._id, isCurrent: true }, '_id').session(session!);
        if (String(current?._id ?? '') !== String(item.previousLinkId ?? '')) throw conflict('The connected account has changed since this request was submitted');
        if (item.linkAction === 'UNLINK') await revokeLinks(student._id, 'STUDENT_UNLINK_APPROVED', reviewer._id, session);
        else await linkAccount(student._id, item.requested.username!, { consent: true, by: reviewer._id, reason: 'STUDENT_REQUEST_APPROVED' }, session);
      }
    }
    item.status = status;
    item.rejectionReason = rejectionReason ?? undefined;
    item.reviewedAt = new Date();
    item.reviewedBy = reviewer._id;
    await item.save({ session });
    await audit(req, 'student.request.reviewed', { type: 'StudentRequest', id }, { status, kind: item.kind }, undefined, session);
  });
  clearBoardCache();
  res.json({ status });
});
