'use client';
import { useState } from 'react';
import { Badge, Card, DataTable, EmptyState, ErrorState, Grid, InlineSelect, PageHeader, PageSkeleton, StatCard, StatusBadge, type Column } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { attendancePct, fmtAttendanceDate, sessionLabel, type StudentAttendance } from '@/lib/attendance';
import { qs } from '@/lib/api';

type Daily = StudentAttendance['daily'][number];
const combination = (d: Daily) => {
  if (!d.morning && !d.afternoon) return 'Not recorded';
  if (d.morning === 'PRESENT' && d.afternoon === 'PRESENT') return 'Present in both';
  if (d.morning === 'PRESENT' && d.afternoon === 'ABSENT') return 'Present in Morning only';
  if (d.morning === 'ABSENT' && d.afternoon === 'PRESENT') return 'Present in Afternoon only';
  if (d.morning === 'ABSENT' && d.afternoon === 'ABSENT') return 'Absent in both';
  if (d.morning === null) return 'Morning not recorded';
  return 'Afternoon not recorded';
};

export default function Page() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [batchId, setBatchId] = useState('');
  const d = useApi<StudentAttendance>(`/student/attendance${qs({ from, to, batchId })}`);
  if (d.error) return <ErrorState message={d.error} retry={d.reload} />;
  if (!d.data) return <PageSkeleton />;
  const s = d.data.summary;
  const dailyColumns: Column<Daily>[] = [
    { key: 'date', header: 'Date', cell: (r) => fmtAttendanceDate(r.date) },
    { key: 'm', header: 'Morning', cell: (r) => (r.morning ? <StatusBadge status={r.morning} /> : <span className="text-xs text-fg-subtle">Not recorded</span>) },
    { key: 'a', header: 'Afternoon', cell: (r) => (r.afternoon ? <StatusBadge status={r.afternoon} /> : <span className="text-xs text-fg-subtle">Not recorded</span>) },
    { key: 'c', header: 'Day', cell: (r) => <Badge tone={r.morning === 'PRESENT' || r.afternoon === 'PRESENT' ? 'success' : r.morning || r.afternoon ? 'danger' : 'neutral'}>{combination(r)}</Badge> },
  ];
  const historyColumns: Column<StudentAttendance['history'][number]>[] = [
    { key: 'date', header: 'Date', cell: (r) => fmtAttendanceDate(r.attendanceDate) },
    { key: 'session', header: 'Session', cell: (r) => sessionLabel(r.sessionType) },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" subtitle="Your finalized attendance records. Your trainer records attendance; you can only view it here." />
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Attendance filters">
        <InlineSelect label="Batch" value={batchId} onChange={setBatchId} options={[{ value: '', label: 'All batches' }, ...d.data.student.batches.map((b) => ({ value: b.batchId, label: b.name }))]} />
        <label className="flex items-center gap-1.5 text-[13px] text-fg-muted">From
          <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border-0 bg-surface px-3 py-1.5 text-[13px] text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-fg-muted">To
          <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border-0 bg-surface px-3 py-1.5 text-[13px] text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />
        </label>
        {(from || to || batchId) && <button type="button" className="text-[13px] text-fg-muted hover:text-fg hover:underline" onClick={() => { setFrom(''); setTo(''); setBatchId(''); }}>Clear filters</button>}
      </div>
      <Grid>
        <StatCard label="Overall attendance" value={attendancePct(s.percentage)} hint={s.eligible ? `${s.present} of ${s.eligible} eligible sessions` : 'No finalized sessions yet'} />
        <StatCard label="Present" value={s.present} tone="good" />
        <StatCard label="Absent" value={s.absent} tone={s.absent ? 'bad' : 'default'} />
        <StatCard label="Morning" value={attendancePct(s.morning.percentage)} hint={`${s.morning.eligible} morning sessions`} />
      </Grid>
      <Grid cols={2}>
        <StatCard label="Afternoon" value={attendancePct(s.afternoon.percentage)} hint={`${s.afternoon.eligible} afternoon sessions`} />
        <StatCard label="Roll number" value={d.data.student.rollNumber} hint={d.data.student.college ?? 'No college'} />
      </Grid>
      {!s.eligible && (
        <Card><EmptyState title="Not recorded" body="No attendance has been recorded for you in this period. A session that was not recorded is not an absence." /></Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Daily attendance" description="Morning and Afternoon are tracked separately" flush>
          <DataTable columns={dailyColumns} rows={d.data.daily} rowKey={(r) => r.date} caption="Daily attendance" empty={<EmptyState compact title="No attendance recorded" />} />
        </Card>
        <Card title="Recent attendance" flush>
          <DataTable columns={historyColumns} rows={d.data.history} rowKey={(r) => `${r.attendanceDate}-${r.sessionType}`} caption="Attendance history" empty={<EmptyState compact title="No attendance recorded" />} />
        </Card>
      </div>
    </div>
  );
}
