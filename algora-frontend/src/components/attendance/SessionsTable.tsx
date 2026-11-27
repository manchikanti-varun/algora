'use client';
import Link from 'next/link';
import { Download, Eye, MoreHorizontal } from 'lucide-react';
import { DataTable, Menu, StatusBadge } from '@/components/ui';
import type { Column } from '@/components/ui';
import type { ReactNode } from 'react';
import { attendancePct, fmtAttendanceDate, sessionLabel, type SessionSummary } from '@/lib/attendance';
import { download } from '@/lib/api';

/** Shared session history table used by the Attendance module and the batch attendance tab. */
export function SessionsTable({ sessions, showBatch = false, empty, sort, onSort }: {
  sessions: SessionSummary[]; showBatch?: boolean; empty?: ReactNode; sort?: { key: 'date' | 'eligible' | 'present' | 'absent'; dir: 'asc' | 'desc' }; onSort?: (key: string) => void;
}) {
  const columns: Column<SessionSummary>[] = [
    { key: 'date', header: 'Date', sortable: !!onSort, cell: (r) => <Link className="font-medium text-fg hover:text-accent-fg hover:underline" href={`/manage/attendance/sessions/${r._id}`}>{fmtAttendanceDate(r.attendanceDate)}</Link> },
    ...(showBatch ? [{ key: 'batch', header: 'Batch', cell: (r: SessionSummary) => r.batchName ?? '—' }] : []),
    { key: 'session', header: 'Session', cell: (r) => sessionLabel(r.sessionType) },
    { key: 'time', header: 'Time', cell: (r) => <span className="tabular-nums">{r.attendanceTime}</span> },
    { key: 'eligible', header: 'Eligible', align: 'right', sortable: !!onSort, cell: (r) => <span className="tabular-nums">{r.eligibleCount}</span> },
    { key: 'present', header: 'Present', align: 'right', sortable: !!onSort, cell: (r) => <span className="tabular-nums text-success-fg">{r.presentCount}</span> },
    { key: 'absent', header: 'Absent', align: 'right', sortable: !!onSort, cell: (r) => <span className="tabular-nums text-danger-fg">{r.absentCount}</span> },
    { key: 'pct', header: 'Attendance', align: 'right', cell: (r) => <span className="tabular-nums">{attendancePct(r.percentage)}</span> },
    ...(showBatch ? [{ key: 'by', header: 'Recorded by', cell: (r: SessionSummary) => r.finalizedBy ?? r.createdBy ?? '—' }] : []),
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} label={r.status === 'DRAFT' ? 'Draft' : undefined} /> },
    {
      key: 'actions', header: 'Actions', align: 'right',
      cell: (r) => (
        <div className="flex justify-end">
          <Menu label={`Actions for ${fmtAttendanceDate(r.attendanceDate)} ${sessionLabel(r.sessionType)}`} icon={<MoreHorizontal size={16} aria-hidden />} items={[
            { label: r.status === 'DRAFT' ? 'Continue draft' : 'View details', href: `/manage/attendance/sessions/${r._id}`, icon: <Eye size={15} aria-hidden /> },
            { label: 'Export CSV', icon: <Download size={15} aria-hidden />, onSelect: () => { void download(`/attendance/export?type=session&sessionId=${r._id}&format=csv`); } },
            { label: 'Export XLSX', icon: <Download size={15} aria-hidden />, onSelect: () => { void download(`/attendance/export?type=session&sessionId=${r._id}&format=xlsx`); } },
          ]} />
        </div>
      ),
    },
  ];
  return <DataTable columns={columns} rows={sessions} rowKey={(r) => r._id} caption="Attendance sessions" empty={empty} sort={sort} onSort={onSort} />;
}
