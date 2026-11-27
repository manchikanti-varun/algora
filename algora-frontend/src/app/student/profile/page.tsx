'use client';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Combobox, DescriptionList, ErrorState, fmtDate, Input, Modal, Notice, PageHeader, PageSkeleton, StatusBadge, Textarea, useConfirm, useToast } from '@/components/ui';
import { RequestList } from '@/components/student/RequestList';
import { AttendanceQr } from '@/components/attendance/AttendanceQr';
import { loadPublicColleges } from '@/lib/options';
import { useSync, type LinkView } from '@/components/student/SyncProvider';
import { setTheme, useTheme, type Theme } from '@/components/ThemePicker';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';
interface Profile { firstName: string; lastName: string; email: string; rollNumber: string; mobile: string; college?: string; collegeId?: string }
const THEMES: { value: Theme; label: string }[] = [{ value: 'system', label: 'Match my device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];
export default function Page() {
  const p = useApi<Profile>('/student/profile');
  const l = useApi<LinkView>('/student/leetcode');
  const { refresh } = useSync();
  const theme = useTheme();
  const toast = useToast(); const confirm = useConfirm();
  const [requestVersion, setRequestVersion] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState(''); const [consent, setConsent] = useState(false);
  const [collegeId, setCollegeId] = useState('');
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
    const requested: Record<string, string> = {};
    if (f.firstName.trim() !== p.data!.firstName) requested.firstName = f.firstName.trim();
    if (f.lastName.trim() !== p.data!.lastName) requested.lastName = f.lastName.trim();
    if (f.mobile.trim() !== p.data!.mobile) requested.mobile = f.mobile.trim();
    if (f.rollNumber.trim().toUpperCase() !== p.data!.rollNumber) requested.rollNumber = f.rollNumber.trim().toUpperCase();
    if (collegeId && collegeId !== p.data!.collegeId) requested.collegeId = collegeId;
    if (!Object.keys(requested).length) {
      setBusy(null);
      toast.info('Change a value before submitting your request.');
      return;
    }
    try {
      await api('/student/profile', { method: 'PATCH', body: { ...requested, reason: f.reason } });
      toast.success('Change request submitted'); setShowProfile(false); setRequestVersion((value) => value + 1);
    } catch (er) { toast.error(errorMessage(er)); } finally { setBusy(null); }
  }
  function openRequest() { setCollegeId(p.data!.collegeId ?? ''); setShowProfile(true); }
  async function saveUsername(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy('link');
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api('/student/leetcode/link', { method: 'POST', body: { username: newName.trim(), consent: true, reason: f.reason } });
      setNewName(''); setConsent(false);
      toast.success('LeetCode account change requested');
      setShowLink(false); setRequestVersion((value) => value + 1);
    } catch (er) { toast.error(errorMessage(er)); } finally { setBusy(null); }
  }
  async function disconnect() {
    if (!(await confirm({ title: 'Request to disconnect your LeetCode account?', body: 'Your trainer or a Super Admin reviews the request. Until it is approved, Algora keeps verifying this account.', confirmLabel: 'Submit request' }))) return;
    try { await api('/student/leetcode/link', { method: 'DELETE', body: { reason: 'Student requested disconnection' } }); toast.success('Disconnection requested. It will take effect once approved.'); setRequestVersion((value) => value + 1); } catch (er) { toast.error(errorMessage(er)); }
  }
  async function stopReading() {
    if (!(await confirm({ title: 'Stop reading your submissions?', body: 'Algora stops checking this account immediately and cancels queued updates. Your verified problems stay counted. The account association remains until a trainer or Super Admin reviews a disconnection request.', confirmLabel: 'Stop reading' }))) return;
    try { await api('/student/leetcode/consent', { method: 'DELETE' }); toast.success('Algora has stopped reading your LeetCode submissions'); await reloadAll(); } catch (er) { toast.error(errorMessage(er)); }
  }
  async function deleteData() {
    if (!(await confirm({ title: 'Withdraw consent and delete your data?', body: 'This cannot be undone. Your verified problems are deleted and stop counting in rankings.', confirmLabel: 'Delete my data', danger: true }))) return;
    try {
      const r = await api<{ evidence: number }>('/student/leetcode/data', { method: 'DELETE', body: { confirm: 'DELETE' } });
      toast.success(`Deleted ${r.evidence} verified problem record${r.evidence === 1 ? '' : 's'}`); await reloadAll(); setRequestVersion((value) => value + 1);
    } catch (er) { toast.error(errorMessage(er)); }
  }
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Profile and account" />
      <Card id="personal-information" title="Personal information" description="Approved information is read-only. Submit a request to change it."
        actions={<Button variant="secondary" size="sm" onClick={openRequest}>Request changes</Button>}>
        <DescriptionList items={[
          { label: 'Name', value: [p.data.firstName, p.data.lastName].filter(Boolean).join(' ') || '—' },
          { label: 'Mobile number', value: p.data.mobile || '—' },
          { label: 'Email', value: p.data.email },
        ]} />
      </Card>
      <Card title="Academic information" actions={<Button variant="secondary" size="sm" onClick={openRequest}>Request changes</Button>}>
        <DescriptionList cols={2} items={[{ label: 'Roll number', value: p.data.rollNumber }, { label: 'College', value: p.data.college ?? '—' }]} />
      </Card>
      {p.data.rollNumber && <AttendanceQr studentName={[p.data.firstName, p.data.lastName].filter(Boolean).join(' ') || 'Student'} rollNumber={p.data.rollNumber} />}
      <Modal open={showProfile} onClose={() => setShowProfile(false)} title="Request a change" description="Your trainer or a Super Admin reviews every request before it is applied.">
        <form onSubmit={saveProfile} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="First name" name="firstName" defaultValue={p.data.firstName} required maxLength={60} />
            <Input label="Last name" name="lastName" defaultValue={p.data.lastName} required maxLength={60} />
          </div>
          <Input label="Mobile number" name="mobile" defaultValue={p.data.mobile} required pattern="\+?[0-9]{10,15}" type="tel" />
          <Input label="Roll number" name="rollNumber" defaultValue={p.data.rollNumber} required pattern="[A-Za-z0-9]{10}" maxLength={10} hint="Exactly 10 letters or digits. Approving a change keeps your progress and verification history." />
          <Combobox label="College" value={collegeId} selectedLabel={p.data.college} load={loadPublicColleges} labelHidden={false}
            onChange={(value) => setCollegeId(value)} placeholder="Search and select your college" className="[&_input]:h-9" />
          <Textarea label="Reason for the change" name="reason" required minLength={3} maxLength={500} />
          <Button type="submit" loading={busy === 'profile'}>Submit request</Button>
        </form>
      </Modal>
      <Card id="connected-accounts" className="scroll-mt-20" title="Connected accounts" description="Algora verifies your problems from accepted submissions on your LeetCode account.">
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-fg">LeetCode</span>
            <StatusBadge status={link.state === 'LINKED' ? 'LINKED' : link.state === 'CONSENT_WITHDRAWN' ? 'CONSENT_WITHDRAWN' : 'UNLINKED'} />
            {connected && link.current && (
              <span className="inline-flex flex-wrap items-center gap-x-2 text-fg-muted">
                <a className="inline-flex items-center gap-1 font-medium text-accent-fg hover:underline" href={`https://leetcode.com/u/${link.current.username}/`} target="_blank" rel="noopener noreferrer">
                  {link.current.username}<ExternalLink size={13} aria-hidden /><span className="sr-only"> (opens LeetCode in a new tab)</span>
                </a>
                {link.current.linkedAt && <span>since {fmtDate(link.current.linkedAt)}</span>}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setShowLink(true)}>{connected ? 'Request username change' : 'Request connection'}</Button>
            {connected && <Button variant="secondary" onClick={() => void stopReading()}>Stop reading submissions</Button>}
            {link.current && <Button variant="ghost" onClick={() => void disconnect()}>Request disconnection</Button>}
          </div>
          {link.state === 'CONSENT_WITHDRAWN' && <Notice tone="info" title="You have stopped sharing submissions">Algora is not reading this account. Verified problems stay counted. Submit a connection request if you want to share again.</Notice>}
        </div>
      </Card>
      <Modal open={showLink} onClose={() => setShowLink(false)} title={connected ? 'Request a username change' : 'Request a LeetCode connection'}
        description={connected ? `Current account: ${link.current?.username}. Verified problems stay with the current account after an approved change.` : 'Your trainer or a Super Admin can review this request.'}>
        <form onSubmit={saveUsername} className="space-y-3">
          <Input label="LeetCode username" value={newName} onChange={(e) => setNewName(e.target.value)} required maxLength={40} placeholder="your_leetcode_username" />
          <Checkbox required checked={consent} onChange={(e) => setConsent(e.target.checked)} label="I agree that Algora may read the public accepted submissions of this account." />
          <Textarea label="Reason for the change" name="reason" required minLength={3} maxLength={500} hint="For example: I changed my LeetCode username." />
          <Button type="submit" loading={busy === 'link'} disabled={!/^[A-Za-z0-9_-]{1,40}$/.test(newName.trim()) || !consent}>Submit request</Button>
        </form>
      </Modal>
      <RequestList version={requestVersion} />
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
