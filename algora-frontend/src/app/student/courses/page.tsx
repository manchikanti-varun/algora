'use client';
import Link from 'next/link';
import { BookOpen, ChevronRight } from 'lucide-react';
import { Card, EmptyState, ErrorState, PageHeader, PageSkeleton, plural, ProgressBar, Skeleton } from '@/components/ui';
import { useSync } from '@/components/student/SyncProvider';
import type { Dashboard } from '@/components/student/types';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
interface Item { batchCourseId: string; batchName: string; title: string; description?: string; chapters: { _id: string; title: string }[] }
function CourseProgress({ batchCourseId }: { batchCourseId: string }) {
  const { version } = useSync();
  const d = useApi<Dashboard>(`/student/dashboard${qs({ batchCourseId, v: version })}`);
  if (d.error) return <p className="text-[13px] text-fg-subtle">Progress is not available right now.</p>;
  if (!d.data) return <Skeleton className="h-5 w-full" />;
  const s = d.data.summary;
  if (!s) return <p className="text-[13px] text-fg-subtle">No problems to verify yet.</p>;
  return (
    <div className="space-y-1.5">
      <ProgressBar value={s.completionPct} label="Course progress" />
      <p className="text-[13px] text-fg-muted">{s.verifiedSolved} of {s.accessibleProblems} verified</p>
    </div>
  );
}
export default function Page() {
  const c = useApi<{ items: Item[] }>('/student/courses');
  if (c.error) return <ErrorState message={c.error} retry={c.reload} />;
  if (!c.data) return <PageSkeleton />;
  return (
    <div>
      <PageHeader title="My Learning" />
      {!c.data.items.length ? (
        <Card><EmptyState icon={BookOpen} title="No courses yet" body="Your trainer enrolls you in a batch using your roll number. The courses of your batch appear here." /></Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {c.data.items.map((i) => (
            <li key={i.batchCourseId}>
              <Link href={`/student/courses/${i.batchCourseId}`} className="flex h-full flex-col gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-hover">
                <div>
                  <p className="font-semibold text-fg">{i.title}</p>
                  <p className="mt-0.5 text-[13px] text-fg-muted">{i.batchName} · {plural(i.chapters.length, 'chapter')}</p>
                </div>
                <CourseProgress batchCourseId={i.batchCourseId} />
                <span className="mt-auto inline-flex items-center gap-1 text-[13px] font-medium text-accent-fg">Continue<ChevronRight size={14} aria-hidden /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
