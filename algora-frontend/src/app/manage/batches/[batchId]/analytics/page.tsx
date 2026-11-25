'use client';
import { useState } from 'react';
import { Button, Card, DataTable, ErrorState, InlineSelect, ProgressBar, TableSkeleton, useToast } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { LeaderboardTable } from '@/components/manage/Leaderboard';
import { useApi } from '@/hooks/useApi';
import { download, errorMessage, qs } from '@/lib/api';

interface BC { _id: string; status: string; courseId: { _id: string; title: string } }
interface ChapterStat { batchCourseId: string; course: string; chapter: string; problems: number; students: number; completedStudents: number; avgCompletionPct: number | null }
export default function Page() {
  const { batch } = useBatch();
  const bcs = useApi<{ items: BC[] }>(`/batches/${batch._id}/courses`);
  const [courseId, setCourseId] = useState('');
  const ch = useApi<{ items: ChapterStat[] }>(`/analytics/chapters${qs({ batchId: batch._id, courseId })}`);
  const toast = useToast();
  const exp = (type: string) => download(`/reports/export${qs({ type, batchId: batch._id, courseId })}`).catch((e) => toast.error(errorMessage(e)));
  const active = (bcs.data?.items ?? []).filter((b) => b.status === 'ACTIVE');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InlineSelect label="Course" value={courseId} onChange={setCourseId} options={[{ value: '', label: 'All courses (combined)' }, ...active.map((b) => ({ value: b.courseId._id, label: b.courseId.title }))]} />
        <div className="flex flex-wrap gap-2">{['student', 'chapter', 'problem'].map((t) => <Button key={t} size="sm" variant="secondary" onClick={() => exp(t)}>Export {t} CSV</Button>)}</div>
      </div>
      <Card title={courseId ? 'Batch-course leaderboard' : 'Combined batch leaderboard'}>
        <LeaderboardTable path={`/leaderboards/batches/${batch._id}`} query={{ courseId: courseId || undefined }} showRoll showSync />
      </Card>
      <Card title="Chapter completion">
        {ch.error ? <ErrorState message={ch.error} retry={ch.reload} /> : !ch.data ? <TableSkeleton /> : (
          <DataTable rows={ch.data.items} rowKey={(c) => `${c.batchCourseId}-${c.chapter}`} columns={[
            { key: 'c', header: 'Course', cell: (c) => c.course }, { key: 'ch', header: 'Chapter', cell: (c) => <span className="font-medium">{c.chapter}</span> },
            { key: 'p', header: 'Problems', cell: (c) => c.problems }, { key: 'd', header: 'Completed', cell: (c) => `${c.completedStudents} / ${c.students}` },
            { key: 'a', header: 'Average completion', className: 'min-w-44', cell: (c) => <ProgressBar value={c.avgCompletionPct} size="sm" /> },
          ]} />
        )}
      </Card>
    </div>
  );
}
