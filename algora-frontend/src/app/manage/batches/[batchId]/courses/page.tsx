'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, DataTable, EmptyState, ErrorState, fmtDate, InlineSelect, Notice, StatusBadge, TableSkeleton, useConfirm, useToast } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';
import type { Course, Paged } from '@/components/manage/types';

interface BC { _id: string; status: string; assignedAt: string; courseId: { _id: string; title: string; status: string } }
export default function Page() {
  const { batch, reload } = useBatch();
  const bcs = useApi<{ items: BC[] }>(`/batches/${batch._id}/courses`);
  const courses = useApi<Paged<Course>>('/courses?status=PUBLISHED&pageSize=100');
  const [pick, setPick] = useState(''); const [busy, setBusy] = useState(false);
  const toast = useToast(); const confirm = useConfirm();
  const ro = batch.status === 'ARCHIVED';
  const assigned = new Set((bcs.data?.items ?? []).filter((b) => b.status === 'ACTIVE').map((b) => b.courseId._id));
  async function run(fn: () => Promise<unknown>, ok: string) { setBusy(true); try { await fn(); toast.success(ok); await Promise.all([bcs.reload(), reload()]); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }
  return (
    <div className="space-y-4">
      <Notice tone="info">Assigning a course makes it available to every enrolled student. All of its chapters stay hidden until you unlock them in Chapter visibility. Deactivating keeps all progress.</Notice>
      {!ro && <Card title="Assign a course">
        <div className="flex flex-wrap items-end gap-2">
          <InlineSelect label="Course to assign" value={pick} onChange={setPick} options={[{ value: '', label: courses.data ? 'Select a published course…' : 'Loading…' }, ...(courses.data?.items ?? []).filter((c) => !assigned.has(c._id)).map((c) => ({ value: c._id, label: `${c.title} (${c.chapterCount} chapters)` }))]} />
          <Button disabled={!pick} loading={busy} onClick={() => run(() => api(`/batches/${batch._id}/courses`, { method: 'POST', body: { courseId: pick } }), 'Course assigned').then(() => setPick(''))}>Assign</Button>
        </div>
      </Card>}
      <Card title="Assigned courses">
        {bcs.error ? <ErrorState message={bcs.error} retry={bcs.reload} /> : !bcs.data ? <TableSkeleton /> : (
          <DataTable rows={bcs.data.items} rowKey={(b) => b._id} empty={<EmptyState title="No courses assigned" body="This batch has no courses yet. Students enrolled now will get access automatically when you assign one." />} columns={[
            { key: 't', header: 'Course', cell: (b) => <Link className="font-medium text-indigo-700 hover:underline" href={`/manage/courses/${b.courseId._id}`}>{b.courseId.title}</Link> },
            { key: 'cs', header: 'Course status', cell: (b) => <StatusBadge status={b.courseId.status} /> },
            { key: 'a', header: 'Assigned', cell: (b) => fmtDate(b.assignedAt) },
            { key: 's', header: 'In this batch', cell: (b) => <StatusBadge status={b.status} /> },
            { key: 'x', header: '', className: 'text-right', cell: (b) => !ro && (b.status === 'ACTIVE'
              ? <Button size="sm" variant="secondary" onClick={async () => { if (await confirm({ title: `Deactivate ${b.courseId.title}?`, body: 'Students lose access now. Verified progress and chapter visibility are kept and come back if you reactivate.', confirmLabel: 'Deactivate', danger: true })) run(() => api(`/batches/${batch._id}/courses/${b.courseId._id}`, { method: 'PATCH', body: { status: 'INACTIVE' } }), 'Course deactivated'); }}>Deactivate</Button>
              : <Button size="sm" onClick={() => run(() => api(`/batches/${batch._id}/courses`, { method: 'POST', body: { courseId: b.courseId._id } }), 'Course reactivated')}>Reactivate</Button>) },
          ]} />
        )}
      </Card>
    </div>
  );
}
