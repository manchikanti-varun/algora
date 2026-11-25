'use client';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorState, fmtDateTime, Notice, StatusBadge, TableSkeleton, useConfirm, useToast } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';

interface Access { batchCourseId: string; status: string; course: { _id: string; title: string }; chapters: { chapterId: string; title: string; order: number; isVisible: boolean; unlockedAt?: string }[] }
export default function Page() {
  const { batch } = useBatch();
  const a = useApi<{ items: Access[] }>(`/batches/${batch._id}/chapter-access`);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast(); const confirm = useConfirm();
  const ro = batch.status === 'ARCHIVED';
  async function run(key: string, fn: () => Promise<unknown>, ok: string) { setBusy(key); try { await fn(); toast.success(ok); await a.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); } }
  if (a.error) return <ErrorState message={a.error} retry={a.reload} />;
  if (!a.data) return <TableSkeleton />;
  if (!a.data.items.length) return <EmptyState title="No courses assigned" body="Assign a course first. Its chapters will appear here, all hidden." />;
  return (
    <div className="space-y-4">
      <Notice tone="info">Visibility is set separately for each batch. Hidden chapters are invisible to students and do not count toward progress; verified evidence is kept and counts again when you unlock the chapter.</Notice>
      {a.data.items.map((bc) => {
        const visible = bc.chapters.filter((c) => c.isVisible).length;
        const inactive = bc.status !== 'ACTIVE';
        return (
          <Card key={bc.batchCourseId} title={<span className="flex items-center gap-2">{bc.course.title}<span className="text-xs font-normal text-slate-500">{visible} of {bc.chapters.length} unlocked</span>{inactive && <StatusBadge status={bc.status} />}</span>}
            actions={!ro && !inactive && bc.chapters.length > 0 && <>
              <Button size="sm" variant="secondary" loading={busy === `all-${bc.batchCourseId}`} disabled={visible === bc.chapters.length} onClick={async () => { if (await confirm({ title: `Unlock all chapters of ${bc.course.title}?`, confirmLabel: 'Unlock all' })) run(`all-${bc.batchCourseId}`, () => api(`/batches/${batch._id}/chapter-access/bulk`, { method: 'POST', body: { courseId: bc.course._id, all: true, isVisible: true } }), 'All chapters unlocked'); }}>Unlock all</Button>
              <Button size="sm" variant="ghost" loading={busy === `none-${bc.batchCourseId}`} disabled={visible === 0} onClick={async () => { if (await confirm({ title: `Hide all chapters of ${bc.course.title}?`, body: 'Students lose access immediately. Progress is kept.', confirmLabel: 'Hide all', danger: true })) run(`none-${bc.batchCourseId}`, () => api(`/batches/${batch._id}/chapter-access/bulk`, { method: 'POST', body: { courseId: bc.course._id, all: true, isVisible: false } }), 'All chapters hidden'); }}>Hide all</Button>
            </>}>
            {inactive && <p className="mb-3 text-sm text-amber-700">This course is deactivated for the batch. Reactivate it to change visibility.</p>}
            {!bc.chapters.length ? <p className="text-sm text-slate-500">This course has no chapters yet.</p> : (
              <ul className="divide-y divide-slate-100">
                {bc.chapters.map((c, i) => (
                  <li key={c.chapterId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="w-6 text-slate-400">{i + 1}</span><span className="font-medium">{c.title}</span>
                    {c.isVisible ? <StatusBadge status="VISIBLE" /> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Hidden</span>}
                    {c.isVisible && c.unlockedAt && <span className="text-xs text-slate-400">since {fmtDateTime(c.unlockedAt)}</span>}
                    {!ro && !inactive && (
                      <label className="ml-auto inline-flex cursor-pointer items-center gap-2">
                        <span className="sr-only">Visible to students</span>
                        <input type="checkbox" role="switch" aria-checked={c.isVisible} checked={c.isVisible} disabled={busy === c.chapterId} className="peer sr-only"
                          onChange={(e) => run(c.chapterId, () => api(`/batches/${batch._id}/courses/${bc.course._id}/chapters/${c.chapterId}/access`, { method: 'PUT', body: { isVisible: e.target.checked } }), e.target.checked ? `“${c.title}” unlocked` : `“${c.title}” hidden`)} />
                        <span className="relative h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-indigo-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-600 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" aria-hidden />
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
