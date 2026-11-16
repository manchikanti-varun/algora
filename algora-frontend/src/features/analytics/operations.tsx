'use client';
import Link from 'next/link';
import { z } from 'zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import { QueryState, DataTable } from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { AttendanceRates } from '@/features/attendance/rates';
import { coding, attendance } from '@/features/analytics/contracts';
const check = z.object({
  check: z.string(),
  status: z.enum(['PASS', 'FAIL', 'BLOCKED', 'NOT CONFIGURED', 'NOT TESTED']),
  guidance: z.string(),
});
export const readinessSchema = z.object({
  batchId: z.string(),
  batchName: z.string(),
  generatedAt: z.string(),
  checks: z.array(check),
  blockers: z.array(check),
  attendanceReady: z.boolean(),
  codingReady: z.boolean(),
  sessions: z.array(
    z.object({
      day: z.number(),
      title: z.string(),
      type: z.string(),
      sessionId: z.string().nullable(),
      status: z.string(),
      expectedEligibleStudents: z.number(),
      snapshotStudents: z.number(),
      scanReady: z.boolean(),
      camera: z.string(),
      guidance: z.string(),
    }),
  ),
  days: z.array(
    z.object({
      day: z.number(),
      title: z.string(),
      assignedProblems: z.number(),
      coding,
      morning: attendance,
      afternoon: attendance,
      finalizedSessions: z.number(),
      pendingSessions: z.number(),
      issues: z.array(z.string()),
    }),
  ),
});
export function BatchOperations({
  batchId,
  superAdmin = false,
}: {
  batchId: string;
  superAdmin?: boolean;
}) {
  const q = useAdministration(
      '/analytics/batches/' + batchId + '/readiness',
      readinessSchema,
    ),
    base = (superAdmin ? '/super-admin' : '/admin') + '/batches/' + batchId;
  const pct = (n: number | null) =>
    n === null ? 'N/A' : (n * 100).toFixed(1) + '%';
  return (
    <section>
      <h2>Bootcamp readiness</h2>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <p>
              Attendance setup:{' '}
              {q.data.attendanceReady ? 'Ready' : 'Needs attention'} · Coding
              setup: {q.data.codingReady ? 'Configured' : 'Needs attention'}.
              Configuration does not establish live browser or provider
              acceptance.
            </p>
            <Button variant="outline" onClick={() => void q.refetch()}>
              Refresh readiness
            </Button>
            <ul className="analytics-actions">
              {q.data.checks.map((c) => (
                <li key={c.check}>
                  <strong>
                    {c.check}: {c.status}
                  </strong>
                  <p>{c.guidance}</p>
                </li>
              ))}
            </ul>
            <h3>Session readiness</h3>
            <DataTable
              items={q.data.sessions.map((s) => ({
                ...s,
                id: s.day + ':' + s.type,
              }))}
              columns={[
                {
                  key: 'day',
                  label: 'Day',
                  render: (s) => s.day + ' · ' + s.title,
                },
                { key: 'type', label: 'Session', render: (s) => s.type },
                { key: 'status', label: 'State', render: (s) => s.status },
                {
                  key: 'expected',
                  label: 'Eligible now',
                  render: (s) => s.expectedEligibleStudents,
                },
                {
                  key: 'snapshot',
                  label: 'Roster snapshot',
                  render: (s) => s.snapshotStudents,
                },
                { key: 'camera', label: 'Camera', render: (s) => s.camera },
                {
                  key: 'action',
                  label: 'Review',
                  render: (s) => (
                    <>
                      <Link
                        href={
                          base +
                          '/attendance' +
                          (s.sessionId ? '/' + s.sessionId : '')
                        }
                      >
                        {s.sessionId ? 'Review session' : 'Create session'}
                      </Link>
                      {s.scanReady && (
                        <p>
                          <Link
                            href={base + '/attendance/' + s.sessionId + '/scan'}
                          >
                            Open scanner
                          </Link>
                        </p>
                      )}
                      <p>{s.guidance}</p>
                    </>
                  ),
                },
              ]}
              empty="No released Learning Days"
            />
            <h3>End of day summary</h3>
            {q.data.days.map((d) => (
              <article className="student-card" key={d.day}>
                <h4>
                  Day {d.day} · {d.title}
                </h4>
                <p>
                  Finalized sessions {d.finalizedSessions}/2 · Pending
                  finalization {d.pendingSessions} · Published problems{' '}
                  {d.assignedProblems}
                </p>
                <AttendanceRates
                  counts={d.morning}
                  scope="Morning finalized rates"
                />
                <AttendanceRates
                  counts={d.afternoon}
                  scope="Afternoon finalized rates"
                />
                <p>
                  Verified solved {d.coding.solved} / {d.coding.assigned}{' '}
                  opportunities · Verified attempts {d.coding.attempted} ·
                  Verification unavailable {d.coding.unavailable} · Verified
                  completion {pct(d.coding.completion)} · Coverage{' '}
                  {pct(d.coding.coverage)}
                </p>
                {d.issues.length ? (
                  <ul>
                    {d.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No outstanding issues in this view.</p>
                )}
                <Link href={base + '/analytics/days/' + d.day}>
                  Review Day analytics and reports
                </Link>
              </article>
            ))}
          </>
        )}
      </QueryState>
    </section>
  );
}
export function SyncRecovery({
  batchId,
  jobs,
}: {
  batchId: string;
  jobs: { id: string; status: string }[];
}) {
  const command = useCommand(),
    failed = jobs.filter((j) => ['FAILED', 'PARTIAL'].includes(j.status));
  if (!failed.length) return null;
  return (
    <section>
      <h4>Synchronization recovery</h4>
      <p>
        Retry uses current ownership and enrollment checks. Active jobs and
        provider backoff cannot be bypassed. Verified solves are preserved.
      </p>
      {failed.map((j) => (
        <Button
          key={j.id}
          disabled={command.isPending}
          variant="outline"
          onClick={() =>
            command.mutate({
              path: '/batches/' + batchId + '/progress/jobs/' + j.id + '/retry',
              body: { confirmed: true },
            })
          }
        >
          Retry {j.status.toLowerCase()} sync
        </Button>
      ))}
      {command.error && <p role="alert">{command.error.message}</p>}
    </section>
  );
}
