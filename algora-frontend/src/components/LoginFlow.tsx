'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { homeFor, useAuth, type SessionUser } from '@/lib/auth';
import { GoogleSignIn } from './GoogleSignIn';
import { ThemePicker } from './ThemePicker';
import { Button, Checkbox, Input, Notice, Spinner, Textarea, usePageTitle } from './ui';

type Step =
  | { kind: 'signin' }
  | { kind: 'register'; idToken: string; email: string; name: string }
  | { kind: 'pending' }
  | { kind: 'rejected'; reason?: string; idToken: string; email: string; name: string };

interface AuthResponse { status: string; user?: SessionUser; csrfToken?: string; profile?: { email: string; name: string }; reason?: string; enrolledBatches?: number }

export function LoginFlow({ mode, expired }: { mode: 'student' | 'trainer'; expired?: boolean }) {
  const router = useRouter();
  usePageTitle(mode === 'student' ? 'Student sign in' : 'Trainer and admin sign in');
  const { user, loading, setSession } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'signin' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hasClaim, setHasClaim] = useState(false);
  useEffect(() => { if (user) router.replace(homeFor(user.role)); }, [user, router]);
  const MESSAGES: Record<string, string> = {
    rollNumber: 'Enter exactly 10 letters or digits.',
    mobile: 'Enter 10 to 15 digits, with an optional + at the start.',
    leetcodeUsername: 'Use letters, digits, underscores or hyphens (up to 40 characters).',
    phone: 'Enter 10 to 15 digits, with an optional + at the start.',
  };
  // Show native constraint failures inline, next to the field, instead of in browser bubbles.
  function onInvalid(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.target as HTMLInputElement;
    if (!el.name) return;
    const v = el.validity;
    const msg = v.valueMissing ? (el.type === 'checkbox' ? 'Please confirm to continue.' : 'This field is required.')
      : v.patternMismatch || v.typeMismatch ? MESSAGES[el.name] ?? 'Check this value.'
      : v.tooShort ? `Enter at least ${el.minLength} characters.` : el.validationMessage;
    setFieldErrors((prev) => {
      if (!Object.keys(prev).length) queueMicrotask(() => el.focus());
      return { ...prev, [el.name]: msg };
    });
  }
  const clearError = (e: React.FormEvent<HTMLFormElement>) => {
    const n = (e.target as HTMLInputElement).name;
    if (n) setFieldErrors((p) => { if (!(n in p)) return p; const rest = { ...p }; delete rest[n]; return rest; });
  };
  const fe = (n: string) => fieldErrors[n];
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
    setBusy(true); setError(undefined); setFieldErrors({});
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      if (mode === 'student') finish(await api<AuthResponse>('/auth/register/student', { method: 'POST', body: { idToken, ...f, claimCode: f.claimCode || undefined, leetcodeConsent: f.leetcodeConsent === 'on' } }));
      else {
        await api('/trainer-requests', { method: 'POST', body: { idToken, fullName: f.fullName, phone: f.phone || undefined, college: f.college || undefined, note: f.note || undefined } });
        setStep({ kind: 'pending' });
      }
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  const waiting = loading || !!user;
  const title = mode === 'student' ? 'Student sign in' : 'Trainer and admin sign in';
  const subtitle = mode === 'student' ? 'Use the Google account you want to learn with.' : 'Management access requires approval by the Super Admin.';
  return (
    <main className="relative grid min-h-screen place-items-center bg-canvas p-4">
      <div className="absolute right-4 top-4"><ThemePicker /></div>
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold text-fg"><span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-white" aria-hidden>A</span>Algora</Link>
        <div className="space-y-5 rounded-xl border border-line bg-surface p-6 sm:p-8">
          <div>
            <h1 className="text-xl font-semibold text-fg">{step.kind === 'register' ? (mode === 'student' ? 'Create your account' : 'Request management access') : title}</h1>
            <p className="mt-1 text-sm text-fg-muted">{step.kind === 'register' ? (mode === 'student' ? 'A few details so your trainer can find you.' : 'The Super Admin reviews every request.') : subtitle}</p>
          </div>
          {waiting && <p role="status" className="flex items-center justify-center gap-2 py-4 text-sm text-fg-muted"><Spinner />{user ? 'Signing you in…' : 'Checking your session…'}</p>}
          {!waiting && expired && step.kind === 'signin' && <Notice tone="warn">Your session ended. Please sign in again.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {!waiting && step.kind === 'signin' && <GoogleSignIn onCredential={onCredential} />}
          {!waiting && step.kind === 'pending' && <Notice tone="info" title="Access request pending">The Super Admin will review your request. Sign in again once it is approved.</Notice>}
          {!waiting && step.kind === 'rejected' && <Notice tone="error" title="Access request rejected">{step.reason ? `Reason: ${step.reason}. ` : ''}You can submit a new request.</Notice>}
          {!waiting && step.kind === 'rejected' && mode === 'trainer' && <Button variant="secondary" onClick={() => setStep({ kind: 'signin' })}>Sign in again to resubmit</Button>}
          {!waiting && step.kind === 'register' && mode === 'student' && (
            <form className="space-y-5" onSubmit={(e) => submit(e, step.idToken)} onInvalidCapture={onInvalid} onInput={clearError}>
              <p className="text-sm text-fg-muted">Signed in as <strong className="text-fg">{step.email}</strong>.</p>
              <fieldset className="space-y-3">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">About you</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="First name" name="firstName" required maxLength={60} autoComplete="given-name" error={fe('firstName')} />
                  <Input label="Last name" name="lastName" required maxLength={60} autoComplete="family-name" error={fe('lastName')} />
                </div>
                <Input label="Mobile number" name="mobile" required pattern="\+?[0-9]{10,15}" type="tel" autoComplete="tel" error={fe('mobile')} />
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">College</legend>
                <Input label="Roll number" name="rollNumber" required pattern="[A-Za-z0-9]{10}" maxLength={10} error={fe('rollNumber')} hint="Exactly 10 letters or digits. You cannot change it later, so check it carefully." />
                <Input label="College" name="college" required minLength={2} error={fe('college')} />
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">LeetCode</legend>
                <Input label="LeetCode username" name="leetcodeUsername" required pattern="[A-Za-z0-9_\-]{1,40}" error={fe('leetcodeUsername')} hint="The public account whose accepted submissions Algora should read. You can change it later from your profile." />
                <div>
                  <Checkbox name="leetcodeConsent" required
                    label={<>I agree that Algora may read the <strong>public accepted submissions</strong> of this LeetCode account to verify my progress. Algora never asks for my LeetCode password. I can withdraw and delete this data from my profile at any time.</>} />
                  {fe('leetcodeConsent') && <p role="alert" className="mt-1 text-xs text-danger-fg">{fe('leetcodeConsent')}</p>}
                </div>
              </fieldset>
              {hasClaim
                ? <Input label="Claim code" name="claimCode" autoComplete="off" hint="The code your trainer gave you for a reserved roll number." />
                : <button type="button" onClick={() => setHasClaim(true)} className="text-[13px] font-medium text-accent-fg hover:underline">I have a claim code</button>}
              <Button loading={busy} type="submit" className="w-full">Create account</Button>
            </form>
          )}
          {!waiting && step.kind === 'register' && mode === 'trainer' && (
            <form className="space-y-3" onSubmit={(e) => submit(e, step.idToken)} onInvalidCapture={onInvalid} onInput={clearError}>
              <p className="text-sm text-fg-muted"><strong className="text-fg">{step.email}</strong> is not an approved trainer yet. Request access:</p>
              <Input label="Full name" name="fullName" defaultValue={step.name} required minLength={2} error={fe('fullName')} />
              <Input label="Phone (optional)" name="phone" pattern="\+?[0-9]{10,15}" type="tel" error={fe('phone')} />
              <Input label="College or organisation (optional)" name="college" />
              <Textarea label="Note for the Super Admin (optional)" name="note" maxLength={1000} />
              <Button loading={busy} type="submit" className="w-full">Request access</Button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-fg-muted">
          {mode === 'student' ? <>Trainer or admin? <Link className="font-medium text-accent-fg hover:underline" href="/trainer/login">Management sign in</Link></> : <>Student? <Link className="font-medium text-accent-fg hover:underline" href="/login">Student sign in</Link></>}
        </p>
      </div>
    </main>
  );
}
