'use client';
import { useState } from 'react';
import { Button, Card, EmptyState, ButtonLink, ErrorState, fmtDate, StatusBadge, Switch, TableSkeleton, useConfirm, usePageTitle, useToast } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';

interface Access { batchCourseId: string; status: string; course: { _id: string; title: string }; chapters: { chapterId: string; title: string; order: number; isVisible: boolean; unlockedAt?: string }[] }

export default function Page() {
  const { batch } = useBatch();
  usePageTitle(`Chapter Access · ${batch.name}`);
  const a = useApi<{ items: Access[] }>(`/batches/${batch._id}/chapter-access`);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast(); const confirm = useConfirm();
  const ro = batch.status === 'ARCHIVED';
  async function run(key: string, fn: () => Promise<unknown>, ok: string) { setBusy(key); try { await fn(); toast.success(ok); await a.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); } }
  if (a.error) return <ErrorState message={a.error} retry={a.reload} />;
  if (!a.data) return <TableSkeleton />;
  if (!a.data.items.length) return <EmptyState title="No courses assigned" body="Assign a course first. Its chapters will appear here, all hidden." action={<ButtonLink href={`/manage/batches/${batch._id}/courses`}>Assign a course</ButtonLink>} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">Chapter access is set separately for each batch. Hidden chapters are invisible to students and do not count toward progress. Verified work is kept and counts again when you make the chapter visible.</p>
      {a.data.items.map((bc) => {
        const visible = bc.chapters.filter((c) => c.isVisible).length;
        const inactive = bc.status !== 'ACTIVE';
        const editable = !ro && !inactive;
        return (
          <Card key={bc.batchCourseId}
            title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">{bc.course.title}<span className="text-xs font-normal text-fg-muted">{visible} of {bc.chapters.length} visible</span>{inactive && <StatusBadge status="INACTIVE" label="Access removed" />}</span>}
            actions={editable && bc.chapters.length > 0 && <>
              <Button size="sm" variant="secondary" loading={busy === `all-${bc.batchCourseId}`} disabled={visible === bc.chapters.length}
                onClick={async () => { if (await confirm({ title: `Make all chapters of ${bc.course.title} visible?`, body: 'Students can see every chapter right away.', confirmLabel: 'Make all visible' })) run(`all-${bc.batchCourseId}`, () => api(`/batches/${batch._id}/chapter-access/bulk`, { method: 'POST', body: { courseId: bc.course._id, all: true, isVisible: true } }), 'All chapters are now visible'); }}>Make all visible</Button>
              <Button size="sm" variant="danger" loading={busy === `none-${bc.batchCourseId}`} disabled={visible === 0}
                onClick={async () => { if (await confirm({ title: `Hide all chapters of ${bc.course.title}?`, body: 'Students lose access immediately. Verified progress is kept.', confirmLabel: 'Hide all', danger: true })) run(`none-${bc.batchCourseId}`, () => api(`/batches/${batch._id}/chapter-access/bulk`, { method: 'POST', body: { courseId: bc.course._id, all: true, isVisible: false } }), 'All chapters are now hidden'); }}>Hide all</Button>
            </>}
            flush={bc.chapters.length > 0}>
            {inactive && <p className="border-b border-line px-4 py-3 text-sm text-warning-fg">Access to this course was removed for the batch. Restore access in Courses to change chapter access.</p>}
            {!bc.chapters.length ? <p className="text-sm text-fg-muted">This course has no chapters yet.</p> : (
              <ul className="divide-y divide-line">
                {bc.chapters.map((c, i) => (
                  <li key={c.chapterId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                    <span className="w-6 tabular-nums text-fg-subtle">{i + 1}</span>
                    <span className="min-w-0 flex-1 basis-40 font-medium text-fg">{c.title}</span>
                    <StatusBadge status={c.isVisible ? 'VISIBLE' : 'HIDDEN'} />
                    {c.isVisible && c.unlockedAt && <span className="text-xs text-fg-subtle">Visible since {fmtDate(c.unlockedAt)}</span>}
                    {editable && (
                      <span className="ml-auto">
                        <Switch checked={c.isVisible} disabled={busy === c.chapterId} label={`${c.title} visible to students`}
                          onChange={(on) => run(c.chapterId, () => api(`/batches/${batch._id}/courses/${bc.course._id}/chapters/${c.chapterId}/access`, { method: 'PUT', body: { isVisible: on } }), on ? `“${c.title}” is now visible` : `“${c.title}” is now hidden`)} />
                      </span>
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
