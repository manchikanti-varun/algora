'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Card, DataTable, EmptyState, ErrorState, InlineSelect, Menu, ProgressBar, TableSkeleton, usePageTitle, useToast } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { LeaderboardTable } from '@/components/manage/Leaderboard';
import { useApi } from '@/hooks/useApi';
import { download, errorMessage, qs } from '@/lib/api';

interface BC { _id: string; status: string; courseId: { _id: string; title: string } }
interface ChapterStat { batchCourseId: string; course: string; chapter: string; problems: number; students: number; completedStudents: number; avgCompletionPct: number | null }

export default function Page() {
  const { batch } = useBatch();
  usePageTitle(`Analytics · ${batch.name}`);
  const bcs = useApi<{ items: BC[] }>(`/batches/${batch._id}/courses`);
  const [picked, setPicked] = useState('');
  const active = (bcs.data?.items ?? []).filter((b) => b.status === 'ACTIVE');
  // With a single active course there is nothing to choose, so it is selected automatically.
  const courseId = picked || (active.length === 1 ? active[0].courseId._id : '');
  const ch = useApi<{ items: ChapterStat[] }>(`/analytics/chapters${qs({ batchId: batch._id, courseId })}`);
  const toast = useToast();
  const exp = (type: string) => download(`/reports/export${qs({ type, batchId: batch._id, courseId })}`).catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {active.length > 1
          ? <InlineSelect label="Course" value={courseId} onChange={setPicked} options={[{ value: '', label: 'All courses' }, ...active.map((b) => ({ value: b.courseId._id, label: b.courseId.title }))]} />
          : <p className="text-sm text-fg-muted">{active.length === 1 ? active[0].courseId.title : 'No active courses'}</p>}
        <Menu label="Export reports" variant="secondary" size="sm" icon={<Download size={15} aria-hidden />} button={<><Download size={15} aria-hidden />Export</>} items={[
          { label: 'Student report', onSelect: () => exp('student') }, { label: 'Chapter report', onSelect: () => exp('chapter') }, { label: 'Problem report', onSelect: () => exp('problem') },
        ]} />
      </div>
      <Card title={courseId ? 'Course leaderboard' : 'Combined leaderboard'}>
        <LeaderboardTable path={`/leaderboards/batches/${batch._id}`} query={{ courseId: courseId || undefined }} showRoll showSync />
      </Card>
      <Card title="Chapter completion" flush>
        {ch.error ? <ErrorState message={ch.error} retry={ch.reload} /> : !ch.data ? <div className="p-4"><TableSkeleton /></div> : (
          <DataTable rows={ch.data.items} rowKey={(c) => `${c.batchCourseId}-${c.chapter}`} empty={<EmptyState compact title="No visible chapters yet" body="Make chapters visible in Chapter Access to see completion." />}
            columns={[
              { key: 'c', header: 'Course', optional: true, cell: (c) => c.course },
              { key: 'ch', header: 'Chapter', cell: (c) => <span className="font-medium">{c.chapter}</span> },
              { key: 'p', header: 'Problems', optional: true, cell: (c) => <span className="tabular-nums">{c.problems}</span> },
              { key: 'd', header: 'Completed', cell: (c) => <span className="tabular-nums">{c.completedStudents} / {c.students}</span> },
              { key: 'a', header: 'Average completion', className: 'min-w-44', cell: (c) => <ProgressBar value={c.avgCompletionPct} size="sm" label={`${c.chapter} average completion`} /> },
            ]} />
        )}
      </Card>
    </div>
  );
}
