'use client';
import { Download } from 'lucide-react';
import { Badge, Button, Card, Combobox, DataTable, EmptyState, ErrorState, InlineSelect, Notice, PageHeader, Pagination, PageSkeleton, SearchInput, type Column } from '@/components/ui';
import { AttendanceTabs } from '@/components/attendance/AttendanceTabs';
import { useDebouncedUrlText } from '@/components/manage/Filters';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { attendancePct, fmtAttendanceDateShort, localToday, sessionShort } from '@/lib/attendance';
import { download, qs } from '@/lib/api';
import { loadBatches } from '@/lib/options';

interface RegisterRow { studentId: string; rollNumber: string; name: string; college: string | null; present: number; absent: number; percentage: number | null; cells: (string | null)[] }
interface Register {
  batch: { _id: string; name: string }; from: string; to: string;
  columns: { sessionId: string; date: string; sessionType: string; time: string }[];
  items: RegisterRow[]; total: number; page: number; pageSize: number;
}
type State = { batchId: string; from: string; to: string; q: string; status: string; page: string };

export default function Page() {
  const [state, set] = useUrlState<State>({ batchId: '', from: `${localToday().slice(0, 7)}-01`, to: localToday(), q: '', status: '', page: '' });
  const data = useApi<Register>(state.batchId ? `/attendance/register${qs({ ...state, pageSize: 25, page: state.page || 1 })}` : null);
  const [text, setText] = useDebouncedUrlText(state.q, (q) => set({ q, page: '' }));
  const columns: Column<RegisterRow>[] = [
    { key: 'roll', header: 'Roll number', cell: (r) => <span className="font-medium tabular-nums">{r.rollNumber}</span> },
    { key: 'name', header: 'Student', cell: (r) => r.name },
    { key: 'college', header: 'College', cell: (r) => r.college ?? '—' },
    ...(data.data?.columns ?? []).map((c, i) => ({
      key: c.sessionId,
      header: <span title={`${c.date} ${c.sessionType}`}>{fmtAttendanceDateShort(c.date)} {sessionShort(c.sessionType)}</span>,
      align: 'right' as const,
      cell: (r: RegisterRow) => {
        const v = r.cells[i];
        if (v === 'PRESENT') return <Badge tone="success">P</Badge>;
        if (v === 'ABSENT') return <Badge tone="danger">A</Badge>;
        return <span className="text-fg-subtle" title="Not recorded or not eligible">—</span>;
      },
    })),
    { key: 'present', header: 'Present', align: 'right', cell: (r) => <span className="tabular-nums">{r.present}</span> },
    { key: 'absent', header: 'Absent', align: 'right', cell: (r) => <span className="tabular-nums">{r.absent}</span> },
    { key: 'pct', header: 'Attendance', align: 'right', cell: (r) => <span className="tabular-nums font-medium">{attendancePct(r.percentage)}</span> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance register" subtitle="One row per student, one column per recorded session."
        actions={data.data && <>
          <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden />} onClick={() => { void download(`/attendance/export${qs({ type: 'register', batchId: state.batchId, from: state.from, to: state.to, format: 'csv' })}`); }}>CSV</Button>
          <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden />} onClick={() => { void download(`/attendance/export${qs({ type: 'register', batchId: state.batchId, from: state.from, to: state.to, format: 'xlsx' })}`); }}>XLSX</Button>
        </>} />
      <AttendanceTabs />
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Register filters">
        <Combobox label="Batch" labelHidden={false} value={state.batchId} onChange={(batchId) => set({ batchId, page: '' })} load={loadBatches} placeholder="Choose a batch" className="min-w-52" />
        <label className="flex items-center gap-1.5 text-[13px] text-fg-muted"><span className="sr-only">From</span>
          <input type="date" aria-label="From" value={state.from} onChange={(e) => set({ from: e.target.value, page: '' })} className="rounded-lg border-0 bg-surface px-3 py-1.5 text-[13px] text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-fg-muted"><span className="sr-only">To</span>
          <input type="date" aria-label="To" value={state.to} onChange={(e) => set({ to: e.target.value, page: '' })} className="rounded-lg border-0 bg-surface px-3 py-1.5 text-[13px] text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />
        </label>
        <SearchInput value={text} onChange={setText} placeholder="Name or roll number" label="Search students" />
        <InlineSelect label="Attendance status" value={state.status} onChange={(status) => set({ status, page: '' })}
          options={[{ value: '', label: 'All students' }, { value: 'ABSENT', label: 'Has an absence' }, { value: 'PRESENT', label: 'Has a presence' }]} />
      </div>
      {!state.batchId ? <Notice tone="info" title="Choose a batch">The register shows its recorded sessions for the selected date range.</Notice>
        : data.error ? <ErrorState message={data.error} retry={data.reload} />
          : !data.data ? <PageSkeleton />
            : (
              <Card flush>
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-xs text-fg-muted">
                  <span className="flex items-center gap-1"><Badge tone="success">P</Badge> Present</span>
                  <span className="flex items-center gap-1"><Badge tone="danger">A</Badge> Absent</span>
                  <span className="flex items-center gap-1"><span className="text-fg-subtle">—</span> Not recorded or not eligible</span>
                  <span className="ml-auto">{data.data.columns.length} session{data.data.columns.length === 1 ? '' : 's'} · {data.data.batch.name}</span>
                </div>
                <DataTable columns={columns} rows={data.data.items} rowKey={(r) => r.studentId} caption="Attendance register"
                  empty={<EmptyState title="No attendance in this period" body="Change the dates or record attendance for this batch." compact />} />
                <Pagination page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={(page) => set({ page: String(page) })} />
              </Card>
            )}
    </div>
  );
}
