'use client';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, Hourglass, Link2Off, TrendingDown, UserPlus, ZapOff, type LucideIcon } from 'lucide-react';
import { BarList, Card, ErrorState, Grid, human, PageHeader, PageSkeleton, plural, pct, ProgressBar, StatCard, StatusBadge, ButtonLink, EmptyState } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { isAdmin, useAuth } from '@/lib/auth';
import type { Overview, Paged } from '@/components/manage/types';

interface Attention { key: string; icon: LucideIcon; text: string; count?: number; href: string; linkLabel: string }

export default function Page() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const o = useApi<Overview>('/analytics/overview');
  const pending = useApi<Paged<unknown>>(admin ? '/trainer-requests?status=PENDING_APPROVAL&pageSize=1' : null);
  const health = useApi<{ enabled: boolean; provider: string; breaker: string }>(admin ? '/leetcode/health' : null);

  const header = (
    <PageHeader title="Overview" subtitle={`Welcome, ${user?.fullName.split(' ')[0] ?? ''}. ${admin ? 'Platform-wide summary.' : 'Summary of your batches.'}`}
      actions={<>
        <ButtonLink href="/manage/batches/new" variant={user?.canManageCourses ? 'secondary' : 'primary'}>New batch</ButtonLink>
        {user?.canManageCourses && <ButtonLink href="/manage/courses/new">New course</ButtonLink>}
      </>} />
  );
  if (o.loading && !o.data) return <div>{header}<PageSkeleton /></div>;
  if (o.error) return <div>{header}<ErrorState message={o.error} retry={o.reload} /></div>;
  const d = o.data!;
  const t = d.totals;
  const unlinked = d.verification.linkStates.UNLINKED ?? 0;
  const hasStatus = d.batchComparison.some((b) => b.status);
  const activeBatches = hasStatus ? d.batchComparison.filter((b) => b.status === 'ACTIVE') : d.batchComparison;
  const activeCount = hasStatus ? activeBatches.length : t.batches;

  const attention: Attention[] = [
    admin && { key: 'req', icon: UserPlus, text: 'Trainer requests are waiting for approval', count: pending.data?.total ?? 0, href: '/manage/trainers', linkLabel: 'Review' },
    admin && health.data?.enabled === false && { key: 'off', icon: ZapOff, text: 'Progress updates are off, so progress will not change', href: '/manage/integration', linkLabel: 'Integrations' },
    { key: 'pend', icon: Hourglass, text: 'Reserved enrollments have not been claimed yet', count: t.pendingEnrollments, href: '/manage/batches', linkLabel: 'Open batches' },
    { key: 'low', icon: TrendingDown, text: 'Students are below 25% completion', count: t.lowProgress, href: '/manage/analytics?maxPct=25', linkLabel: 'View students' },
    { key: 'unl', icon: Link2Off, text: 'Students have not connected a LeetCode account', count: unlinked, href: '/manage/analytics?verification=UNLINKED', linkLabel: 'View students' },
  ].filter((x): x is Attention => !!x && (x.count === undefined || x.count > 0));

  const support = d.needsSupport.slice(0, 6);
  const diff = d.difficulty;

  return (
    <div className="space-y-6">
      {header}
      <Grid>
        {admin ? (
          <>
            <StatCard label="Enrolled students" value={t.enrolledStudents} />
            <StatCard label="Active batches" value={activeCount} href="/manage/batches" />
            <StatCard label="Average completion" value={pct(t.avgCompletionPct)} />
            <StatCard label="LeetCode connection" value={pct(d.verification.coveragePct)} hint={`${d.verification.verifiedLinks} of ${d.verification.studentsInScope} students connected`} />
          </>
        ) : (
          <>
            <StatCard label="My batches" value={t.batches} href="/manage/batches" />
            <StatCard label="Students" value={t.enrolledStudents} />
            <StatCard label="Average completion" value={pct(t.avgCompletionPct)} />
            <StatCard label="Reserved enrollments" value={t.pendingEnrollments} hint="Reserved, not yet claimed" />
          </>
        )}
      </Grid>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Needs attention" flush>
          {attention.length ? (
            <ul className="divide-y divide-line">
              {attention.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-hover">
                    <a.icon size={16} aria-hidden className="shrink-0 text-warning-fg" />
                    <span className="min-w-0 flex-1 text-fg">
                      {a.count !== undefined && <span className="mr-1.5 font-semibold tabular-nums">{a.count}</span>}{a.text}
                    </span>
                    <span className="hidden shrink-0 text-[13px] text-accent-fg sm:inline">{a.linkLabel}</span>
                    <ChevronRight size={15} aria-hidden className="shrink-0 text-fg-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-fg-muted"><CheckCircle2 size={16} aria-hidden className="text-success-fg" />Nothing needs your attention</div>
          )}
        </Card>

        <Card title="Students who may need support" description="Below 25% completion or without a connected LeetCode account" flush>
          {support.length ? (
            <ul className="divide-y divide-line">
              {support.map((r) => (
                <li key={`${r.studentId}-${r.batchCourseId}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <Link className="block truncate font-medium text-fg hover:text-accent-fg hover:underline" href={`/manage/students/${r.studentId}`}>{r.name}</Link>
                    <span className="block truncate text-xs text-fg-subtle">{r.batch}</span>
                  </div>
                  {r.linkState === 'UNLINKED' ? <StatusBadge status="UNLINKED" /> : <span className="shrink-0 tabular-nums text-fg-muted">{pct(r.completionPct)}</span>}
                </li>
              ))}
            </ul>
          ) : <EmptyState compact title="Nobody flagged" body="Students who fall behind will appear here." />}
        </Card>
      </div>

      <Card title={admin ? 'Active batches' : 'Your batches'} actions={<Link className="text-[13px] text-accent-fg hover:underline" href="/manage/batches">All batches</Link>} flush>
        {activeBatches.length ? (
          <ul className="divide-y divide-line">
            {activeBatches.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1 basis-48">
                  <Link href={`/manage/batches/${b.batchId}`} className="block truncate font-medium text-fg hover:text-accent-fg hover:underline">{b.name}</Link>
                  <span className="text-xs text-fg-subtle">{plural(b.students, 'student')}</span>
                </div>
                <ProgressBar value={b.avgCompletionPct} size="sm" label={`${b.name} average completion`} className="w-40 sm:w-52" />
                <div className="flex gap-3 text-[13px]">
                  <Link className="text-accent-fg hover:underline" href={`/manage/batches/${b.batchId}/students`}>Students</Link>
                  <Link className="text-accent-fg hover:underline" href={`/manage/batches/${b.batchId}/visibility`}>Chapter Access</Link>
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState compact title={admin ? 'No active batches' : 'No batches yet'} body="Create a batch to enroll students." action={<ButtonLink href="/manage/batches/new" size="sm">New batch</ButtonLink>} />}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Performance by difficulty" description="Verified problems out of available problems">
          <div className="space-y-3">
            {(['EASY', 'MEDIUM', 'HARD'] as const).map((k) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-sm"><span className="text-fg">{human(k)}</span><span className="tabular-nums text-fg-muted">{diff[k].solved} / {diff[k].available}</span></div>
                <ProgressBar value={diff[k].available ? (diff[k].solved / diff[k].available) * 100 : null} label={`${human(k)} completion`} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Course completion" description="Average completion per course">
          <BarList items={d.courseCompletion.map((c) => ({ key: c.courseId, label: c.title, value: c.avgCompletionPct, sub: plural(c.rows, 'student') }))} max={100} format={(n) => `${n}%`} empty="No course data yet" />
        </Card>
      </div>

      {admin && (
        <Card title="System health" actions={<Link className="text-[13px] text-accent-fg hover:underline" href="/manage/integration">Integrations</Link>}>
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-fg">
              Progress updates
              {health.data ? <StatusBadge status={health.data.enabled ? 'ACTIVE' : 'INACTIVE'} label={health.data.enabled ? 'On' : 'Off'} /> : <span className="text-fg-subtle">…</span>}
            </p>
            {Object.keys(d.sync.byStatus).length ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Student update states">
                {Object.entries(d.sync.byStatus).map(([k, v]) => <li key={k} className="flex items-center gap-1.5"><StatusBadge status={k} /><span className="tabular-nums text-fg-muted">{v}</span></li>)}
              </ul>
            ) : <p className="text-fg-subtle">No students yet.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
