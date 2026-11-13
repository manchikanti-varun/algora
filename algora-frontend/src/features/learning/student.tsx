'use client';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { useAdministration } from '@/features/administration/queries';
import { Status, Pagination, QueryState } from '@/components/shared/admin-ui';
import { StudentShell } from '@/features/students/shell';
const schema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      effectiveAccess: z.boolean(),
      courseId: z.string().optional(),
      batchId: z.string().optional(),
      courseTitle: z.string().optional(),
      batchName: z.string().optional(),
      collegeName: z.string().optional(),
      batchStatus: z.string().optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      message: z.string(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
  message: z.string().optional(),
});
export function StudentLearning({
  view = 'courses',
}: {
  view?: 'courses' | 'batches';
}) {
  const [page, setPage] = useState(1);
  const q = useAdministration('/students/me/' + view + '?page=' + page, schema);
  return (
    <StudentShell
      title={view === 'courses' ? 'Your learning, together.' : 'Your batches.'}
      description="Your own enrolled programs, real membership states and clear next steps."
    >
      <div className="student-actions">
        <Link href="/student/courses">My courses</Link>
        <Link href="/student/batches">My batches</Link>
        <Link href="/student/profile">My profile</Link>
      </div>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            {q.data.message && (
              <div className="student-notice">{q.data.message}</div>
            )}
            {q.data.items.length === 0 && (
              <section className="student-card">
                <h2>No enrolled programs to display</h2>
                <p>
                  Your authorized college team manages enrollment using your
                  current roll number. Registration alone does not grant course
                  access.
                </p>
              </section>
            )}
            <div className="learning-card-grid">
              {q.data.items.map((item) => (
                <article className="student-card" key={item.id}>
                  <Status value={item.status} />
                  <h2>{item.courseTitle ?? 'Membership requires review'}</h2>
                  {item.batchName && (
                    <p>
                      {item.batchName} · {item.collegeName}
                    </p>
                  )}
                  {item.batchStatus && (
                    <p>
                      Batch: {item.batchStatus.toLowerCase()} ·{' '}
                      {item.startDate ?? 'Date not set'} to{' '}
                      {item.endDate ?? 'date not set'}
                    </p>
                  )}
                  <div className="student-notice">
                    {item.effectiveAccess
                      ? 'Your enrollment is active. Explore your assigned curriculum.'
                      : item.message.replaceAll('_', ' ').toLowerCase() ||
                        'This membership does not currently grant learning access.'}
                  </div>
                  {item.effectiveAccess && item.courseId && item.batchId && (
                    <div className="student-actions">
                      <Link href={'/student/courses/' + item.courseId}>
                        Course overview
                      </Link>
                      <Link href={'/student/batches/' + item.batchId}>
                        Open learning path
                      </Link>
                    </div>
                  )}
                </article>
              ))}
            </div>
            <Pagination
              page={page}
              total={q.data.total}
              totalPages={q.data.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </QueryState>
    </StudentShell>
  );
}
