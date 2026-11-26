'use client';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ButtonLink, Card, DataTable, EmptyState, ErrorState, fmtDate, InlineSelect, PageHeader, Pagination, SearchInput, StatusBadge, TableSkeleton } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Course, Paged } from '@/components/manage/types';
export default function Page() {
  const { user } = useAuth();
  const router = useRouter();
  const can = !!user?.canManageCourses;
  const [f, set] = useUrlState({ q: '', status: '', page: '1' });
  const page = Math.max(1, Number(f.page) || 1);
  const dq = useDebounced(f.q);
  const list = useApi<Paged<Course>>(`/courses${qs({ q: dq, status: can ? f.status : '', page })}`);
  const filtered = !!(f.q || f.status);
  const newCourse = can ? <ButtonLink href="/manage/courses/new" icon={<Plus size={16} aria-hidden />}>New course</ButtonLink> : null;
  return (
    <div>
      <PageHeader title="Courses" subtitle="Reusable course content. Add a course to any batch; chapter access is set per batch." actions={newCourse} />
      <Card flush>
        <DataTable rows={list.data?.items ?? []} rowKey={(c) => c._id} caption="Courses" columnsKey="courses"
          onRowClick={(c) => router.push(`/manage/courses/${c._id}`)}
          toolbar={<>
            <SearchInput value={f.q} onChange={(v) => set({ q: v, page: '' })} placeholder="Search courses" label="Search courses" />
            {can && <InlineSelect label="Status" value={f.status} onChange={(v) => set({ status: v, page: '' })}
              options={[{ value: '', label: 'All statuses' }, { value: 'DRAFT', label: 'Draft' }, { value: 'PUBLISHED', label: 'Published' }, { value: 'ARCHIVED', label: 'Archived' }]} />}
          </>}
          empty={list.error ? <div className="p-4"><ErrorState message={list.error} retry={list.reload} /></div>
            : !list.data ? <TableSkeleton />
              : <EmptyState title={filtered ? 'No courses match your filters' : 'No courses yet'}
                body={filtered ? 'Try a different search or status.' : can ? 'Create a course, add chapters and LeetCode problems, then publish it.' : 'Published courses appear here.'}
                action={filtered ? undefined : newCourse} />}
          columns={[
            { key: 't', header: 'Course', cell: (c) => <div className="min-w-0 max-w-sm">
              <Link className="font-medium text-accent-fg hover:underline" href={`/manage/courses/${c._id}`}>{c.title}</Link>
              {c.description && <p className="truncate text-[13px] text-fg-muted">{c.description}</p>}
            </div> },
            { key: 'ch', header: 'Chapters', cell: (c) => <span className="tabular-nums">{c.chapterCount ?? 0}</span> },
            { key: 'p', header: 'Problems', cell: (c) => <span className="tabular-nums">{c.problemCount ?? 0}</span> },
            { key: 'b', header: 'Batches', cell: (c) => <span className="tabular-nums">{c.batchCount ?? 0}</span> },
            { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
            { key: 'd', header: 'Created', optional: true, defaultHidden: true, cell: (c) => c.createdAt ? fmtDate(c.createdAt) : '—' },
          ]} />
        {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set({ page: String(p) })} />}
      </Card>
    </div>
  );
}
