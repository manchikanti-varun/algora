'use client';
import Link from 'next/link';
import { Card, EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/ui';
import { useApi } from '@/hooks/useApi';

interface Item { batchCourseId: string; batchName: string; title: string; description?: string; chapters: { _id: string; title: string }[] }
export default function Page() {
  const c = useApi<{ items: Item[] }>('/student/courses');
  if (c.error) return <ErrorState message={c.error} retry={c.reload} />;
  if (!c.data) return <PageSkeleton />;
  return (
    <div>
      <PageHeader title="My courses" />
      {!c.data.items.length ? <EmptyState title="No courses yet" body="Courses assigned to your batches appear here." /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {c.data.items.map((i) => (
            <Card key={i.batchCourseId} title={i.title} actions={<span className="text-xs text-slate-500">{i.batchName}</span>}>
              {i.description && <p className="mb-3 line-clamp-3 text-sm text-slate-600">{i.description}</p>}
              <p className="mb-3 text-sm text-slate-500">{i.chapters.length} chapter{i.chapters.length === 1 ? '' : 's'} available</p>
              <Link className="text-sm font-medium text-indigo-600 hover:underline" href={`/student/courses/${i.batchCourseId}`}>Open course →</Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
