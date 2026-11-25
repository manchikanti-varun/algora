'use client';
import { useState } from 'react';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, fmtDate, Modal, PageHeader, Pagination, StatusBadge, TableSkeleton, Tabs, Textarea, timeAgo, useConfirm, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage, qs } from '@/lib/api';
import type { Paged } from '@/components/manage/types';

interface Req { _id: string; fullName: string; email: string; status: string; note?: string; college?: string; phone?: string; createdAt: string; rejectionReason?: string }
interface Trainer { _id: string; fullName: string; email: string; trainerId: string; status: string; canManageCourses: boolean; lastLoginAt?: string; createdAt: string }

export default function Page() {
  const [tab, setTab] = useState('requests');
  const [status, setStatus] = useState('PENDING_APPROVAL');
  const [page, setPage] = useState(1); const [tpage, setTpage] = useState(1);
  const reqs = useApi<Paged<Req>>(`/trainer-requests${qs({ status, page })}`);
  const trainers = useApi<Paged<Trainer>>(`/trainers${qs({ page: tpage })}`);
  const toast = useToast(); const confirm = useConfirm();
  const [reject, setReject] = useState<Req | null>(null); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); toast.success(ok); await Promise.all([reqs.reload(), trainers.reload()]); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }
  return (
    <div>
      <PageHeader title="Trainers" subtitle="Approve access requests and manage trainer accounts. Approval is one-time; suspension signs the trainer out everywhere." />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'requests', label: `Access requests${reqs.data && status === 'PENDING_APPROVAL' ? ` (${reqs.data.total})` : ''}` }, { key: 'trainers', label: 'Trainers' }]} />
      {tab === 'requests' && (
        <Card title="Access requests" actions={<select aria-label="Request status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg px-2 py-1 text-sm ring-1 ring-slate-300"><option value="PENDING_APPROVAL">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select>}>
          {reqs.error ? <ErrorState message={reqs.error} retry={reqs.reload} /> : !reqs.data ? <TableSkeleton /> : (
            <>
              <DataTable rows={reqs.data.items} rowKey={(r) => r._id} empty={<EmptyState title="No requests" body={status === 'PENDING_APPROVAL' ? 'New trainer requests appear here.' : undefined} />} columns={[
                { key: 'name', header: 'Name', cell: (r) => <div><p className="font-medium">{r.fullName}</p><p className="text-xs text-slate-500">{r.email}</p></div> },
                { key: 'org', header: 'Organisation', cell: (r) => r.college ?? '—' },
                { key: 'note', header: 'Note', cell: (r) => <span className="block max-w-xs truncate" title={r.note}>{r.note ?? '—'}</span> },
                { key: 'when', header: 'Requested', cell: (r) => timeAgo(r.createdAt) },
                { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { key: 'act', header: '', className: 'text-right', cell: (r) => r.status === 'PENDING_APPROVAL' && (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" loading={busy === `a${r._id}`} onClick={async () => { if (await confirm({ title: `Approve ${r.fullName}?`, body: 'They get management access and a unique Trainer ID. You can suspend them later.', confirmLabel: 'Approve' })) act(`a${r._id}`, () => api(`/trainer-requests/${r._id}/approve`, { method: 'PATCH' }), `${r.fullName} approved`); }}>Approve</Button>
                    <Button size="sm" variant="secondary" onClick={() => { setReject(r); setReason(''); }}>Reject</Button>
                  </div>) },
              ]} />
              <Pagination page={page} pageSize={reqs.data.pageSize} total={reqs.data.total} onPage={setPage} />
            </>
          )}
        </Card>
      )}
      {tab === 'trainers' && (
        <Card title="Approved trainers">
          {trainers.error ? <ErrorState message={trainers.error} retry={trainers.reload} /> : !trainers.data ? <TableSkeleton /> : (
            <>
              <DataTable rows={trainers.data.items} rowKey={(t) => t._id} empty={<EmptyState title="No trainers yet" />} columns={[
                { key: 'name', header: 'Trainer', cell: (t) => <div><p className="font-medium">{t.fullName}</p><p className="text-xs text-slate-500">{t.email}</p></div> },
                { key: 'id', header: 'Trainer ID', cell: (t) => <code className="text-xs">{t.trainerId}</code> },
                { key: 'perm', header: 'Course editing', cell: (t) => (
                  <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={t.canManageCourses} disabled={busy === `p${t._id}`}
                    onChange={(e) => act(`p${t._id}`, () => api(`/trainers/${t._id}/permissions`, { method: 'PATCH', body: { canManageCourses: e.target.checked } }), 'Permission updated')} />{t.canManageCourses ? <Badge tone="indigo">Allowed</Badge> : <span className="text-slate-500">No</span>}</label>) },
                { key: 'last', header: 'Last sign-in', cell: (t) => timeAgo(t.lastLoginAt) },
                { key: 'since', header: 'Approved', cell: (t) => fmtDate(t.createdAt) },
                { key: 'status', header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
                { key: 'act', header: '', className: 'text-right', cell: (t) => t.status === 'ACTIVE'
                  ? <Button size="sm" variant="danger" loading={busy === `s${t._id}`} onClick={async () => { if (await confirm({ title: `Suspend ${t.fullName}?`, body: 'They are signed out immediately and cannot access the management portal until reactivated.', confirmLabel: 'Suspend', danger: true })) act(`s${t._id}`, () => api(`/trainers/${t._id}/suspend`, { method: 'PATCH' }), 'Trainer suspended'); }}>Suspend</Button>
                  : <Button size="sm" variant="secondary" loading={busy === `s${t._id}`} onClick={() => act(`s${t._id}`, () => api(`/trainers/${t._id}/reactivate`, { method: 'PATCH' }), 'Trainer reactivated')}>Reactivate</Button> },
              ]} />
              <Pagination page={tpage} pageSize={trainers.data.pageSize} total={trainers.data.total} onPage={setTpage} />
            </>
          )}
        </Card>
      )}
      <Modal open={!!reject} onClose={() => setReject(null)} title={`Reject ${reject?.fullName ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" loading={busy === 'reject'} onClick={() => act('reject', () => api(`/trainer-requests/${reject!._id}/reject`, { method: 'PATCH', body: { reason: reason || undefined } }), 'Request rejected').then(() => setReject(null))}>Reject request</Button></>}>
        <Textarea label="Reason (shown to the applicant)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Modal>
    </div>
  );
}
