'use client';
import { useState } from 'react';
import { Button, Card, EmptyState, ButtonLink, ErrorState, StatusBadge, Switch, TableSkeleton, DataTable, useConfirm, usePageTitle, useToast } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';

const availabilityLabels = {
  AVAILABLE: 'Available', CHAPTER_HIDDEN: 'Chapter hidden', CHAPTER_DISABLED: 'Ask AI disabled',
  CONTEXT_INACTIVE: 'Batch or course unavailable', GLOBAL_DISABLED: 'Student AI disabled globally',
  BATCH_UNAVAILABLE: 'Batch AI disabled or outside its availability rules',
  PUBLISHED_HINTS_ONLY: 'Published hints only', NO_AI_SOURCE: 'No provider or published hints',
};
interface Access {
  batchCourseId: string; status: string; course: { _id: string; title: string };
  chapters: { chapterId: string; title: string; order: number; isVisible: boolean; unlockedAt?: string;
    problemCount: number; studentAiEnabled: boolean; aiAvailability: keyof typeof availabilityLabels }[];
}

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
        const aiEnabled = bc.chapters.filter((chapter) => chapter.studentAiEnabled).length;
        const bulkAi = (enabled: boolean) => run(`ai-${bc.batchCourseId}`, () => api(`/batches/${batch._id}/chapter-access/student-ai/bulk`, {
          method: 'POST', body: { courseId: bc.course._id, all: true, enabled },
        }), enabled ? 'Ask AI enabled for all chapters' : 'Ask AI disabled for all chapters');
        return (
          <Card key={bc.batchCourseId}
            title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">{bc.course.title}<span className="text-xs font-normal text-fg-muted">{visible} of {bc.chapters.length} visible</span>{inactive && <StatusBadge status="INACTIVE" label="Access removed" />}</span>}
            actions={editable && bc.chapters.length > 0 && <>
              <Button size="sm" variant="secondary" loading={busy === `all-${bc.batchCourseId}`} disabled={visible === bc.chapters.length}
                onClick={async () => { if (await confirm({ title: `Make all chapters of ${bc.course.title} visible?`, body: 'Students can see every chapter right away.', confirmLabel: 'Make all visible' })) run(`all-${bc.batchCourseId}`, () => api(`/batches/${batch._id}/chapter-access/bulk`, { method: 'POST', body: { courseId: bc.course._id, all: true, isVisible: true } }), 'All chapters are now visible'); }}>Make all visible</Button>
              <Button size="sm" variant="danger" loading={busy === `none-${bc.batchCourseId}`} disabled={visible === 0}
                onClick={async () => { if (await confirm({ title: `Hide all chapters of ${bc.course.title}?`, body: 'Students lose access immediately. Verified progress is kept.', confirmLabel: 'Hide all', danger: true })) run(`none-${bc.batchCourseId}`, () => api(`/batches/${batch._id}/chapter-access/bulk`, { method: 'POST', body: { courseId: bc.course._id, all: true, isVisible: false } }), 'All chapters are now hidden'); }}>Hide all</Button>
              <Button size="sm" variant="secondary" disabled={!!busy || aiEnabled === bc.chapters.length} onClick={() => void bulkAi(true)}>Enable Ask AI for all</Button>
              <Button size="sm" variant="secondary" disabled={!!busy || aiEnabled === 0} onClick={() => void bulkAi(false)}>Disable Ask AI for all</Button>
            </>}
            flush={bc.chapters.length > 0}>
            {inactive && <p className="border-b border-line px-4 py-3 text-sm text-warning-fg">Access to this course was removed for the batch. Restore access in Courses to change chapter access.</p>}
            {!bc.chapters.length ? <p className="text-sm text-fg-muted">This course has no chapters yet.</p> : (
              <DataTable caption={`${bc.course.title} chapter access`} rows={bc.chapters} rowKey={(c) => c.chapterId} columns={[
                { key: 'chapter', header: 'Chapter', cell: (c) => <div className="min-w-48 whitespace-normal"><p className="font-medium text-fg">{c.title}</p><p className="text-xs text-fg-muted">{c.problemCount} {c.problemCount === 1 ? 'problem' : 'problems'}</p></div> },
                { key: 'visible', header: 'Visibility', cell: (c) => editable
                  ? <div className="flex items-center gap-2"><Switch checked={c.isVisible} disabled={busy === c.chapterId} showLabel label={`${c.title} visible to students`}
                    onChange={(on) => run(c.chapterId, () => api(`/batches/${batch._id}/courses/${bc.course._id}/chapters/${c.chapterId}/access`, { method: 'PUT', body: { isVisible: on } }), on ? `“${c.title}” is now visible` : `“${c.title}” is now hidden`)} /><span className="text-xs text-fg-muted">{c.isVisible ? 'Visible' : 'Hidden'}</span></div>
                  : <StatusBadge status={c.isVisible ? 'VISIBLE' : 'HIDDEN'} /> },
                { key: 'ask', header: 'Ask AI', cell: (c) => editable
                  ? <div className="flex items-center gap-2"><Switch checked={c.studentAiEnabled} disabled={!!busy} showLabel label={`Ask AI for ${c.title}`}
                    onChange={(enabled) => void run(`ai-${c.chapterId}`, () => api(`/batches/${batch._id}/courses/${bc.course._id}/chapters/${c.chapterId}/student-ai`, { method: 'PUT', body: { enabled } }), enabled ? 'Ask AI enabled' : 'Ask AI disabled')} /><span className="text-xs text-fg-muted">{c.studentAiEnabled ? 'Enabled' : 'Disabled'}</span></div>
                  : <StatusBadge status={c.studentAiEnabled ? 'ACTIVE' : 'INACTIVE'} /> },
                { key: 'effective', header: 'Effective status', cell: (c) => <StatusBadge status={c.aiAvailability === 'AVAILABLE' ? 'ACTIVE' : c.aiAvailability === 'CHAPTER_DISABLED' ? 'INACTIVE' : 'WARNING'} label={availabilityLabels[c.aiAvailability]} /> },
              ]} />
            )}
          </Card>
        );
      })}
    </div>
  );
}
