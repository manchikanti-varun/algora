'use client';
import { Trophy } from 'lucide-react';
import { Card, EmptyState, ErrorState, Notice, PageHeader, PageSkeleton } from '@/components/ui';
import { LeaderboardTable } from '@/components/manage/Leaderboard';
import { ContextPicker } from '@/components/student/ContextPicker';
import { useSync } from '@/components/student/SyncProvider';
import { useStudentDashboard } from '@/components/student/useContextChoice';
export default function Page() {
  const { view, version } = useSync();
  const { data, error, reload, selectedId, choose } = useStudentDashboard();
  if (error) return <ErrorState message={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  return (
    <div className="space-y-4">
      <PageHeader title="Leaderboard" subtitle={data.selected ? `${data.selected.courseTitle} · ${data.selected.batchName}` : undefined}
        actions={<ContextPicker contexts={data.contexts} value={selectedId} onChange={choose} />} />
      {view && !view.syncEnabled && <Notice tone="warn" title="Rankings only include verified problems">Progress updates are unavailable right now, so rankings may not show your latest LeetCode activity.</Notice>}
      {!selectedId ? <Card><EmptyState icon={Trophy} title="No leaderboard yet" body="Rankings appear once you are enrolled in a course." /></Card> : (
          <Card><LeaderboardTable key={`${selectedId}-${version}`} path="/student/leaderboard" query={{ batchCourseId: selectedId }} /></Card>
      )}
    </div>
  );
}
