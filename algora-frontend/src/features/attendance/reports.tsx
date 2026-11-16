'use client';
import Link from 'next/link';
import { AttendanceRates } from './rates';
import { useState } from 'react';
import { apiMutate } from '@/lib/api/client';
import { useAdministration } from '@/features/administration/queries';
import {
  Field,
  Pagination,
  QueryState,
  DataTable,
  Status,
  Confirmation,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { basePath, reportSchema, exportResponse, dayLabel } from './contracts';
const percent = (n: number | null) => (n === null ? 'N/A' : n.toFixed(2) + '%');
export function AttendanceReports({
  batchId,
  superAdmin = false,
}: {
  batchId: string;
  superAdmin?: boolean;
}) {
  const [pg, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [type, setType] = useState(''),
    [status, setStatus] = useState(''),
    [day, setDay] = useState(''),
    [dayPage, setDayPage] = useState(1),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [view, setView] = useState('Session records'),
    [download, setDownload] = useState<{
      format: 'CSV' | 'XLSX';
      scope: 'SESSION' | 'BATCH' | 'STUDENT';
      sessionId?: string;
      studentProfileId?: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const params = new URLSearchParams({ page: String(pg), search });
  if (type) params.set('sessionType', type);
  if (status) params.set('status', status);
  if (day) params.set('dayId', day);
  if (from) params.set('from', new Date(from + 'T00:00:00Z').toISOString());
  if (to) params.set('to', new Date(to + 'T23:59:59.999Z').toISOString());
  const base = basePath(batchId),
    q = useAdministration(base + '/reports?' + params, reportSchema),
    prefix = superAdmin ? '/super-admin' : '/admin';
  const days = useAdministration(base + '?page=' + dayPage, dashboardForDays);
  async function exportNow() {
    if (!download) return;
    setBusy(true);
    setError('');
    try {
      const filters = Object.fromEntries(params.entries());
      const result = await apiMutate(base + '/export', 'POST', exportResponse, {
        ...download,
        filters,
        confirmed: true,
      });
      const bytes = Uint8Array.from(atob(result.base64), (c) =>
          c.charCodeAt(0),
        ),
        url = URL.createObjectURL(new Blob([bytes], { type: result.mime })),
        a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownload(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export unavailable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={prefix + '/attendance'}>College & Course filters</Link> /{' '}
        <Link href={prefix + '/batches/' + batchId + '/attendance'}>
          Batch attendance
        </Link>{' '}
        / Reports
      </nav>
      <section className="student-card">
        <h2>Attendance reports</h2>
        <p>
          College, Course and Batch scope come from the selected authorized
          Batch. Date filters use session creation dates in UTC.
        </p>
        <div className="learning-toolbar">
          <Field label="Roll or student name">
            <input
              aria-label="Attendance report search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Session type">
            <select
              aria-label="Attendance report session type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Both sessions</option>
              <option>MORNING</option>
              <option>AFTERNOON</option>
            </select>
          </Field>
          <Field label="Session state">
            <select
              aria-label="Attendance report state"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All states</option>
              {['DRAFT', 'OPEN', 'CLOSED', 'FINALIZED'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Learning Day">
            <select
              aria-label="Attendance report Learning Day"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All days</option>
              {days.data?.days.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {dayLabel(d.dayNumber)} · {d.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From (UTC)">
            <input
              aria-label="Attendance report from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="To (UTC)">
            <input
              aria-label="Attendance report to"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </Field>
        </div>
        <div className="student-actions">
          <Button
            onClick={() => setDownload({ format: 'CSV', scope: 'BATCH' })}
          >
            Export Batch CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => setDownload({ format: 'XLSX', scope: 'BATCH' })}
          >
            Export Batch XLSX
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>
      {days.data && (
        <Pagination
          page={dayPage}
          total={days.data.days.total}
          totalPages={days.data.days.totalPages}
          onChange={setDayPage}
        />
      )}
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <section className="student-card">
              <h3>Official attendance</h3>
              <AttendanceRates counts={q.data.rates ?? q.data.summary} />
              <p>
                The legacy percentage is Participation Rate; both named metrics
                are exported.
              </p>
              <p>{q.data.policy}</p>
              <dl className="attendance-counts">
                {[
                  ['Present', q.data.summary.present],
                  ['Absent', q.data.summary.absent],
                  ['Excused', q.data.summary.excused],
                  ['Attendance', percent(q.data.summary.percentage)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="attendance-session-grid">
                {(['MORNING', 'AFTERNOON'] as const).map((t) => (
                  <article key={t}>
                    <h3>{t}</h3>
                    <p>
                      {percent(q.data.comparison[t].percentage)} ·{' '}
                      {q.data.comparison[t].present} present /{' '}
                      {q.data.comparison[t].absent} absent
                    </p>
                  </article>
                ))}
              </div>
            </section>
            <div
              role="tablist"
              className="learning-tabs"
              aria-label="Attendance report views"
            >
              {['Session records', 'Student summary', 'Day summary'].map(
                (v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => {
                      setView(v);
                      setPage(1);
                    }}
                  >
                    {v}
                  </button>
                ),
              )}
            </div>
            {view === 'Session records' && (
              <>
                <DataTable
                  items={q.data.rows.items.map((r) => ({
                    ...r,
                    id: r.sessionId + ':' + r.studentProfileId,
                  }))}
                  empty="No attendance rows match"
                  columns={[
                    {
                      key: 'student',
                      label: 'Student snapshot',
                      render: (r) => (
                        <>
                          {r.studentName}
                          <p>{r.rollNumber}</p>
                        </>
                      ),
                    },
                    {
                      key: 'session',
                      label: 'Day / session',
                      render: (r) => (
                        <>
                          {dayLabel(r.dayNumber)} · {r.sessionType}
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
                          <p>{r.official ? 'Official' : 'Not finalized'}</p>
                        </>
                      ),
                    },
                    {
                      key: 'export',
                      label: 'Exports',
                      render: (r) => (
                        <div className="student-actions">
                          <Button
                            variant="outline"
                            onClick={() =>
                              setDownload({
                                format: 'CSV',
                                scope: 'SESSION',
                                sessionId: r.sessionId,
                              })
                            }
                          >
                            Session CSV
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setDownload({
                                format: 'XLSX',
                                scope: 'SESSION',
                                sessionId: r.sessionId,
                              })
                            }
                          >
                            Session XLSX
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
                <Pagination
                  page={pg}
                  total={q.data.rows.total}
                  totalPages={q.data.rows.totalPages}
                  onChange={setPage}
                />
              </>
            )}
            {view === 'Student summary' && (
              <>
                <DataTable
                  items={q.data.students.items.map((r) => ({
                    ...r,
                    id: r.studentProfileId,
                  }))}
                  empty="No student summaries"
                  columns={[
                    {
                      key: 'student',
                      label: 'Student',
                      render: (r) => (
                        <>
                          {r.studentName}
                          <p>{r.rollNumber}</p>
                        </>
                      ),
                    },
                    {
                      key: 'counts',
                      label: 'Official counts',
                      render: (r) => (
                        <>
                          {r.present} present · {r.absent} absent · {r.excused}{' '}
                          excused
                        </>
                      ),
                    },
                    {
                      key: 'percent',
                      label: 'Attendance',
                      render: (r) => percent(r.percentage),
                    },
                    {
                      key: 'export',
                      label: 'History exports',
                      render: (r) => (
                        <div className="student-actions">
                          <Button
                            variant="outline"
                            onClick={() =>
                              setDownload({
                                format: 'CSV',
                                scope: 'STUDENT',
                                studentProfileId: r.studentProfileId,
                              })
                            }
                          >
                            Student CSV
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setDownload({
                                format: 'XLSX',
                                scope: 'STUDENT',
                                studentProfileId: r.studentProfileId,
                              })
                            }
                          >
                            Student XLSX
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
                <Pagination
                  page={pg}
                  total={q.data.students.total}
                  totalPages={q.data.students.totalPages}
                  onChange={setPage}
                />
              </>
            )}
            {view === 'Day summary' && (
              <>
                <DataTable
                  items={q.data.days.items.map((r) => ({
                    ...r,
                    id: String(r.dayNumber),
                  }))}
                  empty="No day summaries"
                  columns={[
                    {
                      key: 'day',
                      label: 'Learning Day',
                      render: (r) => dayLabel(r.dayNumber),
                    },
                    {
                      key: 'counts',
                      label: 'Official counts',
                      render: (r) => (
                        <>
                          {r.present} present · {r.absent} absent · {r.excused}{' '}
                          excused
                        </>
                      ),
                    },
                    {
                      key: 'percent',
                      label: 'Attendance',
                      render: (r) => percent(r.percentage),
                    },
                  ]}
                />
                <Pagination
                  page={pg}
                  total={q.data.days.total}
                  totalPages={q.data.days.totalPages}
                  onChange={setPage}
                />
              </>
            )}
          </>
        )}
      </QueryState>
      <Confirmation
        open={!!download}
        title="Export private attendance report?"
        description="Current College authority is rechecked and this export is audited. Keep downloaded roster files private. Unfinalized rows remain unmarked; official percentages exclude excused records."
        busy={busy}
        onClose={() => setDownload(null)}
        onConfirm={() => void exportNow()}
      />
    </>
  );
}
import { z } from 'zod';
const dashboardForDays = z.object({
  days: z.object({
    items: z.array(
      z.object({ id: z.string(), dayNumber: z.number(), title: z.string() }),
    ),
    total: z.number(),
    totalPages: z.number(),
  }),
});
