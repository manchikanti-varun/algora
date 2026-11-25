'use client';
import { useState } from 'react';
import { Card, DataTable, EmptyState, ErrorState, fmtDateTime, PageHeader, Pagination, SearchInput, TableSkeleton } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import type { Paged } from '@/components/manage/types';

interface Log { _id: string; action: string; targetType?: string; targetId?: string; metadata?: unknown; ip?: string; createdAt: string; actorId?: { fullName: string; role: string } | null; actorRole?: string }
export default function Page() {
  const [action, setAction] = useState(''); const [page, setPage] = useState(1);
  const da = useDebounced(action);
  const logs = useApi<Paged<Log>>(`/audit-logs${qs({ action: da, page, pageSize: 50 })}`);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Security-relevant actions: approvals, suspensions, enrollment, visibility, scoring, exports and sign-ins." />
      <Card title={<SearchInput value={action} onChange={(v) => { setAction(v); setPage(1); }} placeholder="Action prefix, e.g. trainer." label="Filter by action" />}>
        {logs.error ? <ErrorState message={logs.error} retry={logs.reload} /> : !logs.data ? <TableSkeleton rows={10} /> : (
          <>
            <DataTable rows={logs.data.items} rowKey={(l) => l._id} empty={<EmptyState title="No entries" />} columns={[
              { key: 't', header: 'When', cell: (l) => fmtDateTime(l.createdAt) },
              { key: 'a', header: 'Action', cell: (l) => <code className="text-xs">{l.action}</code> },
              { key: 'u', header: 'Actor', cell: (l) => l.actorId ? `${l.actorId.fullName} (${l.actorId.role.toLowerCase().replace('_', ' ')})` : l.actorRole ?? 'anonymous' },
              { key: 'g', header: 'Target', cell: (l) => l.targetType ? <span className="text-xs">{l.targetType} <code className="text-slate-500">{l.targetId}</code></span> : '—' },
              { key: 'm', header: 'Details', cell: (l) => <span className="block max-w-sm truncate text-xs text-slate-500" title={JSON.stringify(l.metadata)}>{l.metadata ? JSON.stringify(l.metadata) : ''}</span> },
              { key: 'ip', header: 'IP', cell: (l) => <span className="text-xs text-slate-500">{l.ip}</span> },
            ]} />
            <Pagination page={page} pageSize={logs.data.pageSize} total={logs.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
