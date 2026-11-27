import { z } from 'zod';
import { collegeLabel, collegeSearch } from '../colleges/registry';
import { Router } from 'express';
import { parse } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth } from '../../middleware/auth';
import { idTokenSchema, studentRegisterSchema } from './auth.schemas';
import { loginWithGoogle, publicUser, registerStudent } from './auth.service';
import { checkedGoogleIdentity } from './credential-guard';
import { College, User } from '../../models';
import { clearSessionCookie, csrfTokenFor, SESSION_COOKIE, setSessionCookie, signSession, verifySession } from './session';

export const authRouter = Router();
authRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function startSession(res: any, user: any) {
  const token = signSession(String(user._id), user.sessionVersion ?? 0);
  setSessionCookie(res, token);
  return { user: publicUser(user), csrfToken: csrfTokenFor(token) };
}

authRouter.get('/colleges', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(120).optional() }), req.query);
  const items = await College.find({ status: 'ACTIVE', code: { $type: 'string' }, ...collegeSearch(q) }, 'name code')
    .sort({ name: 1, _id: 1 }).limit(25).lean();
  res.json({ items: items.map((college) => ({ _id: college._id, name: collegeLabel(college), code: college.code })) });
});

authRouter.post('/google', async (req, res) => {
  const { idToken } = parse(idTokenSchema, req.body);
  const identity = await checkedGoogleIdentity(req, res, idToken, 'login');
  const r = await loginWithGoogle(identity);
  if (r.kind !== 'SESSION') return void res.json(r.kind === 'REGISTRATION_REQUIRED' ? { status: r.kind, profile: r.profile } : { status: r.status, reason: r.reason });
  await audit(req, 'auth.login', { type: 'User', id: r.user._id }, undefined, r.user);
  res.json({ status: 'AUTHENTICATED', ...startSession(res, r.user) });
});

authRouter.post('/register/student', async (req, res) => {
  const { idToken, ...input } = parse(studentRegisterSchema, req.body);
  const identity = await checkedGoogleIdentity(req, res, idToken, 'registration');
  const { user, enrolledBatches } = await registerStudent(identity, input);
  await audit(req, 'student.register', { type: 'User', id: user._id }, { enrolledBatches }, user);
  res.status(201).json({ status: 'AUTHENTICATED', enrolledBatches, ...startSession(res, user) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!), csrfToken: csrfTokenFor(req.sessionToken!) });
});

/** Sign out ends every session of the user (sessionVersion bump), so a copied cookie stops working too. */
authRouter.post('/logout', async (req, res) => {
  const p = verifySession(req.cookies?.[SESSION_COOKIE]);
  if (p) {
    await User.updateOne({ _id: p.uid, sessionVersion: p.sv }, { $inc: { sessionVersion: 1 } });
    await audit(req, 'auth.logout', { type: 'User', id: p.uid }, undefined, { _id: p.uid, role: 'UNKNOWN' });
  }
  clearSessionCookie(res);
  res.status(204).end();
});
