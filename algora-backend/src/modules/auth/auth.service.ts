import { lockRolls } from '../batches/roll-lock';
import { env } from '../../config/env';
import { conflict, forbidden } from '../../lib/errors';
import { normalizeEmail, safeEqual, sha256 } from '../../lib/normalize';
import { activeCollege } from '../colleges/registry';
import { maybeTransaction } from '../../lib/lease';
import { Enrollment, LeetcodeLink, linkFlags, PendingEnrollment, TrainerRequest, User, type UserDoc } from '../../models';
import { normalizeUsername } from '../leetcode/links.service';
import type { GoogleIdentity } from './google';
import { loginOrCreateSuperAdmin } from './superAdmin';

export type LoginResult =
  | { kind: 'SESSION'; user: any }
  | { kind: 'TRAINER_REQUEST'; status: 'PENDING_APPROVAL' | 'REJECTED'; reason?: string }
  | { kind: 'REGISTRATION_REQUIRED'; profile: { email: string; name: string; picture?: string } };

/** Safe projection: never includes googleSub or internal fields. */
export function publicUser(u: UserDoc | any) {
  return {
    id: String(u._id),
    role: u.role,
    email: u.email,
    fullName: u.fullName,
    firstName: u.firstName,
    lastName: u.lastName,
    picture: u.picture,
    trainerId: u.trainerId,
    canManageCourses: u.role === 'SUPER_ADMIN' ? true : !!u.canManageCourses,
    rollNumber: u.rollNumber,
    leetcodeUsername: u.leetcodeUsername,
  };
}

export async function loginWithGoogle(id: GoogleIdentity): Promise<LoginResult> {
  let user: any;
  if (id.email === env.SUPER_ADMIN_EMAIL) {
    user = await loginOrCreateSuperAdmin(id);
  } else {
    user = await User.findOne({ googleSub: id.sub });
    if (!user) {
      if (await User.exists({ email: id.email })) {
        throw conflict('This email is already linked to a different Google identity', 'IDENTITY_CONFLICT');
      }
      const req = await TrainerRequest.findOne({ googleSub: id.sub });
      if (req && req.status !== 'APPROVED') {
        return { kind: 'TRAINER_REQUEST', status: req.status as any, reason: req.status === 'REJECTED' ? req.rejectionReason ?? undefined : undefined };
      }
      return { kind: 'REGISTRATION_REQUIRED', profile: { email: id.email, name: id.name, picture: id.picture } };
    }
    if (user.role === 'SUPER_ADMIN') throw forbidden('Account not permitted', 'ACCOUNT_REVOKED');
  }
  if (user.status === 'SUSPENDED') throw forbidden('Your account is suspended', 'ACCOUNT_SUSPENDED');
  if (user.status !== 'ACTIVE') throw forbidden('Account not permitted', 'ACCOUNT_REVOKED');
  user.lastLoginAt = new Date();
  user.picture = id.picture ?? user.picture;
  if (user.email !== id.email && user.role !== 'SUPER_ADMIN') user.email = id.email;
  await user.save();
  return { kind: 'SESSION', user };
}

export interface StudentInput {
  firstName: string; lastName: string; rollNumber: string; collegeId: string;
  mobile: string; leetcodeUsername: string; claimCode?: string; leetcodeConsent: true;
}

export async function registerStudent(id: GoogleIdentity, input: StudentInput) {
  if (id.email === env.SUPER_ADMIN_EMAIL) throw forbidden('This account cannot register as a student', 'ACCOUNT_CONFLICT');
  const leetcodeUsername = normalizeUsername(input.leetcodeUsername);
  // Independent checks share one round-trip window. Unique indexes still arbitrate concurrent registrations.
  const [existing, trainer, usernameTaken] = await Promise.all([
    User.find({ $or: [{ googleSub: id.sub }, { email: id.email }, { rollNumber: input.rollNumber }] }, 'googleSub email rollNumber').lean(),
    TrainerRequest.exists({ googleSub: id.sub }),
    LeetcodeLink.exists({ usernameNorm: leetcodeUsername.toLowerCase(), isActive: true }),
  ]);
  if (existing.some((user) => user.googleSub === id.sub)) throw conflict('Already registered', 'ALREADY_REGISTERED');
  if (existing.some((user) => user.email === id.email)) throw conflict('Email already registered', 'IDENTITY_CONFLICT');
  if (trainer) throw conflict('This account has a trainer access request', 'ACCOUNT_CONFLICT');
  if (existing.some((user) => user.rollNumber === input.rollNumber)) throw conflict('Roll number already registered', 'ROLL_NUMBER_TAKEN');
  if (usernameTaken) throw conflict('That LeetCode username is already linked to another student', 'USERNAME_IN_USE');

  // A reserved roll number can only be claimed by the matching verified email or claim code.
  const codeHash = input.claimCode ? sha256(input.claimCode) : null;
  // One transaction: user, LeetCode link request, claims and enrollments succeed or fail together.
  // Each claim is an atomic PENDING -> CLAIMED transition, so a cancelled or already-claimed reservation cannot be used.
  let enrolled = 0;
  const user = await maybeTransaction(async (session) => {
    enrolled = 0;
    await lockRolls([input.rollNumber], session);
    const pendings = await PendingEnrollment.find({ rollNumber: input.rollNumber, status: 'PENDING' }).session(session ?? null);
    const authorised = pendings.filter((p) => (p.email && p.email === normalizeEmail(id.email)) || (codeHash && safeEqual(p.claimCodeHash, codeHash)));
    if (pendings.length && !authorised.length) {
      throw forbidden('This roll number is reserved. Use the claim code from your trainer or sign in with the email they registered.', 'ROLL_NUMBER_RESERVED');
    }

    const college = await activeCollege(input.collegeId, session, true);
    const [u] = await User.create([{
      googleSub: id.sub, email: id.email, role: 'STUDENT', firstName: input.firstName, lastName: input.lastName,
      fullName: `${input.firstName} ${input.lastName}`, picture: id.picture, rollNumber: input.rollNumber, collegeId: college._id,
      mobile: input.mobile, leetcodeUsername, lastLoginAt: new Date(),
    }], { session });
    // Linking is immediate: the username is the account whose public accepted submissions Algora reads. It is not treated
    // as proof of ownership, and no provider request is made at registration.
    await LeetcodeLink.create([{
      studentId: u._id, username: leetcodeUsername, usernameNorm: leetcodeUsername.toLowerCase(), status: 'LINKED', ...linkFlags('LINKED'),
      kind: 'INITIAL', consentedAt: new Date(), linkedAt: new Date(),
    }], { session });
    for (const p of authorised) {
      const claimed = await PendingEnrollment.findOneAndUpdate({ _id: p._id, status: 'PENDING' }, { $set: { status: 'CLAIMED', claimedBy: u._id, claimedAt: new Date() } }, { session });
      if (!claimed) continue;
      await Enrollment.updateOne({ studentId: u._id, batchId: p.batchId }, { $setOnInsert: { status: 'ACTIVE', enrolledAt: new Date(), enrolledBy: p.createdBy } }, { upsert: true, session });
      enrolled++;
    }
    return u;
  }).catch((e: any) => {
    if (e?.code === 11000 && /usernameNorm|one_active_link/.test(String(e.message))) throw conflict('That LeetCode username is already linked to another student', 'USERNAME_IN_USE');
    if (e?.code === 11000 && /rollNumber/.test(String(e.message))) throw conflict('Roll number already registered', 'ROLL_NUMBER_TAKEN');
    throw e;
  });
  return { user, enrolledBatches: enrolled };
}
