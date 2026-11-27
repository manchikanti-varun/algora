'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, DataTable, EmptyState, ErrorState, fmtDateTime, Grid, InlineSelect, PageSkeleton, StatCard, StatusBadge, type Column } from '@/components/ui';
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
const dayCell = (v: Daily['morning']) => v ? <StatusBadge status={v} /> : <span className="text-xs text-fg-subtle">Not recorded</span>;

/** Student attendance summary for management. Reads the authorized `/attendance/students/:id` endpoint. */
export function StudentAttendancePanel({ studentId, compact = false }: { studentId: string; compact?: boolean }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [batchId, setBatchId] = useState('');
  const [sessionType, setSessionType] = useState('');
  const d = useApi<StudentAttendance>(`/attendance/students/${studentId}${qs({ from, to, batchId, sessionType })}`);
  if (d.error) return <ErrorState message={d.error} retry={d.reload} />;
  if (!d.data) return <PageSkeleton />;
  const s = d.data.summary;
  const historyColumns: Column<StudentAttendance['history'][number]>[] = [
    { key: 'date', header: 'Date', cell: (r) => fmtAttendanceDate(r.attendanceDate) },
    { key: 'session', header: 'Session', cell: (r) => sessionLabel(r.sessionType) },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'scan', header: 'Scan time', cell: (r) => (r.scanAt ? fmtDateTime(r.scanAt) : '—') },
  ];
  const dailyColumns: Column<Daily>[] = [
    { key: 'date', header: 'Date', cell: (r) => fmtAttendanceDate(r.date) },
    { key: 'm', header: 'Morning', cell: (r) => dayCell(r.morning) },
    { key: 'a', header: 'Afternoon', cell: (r) => dayCell(r.afternoon) },
    { key: 'c', header: 'Combination', cell: (r) => <Badge tone={r.morning === 'PRESENT' || r.afternoon === 'PRESENT' ? 'success' : 'neutral'}>{combination(r)}</Badge> },
  ];
  return (
    <div className="space-y-6">
      <Grid>
        <StatCard label="Attendance" value={attendancePct(s.percentage)} hint={s.eligible ? `${s.present} of ${s.eligible} eligible sessions` : 'No finalized sessions recorded'} />
        <StatCard label="Present" value={s.present} tone="good" />
        <StatCard label="Absent" value={s.absent} tone={s.absent ? 'bad' : 'default'} />
        <StatCard label="Morning / Afternoon" value={`${attendancePct(s.morning.percentage)} / ${attendancePct(s.afternoon.percentage)}`} hint={`${s.morning.eligible} morning · ${s.afternoon.eligible} afternoon`} />
      </Grid>
      {compact ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
          <Link className="font-medium text-accent-fg hover:underline" href={`/manage/attendance/students?studentId=${studentId}`}>View full attendance</Link>
          <span>{d.data.student.rollNumber} · {d.data.student.college ?? 'No college'}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Attendance filters">
            <label className="flex items-center gap-1.5 text-[13px] text-fg-muted">From
              <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border-0 bg-surface px-3 py-1.5 text-[13px] text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-fg-muted">To
              <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border-0 bg-surface px-3 py-1.5 text-[13px] text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />
            </label>
            <InlineSelect label="Batch" value={batchId} onChange={setBatchId} options={[{ value: '', label: 'All batches' }, ...d.data.student.batches.map((b) => ({ value: b.batchId, label: b.name }))]} />
            <InlineSelect label="Session" value={sessionType} onChange={setSessionType} options={[{ value: '', label: 'All sessions' }, { value: 'MORNING', label: 'Morning' }, { value: 'AFTERNOON', label: 'Afternoon' }]} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Daily attendance" description="A session that was never recorded is not an absence" flush>
              <DataTable columns={dailyColumns} rows={d.data.daily} rowKey={(r) => r.date} caption="Daily attendance" empty={<EmptyState compact title="No attendance recorded" />} />
            </Card>
            <Card title="Attendance history" flush>
              <DataTable columns={historyColumns} rows={d.data.history} rowKey={(r) => `${r.attendanceDate}-${r.sessionType}`} caption="Attendance history" empty={<EmptyState compact title="No attendance recorded" />} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
