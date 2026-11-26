import { activeCollege, collegeLabel } from '../colleges/registry';
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError, conflict, notFound, parse } from '../../lib/errors';
import { slugifyName } from '../../lib/normalize';
import { requireAuth, requireRole } from '../../middleware/auth';
import { TrainerRequest, User } from '../../models';
import { audit } from '../audit/audit';
import { idTokenSchema, trainerRequestSchema } from '../auth/auth.schemas';
import { checkedGoogleIdentity } from '../auth/credential-guard';
import { env } from '../../config/env';

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const listQuery = z.object({
  status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const trainerRequestsRouter = Router();
export const trainersRouter = Router();

// Public (identity proven by the Google ID token in the body).
trainerRequestsRouter.post('/', async (req, res) => {
  const { idToken, ...input } = parse(trainerRequestSchema, req.body);
  const id = await checkedGoogleIdentity(req, res, idToken, 'trainer-access');
  if (id.email === env.SUPER_ADMIN_EMAIL) throw new AppError(403, 'ACCOUNT_CONFLICT', 'Not applicable to this account');
  if (await User.exists({ $or: [{ googleSub: id.sub }, { email: id.email }] })) {
    throw conflict('This account is already registered', 'ALREADY_REGISTERED');
  }
  const existing = await TrainerRequest.findOne({ googleSub: id.sub });
  if (existing && existing.status !== 'REJECTED') {
    return void res.status(200).json({ status: existing.status });
  }
  const { collegeId, ...details } = input;
  const college = collegeId ? collegeLabel(await activeCollege(collegeId)) : undefined;
  const doc = await TrainerRequest.findOneAndUpdate(
    { googleSub: id.sub },
    { $set: { ...details, ...(college ? { college } : {}), email: id.email, status: 'PENDING_APPROVAL' }, $unset: { rejectionReason: 1, reviewedAt: 1, reviewedBy: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  await audit(null, 'trainer_request.submit', { type: 'TrainerRequest', id: doc._id }, { email: id.email });
  res.status(201).json({ status: doc.status });
});

trainerRequestsRouter.use(requireAuth, requireRole('SUPER_ADMIN'));

trainerRequestsRouter.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    TrainerRequest.find(filter, '-googleSub').sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    TrainerRequest.countDocuments(filter),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});

async function uniqueTrainerId(fullName: string): Promise<string> {
  const base = `tr_${slugifyName(fullName) || 'trainer'}`;
  let candidate = base;
  for (let i = 2; await User.exists({ trainerId: candidate }); i++) candidate = `${base}${i}`;
  return candidate;
}

trainerRequestsRouter.patch('/:id/approve', async (req, res) => {
  const id = parse(objectId, req.params.id);
  // Atomic PENDING -> APPROVED transition stops double-approval races.
  const request = await TrainerRequest.findOneAndUpdate(
    { _id: id, status: 'PENDING_APPROVAL' },
    { $set: { status: 'APPROVED', reviewedBy: req.user!._id, reviewedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!request) {
    if (!(await TrainerRequest.exists({ _id: id }))) throw notFound('Request not found');
    throw conflict('Request is not pending', 'NOT_PENDING');
  }
  try {
    let user;
    for (let attempt = 0; ; attempt++) {
      try {
        user = await User.create({
          googleSub: request.googleSub,
          email: request.email,
          role: 'TRAINER',
          fullName: request.fullName,
          trainerId: await uniqueTrainerId(request.fullName),
          approvedBy: req.user!._id,
        });
        break;
      } catch (e: any) {
        // Lost a race for the same trainerId: retry. Anything else is real.
        if (e?.code === 11000 && /trainerId/.test(e.message) && attempt < 5) continue;
        throw e;
      }
    }
    request.userId = user._id;
    await request.save();
    await audit(req, 'trainer_request.approve', { type: 'TrainerRequest', id: request._id }, { trainerId: user.trainerId });
    res.json({ status: 'APPROVED', trainerId: user.trainerId, userId: user._id });
  } catch (e) {
    await TrainerRequest.updateOne({ _id: id }, { $set: { status: 'PENDING_APPROVAL' }, $unset: { reviewedBy: 1, reviewedAt: 1 } });
    throw e;
  }
});

trainerRequestsRouter.patch('/:id/reject', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().max(500).optional() }), req.body ?? {});
  const r = await TrainerRequest.findOneAndUpdate(
    { _id: id, status: 'PENDING_APPROVAL' },
    { $set: { status: 'REJECTED', rejectionReason: reason, reviewedBy: req.user!._id, reviewedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!r) {
    if (!(await TrainerRequest.exists({ _id: id }))) throw notFound('Request not found');
    throw conflict('Request is not pending', 'NOT_PENDING');
  }
  await audit(req, 'trainer_request.reject', { type: 'TrainerRequest', id: r._id }, { reason });
  res.json({ status: 'REJECTED' });
});

// ---- Trainer account management (Super Admin only) ----
trainersRouter.use(requireAuth, requireRole('SUPER_ADMIN'));

trainersRouter.get('/', async (req, res) => {
  const q = parse(listQuery.omit({ status: true }), req.query);
  const filter = { role: 'TRAINER' as const };
  const [items, total] = await Promise.all([
    User.find(filter, 'email fullName trainerId status canManageCourses lastLoginAt createdAt').sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    User.countDocuments(filter),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});

async function setTrainerStatus(req: any, res: any, status: 'ACTIVE' | 'SUSPENDED') {
  const id = parse(objectId, req.params.id);
  // sessionVersion bump kills all existing sessions immediately.
  const u = await User.findOneAndUpdate({ _id: id, role: 'TRAINER' }, { $set: { status }, $inc: { sessionVersion: 1 } }, { returnDocument: 'after' });
  if (!u) throw notFound('Trainer not found');
  await audit(req, `trainer.${status === 'ACTIVE' ? 'reactivate' : 'suspend'}`, { type: 'User', id: u._id });
  res.json({ status: u.status });
}
trainersRouter.patch('/:id/suspend', (req, res) => setTrainerStatus(req, res, 'SUSPENDED'));
trainersRouter.patch('/:id/reactivate', (req, res) => setTrainerStatus(req, res, 'ACTIVE'));

trainersRouter.patch('/:id/permissions', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { canManageCourses } = parse(z.object({ canManageCourses: z.boolean() }), req.body);
  const u = await User.findOneAndUpdate({ _id: id, role: 'TRAINER' }, { $set: { canManageCourses } }, { returnDocument: 'after' });
  if (!u) throw notFound('Trainer not found');
  await audit(req, 'trainer.permissions', { type: 'User', id: u._id }, { canManageCourses });
  res.json({ canManageCourses: u.canManageCourses });
});
