'use client';
import { useMemo, useState } from 'react';
import { Button, Card, DataTable, EmptyState, ErrorState, fmtDate, InlineSelect, Modal, PageHeader, Pagination, SearchInput, StatusBadge, Switch, TableSkeleton, Tabs, Textarea, timeAgo, useConfirm, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { api, errorMessage, qs } from '@/lib/api';
import type { Paged } from '@/components/manage/types';
interface Req { _id: string; fullName: string; email: string; status: string; note?: string; college?: string; phone?: string; createdAt: string; rejectionReason?: string }
interface Trainer { _id: string; fullName: string; email: string; trainerId: string; status: string; canManageCourses: boolean; lastLoginAt?: string; createdAt: string }
const PENDING = 'PENDING_APPROVAL';
// The trainers endpoint has no search, so the list is loaded in one large page and filtered in the browser.
const TRAINER_PAGE_SIZE = 100;
export default function Page() {
  const [u, setU] = useUrlState({ tab: 'requests', status: PENDING, page: '1', tpage: '1', q: '' });
  const page = Number(u.page) || 1; const tpage = Number(u.tpage) || 1;
  const reqs = useApi<Paged<Req>>(`/trainer-requests${qs({ status: u.status, page })}`);
  // The pending count in the tab label stays correct while another status is being viewed.
  const pendingOther = useApi<Paged<Req>>(u.status === PENDING ? null : `/trainer-requests${qs({ status: PENDING, pageSize: 1 })}`);
  const pendingCount = u.status === PENDING ? reqs.data?.total : pendingOther.data?.total;
  const trainers = useApi<Paged<Trainer>>(`/trainers${qs({ page: tpage, pageSize: TRAINER_PAGE_SIZE })}`);
  const toast = useToast(); const confirm = useConfirm();
  const [reject, setReject] = useState<Req | null>(null); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); toast.success(ok); await Promise.all([reqs.reload(), trainers.reload(), pendingOther.reload()]); return true; } catch (e) { toast.error(errorMessage(e)); return false; } finally { setBusy(null); }
  }
  const q = u.q.trim().toLowerCase();
  const shown = useMemo(() => (trainers.data?.items ?? []).filter((t) => !q || [t.fullName, t.email, t.trainerId].some((x) => x.toLowerCase().includes(q))), [trainers.data, q]);
  async function setPermission(t: Trainer, allowed: boolean) {
    const ok = await confirm({
      title: allowed ? `Allow ${t.fullName} to edit courses?` : `Stop ${t.fullName} editing courses?`,
      body: allowed ? 'They will be able to create and change courses, chapters and problems.' : 'They will keep access to their batches but can no longer change course content.',
      confirmLabel: allowed ? 'Allow editing' : 'Remove editing',
    });
    if (ok) await act(`p${t._id}`, () => api(`/trainers/${t._id}/permissions`, { method: 'PATCH', body: { canManageCourses: allowed } }), 'Permission updated');
  }
  return (
    <div>
      <PageHeader title="Trainers" subtitle="Approve access requests and manage trainer accounts." />
      <Tabs active={u.tab} onChange={(tab) => setU({ tab })} tabs={[{ key: 'requests', label: 'Access requests', count: pendingCount }, { key: 'trainers', label: 'Trainers' }]} />
      {u.tab === 'requests' && (
        <Card flush title="Access requests" description="Approval is one-time. You can suspend a trainer later."
          actions={<InlineSelect label="Request status" value={u.status} onChange={(status) => setU({ status, page: '1' })}
            options={[{ value: PENDING, label: 'Awaiting approval' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />}>
          {reqs.error ? <ErrorState message={reqs.error} retry={reqs.reload} /> : !reqs.data ? <TableSkeleton /> : (
            <>
              <DataTable rows={reqs.data.items} rowKey={(r) => r._id} caption="Trainer access requests"
                empty={<EmptyState compact title="No requests" body={u.status === PENDING ? 'New trainer requests appear here.' : undefined} />} columns={[
                  { key: 'name', header: 'Applicant', cell: (r) => <div><p className="font-medium">{r.fullName}</p><p className="text-xs text-fg-subtle">{r.email}</p></div> },
                  { key: 'org', header: 'Organisation', cell: (r) => r.college ?? '—' },
                  { key: 'note', header: 'Note', cell: (r) => <span className="block max-w-xs truncate text-fg-muted" title={r.note}>{r.note ?? '—'}</span> },
                  { key: 'when', header: 'Requested', cell: (r) => timeAgo(r.createdAt) },
                  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                  { key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (r) => r.status === PENDING && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" loading={busy === `a${r._id}`} onClick={async () => { if (await confirm({ title: `Approve ${r.fullName}?`, body: 'They get management access and a unique Trainer ID. You can suspend them later.', confirmLabel: 'Approve' })) void act(`a${r._id}`, () => api(`/trainer-requests/${r._id}/approve`, { method: 'PATCH' }), `${r.fullName} approved`); }}>Approve</Button>
                      <Button size="sm" variant="secondary" onClick={() => { setReject(r); setReason(''); }}>Reject</Button>
                    </div>) },
                ]} />
              <Pagination page={page} pageSize={reqs.data.pageSize} total={reqs.data.total} onPage={(p) => setU({ page: String(p) })} />
            </>
          )}
        </Card>
      )}
      {u.tab === 'trainers' && (
        <Card flush title="Approved trainers" description="Suspending a trainer signs them out everywhere."
          actions={<SearchInput value={u.q} onChange={(v) => setU({ q: v })} label="Search trainers" placeholder="Search name, email or ID" />}>
          {trainers.error ? <ErrorState message={trainers.error} retry={trainers.reload} /> : !trainers.data ? <TableSkeleton /> : (
            <>
              <DataTable rows={shown} rowKey={(t) => t._id} caption="Trainers"
                empty={<EmptyState compact title={q ? 'No trainers match your search' : 'No trainers yet'} body={q ? 'Search covers the trainers loaded on this page.' : 'Approved trainers appear here.'} action={q ? <Button variant="secondary" size="sm" onClick={() => setU({ q: '' })}>Clear search</Button> : undefined} />}
                columns={[
                  { key: 'name', header: 'Trainer', cell: (t) => <div><p className="font-medium">{t.fullName}</p><p className="text-xs text-fg-subtle">{t.email}</p></div> },
                  { key: 'id', header: 'Trainer ID', cell: (t) => <span className="font-mono text-xs text-fg-muted">{t.trainerId}</span> },
                  { key: 'perm', header: 'Course editing', cell: (t) => <Switch checked={t.canManageCourses} disabled={busy === `p${t._id}`} label={`${t.fullName} can edit courses`} onChange={(v) => void setPermission(t, v)} /> },
                  { key: 'last', header: 'Last sign-in', cell: (t) => timeAgo(t.lastLoginAt) },
                  { key: 'since', header: 'Approved', cell: (t) => fmtDate(t.createdAt) },
                  { key: 'status', header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
                  { key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (t) => t.status === 'ACTIVE'
                    ? <Button size="sm" variant="danger" loading={busy === `s${t._id}`} onClick={async () => { if (await confirm({ title: `Suspend ${t.fullName}?`, body: 'They are signed out immediately and cannot access the management portal until reactivated.', confirmLabel: 'Suspend', danger: true })) void act(`s${t._id}`, () => api(`/trainers/${t._id}/suspend`, { method: 'PATCH' }), 'Trainer suspended'); }}>Suspend</Button>
                    : <Button size="sm" variant="secondary" loading={busy === `s${t._id}`} onClick={() => void act(`s${t._id}`, () => api(`/trainers/${t._id}/reactivate`, { method: 'PATCH' }), 'Trainer reactivated')}>Reactivate</Button> },
                ]} />
              <Pagination page={tpage} pageSize={trainers.data.pageSize} total={trainers.data.total} onPage={(p) => setU({ tpage: String(p) })} />
            </>
          )}
        </Card>
      )}
      <Modal open={!!reject} onClose={() => setReject(null)} title={`Reject ${reject?.fullName ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" loading={busy === 'reject'} onClick={async () => { if (await act('reject', () => api(`/trainer-requests/${reject!._id}/reject`, { method: 'PATCH', body: { reason: reason || undefined } }), 'Request rejected')) setReject(null); }}>Reject request</Button></>}>
        <Textarea label="Reason (shown to the applicant)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Modal>
    </div>
  );
}
