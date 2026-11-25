'use client';
import Link from 'next/link';
import { BarList, Card, ErrorState, Grid, human, Notice, PageHeader, PageSkeleton, ProgressBar, StatCard, StatusBadge, ButtonLink, EmptyState } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { isAdmin, useAuth } from '@/lib/auth';
import type { Overview, Paged } from '@/components/manage/types';

export default function Page() {
  const { user } = useAuth();
  const o = useApi<Overview>('/analytics/overview');
  const pending = useApi<Paged<unknown>>(isAdmin(user) ? '/trainer-requests?status=PENDING_APPROVAL&pageSize=1' : null);
  const health = useApi<{ enabled: boolean; provider: string; breaker: string }>(isAdmin(user) ? '/leetcode/health' : null);
  if (o.loading && !o.data) return <PageSkeleton />;
  if (o.error) return <ErrorState message={o.error} retry={o.reload} />;
  const d = o.data!;
  const t = d.totals;
  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${user?.fullName.split(' ')[0]}`} subtitle={isAdmin(user) ? 'Platform-wide overview' : 'Overview of your assigned batches'}
        actions={<><ButtonLink href="/manage/batches/new" variant="secondary">New batch</ButtonLink>{user?.canManageCourses && <ButtonLink href="/manage/courses/new">New course</ButtonLink>}</>} />
      {isAdmin(user) && (pending.data?.total ?? 0) > 0 && <Notice tone="warn" title="Trainer requests waiting">{pending.data!.total} trainer access {pending.data!.total === 1 ? 'request is' : 'requests are'} waiting. <Link className="font-medium underline" href="/manage/trainers">Review</Link></Notice>}
      {health.data && !health.data.enabled && <Notice tone="info" title="Automatic LeetCode verification is off">Progress and leaderboards only include verified evidence, so they stay empty until verification is enabled. <Link className="underline" href="/manage/integration">Integration health</Link></Notice>}
      <Grid>
        <StatCard label="Enrolled students" value={t.enrolledStudents} hint={`${t.pendingEnrollments} pending enrollment${t.pendingEnrollments === 1 ? '' : 's'}`} />
        <StatCard label="Active (7 days)" value={t.activeStudents7d} hint="Opened Algora in the last week" />
        <StatCard label="Batches · courses" value={`${t.batches} · ${t.courses}`} />
        <StatCard label="Accessible problems" value={t.accessibleProblems} hint="Unlocked, summed over batch-courses" />
        <StatCard label="Verified completions" value={t.verifiedCompletions} tone="good" />
        <StatCard label="Average completion" value={t.avgCompletionPct === null ? '—' : `${t.avgCompletionPct}%`} hint="Students with unlocked work" />
        <StatCard label="Completed all available" value={t.completedAllAvailable} tone="good" />
        <StatCard label="Low progress (< 25%)" value={t.lowProgress} tone={t.lowProgress ? 'warn' : 'default'} />
      </Grid>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Batch comparison" className="lg:col-span-2" actions={<Link className="text-sm text-indigo-600 hover:underline" href="/manage/analytics">Analytics →</Link>}>
          <BarList items={d.batchComparison.map((b) => ({ label: b.name, value: b.avgCompletionPct, sub: `${b.students} students` }))} max={100} format={(n) => `${n}%`} />
        </Card>
        <Card title="Verification coverage">
          <p className="text-3xl font-semibold">{d.verification.coveragePct === null ? '—' : `${d.verification.coveragePct}%`}</p>
          <p className="mb-3 text-sm text-slate-500">{d.verification.verifiedLinks} of {d.verification.studentsInScope} students have a verified LeetCode account</p>
          <ul className="space-y-1 text-sm">{Object.entries(d.verification.linkStates).map(([k, v]) => <li key={k} className="flex justify-between"><StatusBadge status={k} /><span className="tabular-nums">{v}</span></li>)}</ul>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Difficulty performance">
          <div className="space-y-3">{(['EASY', 'MEDIUM', 'HARD'] as const).map((k) => (
            <div key={k}><div className="mb-1 flex justify-between text-sm"><span>{human(k)}</span><span className="tabular-nums text-slate-500">{d.difficulty[k].solved} / {d.difficulty[k].available}</span></div>
              <ProgressBar value={d.difficulty[k].available ? (d.difficulty[k].solved / d.difficulty[k].available) * 100 : null} label={`${k} completion`} /></div>))}</div>
        </Card>
        <Card title="Synchronization health">
          {Object.keys(d.sync.byStatus).length ? <ul className="space-y-1 text-sm">{Object.entries(d.sync.byStatus).map(([k, v]) => <li key={k} className="flex justify-between"><StatusBadge status={k} /><span className="tabular-nums">{v}</span></li>)}</ul> : <p className="text-sm text-slate-500">No students yet.</p>}
          <p className="mt-3 text-xs text-slate-500">Last scheduled run: {d.sync.lastJob ? `${human(d.sync.lastJob.status)} · ${new Date(d.sync.lastJob.at).toLocaleString()}` : 'none'}</p>
        </Card>
        <Card title="Needs support">
          {d.needsSupport.length ? (
            <ul className="divide-y divide-slate-100 text-sm">{d.needsSupport.slice(0, 8).map((r) => (
              <li key={`${r.studentId}-${r.batchCourseId}`} className="flex items-center justify-between gap-2 py-1.5">
                <Link className="truncate hover:underline" href={`/manage/students/${r.studentId}`}>{r.name}<span className="ml-1 text-xs text-slate-400">{r.batch}</span></Link>
                {r.linkState !== 'VERIFIED' ? <StatusBadge status={r.linkState} /> : <span className="tabular-nums text-slate-500">{r.completionPct}%</span>}
              </li>))}</ul>
          ) : <EmptyState title="Nobody flagged" body="Students below 25% or without a verified LeetCode account appear here." />}
        </Card>
      </div>
    </div>
  );
}
