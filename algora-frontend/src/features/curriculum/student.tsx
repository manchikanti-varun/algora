'use client';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { useAdministration } from '@/features/administration/queries';
import { StudentShell } from '@/features/students/shell';
import { Pagination, QueryState, Status } from '@/components/shared/admin-ui';
import {
  studentBatchSchema,
  studentDayResponse,
  pageSchema,
  dayLabel,
} from './contracts';
import { DayContent, SafeMarkdown } from './render';
const courseSchema = z.object({
  course: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    difficulty: z.string(),
  }),
  batches: pageSchema(
    z.object({
      id: z.string(),
      name: z.string(),
      curriculumRevision: z
        .object({ id: z.string(), revisionNumber: z.number() })
        .nullable(),
    }),
  ),
});
export function StudentCourse({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const q = useAdministration(
    '/students/me/courses/' + id + '?page=' + page,
    courseSchema,
  );
  return (
    <StudentShell
      title="Your Course."
      description="A reusable curriculum, delivered through your authorized Batch."
    >
      <nav aria-label="Breadcrumb">
        <Link href="/student/courses">My courses</Link> / Course overview
      </nav>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <section className="student-card">
              <Status value={q.data.course.difficulty} />
              <h2>{q.data.course.title}</h2>
              <SafeMarkdown text={q.data.course.description} />
            </section>
            <h2>Your eligible Batches</h2>
            <div className="learning-card-grid">
              {q.data.batches.items.map((b) => (
                <article className="student-card" key={b.id}>
                  <h3>{b.name}</h3>
                  <p>
                    {b.curriculumRevision
                      ? 'Curriculum revision ' +
                        b.curriculumRevision.revisionNumber
                      : 'Curriculum not assigned'}
                  </p>
                  <Link href={'/student/batches/' + b.id}>
                    Open Batch learning path →
                  </Link>
                </article>
              ))}
            </div>
            <Pagination
              page={page}
              total={q.data.batches.total}
              totalPages={q.data.batches.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </QueryState>
    </StudentShell>
  );
}
export function StudentBatch({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const q = useAdministration(
    '/students/me/batches/' + id + '/curriculum?page=' + page,
    studentBatchSchema,
  );
  return (
    <StudentShell
      title="Your learning path."
      description="Explore every released day in your assigned curriculum. No sequential unlocking."
    >
      <nav aria-label="Breadcrumb">
        <Link href="/student/batches">My batches</Link> / Learning path
      </nav>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <section className="student-card">
              <span className="eyebrow">{q.data.batch.courseTitle}</span>
              <h2>{q.data.batch.name}</h2>
              <p>{q.data.batch.collegeName ?? 'Your authorized college'}</p>
              <p>
                {q.data.revision
                  ? 'Pinned curriculum revision ' +
                    q.data.revision.revisionNumber
                  : 'Curriculum not assigned'}
              </p>
              {q.data.revision?.courseSnapshot && (
                <SafeMarkdown
                  text={q.data.revision.courseSnapshot.description}
                />
              )}
              <div className="student-notice">
                {q.data.message ||
                  'Choose any released Learning Day. Completion and solved checkboxes are intentionally absent.'}
              </div>
            </section>
            <div className="learning-card-grid">
              {q.data.days.items.map((d) => (
                <article
                  className="student-card curriculum-day-card"
                  key={d.id}
                >
                  <span className="eyebrow">{dayLabel(d.dayNumber)}</span>
                  <h2>{d.title}</h2>
                  <ul>
                    {d.topics.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                  <p>
                    {d.resourceCount} resources · {d.problemCount} assigned
                    problems
                  </p>
                  <Link
                    href={'/student/batches/' + id + '/days/' + d.dayNumber}
                  >
                    Explore this day →
                  </Link>
                </article>
              ))}
            </div>
            <Pagination
              page={page}
              total={q.data.days.total}
              totalPages={q.data.days.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </QueryState>
    </StudentShell>
  );
}
export function StudentLearningDay({
  batchId,
  number,
}: {
  batchId: string;
  number: number;
}) {
  const q = useAdministration(
    '/students/me/batches/' + batchId + '/days/' + number,
    studentDayResponse,
  );
  return (
    <StudentShell
      title={dayLabel(number)}
      description="Topics, trusted resources and guided coding practice."
    >
      <nav aria-label="Breadcrumb">
        <Link href="/student/courses">My courses</Link> /{' '}
        <Link href={'/student/batches/' + batchId}>Batch learning path</Link> /{' '}
        {dayLabel(number)}
      </nav>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <p>
              {q.data.batch.name} · Curriculum revision{' '}
              {q.data.revision.revisionNumber}
            </p>
            <DayContent day={q.data.day} />
          </>
        )}
      </QueryState>
    </StudentShell>
  );
}
