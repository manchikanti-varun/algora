'use client';
import { KeyRound } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, DataTable, DescriptionList, EmptyState, ErrorState, fmtDate, fmtDateTime, Grid, Input, Menu, Modal, Notice, PageHeader, PageSkeleton, Pagination, ProgressBar, StatCard, StatusBadge, Textarea, timeAgo, useConfirm, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useTrackRecent } from '@/hooks/useRecent';
import { api, errorMessage } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import type { PerfRow } from '@/components/manage/types';

interface Detail {
  student: { _id: string; fullName: string; rollNumber: string; email: string; college?: string; status: string; createdAt: string; sync?: { status: string; lastSuccessAt?: string; possibleGap?: boolean } };
  enrollments: { batchId: string; batch?: string; status: string; enrolledAt: string }[];
  contexts: PerfRow[];
  link: { state: string; username: string | null; current: { username: string; linkedAt: string | null } | null; consentedAt: string | null };
  history: { slug: string; title?: string; firstVerifiedAt: string | null; earliestObservedSolvedAt: string | null; latestObservedSolvedAt: string | null }[];
}
const PAGE = 25;

export default function Page() {
  const { studentId } = useParams<{ studentId: string }>();
  const { user } = useAuth();
  const d = useApi<Detail>(`/analytics/students/${studentId}`);
  const toast = useToast(); const confirm = useConfirm();
  const [revoke, setRevoke] = useState(false); const [reason, setReason] = useState('');
  const [fixOpen, setFixOpen] = useState(false); const [fixName, setFixName] = useState(''); const [fixReason, setFixReason] = useState('');
  const [hPage, setHPage] = useState(1);
  const s = d.data?.student;
  useTrackRecent(s ? { href: `/manage/students/${studentId}`, label: s.fullName, kind: 'Student' } : null);
  if (d.error) return <div className="space-y-6"><PageHeader title="Student" breadcrumbs={[{ label: 'Students', href: '/manage/students' }, { label: 'Student' }]} /><ErrorState message={d.error} retry={d.reload} /></div>;
  if (!d.data || !s) return <PageSkeleton />;
  const { link } = d.data;
  const admin = isAdmin(user);
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); d.reload(); return true; } catch (e) { toast.error(errorMessage(e)); return false; } };
  const verified = new Set(d.data.history.map((h) => h.slug)).size;
  const connected = link.state === 'LINKED';
  const openFix = () => { setFixName(link.current?.username ?? ''); setFixReason(''); setFixOpen(true); };
  const history = d.data.history.slice((hPage - 1) * PAGE, hPage * PAGE);

  return (
    <div className="space-y-6">
      <PageHeader title={s.fullName} docTitle={s.fullName} breadcrumbs={[{ label: 'Students', href: '/manage/students' }, { label: s.fullName }]}
        meta={<StatusBadge status={s.status} />}
        subtitle={`${s.rollNumber} · ${s.college ?? 'No college'} · registered ${fmtDate(s.createdAt)}`}
        actions={<>
          <Menu label="LeetCode account actions" variant="secondary" size="md" align="end" button={<><KeyRound size={15} aria-hidden />LeetCode account</>} items={[
            { label: connected ? 'Correct username' : 'Connect username', onSelect: openFix, hidden: link.state === 'REVOKED' },
            { label: 'Revoke connection', danger: true, onSelect: () => { setReason(''); setRevoke(true); }, hidden: !admin || link.state === 'UNLINKED' || link.state === 'REVOKED' },
          ]} />
          {admin && (s.status === 'ACTIVE'
            ? <Button variant="danger" onClick={async () => { if (await confirm({ title: `Suspend ${s.fullName}?`, body: 'They are signed out and cannot use Algora until reactivated.', confirmLabel: 'Suspend', danger: true })) void run(() => api(`/students/${s._id}/status`, { method: 'PATCH', body: { status: 'SUSPENDED' } }), 'Student suspended'); }}>Suspend</Button>
            : <Button onClick={() => run(() => api(`/students/${s._id}/status`, { method: 'PATCH', body: { status: 'ACTIVE' } }), 'Student reactivated')}>Reactivate</Button>)}
        </>} />
      <Grid>
        <StatCard label="Verified problems" value={verified} hint="Across all courses, counted once" />
        <StatCard label="Active batches" value={d.data.enrollments.filter((e) => e.status === 'ACTIVE').length} />
        <StatCard label="Last update" value={timeAgo(s.sync?.lastSuccessAt)} hint={<StatusBadge status={s.sync?.status ?? 'IDLE'} />} />
        <StatCard label="LeetCode account" value={link.current?.username ?? '—'} hint={<StatusBadge status={link.state} />} />
      </Grid>
      {s.sync?.possibleGap && <Notice tone="warn" title="Incomplete submission history">Some accepted submissions between updates may not have been seen.</Notice>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Progress by course" flush>
            <DataTable rows={d.data.contexts} rowKey={(r) => r.batchCourseId} empty={<EmptyState title="No active courses" compact />} columns={[
              { key: 'b', header: 'Batch', cell: (r) => r.batch }, { key: 'c', header: 'Course', cell: (r) => r.course },
              { key: 's', header: 'Verified', cell: (r) => <span className="tabular-nums">{r.solved} / {r.accessible}</span> },
              { key: 'd', header: 'Easy · Medium · Hard', cell: (r) => <span className="tabular-nums">{r.easy} · {r.medium} · {r.hard}</span> },
              { key: 'p', header: 'Points', align: 'right', cell: (r) => <span className="tabular-nums">{r.points}</span> },
              { key: 'r', header: 'Rank', align: 'right', cell: (r) => <span className="tabular-nums">#{r.rank}</span> },
              { key: 'pct', header: 'Completion', className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" /> },
            ]} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="LeetCode account">
            <DescriptionList cols={2} items={[
              { label: 'Status', value: <StatusBadge status={link.state} /> },
              { label: 'Account', value: link.current?.username ?? '—' },
              { label: 'Connected since', value: link.current?.linkedAt ? fmtDate(link.current.linkedAt) : '—' },
              { label: 'Consent', value: link.consentedAt ? `Given ${fmtDate(link.consentedAt)}` : 'Not given' },
            ]} />
          </Card>
          <Card title="Batches">
            {d.data.enrollments.length === 0 ? <p className="text-sm text-fg-muted">Not enrolled in any batch.</p> : (
              <ul className="divide-y divide-line text-sm">
                {d.data.enrollments.map((e) => <li key={e.batchId} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{e.batch ?? 'Batch'}</span><span className="flex shrink-0 items-center gap-2 text-fg-muted">{fmtDate(e.enrolledAt)}<StatusBadge status={e.status} /></span></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="Verified problems" description="Times are accepted submissions Algora has seen. Earlier solves outside LeetCode's recent window cannot be seen." flush>
        <DataTable rows={history} rowKey={(h) => h.slug}
          empty={<EmptyState title="No verified problems yet" body="Problems appear after progress is updated for a connected LeetCode account." compact />} columns={[
            { key: 't', header: 'Problem', cell: (h) => <a className="text-accent-fg hover:underline" href={`https://leetcode.com/problems/${h.slug}/`} target="_blank" rel="noopener noreferrer">{h.title ?? h.slug}</a> },
            { key: 'e', header: 'First accepted seen', cell: (h) => fmtDateTime(h.earliestObservedSolvedAt) },
            { key: 'l', header: 'Latest accepted seen', cell: (h) => fmtDateTime(h.latestObservedSolvedAt) },
            { key: 'v', header: 'Verified on', cell: (h) => fmtDateTime(h.firstVerifiedAt) },
          ]} />
        <Pagination page={hPage} pageSize={PAGE} total={d.data.history.length} onPage={setHPage} />
      </Card>

      <Modal open={revoke} onClose={() => setRevoke(false)} title="Revoke LeetCode connection"
        footer={<><Button variant="secondary" onClick={() => setRevoke(false)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={async () => { if (await run(() => api(`/students/${s._id}/leetcode/revoke`, { method: 'POST', body: { reason } }), 'Connection revoked')) setRevoke(false); }}>Revoke</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">Submissions from this account stop counting. They are kept for audit. The student can connect an account again.</p>
          <Textarea label="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} hint="At least 3 characters." />
        </div>
      </Modal>
      <Modal open={fixOpen} onClose={() => setFixOpen(false)} title={connected ? 'Correct LeetCode username' : 'Connect LeetCode username'}
        footer={<><Button variant="secondary" onClick={() => setFixOpen(false)}>Cancel</Button><Button disabled={!/^[A-Za-z0-9_-]{1,40}$/.test(fixName) || fixReason.trim().length < 3} onClick={async () => { if (await run(() => api(`/students/${s._id}/leetcode/username`, { method: 'POST', body: { username: fixName, reason: fixReason } }), 'Username saved')) setFixOpen(false); }}>Save</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">Takes effect immediately and is recorded in the audit log. The student&apos;s standing consent is required. Problems from the previous account stop counting and are not transferred.</p>
          <Input label="LeetCode username" value={fixName} onChange={(e) => setFixName(e.target.value)} pattern="[A-Za-z0-9_\-]{1,40}" />
          <Textarea label="Reason (recorded in the audit log)" value={fixReason} onChange={(e) => setFixReason(e.target.value)} maxLength={300} hint="At least 3 characters." />
        </div>
      </Modal>
    </div>
  );
}
