'use client';
import Link from 'next/link';
import { ExternalLink, GraduationCap } from 'lucide-react';
import { ButtonLink, Card, DifficultyBadge, EmptyState, ErrorState, Grid, PageHeader, PageSkeleton, ProgressBar, StatCard } from '@/components/ui';
import { ContextPicker } from '@/components/student/ContextPicker';
import { ProgressNotices, ProgressStatusLine } from '@/components/student/SyncProvider';
import { useStudentDashboard } from '@/components/student/useContextChoice';
import { useAuth } from '@/lib/auth';
export default function Page() {
  const { user } = useAuth();
  const { data, error, reload, selectedId, choose } = useStudentDashboard();
  const first = user?.fullName.split(' ')[0];
  const title = first ? `Welcome back, ${first}` : 'Welcome back';
  if (error) return <ErrorState message={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const s = data.summary;
  const bc = data.selected?.batchCourseId;
  const current = data.chapters.find((c) => c.solved < c.total);
  const next = current?.problems?.find((p) => !p.verified);
  return (
    <div className="space-y-6">
      <PageHeader title={title} docTitle="Home" subtitle={data.selected ? `${data.selected.courseTitle} · ${data.selected.batchName}` : undefined}
        actions={<ContextPicker contexts={data.contexts} value={selectedId} onChange={choose} />} />
      <ProgressNotices />
      {!s || !bc ? (
        <Card><EmptyState icon={GraduationCap} title="You are not enrolled in a course yet"
          body="Your trainer enrolls you using your roll number. Once that is done, your course and progress appear here." /></Card>
      ) : (
        <>
          <Card title="Continue learning" footer={<ProgressStatusLine />}>
            {!data.chapters.length ? (
              <p className="text-sm text-fg-muted">Your trainer has not made any chapters visible yet. They will appear here.</p>
            ) : current ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="font-medium text-fg">{current.title}</p>
                  <p className="text-[13px] text-fg-muted">{current.solved} of {current.total} problems verified</p>
                  <ProgressBar value={current.completionPct} label={`${current.title} progress`} />
                </div>
                {next && (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                    <span>Next up:</span><span className="font-medium text-fg">{next.title}</span><DifficultyBadge d={next.difficulty} />
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <ButtonLink href={`/student/chapters/${current.chapterId}?batchCourseId=${bc}`}>Open chapter</ButtonLink>
                  {next?.url && <ButtonLink external href={next.url} variant="secondary" icon={<ExternalLink size={15} aria-hidden />}>Open on LeetCode<span className="sr-only"> (opens in a new tab)</span></ButtonLink>}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-fg">Every problem in your visible chapters is verified. New chapters appear here when your trainer makes them visible.</p>
                <ButtonLink href={`/student/courses/${bc}`} variant="secondary">Open course</ButtonLink>
              </div>
            )}
          </Card>
          <Grid>
            <StatCard label="Verified problems" value={`${s.verifiedSolved} / ${s.accessibleProblems}`} tone="good" />
            <StatCard label="Completion" value={s.completionPct === null ? '—' : `${s.completionPct}%`} hint={s.completionPct === null ? 'No chapters visible yet' : undefined} />
            <StatCard label="Points" value={s.points} hint={`Easy ${s.scoring.EASY} · Medium ${s.scoring.MEDIUM} · Hard ${s.scoring.HARD} per problem`} />
            <StatCard label="Batch rank" value={s.batchRank ? `#${s.batchRank}` : 'Unranked'} href="/student/leaderboard"
              hint={s.batchRank ? (s.courseRank ? `Course-wide #${s.courseRank}` : undefined) : 'After your first verified problem'} />
          </Grid>
          <Card title="Chapters" description={`${s.completedChapters} of ${s.unlockedChapters} complete`} flush>
            {!data.chapters.length ? <EmptyState compact title="No chapters yet" body="Your trainer makes chapters visible as the course goes on." /> : (
              <ul className="divide-y divide-line">
                {data.chapters.map((c) => (
                  <li key={c.chapterId}>
                    <Link href={`/student/chapters/${c.chapterId}?batchCourseId=${bc}`} className="block px-4 py-3 transition-colors hover:bg-hover">
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium text-fg">{c.title}</span>
                        <span className="shrink-0 tabular-nums text-[13px] text-fg-muted">{c.solved} / {c.total} verified</span>
                      </div>
                      <ProgressBar value={c.completionPct} size="sm" label={`${c.title} progress`} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
