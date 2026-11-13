'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAdministration } from '@/features/administration/queries';
import { StudentShell } from '@/features/students/shell';
import {
  DataTable,
  Pagination,
  QueryState,
  Status,
} from '@/components/shared/admin-ui';
import { ownSchema, dayLabel, page } from './contracts';
import { z } from 'zod';
export function StudentAttendance({ batchId }: { batchId: string }) {
  const [pg, setPage] = useState(1);
  const q = useAdministration(
    '/students/me/batches/' + batchId + '/attendance?page=' + pg,
    ownSchema,
  );
  return (
    <StudentShell
      title="Your attendance."
      description="Your own attendance, with official records clearly separated from pending sessions."
    >
      <nav aria-label="Breadcrumb">
        <Link href="/student/batches">My Batches</Link> / Attendance
      </nav>
      <p>
        Finalized history remains available when a Batch completes. This page
        does not grant access to private learning content or anyone else’s
        attendance.
      </p>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <div className="student-notice">
              {q.data.message ||
                'PRESENT, ABSENT and EXCUSED become official only after finalization. Unscanned members remain UNMARKED beforehand.'}
            </div>
            <DataTable
              items={q.data.items}
              empty="No attendance history yet"
              columns={[
                {
                  key: 'day',
                  label: 'Learning Day',
                  render: (r) => (
                    <>
                      {dayLabel(r.dayNumber)}
                      <p>{r.dayTitle}</p>
                    </>
                  ),
                },
                {
                  key: 'session',
                  label: 'Session',
                  render: (r) => (
                    <>
                      {r.sessionType}
                      <p>{r.sessionStatus}</p>
                    </>
                  ),
                },
                {
                  key: 'status',
                  label: 'Attendance',
                  render: (r) => (
                    <>
                      <Status value={r.status} />
                      <p>
                        {r.official
                          ? 'Finalized official record'
                          : 'Pending finalization'}
                      </p>
                    </>
                  ),
                },
                {
                  key: 'date',
                  label: 'Attendance date',
                  render: (r) =>
                    r.openedAt
                      ? new Date(r.openedAt).toLocaleString()
                      : 'Not opened',
                },
                {
                  key: 'finalized',
                  label: 'Finalized',
                  render: (r) =>
                    r.finalizedAt
                      ? new Date(r.finalizedAt).toLocaleString()
                      : 'Pending',
                },
              ]}
            />
            <Pagination
              page={pg}
              total={q.data.total}
              totalPages={q.data.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </QueryState>
    </StudentShell>
  );
}

export function StudentAttendanceBatches() {
  const [pg, setPage] = useState(1),
    q = useAdministration(
      '/students/me/attendance/batches?page=' + pg,
      page(
        z.object({
          id: z.string(),
          name: z.string(),
          college: z.string(),
          course: z.string(),
        }),
      ),
    );
  return (
    <StudentShell
      title="Your attendance history."
      description="Your own roster history, including completed Batches."
    >
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <DataTable
              items={q.data.items}
              empty="No attendance roster history yet"
              columns={[
                {
                  key: 'batch',
                  label: 'Batch',
                  render: (b) => (
                    <>
                      {b.name}
                      <p>
                        {b.college} · {b.course}
                      </p>
                    </>
                  ),
                },
                {
                  key: 'history',
                  label: 'History',
                  render: (b) => (
                    <Link href={'/student/batches/' + b.id + '/attendance'}>
                      View my attendance →
                    </Link>
                  ),
                },
              ]}
            />
            <Pagination
              page={pg}
              total={q.data.total}
              totalPages={q.data.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </QueryState>
    </StudentShell>
  );
}
