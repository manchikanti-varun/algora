'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ButtonLink, Card, DataTable, EmptyState, ErrorState, fmtDate, InlineSelect, PageHeader, Pagination, SearchInput, StatusBadge, TableSkeleton } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { qs } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import type { Batch, Paged } from '@/components/manage/types';

const STATUSES = [{ value: '', label: 'All statuses' }, ...['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))];

export default function Page() {
  const { user } = useAuth();
  const router = useRouter();
  const [f, set] = useUrlState({ q: '', status: '', page: '1' });
  const [qInput, setQInput] = useState(f.q);
  const dq = useDebounced(qInput);
  useEffect(() => { if (dq !== f.q) set({ q: dq, page: '1' }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = Math.max(1, Number(f.page) || 1);
  const list = useApi<Paged<Batch>>(`/batches${qs({ q: f.q, status: f.status, page })}`);
  const filtered = !!(f.q || f.status);
  return (
    <div>
      <PageHeader title="Batches" subtitle={isAdmin(user) ? 'All batches on the platform' : 'Batches you are assigned to'} actions={<ButtonLink href="/manage/batches/new">New batch</ButtonLink>} />
      <Card flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <SearchInput value={qInput} onChange={setQInput} placeholder="Search batches" label="Search batches" />
          <InlineSelect label="Status" value={f.status} onChange={(v) => set({ status: v, page: '1' })} options={STATUSES} />
        </div>
        {list.error ? <ErrorState message={list.error} retry={list.reload} /> : !list.data ? <div className="p-4"><TableSkeleton /></div> : (
          <>
            <DataTable rows={list.data.items} rowKey={(b) => b._id} onRowClick={(b) => router.push(`/manage/batches/${b._id}`)}
              empty={filtered
                ? <EmptyState title="No matching batches" body="Try a different search or status." />
                : <EmptyState title="No batches yet" body="Create a batch first. You can assign courses and enroll students afterwards." action={<ButtonLink href="/manage/batches/new">New batch</ButtonLink>} />}
              columns={[
                { key: 'n', header: 'Batch', cell: (b) => <><Link className="font-medium text-fg hover:text-accent-fg hover:underline" href={`/manage/batches/${b._id}`}>{b.name}</Link>{b.college && <span className="block text-xs text-fg-subtle">{b.college}</span>}</> },
                { key: 'st', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
                { key: 'd', header: 'Dates', optional: true, cell: (b) => b.startDate ? `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}` : '—' },
                { key: 's', header: 'Students', cell: (b) => <span className="tabular-nums">{b.studentCount ?? 0}{b.pendingCount ? <span className="ml-1 text-xs text-fg-subtle">· {b.pendingCount} reserved</span> : null}</span> },
                { key: 'co', header: 'Courses', optional: true, cell: (b) => <span className="tabular-nums">{b.courseCount ?? 0}</span> },
              ]} />
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Card>
    </div>
  );
}
