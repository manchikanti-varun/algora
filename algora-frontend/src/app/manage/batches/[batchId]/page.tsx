'use client';
import Link from 'next/link';
import { Card, Grid, StatCard, ErrorState, PageSkeleton, BarList, StatusBadge } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import type { Overview } from '@/components/manage/types';

export default function Page() {
  const { batch } = useBatch();
  const a = useApi<Overview & { chapters: { chapter: string; course: string; avgCompletionPct: number | null; completedStudents: number; students: number }[] }>(`/analytics/batches/${batch._id}`);
  if (a.error) return <ErrorState message={a.error} retry={a.reload} />;
  if (!a.data) return <PageSkeleton />;
  const t = a.data.totals;
  return (
    <div className="space-y-6">
      <Grid>
        <StatCard label="Students" value={batch.studentCount} hint={`${t.pendingEnrollments} pending enrollment${t.pendingEnrollments === 1 ? '' : 's'}`} />
        <StatCard label="Active courses" value={batch.courseCount} />
        <StatCard label="Average completion" value={t.avgCompletionPct === null ? '—' : `${t.avgCompletionPct}%`} />
        <StatCard label="Verified LeetCode accounts" value={`${a.data.verification.verifiedLinks} / ${a.data.verification.studentsInScope}`} tone={a.data.verification.coveragePct === 100 ? 'good' : 'warn'} />
      </Grid>
      {!batch.courseCount && <Card><p className="text-sm text-slate-600">No courses assigned yet. <Link className="text-indigo-600 hover:underline" href={`/manage/batches/${batch._id}/courses`}>Assign a course</Link>.</p></Card>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Chapter completion"><BarList items={a.data.chapters.map((c) => ({ label: `${c.course} · ${c.chapter}`, value: c.avgCompletionPct, sub: `${c.completedStudents}/${c.students} done` }))} max={100} format={(n) => `${n}%`} /></Card>
        <Card title="Trainers">
          {batch.trainers?.length ? <ul className="space-y-1 text-sm">{batch.trainers.map((t) => <li key={t._id} className="flex justify-between"><span>{t.fullName}</span><code className="text-xs text-slate-500">{t.trainerId}</code></li>)}</ul> : <p className="text-sm text-slate-500">No trainers assigned.</p>}
          <p className="mt-3 text-xs text-slate-500">Sync status of students: {Object.entries(a.data.sync.byStatus).map(([k, v]) => <span key={k} className="mr-2 inline-flex items-center gap-1"><StatusBadge status={k} />{v}</span>)}</p>
        </Card>
      </div>
    </div>
  );
}
