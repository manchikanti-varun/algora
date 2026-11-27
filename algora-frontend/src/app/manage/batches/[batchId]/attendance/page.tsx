'use client';
import { CalendarCheck2, Download, Plus, UsersRound } from 'lucide-react';
import { Button, ButtonLink, Card, EmptyState, ErrorState, Grid, PageSkeleton, StatCard } from '@/components/ui';
import { SessionsTable } from '@/components/attendance/SessionsTable';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { attendancePct, type SessionSummary } from '@/lib/attendance';
import { download } from '@/lib/api';

interface Summary {
  batch: { _id: string; name: string; status: string }; enrolled: number;
  totals: { sessions: number; eligible: number; present: number; absent: number; percentage: number | null; draftSessions: number; cancelledSessions: number };
  morning: { sessions: number; percentage: number | null; present: number; absent: number };
  afternoon: { sessions: number; percentage: number | null; present: number; absent: number };
  recent: SessionSummary[];
}

export default function Page() {
  const { batch } = useBatch();
  const d = useApi<Summary>(`/attendance/batch/${batch._id}/summary`);
  const base = `/manage/batches/${batch._id}`;
  if (d.error) return <ErrorState message={d.error} retry={d.reload} />;
  if (!d.data) return <PageSkeleton />;
  return (
    <div className="space-y-6">
      <Grid>
        <StatCard label="Enrolled students" value={d.data.enrolled} icon={<UsersRound size={16} aria-hidden />} href={`${base}/students`} />
        <StatCard label="Recorded sessions" value={d.data.totals.sessions} hint={d.data.totals.draftSessions ? `${d.data.totals.draftSessions} draft` : undefined} icon={<CalendarCheck2 size={16} aria-hidden />} />
        <StatCard label="Average attendance" value={attendancePct(d.data.totals.percentage)} hint={`${d.data.totals.present} present of ${d.data.totals.eligible}`} />
        <StatCard label="Morning / Afternoon" value={`${attendancePct(d.data.morning.percentage)} / ${attendancePct(d.data.afternoon.percentage)}`} hint={`${d.data.morning.sessions} morning · ${d.data.afternoon.sessions} afternoon`} />
      </Grid>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/manage/attendance/record?batchId=${batch._id}`} size="sm" icon={<Plus size={15} aria-hidden />}>Record attendance</ButtonLink>
        <ButtonLink href={`/manage/attendance/sessions?batchId=${batch._id}`} variant="secondary" size="sm">View attendance</ButtonLink>
        <ButtonLink href={`/manage/attendance/students?batchId=${batch._id}`} variant="secondary" size="sm">View student attendance</ButtonLink>
        <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden />} onClick={() => { void download(`/attendance/export?type=batch&batchId=${batch._id}&format=xlsx`); }}>Export</Button>
      </div>
      <Card title="Recent attendance sessions" description="Recorded for this batch" flush>
        <SessionsTable sessions={d.data.recent} empty={
          <EmptyState icon={CalendarCheck2} title="No attendance recorded" body="Upload a scanner CSV to record Morning or Afternoon attendance."
            action={<ButtonLink href={`/manage/attendance/record?batchId=${batch._id}`} size="sm">Record attendance</ButtonLink>} />
        } />
      </Card>
    </div>
  );
}
