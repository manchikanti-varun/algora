'use client';
import Link from 'next/link';
import { ArrowRight, BookOpen, CircleCheck, ExternalLink, GraduationCap, Target, Trophy, Zap } from 'lucide-react';
import { Badge, ButtonLink, Card, Popover, DifficultyBadge, EmptyState, ErrorState, Grid, PageHeader, PageSkeleton, ProgressBar, StatCard } from '@/components/ui';
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
      {data.previousPractice && <Card title="Continue practice" description={`${data.previousPractice.course} · ${data.previousPractice.chapter}`}>
        <p className="mb-3 font-medium">{data.previousPractice.title} <DifficultyBadge d={data.previousPractice.difficulty} /></p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink external variant="secondary" href={data.previousPractice.url}>Continue on LeetCode</ButtonLink>
          {data.previousPractice.allowed && <ButtonLink variant="ghost" href={`/student/chapters/${data.previousPractice.chapterId}?batchCourseId=${data.previousPractice.batchCourseId}&ai=${data.previousPractice.problemId}`}>Ask AI</ButtonLink>}
        </div>
      </Card>}
      {!s || !bc ? (
        <Card><EmptyState icon={GraduationCap} title="You are not enrolled in a course yet"
          body="Your trainer enrolls you using your roll number. Once that is done, your course and progress appear here." /></Card>
      ) : (
        <>
          <Card tone="accent" title="Continue learning">
            {!s.accessibleProblems ? (
              <p className="text-sm text-fg-muted">Your trainer hasn’t made any problems available yet. Check back when your next chapter opens.</p>
            ) : current ? (
              <div className="grid items-center gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
                <div className="space-y-2">
                  <p className="text-xl font-semibold tracking-tight text-fg">{current.title}</p>
                  <p className="text-[13px] text-fg-muted">{current.solved} of {current.total} problems verified</p>
                  <ProgressBar value={current.completionPct} label={`${current.title} progress`} />
                </div>
                <div className="space-y-3 md:border-l md:border-accent-line md:pl-5">
                {next && (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                    <span>Next up:</span><span className="font-medium text-fg">{next.title}</span><DifficultyBadge d={next.difficulty} />
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <ButtonLink href={`/student/chapters/${current.chapterId}?batchCourseId=${bc}`} icon={<ArrowRight size={16} aria-hidden />}>Continue learning</ButtonLink>
                  {next?.url && <ButtonLink external href={next.url} variant="secondary" icon={<ExternalLink size={15} aria-hidden />}>Open on LeetCode<span className="sr-only"> (opens in a new tab)</span></ButtonLink>}
                </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-fg">Every problem in your visible chapters is verified. New chapters appear here when your trainer makes them visible.</p>
                <ButtonLink href={`/student/courses/${bc}`} variant="secondary">Open course</ButtonLink>
              </div>
            )}
            <ProgressStatusLine />
          </Card>
          <Grid>
            <StatCard label="Verified problems" icon={<CircleCheck size={16} />} value={`${s.verifiedSolved} / ${s.accessibleProblems}`} tone="good" />
            <StatCard label="Completion" icon={<Target size={16} />} value={s.completionPct === null ? '—' : `${s.completionPct}%`} hint={s.completionPct === null ? 'No chapters visible yet' : undefined} />
            <StatCard label="Points" icon={<Zap size={16} />} value={s.points} hint={<Popover label="Scoring rules" button="Scoring rules" size="xs"><p className="p-3">Easy {s.scoring.EASY} · Medium {s.scoring.MEDIUM} · Hard {s.scoring.HARD} points per verified problem</p></Popover>} />
            <StatCard label="Batch rank" icon={<Trophy size={16} />} value={s.batchRank ? `#${s.batchRank}` : 'Unranked'} href="/student/leaderboard"
              hint={s.batchRank ? 'View leaderboard' : 'After your first verified problem'} />
          </Grid>
          <Card title="Chapters" description={`${s.completedChapters} of ${s.unlockedChapters} complete`} flush>
            {!data.chapters.length ? <EmptyState compact title="No chapters yet" body="Your trainer makes chapters visible as the course goes on." /> : (
              <ul className="divide-y divide-line">
                {data.chapters.map((c) => (
                  <li key={c.chapterId}>
                    <Link href={`/student/chapters/${c.chapterId}?batchCourseId=${bc}`} className="grid items-center gap-3 px-5 py-3 transition-colors hover:bg-hover sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.6fr)_auto]">
                      <div className="flex min-w-0 items-center gap-3 text-sm">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-subtle text-accent-fg"><BookOpen size={16} aria-hidden /></span>
                        <span className="min-w-0"><span className="block break-words font-medium text-fg">{c.title}</span>
                          <span className="tabular-nums text-xs text-fg-muted">{c.solved} / {c.total} verified</span></span>
                      </div>
                      <ProgressBar value={c.completionPct} size="sm" label={`${c.title} progress`} />
                      <span className="flex items-center justify-between gap-3"><Badge tone={c.completionPct === 100 ? 'success' : 'neutral'}>{c.completionPct === 100 ? 'Complete' : c.total ? 'Available' : 'No problems'}</Badge><ArrowRight size={16} aria-hidden className="text-accent-fg" /></span>
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
