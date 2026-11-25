'use client';
import Link from 'next/link';
import { Card, DifficultyBadge, EmptyState, ErrorState, Grid, PageHeader, PageSkeleton, ProgressBar, StatCard } from '@/components/ui';
import { ContextPicker } from '@/components/student/ContextPicker';
import { SyncPanel, useSync } from '@/components/student/SyncProvider';
import { useContextChoice } from '@/components/student/useContextChoice';
import type { Dashboard } from '@/components/student/types';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Page() {
  const { user } = useAuth();
  const [choice, choose] = useContextChoice();
  const { version, view } = useSync();
  const probe = useApi<Dashboard>(`/student/dashboard${qs({ v: version })}`); // lists contexts; default context
  const valid = probe.data?.contexts.some((c) => c.batchCourseId === choice);
  const selectedId = valid ? choice! : probe.data?.selected?.batchCourseId;
  const d = useApi<Dashboard>(selectedId && valid ? `/student/dashboard${qs({ batchCourseId: selectedId, v: version })}` : null);
  const data = valid ? d.data : probe.data;
  const err = probe.error ?? d.error;
  if (err) return <ErrorState message={err} retry={() => { probe.reload(); d.reload(); }} />;
  if (!data) return <PageSkeleton />;
  const s = data.summary;
  return (
    <div className="space-y-6">
      <PageHeader title={`Hi, ${user?.fullName.split(' ')[0]}`} subtitle={data.selected ? `${data.selected.courseTitle} · ${data.selected.batchName}` : undefined}
        actions={<ContextPicker contexts={data.contexts} value={selectedId} onChange={choose} />} />
      <SyncPanel />
      {view && view.link.state !== 'VERIFIED' && (
        <Card><p className="text-sm text-slate-700">Your LeetCode account {view.link.state === 'UNLINKED' || view.link.state === 'REVOKED' ? 'is not linked' : view.link.state === 'REVALIDATION_REQUIRED' ? 'needs to be verified again' : 'is waiting for ownership verification'}. Progress only counts from a verified account. <Link className="font-medium text-indigo-600 hover:underline" href="/student/profile">Go to profile</Link></p></Card>
      )}
      {!s ? (
        <EmptyState title="No courses yet" body="You are not enrolled in an active course. Your trainer will enroll you using your roll number; courses appear here automatically." />
      ) : (
        <>
          <Grid>
            <StatCard label="Verified solved" value={`${s.verifiedSolved} / ${s.accessibleProblems}`} hint={`${s.accessibleProblems - s.verifiedSolved} not yet verified`} tone="good" />
            <StatCard label="Completion" value={s.completionPct === null ? '—' : `${s.completionPct}%`} hint={s.completionPct === null ? 'No chapters unlocked yet' : undefined} />
            <StatCard label="Points" value={s.points} hint={`Easy ${s.scoring.EASY} · Medium ${s.scoring.MEDIUM} · Hard ${s.scoring.HARD}`} />
            <StatCard label="Batch rank" value={s.batchRank ? `#${s.batchRank}` : '—'} hint={s.batchRank ? (s.courseRank ? `Course-wide #${s.courseRank}` : 'Course-wide: not comparable yet') : 'Unranked until a problem is verified'} />
          </Grid>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Difficulty">
              <div className="space-y-3">{(['EASY', 'MEDIUM', 'HARD'] as const).map((k) => (
                <div key={k}><div className="mb-1 flex items-center justify-between text-sm"><DifficultyBadge d={k} /><span className="tabular-nums text-slate-500">{data.difficulty![k].solved} / {data.difficulty![k].total}</span></div>
                  <ProgressBar value={data.difficulty![k].total ? (data.difficulty![k].solved / data.difficulty![k].total) * 100 : null} label={`${k} progress`} /></div>))}</div>
            </Card>
            <Card title={`Chapters (${s.completedChapters} of ${s.unlockedChapters} complete)`} className="lg:col-span-2">
              {!data.chapters.length ? <EmptyState title="No chapters unlocked yet" body="Your trainer unlocks chapters as the course progresses." /> : (
                <ul className="divide-y divide-slate-100">
                  {data.chapters.map((c) => (
                    <li key={c.chapterId} className="py-3">
                      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                        <Link className="font-medium text-indigo-700 hover:underline" href={`/student/chapters/${c.chapterId}?batchCourseId=${data.selected!.batchCourseId}`}>{c.title}</Link>
                        <span className="text-slate-500">{c.solved} / {c.total} · E {c.difficulty.EASY.solved}/{c.difficulty.EASY.total} · M {c.difficulty.MEDIUM.solved}/{c.difficulty.MEDIUM.total} · H {c.difficulty.HARD.solved}/{c.difficulty.HARD.total}</span>
                      </div>
                      <ProgressBar value={c.completionPct} size="sm" label={`${c.title} progress`} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <p className="text-xs text-slate-500">{data.sync.note}</p>
        </>
      )}
    </div>
  );
}
