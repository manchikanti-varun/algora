import { Router } from 'express';
import { parse } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth } from '../../middleware/auth';
import { idTokenSchema, studentRegisterSchema } from './auth.schemas';
import { loginWithGoogle, publicUser, registerStudent } from './auth.service';
import { verifyGoogleIdToken } from './google';
import { User } from '../../models';
import { clearSessionCookie, csrfTokenFor, SESSION_COOKIE, setSessionCookie, signSession, verifySession } from './session';

export const authRouter = Router();

function startSession(res: any, user: any) {
  const token = signSession(String(user._id), user.sessionVersion ?? 0);
  setSessionCookie(res, token);
  return { user: publicUser(user), csrfToken: csrfTokenFor(token) };
}

authRouter.post('/google', async (req, res) => {
  const { idToken } = parse(idTokenSchema, req.body);
  const identity = await verifyGoogleIdToken(idToken);
  const r = await loginWithGoogle(identity);
  if (r.kind !== 'SESSION') return void res.json(r.kind === 'REGISTRATION_REQUIRED' ? { status: r.kind, profile: r.profile } : { status: r.status, reason: r.reason });
  await audit(req, 'auth.login', { type: 'User', id: r.user._id }, undefined, r.user);
  res.json({ status: 'AUTHENTICATED', ...startSession(res, r.user) });
});

authRouter.post('/register/student', async (req, res) => {
  const { idToken, ...input } = parse(studentRegisterSchema, req.body);
  const identity = await verifyGoogleIdToken(idToken);
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
