'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, Combobox, DataTable, EmptyState, ErrorState, fmtDate, StatusBadge, TableSkeleton, useConfirm, usePageTitle, useToast } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';
import { loadPublishedCourses } from '@/lib/options';

interface BC { _id: string; status: string; assignedAt: string; courseId: { _id: string; title: string; status: string } }

export default function Page() {
  const { batch, reload } = useBatch();
  usePageTitle(`Courses · ${batch.name}`);
  const bcs = useApi<{ items: BC[] }>(`/batches/${batch._id}/courses`);
  const [pick, setPick] = useState(''); const [busy, setBusy] = useState(false);
  const toast = useToast(); const confirm = useConfirm();
  const ro = batch.status === 'ARCHIVED';
  const assigned = new Set((bcs.data?.items ?? []).filter((b) => b.status === 'ACTIVE').map((b) => b.courseId._id));
  const already = !!pick && assigned.has(pick);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); await Promise.all([bcs.reload(), reload()]); return true; }
    catch (e) { toast.error(errorMessage(e)); return false; } finally { setBusy(false); }
  }
  return (
    <div className="space-y-6">
      {!ro && (
        <Card title="Assign a course" description="Assigning a course gives every enrolled student access, but all its chapters stay hidden until you make them visible in Chapter Access.">
          <div className="flex flex-wrap items-start gap-2">
            <div className="w-full sm:w-80">
              <Combobox label="Course to assign" value={pick} onChange={setPick} load={loadPublishedCourses} placeholder="Search published courses…" hint={already ? 'Already assigned' : undefined} />
            </div>
            <Button disabled={!pick || already} loading={busy} onClick={async () => { if (await run(() => api(`/batches/${batch._id}/courses`, { method: 'POST', body: { courseId: pick } }), 'Course assigned')) setPick(''); }}>Assign</Button>
            <Link href={`/manage/batches/${batch._id}/visibility`} className="self-center text-[13px] text-accent-fg hover:underline">Chapter Access</Link>
          </div>
        </Card>
      )}
      <Card title="Assigned courses" flush>
        {bcs.error ? <ErrorState message={bcs.error} retry={bcs.reload} /> : !bcs.data ? <div className="p-4"><TableSkeleton /></div> : (
          <DataTable rows={bcs.data.items} rowKey={(b) => b._id}
            empty={<EmptyState title="No courses assigned" body="Assign a published course above. Students enrolled now get access automatically." />}
            columns={[
              { key: 't', header: 'Course', cell: (b) => <Link className="font-medium text-fg hover:text-accent-fg hover:underline" href={`/manage/courses/${b.courseId._id}`}>{b.courseId.title}</Link> },
              { key: 'prep', header: 'Preparation', optional: true, cell: (b) => b.status === 'ACTIVE' &&
                <Link className="text-accent-fg hover:underline" href={`/manage/ai-preparation?courseId=${b.courseId._id}`}>AI Preparation</Link> },
              { key: 's', header: 'Access in this batch', cell: (b) => <StatusBadge status={b.status} label={b.status === 'ACTIVE' ? 'Has access' : 'Access removed'} /> },
              { key: 'cs', header: 'Course status', optional: true, cell: (b) => <StatusBadge status={b.courseId.status} /> },
              { key: 'a', header: 'Added on', optional: true, cell: (b) => fmtDate(b.assignedAt) },
              { key: 'x', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (b) => !ro && (b.status === 'ACTIVE'
                ? <Button size="sm" variant="secondary" onClick={async () => {
                    if (await confirm({ title: `Remove access to ${b.courseId.title}?`, body: 'Students lose access now. Verified progress and chapter access are kept, and come back if you restore access.', confirmLabel: 'Remove access', danger: true }))
                      run(() => api(`/batches/${batch._id}/courses/${b.courseId._id}`, { method: 'PATCH', body: { status: 'INACTIVE' } }), 'Access removed');
                  }}>Remove access</Button>
                : <Button size="sm" variant="secondary" onClick={() => run(() => api(`/batches/${batch._id}/courses`, { method: 'POST', body: { courseId: b.courseId._id } }), 'Access restored')}>Restore access</Button>) },
            ]} />
        )}
      </Card>
    </div>
  );
}
