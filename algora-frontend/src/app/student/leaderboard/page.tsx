'use client';
import { useState } from 'react';
import { Card, EmptyState, ErrorState, PageHeader, PageSkeleton, Tabs } from '@/components/ui';
import { LeaderboardTable } from '@/components/manage/Leaderboard';
import { ContextPicker } from '@/components/student/ContextPicker';
import { useSync } from '@/components/student/SyncProvider';
import { useContextChoice } from '@/components/student/useContextChoice';
import type { Dashboard } from '@/components/student/types';
import { useApi } from '@/hooks/useApi';

export default function Page() {
  const [choice, choose] = useContextChoice();
  const [scope, setScope] = useState('batch-course');
  const { view, version } = useSync();
  const ctx = useApi<Dashboard>('/student/dashboard');
  if (ctx.error) return <ErrorState message={ctx.error} retry={ctx.reload} />;
  if (!ctx.data) return <PageSkeleton />;
  const valid = ctx.data.contexts.some((c) => c.batchCourseId === choice);
  const bc = valid ? choice! : ctx.data.selected?.batchCourseId;
  return (
    <div>
      <PageHeader title="Leaderboard" actions={<ContextPicker contexts={ctx.data.contexts} value={bc} onChange={choose} />} />
      {view && !view.syncEnabled && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Automatic verification is not available yet, so rankings do not reflect LeetCode activity. Do not treat them as final.</div>}
      {!bc ? <EmptyState title="No courses yet" /> : (
        <>
          <Tabs active={scope} onChange={setScope} tabs={[{ key: 'batch-course', label: 'My batch' }, { key: 'course', label: 'Course-wide' }, { key: 'batch', label: 'All my batch courses' }]} />
          <Card><LeaderboardTable key={`${bc}-${scope}-${version}`} path="/student/leaderboard" query={{ batchCourseId: bc, scope }} /></Card>
        </>
      )}
    </div>
  );
}
