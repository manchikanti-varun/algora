'use client';
import { useEffect, useRef } from 'react';
import { Card, Combobox, EmptyState, ErrorState, PageHeader, Select, Tabs } from '@/components/ui';
import { LeaderboardTable } from '@/components/manage/Leaderboard';
import type { Batch, Paged } from '@/components/manage/types';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import { loadBatches, loadPublishedCourses } from '@/lib/options';

const KEY = 'algora.leaderboardBatch';

export default function Page() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [f, set] = useUrlState({ tab: 'batch', batchId: '', courseId: '', cwCourse: '' });
  const tab = f.tab === 'course' && admin ? 'course' : 'batch';
  const bcs = useApi<{ items: { status: string; courseId: { _id: string; title: string } }[] }>(f.batchId ? `/batches/${f.batchId}/courses` : null);
  // Resolve the selected batch's real name, so a link or remembered id never shows "Selected" or a raw id.
  const batch = useApi<Batch>(f.batchId ? `/batches/${f.batchId}` : null);
  const tried = useRef(false);

  // Preselect the last used batch, otherwise the first batch the user can see.
  useEffect(() => {
    if (f.batchId || tried.current || tab !== 'batch') return;
    tried.current = true;
    let live = true;
    (async () => {
      let id = '';
      try { id = localStorage.getItem(KEY) ?? ''; } catch { /* storage unavailable */ }
      if (!id) { try { id = (await api<Paged<Batch>>('/batches?pageSize=1')).items[0]?._id ?? ''; } catch { /* no default */ } }
      if (live && id) set({ batchId: id });
    })();
    return () => { live = false; };
  }, [f.batchId, tab, set]);

  const pickBatch = (batchId: string) => {
    try { if (batchId) localStorage.setItem(KEY, batchId); else localStorage.removeItem(KEY); } catch { /* ignore */ }
    set({ batchId, courseId: '' });
  };
  const courses = (bcs.data?.items ?? []).filter((b) => b.status === 'ACTIVE');
  // A stale or unauthorized course selection must not silently filter against an id the batch does not use.
  useEffect(() => {
    if (f.courseId && bcs.data && !courses.some((c) => c.courseId._id === f.courseId)) set({ courseId: '' });
  }, [f.courseId, bcs.data, courses, set]);

  return (
    <div>
      <PageHeader title="Leaderboards" subtitle="Ranked by points from verified problems. Ties share a rank." />
      <Tabs active={tab} onChange={(t) => set({ tab: t })} tabs={[{ key: 'batch', label: 'Batch' }, { key: 'course', label: 'Course-wide', hidden: !admin }]} />
      {tab === 'batch' && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Combobox label="Batch" value={f.batchId} selectedLabel={batch.data?.name} onChange={pickBatch} load={loadBatches} placeholder="Choose a batch" />
            {f.batchId && <Select label="Course" labelHidden className="h-8 py-0 text-[13px]" value={f.courseId} onChange={(e) => set({ courseId: e.target.value })}
              options={[{ value: '', label: 'All courses' }, ...courses.map((b) => ({ value: b.courseId._id, label: b.courseId.title }))]} />}
          </div>
          {batch.error && <div className="mb-4"><ErrorState message={batch.error} retry={batch.reload} /></div>}
          {f.batchId && !batch.error
            ? <LeaderboardTable key={`${f.batchId}-${f.courseId}`} path={`/leaderboards/batches/${f.batchId}`} query={{ courseId: f.courseId || undefined }} showRoll showSync />
            : !batch.error && <EmptyState title="Choose a batch" body="Pick a batch to see how its students rank. If there are no batches yet, create one under Batches." />}
        </Card>
      )}
      {tab === 'course' && (
        <Card>
          <div className="mb-4">
            <Combobox label="Course" value={f.cwCourse} onChange={(cwCourse) => set({ cwCourse })} load={loadPublishedCourses} placeholder="Choose a course" />
          </div>
          {f.cwCourse
            ? <LeaderboardTable key={f.cwCourse} path={`/leaderboards/courses/${f.cwCourse}`} showRoll showSync />
            : <EmptyState title="Choose a course" body="Students from every batch using the course are compared on the problems visible in all of those batches." />}
        </Card>
      )}
    </div>
  );
}
