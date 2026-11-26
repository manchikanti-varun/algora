'use client';
import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, Combobox, DataTable, EmptyState, ErrorState, FilterChips, InlineSelect, PageHeader, Pagination, Popover, SearchInput, StatusBadge, TableSkeleton, timeAgo } from '@/components/ui';
import { useDebouncedUrlText } from '@/components/manage/Filters';
import type { Paged } from '@/components/manage/types';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { qs } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import { loadBatches, loadColleges } from '@/lib/options';
import { useState } from 'react';

interface Row { _id: string; fullName: string; rollNumber: string; college: string | null; status: string; syncStatus: string; lastSyncAt: string | null; possibleGap?: boolean; syncError?: string | null; syncDetail?: string | null; link: { status: string; username: string } | null; batches: number }

const ISSUES = [
  { value: '', label: 'Needs attention: any' },
  { value: 'MISSING_USERNAME', label: 'No LeetCode username' },
  { value: 'SYNC_FAILURE', label: 'Progress updates failing' },
  { value: 'POSSIBLE_GAP', label: 'Incomplete submission history' },
  { value: 'NO_SUBMISSIONS', label: 'No accepted submissions' },
  { value: 'SUBMISSIONS_UNAVAILABLE', label: 'Submissions not visible' },
  { value: 'ACCOUNT_NOT_FOUND', label: 'Username not found' },
];

export default function Page() {
  const { user } = useAuth();
  const router = useRouter();
  const [f, set] = useUrlState({ q: '', batchId: '', collegeId: '', issue: '', page: '1' });
  const [names, setNames] = useState<Record<string, string>>({});
  const [text, setText] = useDebouncedUrlText(f.q, (q) => set({ q, page: '' }));
  const page = Math.max(1, Number(f.page) || 1);
  const list = useApi<Paged<Row>>(`/students${qs({ q: f.q, batchId: f.batchId, collegeId: f.collegeId, issue: f.issue, page })}`);
  const filtered = !!(f.q || f.batchId || f.collegeId || f.issue);
  const clear = () => set({ q: '', batchId: '', collegeId: '', issue: '', page: '' });
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (f.collegeId) chips.push({ key: 'college', label: `College: ${names[f.collegeId] ?? 'Selected college'}`, onRemove: () => set({ collegeId: '', page: '' }) });

  const toolbar = (
    <>
      <SearchInput value={text} onChange={setText} placeholder="Name or roll number" label="Name or roll number" />
      <Combobox label="Batch" value={f.batchId} onChange={(batchId) => set({ batchId, page: '' })} load={loadBatches} emptyLabel="All batches" />
      <InlineSelect label="Needs attention" value={f.issue} onChange={(issue) => set({ issue, page: '' })} options={ISSUES} />
      <Popover label="More filters" align="start" button={<><SlidersHorizontal size={15} aria-hidden />More filters{f.collegeId && <span className="rounded-full bg-accent-soft px-1.5 text-xs text-accent-fg">1</span>}</>}>
        <Combobox label="College" labelHidden={false} value={f.collegeId} onChange={(collegeId, o) => { if (o) setNames((n) => ({ ...n, [o.value]: o.label })); set({ collegeId, page: '' }); }} load={loadColleges} emptyLabel="All colleges" />
      </Popover>
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Students" subtitle={isAdmin(user) ? 'All registered students.' : 'Students in your batches.'} />
      {chips.length > 0 && <FilterChips chips={chips} onClear={clear} />}
      <Card flush>
        {list.error ? <div className="p-4"><ErrorState message={list.error} retry={list.reload} /></div> : (
          <>
            <DataTable
              toolbar={toolbar} columnsKey="students" caption="Students" rows={list.data?.items ?? []} rowKey={(r) => r._id}
              onRowClick={(r) => router.push(`/manage/students/${r._id}`)}
              empty={!list.data ? <TableSkeleton /> : (
                <EmptyState title={filtered ? 'No students match these filters' : 'No students yet'}
                  body={filtered ? undefined : 'Students appear here after they register and are enrolled in a batch.'}
                  action={filtered ? <Button variant="secondary" size="sm" onClick={clear}>Clear filters</Button> : undefined} />
              )}
              columns={[
                { key: 'student', header: 'Student', cell: (r) => <div><Link className="font-medium text-accent-fg hover:underline" href={`/manage/students/${r._id}`}>{r.fullName}</Link><p className="text-xs text-fg-subtle">{r.rollNumber}</p></div> },
                { key: 'college', header: 'College', optional: true, cell: (r) => r.college ?? '—' },
                { key: 'batches', header: 'Batches', optional: true, align: 'right', cell: (r) => <span className="tabular-nums">{r.batches}</span> },
                { key: 'leetcode', header: 'LeetCode', cell: (r) => r.link ? <span className="inline-flex items-center gap-2">{r.link.username}<StatusBadge status={r.link.status} /></span> : <StatusBadge status="UNLINKED" /> },
                { key: 'update', header: 'Last update', cell: (r) => (
                  <span className="inline-flex items-center gap-2" title={r.syncDetail ?? r.syncError ?? undefined}>
                    <StatusBadge status={r.syncStatus} /><span className="text-xs text-fg-subtle">{timeAgo(r.lastSyncAt)}</span>
                    {r.possibleGap && <Badge tone="warning">Incomplete history</Badge>}
                  </span>) },
                { key: 'account', header: 'Account', cell: (r) => r.status === 'ACTIVE' ? null : <StatusBadge status={r.status} /> },
              ]}
            />
            {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set({ page: String(p) })} />}
          </>
        )}
      </Card>
    </div>
  );
}
