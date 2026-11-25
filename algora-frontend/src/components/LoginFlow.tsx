'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { homeFor, useAuth, type SessionUser } from '@/lib/auth';
import { GoogleSignIn } from './GoogleSignIn';
import { Button, Input, Notice, Textarea } from './ui';

type Step =
  | { kind: 'signin' }
  | { kind: 'register'; idToken: string; email: string; name: string }
  | { kind: 'pending' }
  | { kind: 'rejected'; reason?: string; idToken: string; email: string; name: string };

interface AuthResponse { status: string; user?: SessionUser; csrfToken?: string; profile?: { email: string; name: string }; reason?: string; enrolledBatches?: number }

export function LoginFlow({ mode, expired }: { mode: 'student' | 'trainer'; expired?: boolean }) {
  const router = useRouter();
  const { user, loading, setSession } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'signin' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) router.replace(homeFor(user.role)); }, [user, router]);
  const finish = (r: AuthResponse) => { if (r.user && r.csrfToken) setSession(r.user, r.csrfToken); };

  async function onCredential(idToken: string) {
    setError(undefined);
    try {
      const r = await api<AuthResponse>('/auth/google', { method: 'POST', body: { idToken } });
      if (r.status === 'AUTHENTICATED') {
        // A student on the management login (or the reverse) is still signed in, then routed to their own portal.
        return finish(r);
      }
      if (r.status === 'PENDING_APPROVAL') return setStep({ kind: 'pending' });
      if (r.status === 'REJECTED') return setStep({ kind: 'rejected', reason: r.reason, idToken, email: '', name: '' });
      if (r.status === 'REGISTRATION_REQUIRED') return setStep({ kind: 'register', idToken, email: r.profile!.email, name: r.profile!.name });
    } catch (e) { setError(errorMessage(e)); }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>, idToken: string) {
    e.preventDefault();
    setBusy(true); setError(undefined);
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      if (mode === 'student') finish(await api<AuthResponse>('/auth/register/student', { method: 'POST', body: { idToken, ...f, claimCode: f.claimCode || undefined, leetcodeConsent: f.leetcodeConsent === 'on' } }));
      else {
        await api('/trainer-requests', { method: 'POST', body: { idToken, fullName: f.fullName, phone: f.phone || undefined, college: f.college || undefined, note: f.note || undefined } });
        setStep({ kind: 'pending' });
      }
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  if (loading) return null;
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 to-indigo-50 p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 text-xl font-bold text-slate-900"><span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white">A</span>Algora</Link>
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{mode === 'student' ? 'Student sign in' : 'Trainer & admin sign in'}</h1>
            <p className="mt-1 text-sm text-slate-500">{mode === 'student' ? 'Use the Google account you want to learn with.' : 'Management access requires approval by the Super Admin.'}</p>
          </div>
          {expired && step.kind === 'signin' && <Notice tone="warn">Your session ended. Please sign in again.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {step.kind === 'signin' && <GoogleSignIn onCredential={onCredential} />}
          {step.kind === 'pending' && <Notice tone="info" title="Access request pending">The Super Admin will review your request. Sign in again once it is approved.</Notice>}
          {step.kind === 'rejected' && <Notice tone="error" title="Access request rejected">{step.reason ? `Reason: ${step.reason}. ` : ''}You can submit a new request.</Notice>}
          {step.kind === 'rejected' && mode === 'trainer' && <Button variant="secondary" onClick={() => setStep({ kind: 'signin' })}>Sign in again to resubmit</Button>}

          {step.kind === 'register' && mode === 'student' && (
            <form className="space-y-3" onSubmit={(e) => submit(e, step.idToken)}>
              <p className="text-sm text-slate-600">Signed in as <strong>{step.email}</strong>. Complete your registration.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="First name" name="firstName" required maxLength={60} autoComplete="given-name" />
                <Input label="Last name" name="lastName" required maxLength={60} autoComplete="family-name" />
              </div>
              <Input label="Roll number" name="rollNumber" required pattern="[A-Za-z0-9]{10}" maxLength={10} hint="Exactly 10 letters or digits. It cannot be changed later." />
              <Input label="College" name="college" required minLength={2} />
              <Input label="Mobile number" name="mobile" required pattern="\+?[0-9]{10,15}" type="tel" autoComplete="tel" />
              <Input label="LeetCode username" name="leetcodeUsername" required pattern="[A-Za-z0-9_\-]{1,40}" hint="You will verify that this account is yours from your profile page." />
              <Input label="Claim code (optional)" name="claimCode" hint="Only if your trainer gave you one for a reserved roll number." />
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" name="leetcodeConsent" required className="mt-1" />
                <span>I agree that Algora may read the <strong>public accepted submissions</strong> of this LeetCode account to verify my progress. Algora never asks for my LeetCode password. I can withdraw and delete this data from my profile at any time.</span>
              </label>
              <Button loading={busy} type="submit" className="w-full">Create account</Button>
            </form>
          )}
          {step.kind === 'register' && mode === 'trainer' && (
            <form className="space-y-3" onSubmit={(e) => submit(e, step.idToken)}>
              <p className="text-sm text-slate-600"><strong>{step.email}</strong> is not an approved trainer yet. Request access:</p>
              <Input label="Full name" name="fullName" defaultValue={step.name} required minLength={2} />
              <Input label="Phone (optional)" name="phone" pattern="\+?[0-9]{10,15}" type="tel" />
              <Input label="College or organisation (optional)" name="college" />
              <Textarea label="Note for the Super Admin (optional)" name="note" maxLength={1000} />
              <Button loading={busy} type="submit" className="w-full">Request access</Button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-slate-500">
          {mode === 'student' ? <>Trainer or admin? <Link className="text-indigo-600 hover:underline" href="/trainer/login">Management sign in</Link></> : <>Student? <Link className="text-indigo-600 hover:underline" href="/login">Student sign in</Link></>}
        </p>
      </div>
    </main>
  );
}
