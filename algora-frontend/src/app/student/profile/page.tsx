'use client';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, ErrorState, fmtDate, Input, PageHeader, PageSkeleton, StatusBadge, useConfirm, useToast } from '@/components/ui';
import { useSync, type LinkView } from '@/components/student/SyncProvider';
import { setTheme, useTheme, type Theme } from '@/components/ThemePicker';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';
interface Profile { firstName: string; lastName: string; email: string; rollNumber: string; mobile: string; college?: string }
const THEMES: { value: Theme; label: string }[] = [{ value: 'system', label: 'Match my device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];
export default function Page() {
  const p = useApi<Profile>('/student/profile');
  const l = useApi<LinkView>('/student/leetcode');
  const { refresh } = useSync();
  const theme = useTheme();
  const toast = useToast(); const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState(''); const [consent, setConsent] = useState(false);
  const ready = !!p.data && !!l.data;
  // The account menu links to #connected-accounts; the sections only exist after loading.
  useEffect(() => { if (ready && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView(); }, [ready]);
  if (p.error || l.error) return <ErrorState message={(p.error ?? l.error)!} retry={() => { void p.reload(); void l.reload(); }} />;
  if (!p.data || !l.data) return <PageSkeleton />;
  const link = l.data;
  const connected = link.state === 'LINKED' && !!link.current;
  const reloadAll = async () => { await Promise.all([l.reload(), refresh()]); };
  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy('profile');
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try { await api('/student/profile', { method: 'PATCH', body: f }); toast.success('Profile saved'); void p.reload(); } catch (er) { toast.error(errorMessage(er)); } finally { setBusy(null); }
  }
  async function saveUsername(e: React.FormEvent) {
    e.preventDefault();
    if (connected && !(await confirm({ title: 'Change your LeetCode account?', body: 'The new account is connected immediately. Problems verified from your current account stop counting, and changing back later starts again from zero.', confirmLabel: 'Change account' }))) return;
    setBusy('link');
    try {
      await api('/student/leetcode/link', { method: 'POST', body: { username: newName.trim(), consent: true } });
      setNewName(''); setConsent(false);
      toast.success(connected ? 'LeetCode username updated' : 'LeetCode account connected');
      await reloadAll();
    } catch (er) { toast.error(errorMessage(er)); } finally { setBusy(null); }
  }
  async function disconnect() {
    if (!(await confirm({ title: 'Disconnect your LeetCode account?', body: 'Your progress stops counting until you connect an account again.', confirmLabel: 'Disconnect', danger: true }))) return;
    try { await api('/student/leetcode/link', { method: 'DELETE' }); toast.success('LeetCode account disconnected'); await reloadAll(); } catch (er) { toast.error(errorMessage(er)); }
  }
  async function deleteData() {
    if (!(await confirm({ title: 'Withdraw consent and delete your data?', body: 'This cannot be undone. Your verified problems are deleted and stop counting in rankings.', confirmLabel: 'Delete my data', danger: true }))) return;
    try {
      const r = await api<{ evidence: number }>('/student/leetcode/data', { method: 'DELETE', body: { confirm: 'DELETE' } });
      toast.success(`Deleted ${r.evidence} verified problem record${r.evidence === 1 ? '' : 's'}`); await reloadAll();
    } catch (er) { toast.error(errorMessage(er)); }
  }
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Profile and account" />
      <Card id="personal-information" title="Personal information">
        <form onSubmit={saveProfile} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="First name" name="firstName" defaultValue={p.data.firstName} required maxLength={60} />
            <Input label="Last name" name="lastName" defaultValue={p.data.lastName} required maxLength={60} />
          </div>
          <Input label="Mobile number" name="mobile" defaultValue={p.data.mobile} required pattern="\+?[0-9]{10,15}" type="tel" />
          <Input label="Email" value={p.data.email} disabled readOnly hint="From your Google account. It cannot be changed here." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Roll number" value={p.data.rollNumber} disabled readOnly hint="Ask your trainer if it is wrong." />
            <Input label="College" value={p.data.college ?? ''} disabled readOnly hint="Set by your trainer." />
          </div>
          <Button type="submit" loading={busy === 'profile'}>Save changes</Button>
        </form>
      </Card>
      <Card id="connected-accounts" title="Connected accounts" description="Algora verifies your problems from accepted submissions on your LeetCode account.">
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-fg">LeetCode</span>
            <StatusBadge status={connected ? 'LINKED' : 'UNLINKED'} />
            {connected && link.current && (
              <span className="inline-flex flex-wrap items-center gap-x-2 text-fg-muted">
                <a className="inline-flex items-center gap-1 font-medium text-accent-fg hover:underline" href={`https://leetcode.com/u/${link.current.username}/`} target="_blank" rel="noopener noreferrer">
                  {link.current.username}<ExternalLink size={13} aria-hidden /><span className="sr-only"> (opens LeetCode in a new tab)</span>
                </a>
                {link.current.linkedAt && <span>since {fmtDate(link.current.linkedAt)}</span>}
              </span>
            )}
          </div>
          <form onSubmit={saveUsername} className="space-y-3 border-t border-line pt-4">
            <Input label={connected ? 'Change LeetCode username' : 'LeetCode username'} value={newName} onChange={(e) => setNewName(e.target.value)} required pattern="[A-Za-z0-9_\-]{1,40}" placeholder="your_leetcode_username"
              hint={connected ? 'Takes effect immediately. Problems verified on your previous account stay with it and do not move to the new one.' : 'Algora never asks for your LeetCode password.'} />
            <Checkbox required checked={consent} onChange={(e) => setConsent(e.target.checked)} label="I agree that Algora may read the public accepted submissions of this account." />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant={connected ? 'secondary' : 'primary'} loading={busy === 'link'} disabled={!/^[A-Za-z0-9_-]{1,40}$/.test(newName.trim()) || !consent}>{connected ? 'Save username' : 'Connect account'}</Button>
              {connected && <Button type="button" variant="ghost" onClick={() => void disconnect()}>Disconnect</Button>}
            </div>
          </form>
        </div>
      </Card>
      <Card id="preferences" title="Preferences">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Theme</legend>
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-subtle p-1">
            {THEMES.map((t) => (
              <label key={t.value} className="cursor-pointer">
                <input type="radio" name="theme" value={t.value} checked={theme === t.value} onChange={() => setTheme(t.value)} className="peer sr-only" />
                <span className="block rounded-md px-3 py-1.5 text-[13px] font-medium text-fg-muted transition-colors peer-checked:bg-surface peer-checked:text-fg peer-checked:ring-1 peer-checked:ring-line-strong peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">{t.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>
      <Card id="privacy-and-data" title="Privacy and data">
        <div className="space-y-3 text-sm text-fg-muted">
          <p>{link.consentedAt ? `You agreed to Algora reading your LeetCode submissions on ${fmtDate(link.consentedAt)}. ` : ''}Algora reads only public accepted submissions, to verify your problems.</p>
          <p>If you withdraw consent, your LeetCode account is disconnected and your verified problems are permanently deleted. Algora keeps a record that you connected and consented.</p>
          <Button variant="danger" size="sm" onClick={() => void deleteData()}>Withdraw consent and delete my data</Button>
        </div>
      </Card>
    </div>
  );
}
