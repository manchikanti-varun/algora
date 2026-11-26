'use client';
import Link from 'next/link';
import { BookOpen, ChevronRight } from 'lucide-react';
import { ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageSkeleton, plural, ProgressBar } from '@/components/ui';
import { useSync } from '@/components/student/SyncProvider';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
interface Item {
  batchCourseId: string; batchName: string; title: string; description?: string; chapters: { _id: string; title: string }[];
  progress: { verifiedSolved: number; total: number; completionPct: number | null };
  nextChapterId: string | null;
}
export default function Page() {
  const { version } = useSync();
  const c = useApi<{ items: Item[] }>(`/student/courses${qs({ v: version })}`);
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
              <Card className="h-full">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-fg"><BookOpen size={19} aria-hidden /></span>
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold tracking-tight"><Link href={`/student/courses/${i.batchCourseId}`} className="hover:text-accent-fg hover:underline">{i.title}</Link></h2>
                      <p className="text-sm text-fg-muted">{i.batchName} · {plural(i.chapters.length, 'chapter')}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm text-fg-muted">{i.progress.verifiedSolved} of {i.progress.total} verified</p>
                    <ProgressBar value={i.progress.completionPct} label={`${i.title} progress`} />
                  </div>
                  <ButtonLink href={i.nextChapterId ? `/student/chapters/${i.nextChapterId}?batchCourseId=${i.batchCourseId}` : `/student/courses/${i.batchCourseId}`}
                    variant={i.nextChapterId ? 'primary' : 'secondary'} size="sm">
                    {i.nextChapterId ? 'Continue learning' : 'View course'}<ChevronRight size={15} aria-hidden />
                  </ButtonLink>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
