'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, EmptyState, ErrorState, PageHeader, PageSkeleton, ProgressBar } from '@/components/ui';
import { useSync } from '@/components/student/SyncProvider';
import type { Dashboard } from '@/components/student/types';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';

export default function Page() {
  const { batchCourseId } = useParams<{ batchCourseId: string }>();
  const { version } = useSync();
  const d = useApi<Dashboard>(`/student/dashboard${qs({ batchCourseId, v: version })}`);
  if (d.error) return <ErrorState message={d.error} retry={d.reload} />;
  if (!d.data?.selected) return <PageSkeleton />;
  const s = d.data.summary!;
  return (
    <div className="space-y-6">
      <PageHeader back={{ href: '/student/courses', label: 'My courses' }} title={d.data.selected.courseTitle} subtitle={`${d.data.selected.batchName} · ${s.verifiedSolved} of ${s.accessibleProblems} verified`} />
      <Card><ProgressBar value={s.completionPct} label="Course completion" /></Card>
      {!d.data.chapters.length ? <EmptyState title="No chapters unlocked yet" body="Your trainer will unlock chapters as the bootcamp progresses." /> : (
        <ol className="space-y-3">
          {d.data.chapters.map((c, i) => (
            <li key={c.chapterId}>
              <Link href={`/student/chapters/${c.chapterId}?batchCourseId=${batchCourseId}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300">
                <div className="mb-2 flex items-center justify-between gap-2"><span className="font-medium"><span className="mr-2 text-slate-400">{i + 1}.</span>{c.title}</span><span className="text-sm text-slate-500">{c.solved} / {c.total}</span></div>
                <ProgressBar value={c.completionPct} size="sm" label={`${c.title} progress`} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
