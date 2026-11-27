'use client';
import { useState } from 'react';
import { Badge, Card, Combobox, DataTable, EmptyState, ErrorState, InlineSelect, PageHeader, PageSkeleton, type Column } from '@/components/ui';
import { AttendanceTabs } from '@/components/attendance/AttendanceTabs';
import { StudentAttendancePanel } from '@/components/attendance/StudentAttendancePanel';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { attendancePct, fmtAttendanceDate, localToday, type LowAttendanceRow } from '@/lib/attendance';
import { qs } from '@/lib/api';
import { loadStudents } from '@/lib/options';

type State = { studentId: string; batchId: string; from: string; to: string; threshold: string };

export default function Page() {
  const [state, set] = useUrlState<State>({ studentId: '', batchId: '', from: '', to: '', threshold: '75' });
  const student = state.studentId;
  const [studentName, setStudentName] = useState<string | undefined>();
  const low = useApi<{ items: LowAttendanceRow[]; total: number }>(`/attendance/analytics/low${qs({ batchId: state.batchId, from: state.from, to: state.to, threshold: state.threshold, pageSize: 100 })}`);
  const columns: Column<LowAttendanceRow>[] = [
    { key: 'name', header: 'Student', cell: (r) => <button type="button" className="font-medium text-fg hover:text-accent-fg hover:underline" onClick={() => { setStudentName(r.name); set({ studentId: r.studentId }); }}>{r.name}</button> },
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
      <PageHeader title="Student attendance" subtitle="Look up one student, or find students below an attendance threshold." />
      <AttendanceTabs />
      <Card title="Find a student" description="Search by name or roll number">
        <div className="flex flex-wrap items-end gap-2">
          <Combobox label="Student" labelHidden={false} value={student} selectedLabel={studentName} load={loadStudents} className="[&_input]:h-9"
            onChange={(id, o) => { setStudentName(o?.label); set({ studentId: id }); }} placeholder="Search students" />
          {student && <button type="button" className="pb-2 text-[13px] text-fg-muted hover:text-fg hover:underline" onClick={() => { setStudentName(undefined); set({ studentId: '' }); }}>Clear</button>}
        </div>
      </Card>
      {student && (
        <Card title={studentName ?? 'Student attendance'} actions={<Badge tone="neutral">{fmtAttendanceDate(localToday())} snapshot</Badge>}>
          <StudentAttendancePanel studentId={student} />
        </Card>
      )}
      <Card title="Low attendance" description="Students with recorded sessions below the selected threshold. Students with no recorded sessions are never flagged." flush
        actions={<div className="flex flex-wrap items-center gap-2">
          <InlineSelect label="Low attendance threshold" value={state.threshold} onChange={(threshold) => set({ threshold })}
            options={[{ value: '90', label: 'Below 90%' }, { value: '80', label: 'Below 80%' }, { value: '75', label: 'Below 75%' }, { value: '60', label: 'Below 60%' }, { value: '50', label: 'Below 50%' }]} />
        </div>}>
        {low.error ? <ErrorState message={low.error} retry={low.reload} /> : !low.data ? <PageSkeleton /> : (
          <DataTable columns={columns} rows={low.data.items} rowKey={(r) => `${r.studentId}-${r.batchId}`} caption="Low attendance students"
            empty={<EmptyState compact title="Nobody is below the threshold" body="Students without recorded sessions are not flagged." />} />
        )}
      </Card>
    </div>
  );
}
