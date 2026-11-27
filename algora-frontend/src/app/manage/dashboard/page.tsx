'use client';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, CirclePlus, GraduationCap, Hourglass, Inbox, Link2, Link2Off, Target, UserPlus, UsersRound, ZapOff, type LucideIcon } from 'lucide-react';
import { BarList, Card, DataTable, ErrorState, Grid, human, PageHeader, PageSkeleton, plural, pct, ProgressBar, StatCard, StatusBadge, ButtonLink, EmptyState } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { isAdmin, useAuth } from '@/lib/auth';
import type { Overview } from '@/components/manage/types';

interface DashboardData {
  overview: Overview;
  counts: { studentRequests: number; trainerRequests: number; pendingEnrollments: number };
  integration: { enabled?: boolean | null; paused: boolean | null };
}
interface Attention { key: string; icon: LucideIcon; text: string; count?: number; href: string; linkLabel: string }

export default function Page() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  // One scoped request drives the whole above-the-fold dashboard (metrics, attention counts, integration state).
  const d = useApi<DashboardData>('/dashboard/overview');

  const header = (
    <PageHeader title="Overview" subtitle={`Welcome, ${user?.fullName.split(' ')[0] ?? ''}. ${admin ? 'Platform-wide summary.' : 'Summary of your batches.'}`}
      actions={<>
        <ButtonLink href="/manage/batches/new" prefetch={false} icon={<CirclePlus size={16} aria-hidden />}>New batch</ButtonLink>
        <ButtonLink href="/manage/ai-preparation" variant="secondary" prefetch={false}>AI Preparation</ButtonLink>
        {user?.canManageCourses && <ButtonLink href="/manage/courses/new" variant="secondary" prefetch={false}>New course</ButtonLink>}
      </>} />
  );
  if (d.loading && !d.data) return <div>{header}<PageSkeleton /></div>;
  if (d.error) return <div>{header}<ErrorState message={d.error} retry={d.reload} /></div>;
  const data = d.data!;
  const o = data.overview;
  const t = o.totals;
  const unlinked = o.verification.linkStates.UNLINKED ?? 0;
  const hasStatus = o.batchComparison.some((b) => b.status);
  const activeBatches = hasStatus ? o.batchComparison.filter((b) => b.status === 'ACTIVE') : o.batchComparison;
  const activeCount = hasStatus ? activeBatches.length : t.batches;

  const attention: Attention[] = [
    admin && { key: 'req', icon: UserPlus, text: 'Trainer requests are waiting for approval', count: data.counts.trainerRequests, href: '/manage/trainers', linkLabel: 'Review' },
    admin && data.integration.enabled === false && { key: 'off', icon: ZapOff, text: 'Progress updates are off, so progress will not change', href: '/manage/integration', linkLabel: 'Integrations' },
    { key: 'pend', icon: Hourglass, text: 'Reserved enrollments have not been claimed yet', count: data.counts.pendingEnrollments, href: '/manage/batches', linkLabel: 'Open batches' },
    { key: 'student-requests', icon: Inbox, text: 'Student requests awaiting review', count: data.counts.studentRequests, href: '/manage/requests', linkLabel: 'Review' },
    { key: 'unl', icon: Link2Off, text: 'Students have not connected a LeetCode account', count: unlinked, href: '/manage/students?issue=MISSING_USERNAME', linkLabel: 'View students' },
  ].filter((x): x is Attention => !!x && (x.count === undefined || x.count > 0));

  const support = o.needsSupport.slice(0, 6);
  const diff = o.difficulty;

  return (
    <div className="space-y-6">
      {header}
      <Grid>
        <StatCard label="Enrolled students" value={t.enrolledStudents} icon={<GraduationCap size={16} />} hint={plural(t.pendingEnrollments, 'reserved seat')} />
        <StatCard label="Active batches" value={activeCount} icon={<UsersRound size={16} />} href="/manage/batches" />
        <StatCard label="Average completion" value={pct(t.avgCompletionPct)} icon={<Target size={16} />}
          hint={<ProgressBar value={t.avgCompletionPct} label="Average completion" size="sm" showValue={false} />} />
        <StatCard label="LeetCode connection" value={pct(o.verification.coveragePct)} icon={<Link2 size={16} />}
          hint={`${o.verification.verifiedLinks} of ${o.verification.studentsInScope} students connected`} />
      </Grid>

      <div className="grid items-start gap-5 lg:grid-cols-2">
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

        <Card title="Students who may need support" description="Low verified completion after a successful update, or no connected account" flush>
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
          ) : <EmptyState compact title="Nobody flagged" body="No students currently match these criteria." />}
        </Card>
      </div>

      <Card title="Active batches" actions={<ButtonLink href="/manage/batches" variant="secondary" size="sm" prefetch={false}>All batches</ButtonLink>} flush>
        <DataTable caption="Active batches" rows={activeBatches.slice(0, 8)} rowKey={(batch) => batch.batchId}
          empty={<EmptyState compact title="No active batches" body="Create a batch to enroll students." action={<ButtonLink href="/manage/batches/new" size="sm" prefetch={false}>New batch</ButtonLink>} />}
          columns={[
            { key: 'batch', header: 'Batch', cell: (b) => <div className="max-w-64 whitespace-normal"><Link href={`/manage/batches/${b.batchId}`} className="font-medium text-accent-fg hover:underline">{b.name}</Link>{b.college && <p className="text-xs text-fg-muted">{b.college}</p>}</div> },
            { key: 'courses', header: 'Courses', cell: (b) => <span className="block max-w-64 whitespace-normal">{b.courses?.length ? b.courses.join(', ') : 'No courses assigned'}</span> },
            { key: 'students', header: 'Students', cell: (b) => <span className="tabular-nums">{b.students}</span> },
            { key: 'completion', header: 'Average completion', className: 'min-w-40', cell: (b) => <ProgressBar value={b.avgCompletionPct} size="sm" label={`${b.name} average completion`} /> },
            { key: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
            { key: 'actions', header: 'Actions', cell: (b) => <ButtonLink href={`/manage/batches/${b.batchId}/students`} variant="secondary" size="xs">Manage students</ButtonLink> },
          ]} />
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Performance by difficulty" description="Verified problems out of available problems">
          <div className="space-y-3">
            {(['EASY', 'MEDIUM', 'HARD'] as const).map((k) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-sm"><span className="text-fg">{human(k)}</span><span className="tabular-nums text-fg-muted">{diff[k].available ? `${diff[k].solved} / ${diff[k].available}` : 'Not assigned'}</span></div>
                {diff[k].available > 0 && <ProgressBar value={(diff[k].solved / diff[k].available) * 100} label={`${human(k)} completion`} />}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Course completion" description="Average completion per course">
          <BarList items={o.courseCompletion.map((c) => ({ key: c.courseId, label: c.title, value: c.avgCompletionPct, sub: plural(c.rows, 'student') }))} max={100} format={(n) => `${n}%`} empty="No course data yet" />
        </Card>
      </div>

      {admin && (
        <Card title="System health" actions={<Link className="text-[13px] text-accent-fg hover:underline" href="/manage/integration">Integrations</Link>}>
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-fg">
              Progress updates
              {data.integration.enabled === undefined || data.integration.enabled === null ? <span className="text-fg-subtle">…</span>
                : <StatusBadge status={data.integration.enabled ? 'ACTIVE' : 'INACTIVE'} label={data.integration.enabled ? 'On' : 'Off'} />}
            </p>
            {Object.keys(o.sync.byStatus).length ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Student update states">
                {Object.entries(o.sync.byStatus).map(([k, v]) => <li key={k} className="flex items-center gap-1.5"><StatusBadge status={k} /><span className="tabular-nums text-fg-muted">{v}</span></li>)}
              </ul>
            ) : <p className="text-fg-subtle">No students yet.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
