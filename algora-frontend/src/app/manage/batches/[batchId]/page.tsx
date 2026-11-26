'use client';
import Link from 'next/link';
import { Eye, UserPlus, BookPlus } from 'lucide-react';
import { BarList, ButtonLink, Card, EmptyState, ErrorState, Grid, PageSkeleton, pct, plural, StatCard, StatusBadge, usePageTitle } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import type { Overview } from '@/components/manage/types';

type Resp = Overview & { chapters: { chapter: string; course: string; avgCompletionPct: number | null; completedStudents: number; students: number }[] };

export default function Page() {
  const { batch } = useBatch();
  usePageTitle(`Overview · ${batch.name}`);
  const a = useApi<Resp>(`/analytics/batches/${batch._id}`);
  const base = `/manage/batches/${batch._id}`;
  const ro = batch.status === 'ARCHIVED';
  if (a.error) return <ErrorState message={a.error} retry={a.reload} />;
  if (!a.data) return <PageSkeleton />;
  const t = a.data.totals; const v = a.data.verification;
  const support = (a.data.needsSupport ?? []).slice(0, 6);
  const reserved = t.pendingEnrollments;
  return (
    <div className="space-y-6">
      <Grid>
        <StatCard label="Students" value={batch.studentCount ?? 0} hint={reserved ? `${reserved} reserved` : undefined} href={`${base}/students`} />
        <StatCard label="Courses" value={batch.courseCount ?? 0} href={`${base}/courses`} />
        <StatCard label="Average completion" value={pct(t.avgCompletionPct)} />
        <StatCard label="LeetCode connected" value={`${v.verifiedLinks} / ${v.studentsInScope}`} hint="Students with a connected account" tone={v.studentsInScope > 0 && v.verifiedLinks === v.studentsInScope ? 'good' : 'default'} />
      </Grid>
      {!ro && (
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`${base}/students`} variant="secondary" size="sm" icon={<UserPlus size={15} aria-hidden />}>Enroll students</ButtonLink>
          <ButtonLink href={`${base}/visibility`} variant="secondary" size="sm" icon={<Eye size={15} aria-hidden />}>Manage chapter access</ButtonLink>
          {!batch.courseCount && <ButtonLink href={`${base}/courses`} size="sm" icon={<BookPlus size={15} aria-hidden />}>Assign a course</ButtonLink>}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Chapter completion" description="Average completion of visible chapters">
          {a.data.chapters.length
            ? <BarList items={a.data.chapters.map((c) => ({ key: `${c.course}-${c.chapter}`, label: `${c.course} · ${c.chapter}`, value: c.avgCompletionPct, sub: `${c.completedStudents}/${c.students} done` }))} max={100} format={(n) => `${n}%`} />
            : <EmptyState compact title="No chapters visible yet" body="Assign a course, then make chapters visible in Chapter Access." action={<ButtonLink href={`${base}/visibility`} variant="secondary" size="sm">Chapter Access</ButtonLink>} />}
        </Card>
        <Card title="Students who may need support" flush>
          {support.length ? (
            <ul className="divide-y divide-line">
              {support.map((r) => (
                <li key={`${r.studentId}-${r.batchCourseId}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <Link className="min-w-0 truncate font-medium text-fg hover:text-accent-fg hover:underline" href={`/manage/students/${r.studentId}`}>{r.name}</Link>
                  {r.linkState === 'UNLINKED' ? <StatusBadge status="UNLINKED" /> : <span className="shrink-0 tabular-nums text-fg-muted">{pct(r.completionPct)}</span>}
                </li>
              ))}
            </ul>
          ) : <EmptyState compact title="Nobody flagged" body={`${plural(batch.studentCount ?? 0, 'student')} in this batch.`} />}
        </Card>
      </div>
    </div>
  );
}
