'use client';
import { CalendarCheck2, ClipboardList, FileBarChart, Plus, ScanLine } from 'lucide-react';
import { ButtonLink, Card, EmptyState, ErrorState, Grid, PageHeader, PageSkeleton, StatCard, StatusBadge } from '@/components/ui';
import { AttendanceScopeFilters, type AttendanceScope } from '@/components/attendance/AttendanceFilters';
import { AttendanceTabs } from '@/components/attendance/AttendanceTabs';
import { SessionsTable } from '@/components/attendance/SessionsTable';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { attendancePct, type SessionSummary } from '@/lib/attendance';
import { qs } from '@/lib/api';

interface Overview {
  totals: { sessions: number; eligible: number; present: number; absent: number; morningSessions: number; afternoonSessions: number; draftSessions: number; cancelledSessions: number; percentage: number | null };
  batches: number; batchesWithAttendance: number; recent: SessionSummary[];
}

export default function Page() {
  const [filters, setFilters] = useUrlState<AttendanceScope>({ batchId: '', collegeId: '', from: '', to: '', sessionType: '' });
  const o = useApi<Overview>(`/attendance/overview${qs(filters)}`);
  const clear = () => setFilters({ batchId: '', collegeId: '', from: '', to: '', sessionType: '' });
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" subtitle="QR-scanned attendance for the batches you can access."
        actions={<ButtonLink href={`/manage/attendance/record${filters.batchId ? `?batchId=${filters.batchId}` : ''}`} icon={<Plus size={16} aria-hidden />}>Record attendance</ButtonLink>} />
      <AttendanceTabs />
      <AttendanceScopeFilters value={filters} onChange={(patch) => setFilters(patch)} onClear={clear} />
      {o.error ? <ErrorState message={o.error} retry={o.reload} /> : !o.data ? <PageSkeleton /> : (
        <>
          <Grid>
            <StatCard label="Finalized sessions" value={o.data.totals.sessions} hint={o.data.totals.draftSessions ? `${o.data.totals.draftSessions} draft${o.data.totals.draftSessions === 1 ? '' : 's'} waiting` : undefined} icon={<CalendarCheck2 size={16} aria-hidden />} />
            <StatCard label="Attendance opportunities" value={o.data.totals.eligible} hint="Eligible students × recorded sessions" icon={<ClipboardList size={16} aria-hidden />} />
            <StatCard label="Present records" value={o.data.totals.present} hint={`${o.data.totals.absent} absent`} tone="good" icon={<ScanLine size={16} aria-hidden />} />
            <StatCard label="Overall attendance" value={attendancePct(o.data.totals.percentage)} hint={`${o.data.batchesWithAttendance} of ${o.data.batches} batch${o.data.batches === 1 ? '' : 'es'} with attendance`} icon={<FileBarChart size={16} aria-hidden />} />
          </Grid>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/manage/attendance/sessions" variant="secondary" size="sm">Session history</ButtonLink>
            <ButtonLink href="/manage/attendance/analytics" variant="secondary" size="sm">Analytics</ButtonLink>
            <ButtonLink href="/manage/attendance/register" variant="secondary" size="sm">Attendance register</ButtonLink>
            <ButtonLink href="/manage/attendance/students" variant="secondary" size="sm">Student attendance</ButtonLink>
          </div>
          <Card title="Recent sessions" description="Newest recorded attendance across the selected scope" actions={
            <div className="flex items-center gap-2 text-[13px] text-fg-muted">
              {o.data.totals.draftSessions > 0 && <StatusBadge status="DRAFT" label={`${o.data.totals.draftSessions} draft`} />}
              {o.data.totals.cancelledSessions > 0 && <span>{o.data.totals.cancelledSessions} cancelled</span>}
            </div>
          } flush>
            <SessionsTable sessions={o.data.recent} showBatch empty={
              <EmptyState icon={CalendarCheck2} title="No attendance recorded yet" body="Record attendance from a scanner CSV to start building history."
                action={<ButtonLink href={`/manage/attendance/record${filters.batchId ? `?batchId=${filters.batchId}` : ''}`} size="sm">Record attendance</ButtonLink>} />
            } />
          </Card>
        </>
      )}
    </div>
  );
}
