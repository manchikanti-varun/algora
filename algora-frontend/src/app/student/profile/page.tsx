'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, ErrorState, fmtDate, Input, PageHeader, PageSkeleton, StatusBadge, timeAgo, useConfirm, useToast } from '@/components/ui';
import { SyncPanel, useSync, type LinkView } from '@/components/student/SyncProvider';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Profile { firstName: string; lastName: string; email: string; rollNumber: string; mobile: string; college?: string }
export default function Page() {
  const p = useApi<Profile>('/student/profile');
  const l = useApi<LinkView>('/student/leetcode');
  const { view, refresh } = useSync();
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
  async function saveUsername() {
    setBusy('link');
    try {
      await api('/student/leetcode/link', { method: 'POST', body: { username: newName.trim(), consent: true } });
      setNewName(''); setConsent(false);
      toast.success(link.state === 'LINKED' ? 'LeetCode username updated' : 'LeetCode account linked');
      await reloadAll();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }
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
              {link.state === 'LINKED' && link.current ? (
                <p>
                  Linked account:{' '}
                  <a className="font-medium text-indigo-700 hover:underline" href={`https://leetcode.com/u/${link.current.username}/`} target="_blank" rel="noopener noreferrer">{link.current.username}</a>
                  {link.current.linkedAt && <span className="text-slate-500"> · since {fmtDate(link.current.linkedAt)}</span>}
                </p>
              ) : (
                <p className="text-slate-600">No LeetCode account is linked. Progress counts only from accepted submissions on the account you link.</p>
              )}
              <p className="text-xs text-slate-500">Algora reads only this account&apos;s public accepted submissions. It never asks for your LeetCode password, and the username is not treated as proof that the account is yours.</p>
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <Input label={link.state === 'LINKED' ? 'Change LeetCode username' : 'Link your LeetCode username'} value={newName} onChange={(e) => setNewName(e.target.value)} pattern="[A-Za-z0-9_\-]{1,40}" placeholder="your_leetcode_username"
                  hint="Takes effect immediately. Evidence from a previous account is kept but never moves to the new one." />
                <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />I agree that Algora may read this account&apos;s public accepted submissions.</label>
                <Button variant="secondary" loading={busy === 'link'} disabled={!/^[A-Za-z0-9_-]{1,40}$/.test(newName.trim()) || !consent} onClick={async () => { if (link.state !== 'LINKED' || (await confirm({ title: 'Change your LeetCode account?', body: 'The new account is linked immediately. Problems verified from your current account stop counting, and changing back later starts again from zero.', confirmLabel: 'Change account' }))) saveUsername(); }}>
                  {link.state === 'LINKED' ? 'Save username' : 'Link account'}
                </Button>
              </div>
              {link.state === 'LINKED' && <Button variant="ghost" size="sm" onClick={async () => { if (await confirm({ title: 'Unlink your LeetCode account?', body: 'Your progress stops counting until you link an account again.', confirmLabel: 'Unlink', danger: true })) { try { await api('/student/leetcode/link', { method: 'DELETE' }); toast.success('Account unlinked'); await reloadAll(); } catch (e) { toast.error(errorMessage(e)); } } }}>Unlink account</Button>}
            </div>
          </Card>
          <SyncPanel />
          {view && (
            <p className="text-xs text-slate-500">
              Last successful synchronization: <strong>{timeAgo(view.lastSuccessAt)}</strong>
              {view.statusDetail && <> · detail: <code>{view.statusDetail}</code></>}
            </p>
          )}
          <Card title="Your LeetCode data">
            <p className="mb-3 text-sm text-slate-600">{link.consentedAt ? `You agreed to Algora reading this account's public submissions on ${fmtDate(link.consentedAt)}. ` : ''}Withdrawing unlinks your account and permanently removes your verified problems and observed submissions. Algora retains the link history and consent audit record.</p>
            <Button variant="danger" size="sm" onClick={async () => { if (await confirm({ title: 'Withdraw consent and delete your LeetCode data?', body: 'This cannot be undone. Verified problems are deleted and stop counting in leaderboards.', confirmLabel: 'Delete my data', danger: true })) { try { const r = await api<{ evidence: number }>('/student/leetcode/data', { method: 'DELETE', body: { confirm: 'DELETE' } }); toast.success(`Deleted ${r.evidence} verified problem record${r.evidence === 1 ? '' : 's'}`); await reloadAll(); } catch (e) { toast.error(errorMessage(e)); } } }}>Withdraw and delete my data</Button>
          </Card>
          <Card title="Session"><Button variant="secondary" onClick={async () => { await logout(); router.replace('/login'); }}>Sign out</Button></Card>
        </div>
      </div>
    </div>
  );
}
