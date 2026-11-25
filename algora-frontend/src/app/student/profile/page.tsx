'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, ErrorState, fmtDate, Input, Notice, PageHeader, PageSkeleton, StatusBadge, useConfirm, useToast } from '@/components/ui';
import { SyncPanel, useSync, type LinkView } from '@/components/student/SyncProvider';
import { useApi } from '@/hooks/useApi';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Profile { firstName: string; lastName: string; email: string; rollNumber: string; mobile: string; college?: string }
export default function Page() {
  const p = useApi<Profile>('/student/profile');
  const l = useApi<LinkView>('/student/leetcode');
  const { refresh } = useSync();
  const { logout } = useAuth(); const router = useRouter();
  const toast = useToast(); const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState(''); const [consent, setConsent] = useState(false);
  if (p.error || l.error) return <ErrorState message={(p.error ?? l.error)!} />;
  if (!p.data || !l.data) return <PageSkeleton />;
  const link = l.data;
  const reloadAll = async () => { await Promise.all([l.reload(), refresh()]); };

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy('profile');
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try { await api('/student/profile', { method: 'PATCH', body: f }); toast.success('Profile saved'); p.reload(); } catch (er) { toast.error(errorMessage(er)); } finally { setBusy(null); }
  }
  async function requestLink() {
    setBusy('link');
    try { await api('/student/leetcode/link', { method: 'POST', body: { username: newName, consent: true } }); setNewName(''); setConsent(false); toast.success('Request created. Follow the verification steps.'); await reloadAll(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }
  async function verify() {
    setBusy('verify');
    try {
      const r = await api<{ verified: boolean; reason?: string }>('/student/leetcode/verify', { method: 'POST' });
      if (r.verified) toast.success('Ownership verified'); else toast.error('The code was not found in your LeetCode profile summary yet. Save it on LeetCode and try again in a minute.');
      await reloadAll();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERIFICATION_UNAVAILABLE') toast.info('Verification is not available yet. Your request stays pending and will be checked once it is.');
      else toast.error(errorMessage(e));
    } finally { setBusy(null); }
  }
  const openStep = link.state === 'PENDING_VERIFICATION' || link.state === 'REVALIDATION_REQUIRED' || !!link.request;
  return (
    <div className="space-y-6">
      <PageHeader title="Profile" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Personal details">
          <form onSubmit={saveProfile} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="First name" name="firstName" defaultValue={p.data.firstName} required maxLength={60} />
              <Input label="Last name" name="lastName" defaultValue={p.data.lastName} required maxLength={60} />
            </div>
            <Input label="Mobile number" name="mobile" defaultValue={p.data.mobile} required pattern="\+?[0-9]{10,15}" type="tel" />
            <Input label="Email" value={p.data.email} disabled readOnly hint="Your Google account. It cannot be changed here." />
            <Input label="Roll number" value={p.data.rollNumber} disabled readOnly hint="Roll numbers cannot be changed. Contact your trainer if it is wrong." />
            <Input label="College" value={p.data.college ?? ''} disabled readOnly />
            <Button loading={busy === 'profile'} type="submit">Save</Button>
          </form>
        </Card>
        <div className="space-y-6">
          <Card title={<span className="flex items-center gap-2">LeetCode account <StatusBadge status={link.state} /></span>}>
            <div className="space-y-4 text-sm">
              {link.current && <p>Verified account: <a className="font-medium text-indigo-700 hover:underline" href={`https://leetcode.com/u/${link.current.username}/`} target="_blank" rel="noopener noreferrer">{link.current.username}</a>{link.current.verifiedAt && <span className="text-slate-500"> · since {fmtDate(link.current.verifiedAt)}</span>}</p>}
              {link.request && <p>Requested {link.request.kind === 'CHANGE' ? 'change to' : 'account'}: <strong>{link.request.username}</strong>{link.current && ' (your current account keeps counting until this one is verified)'}</p>}
              {link.state === 'REVOKED' && <Notice tone="warn">Your previous link was revoked. Link an account again to continue.</Notice>}
              {openStep && link.challenge && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                  <p className="font-medium text-indigo-900">Prove this account is yours</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-indigo-900">
                    <li>On leetcode.com, open <em>Edit profile</em> and add this code to your <strong>Summary</strong>:</li>
                  </ol>
                  <code className="mt-2 block select-all rounded bg-white px-3 py-2 font-mono text-sm ring-1 ring-indigo-200">{link.challenge}</code>
                  <ol start={2} className="mt-2 list-decimal space-y-1 pl-5 text-indigo-900"><li>Save, then press <em>Verify</em>. You can remove the code afterwards.</li></ol>
                  {!link.verificationAvailable && <p className="mt-3 text-amber-800">Verification is not available yet. Your request is saved and stays pending; nothing counts until it is verified.</p>}
                  <Button className="mt-3" loading={busy === 'verify'} disabled={!link.verificationAvailable} onClick={verify}>Verify</Button>
                </div>
              )}
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <Input label={link.current || link.request ? 'Change LeetCode username' : 'Link your LeetCode username'} value={newName} onChange={(e) => setNewName(e.target.value)} pattern="[A-Za-z0-9_\-]{1,40}" placeholder="your_leetcode_username"
                  hint="A new account must be verified before it counts. Evidence from a previous account is kept but never moves to the new one." />
                <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />I agree that Algora may read this account&apos;s public accepted submissions.</label>
                <Button variant="secondary" loading={busy === 'link'} disabled={!/^[A-Za-z0-9_-]{1,40}$/.test(newName) || !consent} onClick={async () => { if (!link.current || (await confirm({ title: 'Change your LeetCode account?', body: 'When the new account is verified, problems verified from your current account stop counting. Changing back later starts again from zero.', confirmLabel: 'Request change' }))) requestLink(); }}>{link.current || link.request ? 'Request change' : 'Link account'}</Button>
              </div>
              {(link.current || link.request) && <Button variant="ghost" size="sm" onClick={async () => { if (await confirm({ title: 'Unlink your LeetCode account?', body: 'Your progress stops counting until you link and verify an account again.', confirmLabel: 'Unlink', danger: true })) { try { await api('/student/leetcode/link', { method: 'DELETE' }); toast.success('Account unlinked'); await reloadAll(); } catch (e) { toast.error(errorMessage(e)); } } }}>Unlink account</Button>}
            </div>
          </Card>
          <SyncPanel />
          <Card title="Your LeetCode data">
            <p className="mb-3 text-sm text-slate-600">{link.consentedAt ? `You agreed to verification on ${fmtDate(link.consentedAt)}. ` : ''}Withdrawing unlinks your account and permanently deletes every LeetCode record Algora holds about you (verified problems, observed submissions). Your course progress will show zero until you link and verify again.</p>
            <Button variant="danger" size="sm" onClick={async () => { if (await confirm({ title: 'Withdraw consent and delete your LeetCode data?', body: 'This cannot be undone. Verified problems are deleted and stop counting in leaderboards.', confirmLabel: 'Delete my data', danger: true })) { try { const r = await api<{ evidence: number }>('/student/leetcode/data', { method: 'DELETE', body: { confirm: 'DELETE' } }); toast.success(`Deleted ${r.evidence} verified problem record${r.evidence === 1 ? '' : 's'}`); await reloadAll(); } catch (e) { toast.error(errorMessage(e)); } } }}>Withdraw and delete my data</Button>
          </Card>
          <Card title="Session"><Button variant="secondary" onClick={async () => { await logout(); router.replace('/login'); }}>Sign out</Button></Card>
        </div>
      </div>
    </div>
  );
}
