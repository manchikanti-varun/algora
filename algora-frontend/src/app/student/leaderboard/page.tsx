'use client';
import { Trophy } from 'lucide-react';
import { Card, EmptyState, ErrorState, Notice, PageHeader, PageSkeleton, Tabs } from '@/components/ui';
import { LeaderboardTable } from '@/components/manage/Leaderboard';
import { ContextPicker } from '@/components/student/ContextPicker';
import { useSync } from '@/components/student/SyncProvider';
import { useStudentDashboard } from '@/components/student/useContextChoice';
import { useUrlState } from '@/hooks/useUrlState';
const TABS = [{ key: 'batch-course', label: 'My batch' }, { key: 'course', label: 'Course-wide' }, { key: 'batch', label: 'All my courses' }];
export default function Page() {
  const { view, version } = useSync();
  const [{ tab }, setUrl] = useUrlState({ tab: 'batch-course' });
  const { data, error, reload, selectedId, choose } = useStudentDashboard();
  if (error) return <ErrorState message={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const scope = TABS.some((t) => t.key === tab) ? tab : 'batch-course';
  return (
    <div className="space-y-4">
      <PageHeader title="Leaderboard" subtitle={data.selected ? `${data.selected.courseTitle} · ${data.selected.batchName}` : undefined}
        actions={<ContextPicker contexts={data.contexts} value={selectedId} onChange={choose} />} />
      {view && !view.syncEnabled && <Notice tone="warn" title="Rankings only include verified problems">Progress updates are unavailable right now, so rankings may not show your latest LeetCode activity.</Notice>}
      {!selectedId ? <Card><EmptyState icon={Trophy} title="No leaderboard yet" body="Rankings appear once you are enrolled in a course." /></Card> : (
        <Tabs active={scope} onChange={(k) => setUrl({ tab: k })} tabs={TABS}>
          <Card><LeaderboardTable key={`${selectedId}-${scope}-${version}`} path="/student/leaderboard" query={{ batchCourseId: selectedId, scope }} /></Card>
        </Tabs>
      )}
    </div>
  );
}
