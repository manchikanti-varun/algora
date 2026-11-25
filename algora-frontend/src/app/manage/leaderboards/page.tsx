'use client';
import { useState } from 'react';
import { Card, EmptyState, InlineSelect, PageHeader, Tabs } from '@/components/ui';
import { LeaderboardTable } from '@/components/manage/Leaderboard';
import { useApi } from '@/hooks/useApi';
import { isAdmin, useAuth } from '@/lib/auth';
import type { Batch, Course, Paged } from '@/components/manage/types';

export default function Page() {
  const { user } = useAuth();
  const [tab, setTab] = useState('batch');
  const batches = useApi<Paged<Batch>>('/batches?pageSize=100');
  const courses = useApi<Paged<Course>>('/courses?status=PUBLISHED&pageSize=100');
  const [batchId, setBatchId] = useState(''); const [courseId, setCourseId] = useState(''); const [cwCourse, setCw] = useState('');
  const bcs = useApi<{ items: { status: string; courseId: { _id: string; title: string } }[] }>(batchId ? `/batches/${batchId}/courses` : null);
  return (
    <div>
      <PageHeader title="Leaderboards" subtitle="Verified problems only. Ties share a rank." />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'batch', label: 'Batch' }, { key: 'course', label: 'Course-wide', hidden: !isAdmin(user) }]} />
      {tab === 'batch' && (
        <Card title={<div className="flex flex-wrap gap-2">
          <InlineSelect label="Batch" value={batchId} onChange={(v) => { setBatchId(v); setCourseId(''); }} options={[{ value: '', label: 'Select a batch…' }, ...(batches.data?.items ?? []).map((b) => ({ value: b._id, label: b.name }))]} />
          {batchId && <InlineSelect label="Course" value={courseId} onChange={setCourseId} options={[{ value: '', label: 'All courses (combined)' }, ...(bcs.data?.items ?? []).filter((b) => b.status === 'ACTIVE').map((b) => ({ value: b.courseId._id, label: b.courseId.title }))]} />}
        </div>}>
          {batchId ? <LeaderboardTable key={`${batchId}-${courseId}`} path={`/leaderboards/batches/${batchId}`} query={{ courseId: courseId || undefined }} showRoll showSync /> : <EmptyState title="Choose a batch" />}
        </Card>
      )}
      {tab === 'course' && (
        <Card title={<InlineSelect label="Course" value={cwCourse} onChange={setCw} options={[{ value: '', label: 'Select a course…' }, ...(courses.data?.items ?? []).map((c) => ({ value: c._id, label: c.title }))]} />}>
          {cwCourse ? <LeaderboardTable key={cwCourse} path={`/leaderboards/courses/${cwCourse}`} showRoll showSync /> : <EmptyState title="Choose a course" body="Students across all batches using the course are compared on the problems unlocked in every batch." />}
        </Card>
      )}
    </div>
  );
}
