'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ButtonLink, Card, DataTable, EmptyState, ErrorState, fmtDate, InlineSelect, PageHeader, Pagination, SearchInput, StatusBadge, TableSkeleton } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import type { Batch, Paged } from '@/components/manage/types';

export default function Page() {
  const { user } = useAuth();
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useApi<Paged<Batch>>(`/batches${qs({ q: dq, status, page })}`);
  return (
    <div>
      <PageHeader title="Batches" subtitle={isAdmin(user) ? 'All batches on the platform' : 'Batches you are assigned to'} actions={<ButtonLink href="/manage/batches/new">New batch</ButtonLink>} />
      <Card title={<div className="flex flex-wrap gap-2"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search batches" />
        <InlineSelect label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'All statuses' }, ...['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))]} /></div>}>
        {list.error ? <ErrorState message={list.error} retry={list.reload} /> : !list.data ? <TableSkeleton /> : (
          <>
            <DataTable rows={list.data.items} rowKey={(b) => b._id} empty={<EmptyState title="No batches" body="A batch can be created without any course; assign courses later." action={<ButtonLink href="/manage/batches/new">Create batch</ButtonLink>} />} columns={[
              { key: 'n', header: 'Batch', cell: (b) => <Link className="font-medium text-indigo-700 hover:underline" href={`/manage/batches/${b._id}`}>{b.name}</Link> },
              { key: 'c', header: 'College', cell: (b) => b.college ?? '—' },
              { key: 'd', header: 'Dates', cell: (b) => b.startDate ? `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}` : '—' },
              { key: 's', header: 'Students', cell: (b) => <>{b.studentCount}{b.pendingCount ? <span className="ml-1 text-xs text-amber-700">+{b.pendingCount} pending</span> : null}</> },
              { key: 'co', header: 'Courses', cell: (b) => b.courseCount },
              { key: 'st', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
            ]} />
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
