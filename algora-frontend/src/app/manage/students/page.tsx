'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Card, DataTable, EmptyState, ErrorState, InlineSelect, PageHeader, Pagination, SearchInput, StatusBadge, TableSkeleton, timeAgo } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import type { Batch, Paged } from '@/components/manage/types';

interface Row { _id: string; fullName: string; rollNumber: string; college: string | null; status: string; syncStatus: string; lastSyncAt: string | null; possibleGap?: boolean; syncError?: string | null; syncDetail?: string | null; link: { status: string; username: string } | null; batches: number }
export default function Page() {
  const { user } = useAuth();
  const [q, setQ] = useState(''); const [batchId, setBatchId] = useState(''); const [collegeId, setCollegeId] = useState(''); const [issue, setIssue] = useState(''); const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useApi<Paged<Row>>(`/students${qs({ q: dq, batchId, collegeId, issue, page })}`);
  const batches = useApi<Paged<Batch>>('/batches?pageSize=100');
  const colleges = useApi<Paged<{ _id: string; name: string }>>('/colleges?pageSize=100');
  const reset = () => setPage(1);
  return (
    <div>
      <PageHeader title="Students" subtitle={isAdmin(user) ? 'All registered students' : 'Students enrolled in your batches'} />
      <Card title={<div className="flex flex-wrap gap-2">
        <SearchInput value={q} onChange={(v) => { setQ(v); reset(); }} placeholder="Name or roll number" />
        <InlineSelect label="Batch" value={batchId} onChange={(v) => { setBatchId(v); reset(); }} options={[{ value: '', label: 'All batches' }, ...(batches.data?.items ?? []).map((b) => ({ value: b._id, label: b.name }))]} />
        <InlineSelect label="College" value={collegeId} onChange={(v) => { setCollegeId(v); reset(); }} options={[{ value: '', label: 'All colleges' }, ...(colleges.data?.items ?? []).map((c) => ({ value: c._id, label: c.name }))]} />
        <InlineSelect label="Needs attention" value={issue} onChange={(v) => { setIssue(v); reset(); }} options={[
          { value: '', label: 'Any account state' }, { value: 'MISSING_USERNAME', label: 'No username' }, { value: 'SYNC_FAILURE', label: 'Sync failures' },
          { value: 'POSSIBLE_GAP', label: 'Possible evidence gap' }, { value: 'NO_SUBMISSIONS', label: 'No accepted submissions' },
          { value: 'SUBMISSIONS_UNAVAILABLE', label: 'Submissions not visible' }, { value: 'ACCOUNT_NOT_FOUND', label: 'Username not found' },
        ]} />
      </div>}>
        {list.error ? <ErrorState message={list.error} retry={list.reload} /> : !list.data ? <TableSkeleton /> : (
          <>
            <DataTable rows={list.data.items} rowKey={(r) => r._id} empty={<EmptyState title="No students found" />} columns={[
              { key: 'r', header: 'Roll number', cell: (r) => <code className="text-xs">{r.rollNumber}</code> },
              { key: 'n', header: 'Name', cell: (r) => <Link className="font-medium text-indigo-700 hover:underline" href={`/manage/students/${r._id}`}>{r.fullName}</Link> },
              { key: 'c', header: 'College', cell: (r) => r.college ?? '—' },
              { key: 'b', header: 'Batches', cell: (r) => r.batches },
              { key: 'l', header: 'LeetCode account', cell: (r) => r.link ? <span className="inline-flex items-center gap-2">{r.link.username}<StatusBadge status={r.link.status} /></span> : <StatusBadge status="UNLINKED" /> },
              { key: 's', header: 'Last sync', cell: (r) => <span className="inline-flex items-center gap-2" title={r.syncDetail ?? r.syncError ?? undefined}><StatusBadge status={r.syncStatus} /><span className="text-xs text-slate-500">{timeAgo(r.lastSyncAt)}</span>{r.possibleGap && <span className="text-xs font-medium text-amber-700">gap</span>}</span> },
              { key: 'st', header: 'Account', cell: (r) => <StatusBadge status={r.status} /> },
            ]} />
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
