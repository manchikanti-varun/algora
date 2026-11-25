'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, DataTable, EmptyState, ErrorState, fmtDate, fmtDateTime, Grid, Modal, Notice, PageHeader, PageSkeleton, ProgressBar, StatCard, StatusBadge, Textarea, timeAgo, useConfirm, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import type { PerfRow } from '@/components/manage/types';

interface Detail {
  student: { _id: string; fullName: string; rollNumber: string; email: string; college?: string; status: string; createdAt: string; sync?: { status: string; lastSuccessAt?: string; possibleGap?: boolean } };
  enrollments: { batchId: string; batch?: string; status: string; enrolledAt: string }[];
  contexts: PerfRow[];
  link: { state: string; current: { username: string; verifiedAt: string | null } | null; request: { username: string; kind: string; requestedAt: string } | null };
  history: { slug: string; title?: string; firstVerifiedAt: string | null; earliestObservedSolvedAt: string | null; latestObservedSolvedAt: string | null }[];
}
export default function Page() {
  const { studentId } = useParams<{ studentId: string }>();
  const { user } = useAuth();
  const d = useApi<Detail>(`/analytics/students/${studentId}`);
  const toast = useToast(); const confirm = useConfirm();
  const [revoke, setRevoke] = useState(false); const [reason, setReason] = useState('');
  if (d.error) return <ErrorState message={d.error} retry={d.reload} />;
  if (!d.data) return <PageSkeleton />;
  const { student: s, link } = d.data;
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); d.reload(); } catch (e) { toast.error(errorMessage(e)); } };
  const totalSolved = new Set(d.data.history.map((h) => h.slug)).size;
  return (
    <div className="space-y-6">
      <PageHeader back={{ href: '/manage/students', label: 'Students' }} title={<span className="flex items-center gap-3">{s.fullName}<StatusBadge status={s.status} /></span>}
        subtitle={`${s.rollNumber} · ${s.college ?? 'No college'} · registered ${fmtDate(s.createdAt)}`}
        actions={isAdmin(user) && (s.status === 'ACTIVE'
          ? <Button variant="danger" onClick={async () => { if (await confirm({ title: `Suspend ${s.fullName}?`, body: 'They are signed out and cannot use Algora until reactivated.', confirmLabel: 'Suspend', danger: true })) run(() => api(`/students/${s._id}/status`, { method: 'PATCH', body: { status: 'SUSPENDED' } }), 'Student suspended'); }}>Suspend</Button>
          : <Button onClick={() => run(() => api(`/students/${s._id}/status`, { method: 'PATCH', body: { status: 'ACTIVE' } }), 'Student reactivated')}>Reactivate</Button>)} />
      <Grid>
        <StatCard label="Verified problems" value={totalSolved} hint="Across all courses, counted once" />
        <StatCard label="Batches" value={d.data.enrollments.filter((e) => e.status === 'ACTIVE').length} />
        <StatCard label="Last successful sync" value={timeAgo(s.sync?.lastSuccessAt)} hint={<StatusBadge status={s.sync?.status ?? 'IDLE'} />} />
        <StatCard label="LeetCode account" value={link.current?.username ?? link.request?.username ?? '—'} hint={<StatusBadge status={link.state} />} />
      </Grid>
      {s.sync?.possibleGap && <Notice tone="warn">The last sync returned a full submission window. Some accepted submissions between syncs may not have been captured.</Notice>}
      <Card title="LeetCode account ownership" actions={<>
        {link.state === 'VERIFIED' && <Button size="sm" variant="secondary" onClick={async () => { if (await confirm({ title: 'Require revalidation?', body: 'Their evidence stops counting until they prove ownership again.', confirmLabel: 'Require revalidation' })) run(() => api(`/students/${s._id}/leetcode/revalidate`, { method: 'POST' }), 'Revalidation required'); }}>Require revalidation</Button>}
        {isAdmin(user) && link.state !== 'UNLINKED' && link.state !== 'REVOKED' && <Button size="sm" variant="danger" onClick={() => setRevoke(true)}>Revoke link</Button>}
      </>}>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">State</dt><dd><StatusBadge status={link.state} /></dd></div>
          <div><dt className="text-slate-500">Verified account</dt><dd>{link.current ? `${link.current.username} (since ${fmtDate(link.current.verifiedAt)})` : '—'}</dd></div>
          <div><dt className="text-slate-500">Open request</dt><dd>{link.request ? `${link.request.username} · ${link.request.kind.toLowerCase()} · ${timeAgo(link.request.requestedAt)}` : '—'}</dd></div>
        </dl>
      </Card>
      <Card title="Progress by course">
        <DataTable rows={d.data.contexts} rowKey={(r) => r.batchCourseId} empty={<EmptyState title="No active courses" />} columns={[
          { key: 'b', header: 'Batch', cell: (r) => r.batch }, { key: 'c', header: 'Course', cell: (r) => r.course },
          { key: 's', header: 'Solved', cell: (r) => `${r.solved} / ${r.accessible}` }, { key: 'd', header: 'E / M / H', cell: (r) => `${r.easy} / ${r.medium} / ${r.hard}` },
          { key: 'p', header: 'Points', cell: (r) => r.points }, { key: 'r', header: 'Rank', cell: (r) => `#${r.rank}` },
          { key: 'pct', header: 'Completion', className: 'min-w-40', cell: (r) => <ProgressBar value={r.completionPct} size="sm" /> },
        ]} />
      </Card>
      <Card title="Verified problems">
        <DataTable rows={d.data.history} rowKey={(h) => h.slug} empty={<EmptyState title="No verified problems" body="Problems appear after a successful sync of a verified LeetCode account." />} columns={[
          { key: 't', header: 'Problem', cell: (h) => <a className="text-indigo-700 hover:underline" href={`https://leetcode.com/problems/${h.slug}/`} target="_blank" rel="noopener noreferrer">{h.title ?? h.slug}</a> },
          { key: 'e', header: 'Earliest observed accepted', cell: (h) => fmtDateTime(h.earliestObservedSolvedAt) },
          { key: 'l', header: 'Latest observed accepted', cell: (h) => fmtDateTime(h.latestObservedSolvedAt) },
          { key: 'v', header: 'First verified by Algora', cell: (h) => fmtDateTime(h.firstVerifiedAt) },
        ]} />
        <p className="mt-2 text-xs text-slate-500">“Observed” times are the accepted submissions Algora has seen; earlier solves outside LeetCode&apos;s recent window cannot be seen.</p>
      </Card>
      <Card title="Enrollments">
        <ul className="divide-y divide-slate-100 text-sm">{d.data.enrollments.map((e) => <li key={e.batchId} className="flex justify-between py-1.5"><span>{e.batch ?? 'Batch'}</span><span className="flex items-center gap-2 text-slate-500">{fmtDate(e.enrolledAt)}<StatusBadge status={e.status} /></span></li>)}</ul>
      </Card>
      <Modal open={revoke} onClose={() => setRevoke(false)} title="Revoke LeetCode link" footer={<><Button variant="secondary" onClick={() => setRevoke(false)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={() => run(() => api(`/students/${s._id}/leetcode/revoke`, { method: 'POST', body: { reason } }), 'Link revoked').then(() => setRevoke(false))}>Revoke</Button></>}>
        <p className="text-sm text-slate-600">Evidence from this account stops counting. It is kept for audit. The student can link and verify an account again.</p>
        <Textarea label="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </Modal>
    </div>
  );
}
