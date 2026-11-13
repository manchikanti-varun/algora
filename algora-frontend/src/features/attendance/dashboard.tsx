'use client';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import {
  Field,
  Pagination,
  QueryState,
  Status,
  DataTable,
  Confirmation,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { CollegePicker, CoursePicker } from '@/features/learning/options';
import { dashboardSchema, page, basePath, dayLabel } from './contracts';
import { AttendanceCounts } from './shared';
export function AttendanceHub({
  superAdmin = false,
}: {
  superAdmin?: boolean;
}) {
  const [pg, setPage] = useState(1),
    [college, setCollege] = useState(''),
    [course, setCourse] = useState(''),
    [search, setSearch] = useState('');
  const params = new URLSearchParams({ page: String(pg), search });
  if (college) params.set('collegeId', college);
  if (course) params.set('courseId', course);
  const q = useAdministration(
    '/attendance/batches?' + params,
    page(
      z.object({
        id: z.string(),
        name: z.string(),
        collegeId: z.string(),
        courseId: z.string(),
        status: z.string(),
        courseTitle: z.string(),
      }),
    ),
  );
  const prefix = superAdmin ? '/super-admin' : '/admin';
  return (
    <>
      <div className="learning-toolbar">
        <CollegePicker
          superAdmin={superAdmin}
          permission="attendance.manage"
          value={college}
          onChange={(id) => {
            setCollege(id);
            setCourse('');
            setPage(1);
          }}
          label="Attendance College"
        />
        <Field label="Search Batches">
          <input
            aria-label="Search attendance Batches"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </div>
      {college && (
        <CoursePicker
          collegeId={college}
          value={course}
          onChange={(id) => {
            setCourse(id);
            setPage(1);
          }}
        />
      )}
      <p>
        Current attendance.manage authority is required. Existing grants are
        never expanded automatically.
      </p>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <DataTable
              items={q.data.items}
              empty="No authorized Batches"
              columns={[
                {
                  key: 'name',
                  label: 'Batch',
                  render: (b) => (
                    <>
                      <strong>{b.name}</strong>
                      <p>{b.courseTitle}</p>
                    </>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: (b) => <Status value={b.status} />,
                },
                {
                  key: 'link',
                  label: 'Attendance',
                  render: (b) => (
                    <Link href={prefix + '/batches/' + b.id + '/attendance'}>
                      Open attendance →
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
    </>
  );
}
export function AttendanceDashboard({
  batchId,
  superAdmin = false,
}: {
  batchId: string;
  superAdmin?: boolean;
}) {
  const [pg, setPage] = useState(1),
    [selected, setSelected] = useState(''),
    [create, setCreate] = useState<{
      dayId: string;
      sessionType: 'MORNING' | 'AFTERNOON';
    } | null>(null),
    command = useCommand(),
    prefix = superAdmin ? '/super-admin' : '/admin';
  const q = useAdministration(
    basePath(batchId) + '?page=' + pg,
    dashboardSchema,
  );
  const days = q.data?.days.items ?? [],
    visible = selected ? days.filter((d) => d.id === selected) : days;
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={prefix + '/attendance'}>Attendance Batches</Link> / Batch
        sessions
      </nav>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <header className="attendance-heading">
              <div>
                <h2>{q.data.batch.name}</h2>
                <p>
                  {q.data.batch.courseTitle} ·{' '}
                  <Status value={q.data.batch.status} />
                </p>
                <p>
                  {q.data.revision
                    ? 'Pinned curriculum revision ' +
                      q.data.revision.revisionNumber
                    : 'Curriculum not assigned'}
                </p>
              </div>
              <Link
                href={prefix + '/batches/' + batchId + '/attendance/reports'}
              >
                Reports & exports →
              </Link>
            </header>
            {q.data.message && (
              <div className="student-notice">{q.data.message}</div>
            )}
            <Field label="Learning Day">
              <select
                aria-label="Attendance Learning Day"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">All days on this page</option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {dayLabel(d.dayNumber)} · {d.title}
                  </option>
                ))}
              </select>
            </Field>
            {visible.map((d) => (
              <section key={d.id} className="attendance-day">
                <h2>
                  {dayLabel(d.dayNumber)} — {d.title}
                </h2>
                {!d.released && (
                  <p>
                    Learning Day is scheduled, private or restricted. New
                    scanning cannot begin.
                  </p>
                )}
                <div className="attendance-session-grid">
                  {d.sessions.map((card) => (
                    <article key={card.sessionType} className="student-card">
                      <span className="eyebrow">{card.sessionType}</span>
                      <h3>
                        {card.session ? (
                          <Status value={card.session.status} />
                        ) : (
                          'Not created'
                        )}
                      </h3>
                      {card.counts ? (
                        <AttendanceCounts counts={card.counts} />
                      ) : (
                        <p>No attendance roster or counts exist yet.</p>
                      )}
                      {card.session ? (
                        <div className="student-actions">
                          <Link
                            href={
                              prefix +
                              '/batches/' +
                              batchId +
                              '/attendance/' +
                              card.session.id
                            }
                          >
                            Review & manage session →
                          </Link>
                          {card.session.status === 'OPEN' && d.released && (
                            <Link
                              href={
                                prefix +
                                '/batches/' +
                                batchId +
                                '/attendance/' +
                                card.session.id +
                                '/scan'
                              }
                            >
                              Start scanning →
                            </Link>
                          )}
                        </div>
                      ) : (
                        <Button
                          disabled={
                            !d.released || q.data?.batch.status !== 'ACTIVE'
                          }
                          onClick={() =>
                            setCreate({
                              dayId: d.id,
                              sessionType: card.sessionType,
                            })
                          }
                        >
                          Create {card.sessionType.toLowerCase()} session
                        </Button>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
            <Pagination
              page={pg}
              total={q.data.days.total}
              totalPages={q.data.days.totalPages}
              onChange={(p) => {
                setPage(p);
                setSelected('');
              }}
            />
          </>
        )}
      </QueryState>
      {command.error && <p role="alert">{command.error.message}</p>}
      <Confirmation
        open={!!create}
        title="Create attendance session?"
        description="Creates a draft only. No student is marked absent and no roster is captured until opening."
        busy={command.isPending}
        onClose={() => setCreate(null)}
        onConfirm={() => {
          if (create)
            void command
              .mutateAsync({
                path: basePath(batchId) + '/sessions',
                body: {
                  learningDayId: create.dayId,
                  sessionType: create.sessionType,
                },
              })
              .then(() => setCreate(null))
              .catch(() => setCreate(null));
        }}
      />
    </>
  );
}
