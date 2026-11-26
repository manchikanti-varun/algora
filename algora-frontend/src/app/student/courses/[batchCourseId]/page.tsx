'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageSkeleton, ProgressBar } from '@/components/ui';
import { useSync } from '@/components/student/SyncProvider';
import type { Dashboard } from '@/components/student/types';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
export default function Page() {
  const { batchCourseId } = useParams<{ batchCourseId: string }>();
  const { version } = useSync();
  const d = useApi<Dashboard>(`/student/dashboard${qs({ batchCourseId, v: version })}`);
  if (d.error) return <ErrorState message={d.error} retry={d.reload} />;
  if (!d.data) return <PageSkeleton />;
  const { selected, summary: s, chapters } = d.data;
  if (!selected || selected.batchCourseId !== batchCourseId) {
    return (
      <div>
        <PageHeader title="Course not available" breadcrumbs={[{ label: 'My Learning', href: '/student/courses' }, { label: 'Course' }]} />
        <Card><EmptyState title="This course is not available to you" body="It may have been removed from your batch." action={<ButtonLink href="/student/courses" variant="secondary">Back to My Learning</ButtonLink>} /></Card>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader title={selected.courseTitle} subtitle={selected.batchName}
        breadcrumbs={[{ label: 'My Learning', href: '/student/courses' }, { label: selected.courseTitle }]}
        actions={s && (
          <div className="w-56">
            <p className="mb-1 text-right text-[13px] text-fg-muted">{s.verifiedSolved} of {s.accessibleProblems} verified</p>
            <ProgressBar value={s.completionPct} label="Course progress" />
          </div>
        )} />
      <Card flush>
        {!chapters.length ? <EmptyState title="No chapters yet" body="Your trainer makes chapters visible as the course goes on." /> : (
          <ol className="divide-y divide-line">
            {chapters.map((c, i) => (
              <li key={c.chapterId}>
                <Link href={`/student/chapters/${c.chapterId}?batchCourseId=${batchCourseId}`} className="block px-4 py-3 transition-colors hover:bg-hover">
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 gap-2"><span className="w-5 shrink-0 tabular-nums text-fg-subtle">{i + 1}.</span><span className="truncate font-medium text-fg">{c.title}</span></span>
                    <span className="shrink-0 tabular-nums text-[13px] text-fg-muted">{c.solved} / {c.total} verified</span>
                  </div>
                  <ProgressBar value={c.completionPct} size="sm" label={`${c.title} progress`} className="pl-7" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
