'use client';
import { useState } from 'react';
import { BarList, Card, DataTable, ErrorState, Grid, InlineSelect, PageHeader, StatCard, StatusBadge, Tabs, type Column } from '@/components/ui';
import { AttendanceScopeFilters, type AttendanceScope } from '@/components/attendance/AttendanceFilters';
import { AttendanceTabs } from '@/components/attendance/AttendanceTabs';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { attendancePct, localToday, type BatchAttendanceRow, type DailyRow, type LowAttendanceRow } from '@/lib/attendance';
import { qs } from '@/lib/api';

interface CollegeRow { collegeId: string | null; college: string; batchId: string; batch: string; eligible: number; present: number; absent: number; percentage: number | null }
type SortKey = 'percentage' | 'students' | 'sessions' | 'name';

const monthStart = () => `${localToday().slice(0, 7)}-01`;

export default function Page() {
  const [filters, setFilters] = useUrlState<AttendanceScope & { threshold: string }>({ batchId: '', collegeId: '', from: monthStart(), to: localToday(), sessionType: '', threshold: '75' });
  const [tab, setTab] = useState('trend');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'percentage', dir: 'desc' });
  const range = { batchId: filters.batchId, collegeId: filters.collegeId, from: filters.from, to: filters.to, sessionType: filters.sessionType };
  const daily = useApi<{ days: DailyRow[] }>(filters.from && filters.to ? `/attendance/analytics/daily${qs(range)}` : null);
  const batches = useApi<{ items: BatchAttendanceRow[]; weighted: { eligible: number; present: number; percentage: number | null } }>(`/attendance/analytics/batches${qs(range)}`);
  const colleges = useApi<{ items: CollegeRow[]; weighted: { eligible: number; present: number; percentage: number | null } }>(`/attendance/analytics/colleges${qs(range)}`);
  const low = useApi<{ items: LowAttendanceRow[]; total: number; threshold: number }>(`/attendance/analytics/low${qs({ ...range, threshold: filters.threshold, pageSize: 100 })}`);
  const clear = () => setFilters({ batchId: '', collegeId: '', sessionType: '' });
  const dayRows = daily.data?.days ?? [];
  const sum = (pick: (d: DailyRow) => { eligible: number; present: number } | null) => dayRows.reduce((a, d) => { const v = pick(d); return v ? { eligible: a.eligible + v.eligible, present: a.present + v.present } : a; }, { eligible: 0, present: 0 });
  const overall = sum((d) => d.overall);
  const morning = sum((d) => d.morning);
  const afternoon = sum((d) => d.afternoon);

  const batchColumns: Column<BatchAttendanceRow>[] = [
    { key: 'name', header: 'Batch', sortable: true, cell: (r) => r.name },
    { key: 'students', header: 'Students', align: 'right', sortable: true, cell: (r) => <span className="tabular-nums">{r.students}</span> },
    { key: 'sessions', header: 'Sessions', align: 'right', sortable: true, cell: (r) => <span className="tabular-nums">{r.sessions || '—'}</span> },
    { key: 'eligible', header: 'Opportunities', align: 'right', cell: (r) => <span className="tabular-nums">{r.eligible || '—'}</span> },
    { key: 'present', header: 'Present', align: 'right', cell: (r) => <span className="tabular-nums">{r.present || '—'}</span> },
    { key: 'absent', header: 'Absent', align: 'right', cell: (r) => <span className="tabular-nums">{r.absent || '—'}</span> },
    { key: 'percentage', header: 'Overall', align: 'right', sortable: true, cell: (r) => r.hasData ? <span className="tabular-nums font-medium">{attendancePct(r.percentage)}</span> : <StatusBadge status="NO_DATA" label="No attendance" /> },
    { key: 'morning', header: 'Morning', align: 'right', cell: (r) => <span className="tabular-nums">{r.morning.sessions ? attendancePct(r.morning.percentage) : '—'}</span> },
    { key: 'afternoon', header: 'Afternoon', align: 'right', cell: (r) => <span className="tabular-nums">{r.afternoon.sessions ? attendancePct(r.afternoon.percentage) : '—'}</span> },
  ];
  const onSort = (key: string) => setSort((s) => ({ key: key as SortKey, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const sortedBatches = [...(batches.data?.items ?? [])].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'name') return a.name.localeCompare(b.name) * dir;
    const x = (a[sort.key] ?? 0) as number; const y = (b[sort.key] ?? 0) as number;
    return (x - y) * dir;
  });
  const dailyColumns: Column<DailyRow>[] = [
    { key: 'date', header: 'Date', cell: (r) => r.date },
    { key: 'mp', header: 'Morning present', align: 'right', cell: (r) => r.morning ? <span className="tabular-nums">{r.morning.present}</span> : <span className="text-fg-subtle">Not recorded</span> },
    { key: 'ma', header: 'Morning absent', align: 'right', cell: (r) => r.morning ? <span className="tabular-nums">{r.morning.absent}</span> : '—' },
    { key: 'mpct', header: 'Morning %', align: 'right', cell: (r) => <span className="tabular-nums">{r.morningPct === null ? '—' : attendancePct(r.morningPct)}</span> },
    { key: 'ap', header: 'Afternoon present', align: 'right', cell: (r) => r.afternoon ? <span className="tabular-nums">{r.afternoon.present}</span> : <span className="text-fg-subtle">Not recorded</span> },
    { key: 'aa', header: 'Afternoon absent', align: 'right', cell: (r) => r.afternoon ? <span className="tabular-nums">{r.afternoon.absent}</span> : '—' },
    { key: 'apct', header: 'Afternoon %', align: 'right', cell: (r) => <span className="tabular-nums">{r.afternoonPct === null ? '—' : attendancePct(r.afternoonPct)}</span> },
    { key: 'overall', header: 'Overall', align: 'right', cell: (r) => <span className="tabular-nums font-medium">{r.overall.eligible ? attendancePct(r.overall.percentage) : '—'}</span> },
  ];
  const lowColumns: Column<LowAttendanceRow>[] = [
    { key: 'name', header: 'Student', cell: (r) => r.name },
    { key: 'roll', header: 'Roll number', cell: (r) => <span className="tabular-nums">{r.rollNumber}</span> },
    { key: 'batch', header: 'Batch', cell: (r) => r.batch },
    { key: 'college', header: 'College', cell: (r) => r.college ?? '—' },
    { key: 'eligible', header: 'Eligible', align: 'right', cell: (r) => <span className="tabular-nums">{r.eligible}</span> },
    { key: 'present', header: 'Present', align: 'right', cell: (r) => <span className="tabular-nums">{r.present}</span> },
    { key: 'absent', header: 'Absent', align: 'right', cell: (r) => <span className="tabular-nums">{r.absent}</span> },
    { key: 'pct', header: 'Attendance', align: 'right', cell: (r) => <span className="tabular-nums font-medium text-danger-fg">{attendancePct(r.percentage)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance analytics" subtitle="Daily, weekly, monthly and batch-wise attendance. Recorded sessions only." />
      <AttendanceTabs />
      <AttendanceScopeFilters value={filters} onChange={(patch) => setFilters(patch)} onClear={clear}
        extra={<InlineSelect label="Low attendance threshold" value={filters.threshold} onChange={(threshold) => setFilters({ threshold })}
          options={[{ value: '90', label: 'Below 90%' }, { value: '80', label: 'Below 80%' }, { value: '75', label: 'Below 75%' }, { value: '60', label: 'Below 60%' }, { value: '50', label: 'Below 50%' }]} />} />
      {!filters.from || !filters.to ? <ErrorState title="Choose a date range" message="Select a start and end date to analyse attendance." /> : (
        <>
          <Grid>
            <StatCard label="Overall attendance" value={attendancePct(overall.eligible ? Math.round((overall.present / overall.eligible) * 1000) / 10 : null)} hint={`${overall.present} of ${overall.eligible} opportunities`} />
            <StatCard label="Morning" value={attendancePct(morning.eligible ? Math.round((morning.present / morning.eligible) * 1000) / 10 : null)} hint={`${morning.present} of ${morning.eligible}`} />
            <StatCard label="Afternoon" value={attendancePct(afternoon.eligible ? Math.round((afternoon.present / afternoon.eligible) * 1000) / 10 : null)} hint={`${afternoon.present} of ${afternoon.eligible}`} />
            <StatCard label="Batches with attendance" value={`${(batches.data?.items ?? []).filter((b) => b.hasData).length} / ${batches.data?.items.length ?? 0}`} hint="Weighted overall, not an average of percentages" />
          </Grid>
          <Card title="Daily attendance trend" description="Days without a recorded session stay unrecorded, never absent">
            {dayRows.some((d) => d.overall.eligible) ? (
              <BarList items={dayRows.filter((d) => d.overall.eligible).slice(-31).map((d) => ({ key: d.date, label: d.date, value: d.overall.percentage, sub: `${d.overall.present}/${d.overall.eligible}` }))} max={100} format={(n) => `${Math.round(n)}%`} />
            ) : <p className="py-6 text-center text-sm text-fg-subtle">No attendance has been recorded for this period.</p>}
          </Card>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'trend', label: 'Daily' }, { key: 'batches', label: 'Batches', count: batches.data?.items.length },
            { key: 'colleges', label: 'Colleges' }, { key: 'low', label: 'Low attendance', count: low.data?.total },
          ]} />
          {tab === 'trend' && (
            <Card flush>
              <DataTable columns={dailyColumns} rows={dayRows} rowKey={(r) => r.date} caption="Daily attendance" />
            </Card>
          )}
          {tab === 'batches' && (
            <Card flush footer={batches.data && <p className="text-xs text-fg-subtle">Weighted overall for the selected filters: {attendancePct(batches.data.weighted.percentage)} across {batches.data.weighted.eligible} opportunities.</p>}>
              {batches.error ? <ErrorState message={batches.error} retry={batches.reload} /> : <DataTable columns={batchColumns} rows={sortedBatches} rowKey={(r) => r.batchId} sort={sort} onSort={onSort} caption="Batch attendance comparison" />}
            </Card>
          )}
          {tab === 'colleges' && (
            <Card flush footer={colleges.data && <p className="text-xs text-fg-subtle">Weighted overall: {attendancePct(colleges.data.weighted.percentage)}.</p>}>
              {colleges.error ? <ErrorState message={colleges.error} retry={colleges.reload} /> : (
                <DataTable rows={colleges.data?.items ?? []} rowKey={(r) => `${r.collegeId}-${r.batchId}`} caption="College attendance"
                  columns={[
                    { key: 'college', header: 'College', cell: (r) => r.college },
                    { key: 'batch', header: 'Batch', cell: (r) => r.batch },
                    { key: 'eligible', header: 'Opportunities', align: 'right', cell: (r) => <span className="tabular-nums">{r.eligible}</span> },
                    { key: 'present', header: 'Present', align: 'right', cell: (r) => <span className="tabular-nums">{r.present}</span> },
                    { key: 'absent', header: 'Absent', align: 'right', cell: (r) => <span className="tabular-nums">{r.absent}</span> },
                    { key: 'pct', header: 'Attendance', align: 'right', cell: (r) => <span className="tabular-nums font-medium">{attendancePct(r.percentage)}</span> },
                  ]} />
              )}
            </Card>
          )}
          {tab === 'low' && (
            <Card flush title={`Students below ${filters.threshold}%`}>
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <InlineSelect label="Low attendance threshold" value={filters.threshold} onChange={(threshold) => setFilters({ threshold })}
                  options={[{ value: '90', label: 'Below 90%' }, { value: '80', label: 'Below 80%' }, { value: '75', label: 'Below 75%' }, { value: '60', label: 'Below 60%' }, { value: '50', label: 'Below 50%' }]} />
                <span className="text-[13px] text-fg-muted">Students with no recorded sessions are never flagged.</span>
              </div>
              {low.error ? <ErrorState message={low.error} retry={low.reload} /> : <DataTable columns={lowColumns} rows={low.data?.items ?? []} rowKey={(r) => `${r.studentId}-${r.batchId}`} caption="Low attendance students" />}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
