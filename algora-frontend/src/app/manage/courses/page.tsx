'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ButtonLink, Card, DataTable, EmptyState, ErrorState, fmtDate, InlineSelect, PageHeader, Pagination, SearchInput, StatusBadge, TableSkeleton } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Course, Paged } from '@/components/manage/types';

export default function Page() {
  const { user } = useAuth();
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useApi<Paged<Course>>(`/courses${qs({ q: dq, status, page })}`);
  return (
    <div>
      <PageHeader title="Courses" subtitle="Reusable course content. Assign a course to any number of batches; chapters are unlocked per batch."
        actions={user?.canManageCourses && <ButtonLink href="/manage/courses/new">New course</ButtonLink>} />
      <Card title={<div className="flex flex-wrap gap-2"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search courses" />
        {user?.canManageCourses && <InlineSelect label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'All statuses' }, { value: 'DRAFT', label: 'Draft' }, { value: 'PUBLISHED', label: 'Published' }, { value: 'ARCHIVED', label: 'Archived' }]} />}</div>}>
        {list.error ? <ErrorState message={list.error} retry={list.reload} /> : !list.data ? <TableSkeleton /> : (
          <>
            <DataTable rows={list.data.items} rowKey={(c) => c._id}
              empty={<EmptyState title="No courses yet" body={user?.canManageCourses ? 'Create a course, add chapters and LeetCode problems, then publish it.' : 'Published courses appear here.'} action={user?.canManageCourses && <ButtonLink href="/manage/courses/new">Create course</ButtonLink>} />}
              columns={[
                { key: 't', header: 'Course', cell: (c) => <Link className="font-medium text-indigo-700 hover:underline" href={`/manage/courses/${c._id}`}>{c.title}</Link> },
                { key: 'ch', header: 'Chapters', cell: (c) => c.chapterCount }, { key: 'p', header: 'Problems', cell: (c) => c.problemCount },
                { key: 'b', header: 'Batches', cell: (c) => c.batchCount }, { key: 'd', header: 'Created', cell: (c) => fmtDate(c.createdAt) },
                { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
              ]} />
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
