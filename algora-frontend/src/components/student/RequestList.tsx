'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage, qs } from '@/lib/api';
import { Button, Card, DataTable, EmptyState, ErrorState, fmtDate, Pagination, StatusBadge, TableSkeleton, useConfirm, useToast } from '@/components/ui';
import type { Paged } from '@/components/manage/types';

type Fields = Partial<Record<'firstName' | 'lastName' | 'mobile' | 'username', string>>;
interface ChangeRequest {
  _id: string;
  kind: 'PROFILE' | 'LEETCODE';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  studentId?: { fullName: string; rollNumber: string };
  current?: Fields;
  requested?: Fields;
}

const labels = { firstName: 'First name', lastName: 'Last name', mobile: 'Mobile', username: 'LeetCode' } as const;
const statuses = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
type Status = (typeof statuses)[number];

function Changes({ request }: { request: ChangeRequest }) {
  if (!request.requested) return <span className="text-fg-muted">Details removed</span>;
  return (
    <dl className="space-y-1">
      {(Object.keys(labels) as (keyof Fields)[]).filter((key) => request.requested?.[key] !== undefined).map((key) => (
        <div key={key} className="min-w-40">
          <dt className="text-xs font-medium text-fg-muted">{labels[key]}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-fg-muted"><span className="sr-only">Current: </span>{request.current?.[key] ?? 'None'}</span>
            <span aria-hidden>→</span>
            <strong><span className="sr-only">Requested: </span>{request.requested?.[key]}</strong>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function RequestList({ management = false, version = 0 }: { management?: boolean; version?: number }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<Status | ''>(management ? 'PENDING' : '');
  const [busy, setBusy] = useState<string | null>(null);
  const endpoint = management ? '/student-requests' : '/student/requests';
  const list = useApi<Paged<ChangeRequest>>(`${endpoint}${qs({ page, status, v: version })}`);
  const confirm = useConfirm();
  const toast = useToast();

  async function act(item: ChangeRequest, decision: 'APPROVED' | 'REJECTED' | 'CANCELLED') {
    const label = { APPROVED: 'Approve', REJECTED: 'Reject', CANCELLED: 'Cancel request' }[decision];
    if (!(await confirm({
      title: decision === 'CANCELLED' ? 'Cancel this request?' : `${label} this request?`,
      body: decision === 'APPROVED' ? 'The requested changes will take effect immediately.' : 'The current account information will stay in effect.',
      confirmLabel: label,
    }))) return;
    setBusy(item._id);
    try {
      await api(`${endpoint}/${item._id}/${management ? 'review' : 'cancel'}`, { method: 'POST', body: management ? { status: decision } : undefined });
      toast.success(`Request ${decision.toLowerCase()}`);
      if (page > 1 && list.data?.items.length === 1) setPage(page - 1);
      else await list.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card id={management ? undefined : 'my-requests'} title={management ? undefined : 'My requests'} className="scroll-mt-20" flush>
      {management && <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <label htmlFor="request-status" className="font-medium">Status</label>
        <select id="request-status" className="rounded-lg border border-line bg-surface px-3 py-2" value={status}
          onChange={(event) => { setPage(1); setStatus(event.target.value as Status | ''); }}>
          <option value="">All statuses</option>
          {statuses.map((item) => <option key={item} value={item}>{item[0] + item.slice(1).toLowerCase()}</option>)}
        </select>
      </div>}
      {list.error ? <ErrorState message={list.error} retry={list.reload} /> : !list.data ? <TableSkeleton /> : <>
        <DataTable rows={list.data.items} rowKey={(item) => item._id} caption={management ? 'Student requests' : 'My requests'}
          empty={<EmptyState compact icon={Inbox} title={management ? 'No requests match this status' : 'No requests yet'} />}
          columns={[
            { key: 'kind', header: 'Request', cell: (item) => <><div className="font-medium">{item.kind === 'PROFILE' ? 'Personal information' : 'LeetCode account'}</div><div className="text-xs text-fg-muted">{fmtDate(item.createdAt)}</div></> },
            ...(management ? [{ key: 'student', header: 'Student', cell: (item: ChangeRequest) => <><div>{item.studentId?.fullName ?? 'Student'}</div><div className="text-xs text-fg-muted">{item.studentId?.rollNumber}</div></> }] : []),
            { key: 'change', header: 'Current → requested', cell: (item) => <Changes request={item} /> },
            { key: 'status', header: 'Status', cell: (item) => <StatusBadge status={item.status} /> },
            { key: 'actions', header: 'Actions', cell: (item) => item.status === 'PENDING' && <div className="flex flex-wrap gap-2">
              {management ? <>
                <Button size="sm" disabled={!!busy} onClick={() => void act(item, 'APPROVED')}>Approve</Button>
                <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void act(item, 'REJECTED')}>Reject</Button>
              </> : <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void act(item, 'CANCELLED')}>Cancel request</Button>}
            </div> },
          ]} />
        <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      </>}
    </Card>
  );
}
