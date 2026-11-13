'use client';
import Link from 'next/link';
import { useState } from 'react';
import { apiGet } from '@/lib/api/client';
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
  Dialog,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import {
  rosterSchema,
  historySchema,
  refreshSchema,
  basePath,
  dayLabel,
  type RosterEntry,
} from './contracts';
import { AttendanceCounts } from './shared';
export function AttendanceReview({
  batchId,
  sessionId,
  superAdmin = false,
}: {
  batchId: string;
  sessionId: string;
  superAdmin?: boolean;
}) {
  const [pg, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [action, setAction] = useState(''),
    [reason, setReason] = useState(''),
    [confirm, setConfirm] = useState(false),
    [correct, setCorrect] = useState<RosterEntry | null>(null),
    [nextStatus, setNextStatus] = useState('PRESENT'),
    [impact, setImpact] = useState<{
      existing: number;
      additions: number;
      impactFingerprint: string;
      sessionRevision: number;
    } | null>(null),
    [error, setError] = useState('');
  const base = basePath(batchId) + '/sessions/' + sessionId,
    prefix = superAdmin ? '/super-admin' : '/admin',
    params = new URLSearchParams({ page: String(pg), search });
  if (status) params.set('recordStatus', status);
  const q = useAdministration(base + '/roster?' + params, rosterSchema),
    history = useAdministration(
      base + '/history?page=' + historyPage,
      historySchema,
    ),
    command = useCommand();
  async function refresh() {
    setError('');
    try {
      setImpact(await apiGet(base + '/roster/refresh-preview', refreshSchema));
      setAction('refresh');
      setReason('');
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Roster review unavailable');
    }
  }
  const session = q.data?.session;
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={prefix + '/batches/' + batchId + '/attendance'}>
          Batch attendance
        </Link>{' '}
        / Session review
      </nav>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <section className="student-card">
              <span className="eyebrow">
                {dayLabel(q.data.session.dayNumber)} ·{' '}
                {q.data.session.sessionType}
              </span>
              <h2>{q.data.session.dayTitle}</h2>
              <Status value={q.data.session.status} />
              <AttendanceCounts counts={q.data.counts} />
              <div className="student-notice">
                {q.data.session.status === 'FINALIZED'
                  ? 'Official attendance. Changes require an audited correction and reason.'
                  : 'Draft attendance. Unscanned roster members are UNMARKED, never official ABSENT until finalization.'}
              </div>
              <div className="student-actions">
                {(
                  {
                    DRAFT: ['open'],
                    OPEN: ['close'],
                    CLOSED: ['reopen', 'finalize'],
                    FINALIZED: [],
                  } as const
                )[q.data.session.status].map((v) => (
                  <Button
                    key={v}
                    variant={v === 'finalize' ? 'default' : 'outline'}
                    onClick={() => {
                      setAction(v);
                      setReason('');
                      setConfirm(false);
                    }}
                  >
                    {v === 'finalize'
                      ? 'Review finalization'
                      : v.charAt(0).toUpperCase() + v.slice(1) + ' session'}
                  </Button>
                ))}
                {['OPEN', 'CLOSED'].includes(q.data.session.status) && (
                  <Button variant="outline" onClick={() => void refresh()}>
                    Review roster additions
                  </Button>
                )}
                {q.data.session.status === 'OPEN' && (
                  <Link
                    href={
                      prefix +
                      '/batches/' +
                      batchId +
                      '/attendance/' +
                      sessionId +
                      '/scan'
                    }
                  >
                    Open continuous scanner →
                  </Link>
                )}
                <Link
                  href={prefix + '/batches/' + batchId + '/attendance/reports'}
                >
                  Reports & exports →
                </Link>
              </div>
            </section>
            <section className="student-card">
              <h2>Roster review</h2>
              <div className="learning-toolbar">
                <Field label="Search roll or name">
                  <input
                    aria-label="Search attendance roster"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </Field>
                <Field label="Attendance status">
                  <select
                    aria-label="Attendance roster status"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All statuses</option>
                    {['PRESENT', 'UNMARKED', 'ABSENT', 'EXCUSED'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <DataTable
                items={q.data.rows.items}
                empty="No roster members match. The durable roster is captured at session opening."
                columns={[
                  {
                    key: 'student',
                    label: 'Student snapshot',
                    render: (r) => (
                      <>
                        <strong>{r.studentName}</strong>
                        <p>{r.rollNumber}</p>
                      </>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (r) => <Status value={r.status} />,
                  },
                  {
                    key: 'time',
                    label: 'Marked time',
                    render: (r) =>
                      r.record
                        ? new Date(r.record.markedAt).toLocaleString()
                        : 'Unmarked',
                  },
                  {
                    key: 'action',
                    label: 'Correction',
                    render: (r) =>
                      q.data?.session.status === 'FINALIZED' && r.record ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setAction('');
                            setCorrect(r);
                            setNextStatus(
                              r.status === 'PRESENT' ? 'ABSENT' : 'PRESENT',
                            );
                            setReason('');
                            setConfirm(false);
                          }}
                        >
                          Correct official record
                        </Button>
                      ) : q.data?.session.status === 'CLOSED' &&
                        r.status === 'UNMARKED' ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setAction('excuse');
                            setCorrect(r);
                            setNextStatus('EXCUSED');
                            setReason('');
                            setConfirm(false);
                          }}
                        >
                          Excuse unmarked member
                        </Button>
                      ) : (
                        <span>Finalization required</span>
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
            </section>
          </>
        )}
      </QueryState>
      <section className="student-card">
        <h2>Session and correction history</h2>
        <QueryState
          pending={history.isPending}
          error={history.error}
          onRetry={() => void history.refetch()}
        >
          {history.data && (
            <>
              <DataTable
                items={history.data.items}
                empty="No session history yet"
                columns={[
                  {
                    key: 'action',
                    label: 'Action',
                    render: (h) => (
                      <>
                        {h.action.replaceAll('_', ' ')}
                        <p>
                          {h.previousStatus ?? '—'} → {h.newStatus}
                        </p>
                      </>
                    ),
                  },
                  { key: 'reason', label: 'Reason', render: (h) => h.reason },
                  {
                    key: 'actor',
                    label: 'Actor',
                    render: (h) => h.actorName,
                  },
                  {
                    key: 'time',
                    label: 'Time',
                    render: (h) => new Date(h.createdAt).toLocaleString(),
                  },
                ]}
              />
              <Pagination
                page={historyPage}
                total={history.data.total}
                totalPages={history.data.totalPages}
                onChange={setHistoryPage}
              />
            </>
          )}
        </QueryState>
      </section>
      {error && <p role="alert">{error}</p>}
      {command.error && <p role="alert">{command.error.message}</p>}
      <Dialog
        open={!!action || !!correct}
        title={
          correct
            ? 'Review official attendance correction'
            : action === 'finalize'
              ? 'Review finalization'
              : action === 'refresh'
                ? 'Review immutable roster additions'
                : 'Review session ' + action
        }
        onClose={() => {
          setAction('');
          setCorrect(null);
          setImpact(null);
          setConfirm(false);
        }}
      >
        {correct && (
          <>
            <p>
              {correct.studentName} · {correct.rollNumber} · Current:{' '}
              {correct.status}
            </p>
            <Field label="Corrected status">
              <select
                disabled={action === 'excuse'}
                aria-label="Corrected attendance status"
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value)}
              >
                {['PRESENT', 'ABSENT', 'EXCUSED'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        {action === 'finalize' && (
          <p>
            Only the durable admitted roster is finalized.{' '}
            {q.data?.counts.unmarked ?? 0} unmarked members become official
            ABSENT. Existing PRESENT and EXCUSED records are preserved.
            Finalization cannot be reopened.
          </p>
        )}
        {action === 'open' && (
          <p>
            Opening captures the current verified active enrollment roster.
            Future enrollments require a reviewed additive refresh. No absence
            is created.
          </p>
        )}
        {action === 'refresh' && impact && (
          <p>
            {impact.existing} existing immutable roster members;{' '}
            {impact.additions} eligible additions. Existing rows, identity
            snapshots and withdrawn members remain unchanged.
          </p>
        )}
        <Field label="Attendance change reason">
          <textarea
            aria-label="Attendance change reason"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Button
          disabled={
            reason.trim().length < 15 ||
            command.isPending ||
            (!!correct && correct.status === nextStatus)
          }
          onClick={() => setConfirm(true)}
        >
          Review confirmation
        </Button>
      </Dialog>
      <Confirmation
        open={confirm}
        title={
          correct
            ? 'Confirm official correction?'
            : action === 'finalize'
              ? 'Finalize official attendance?'
              : 'Confirm attendance ' + action + '?'
        }
        description="The backend rechecks current authority, eligibility, state and revisions. This change and its history are committed together."
        busy={command.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (!session) return;
          const path =
            action === 'excuse' && correct
              ? base + '/roster/' + correct.studentProfileId + '/excuse'
              : correct
                ? base + '/records/' + correct.record?.id + '/correct'
                : base +
                  (action === 'refresh' ? '/roster/refresh' : '/' + action);
          void command
            .mutateAsync({
              path,
              body: {
                expectedRevision:
                  action === 'refresh'
                    ? impact?.sessionRevision
                    : session.revision,
                confirmed: true,
                reason,
                ...(correct?.record
                  ? {
                      status: nextStatus,
                      expectedRecordRevision: correct.record?.revision,
                    }
                  : {}),
                ...(action === 'refresh'
                  ? { impactFingerprint: impact?.impactFingerprint }
                  : {}),
              },
            })
            .then(() => {
              setAction('');
              setCorrect(null);
              setConfirm(false);
              setImpact(null);
            })
            .catch(() => setConfirm(false));
        }}
      />
    </>
  );
}
