'use client';
import Link from 'next/link';
import { ReportDownloads } from './report-downloads';
import { CollegePicker, CoursePicker } from '@/features/learning/options';
import { useState } from 'react';
import { z } from 'zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import { StudentShell } from '@/features/students/shell';
import {
  QueryState,
  Status,
  Pagination,
  DataTable,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';

import {
  dashboardSchema,
  matrixSchema,
  batchesSchema,
  evidenceSchema,
  analyticsSchema,
  platforms,
  type metricsSchema,
  type progressItemSchema,
} from './contracts';
export function Metrics({ value }: { value: z.infer<typeof metricsSchema> }) {
  return (
    <div className="coding-metrics" aria-label="Verified progress summary">
      {[
        ['Assigned', value.assigned],
        ['Solved verified', value.solved],
        ['Attempted verified', value.attempted],
        ['Verification unavailable', value.unavailable],
        ['Verified coverage', value.verifiedCoverage],
        ['Completion', value.completionPercent + '%'],
      ].map(([name, count]) => (
        <div className="student-card" key={name}>
          <span>{name}</span>
          <strong>{count}</strong>
        </div>
      ))}
    </div>
  );
}
export function ProgressBatches({
  staff = false,
  superAdmin = false,
  reports = false,
}: {
  staff?: boolean;
  superAdmin?: boolean;
  reports?: boolean;
}) {
  const [page, setPage] = useState(1),
    [college, setCollege] = useState(''),
    [course, setCourse] = useState(''),
    q = useAdministration(
      (staff ? '/coding/batches' : '/students/me/progress/batches') +
        '?' +
        new URLSearchParams({
          page: String(page),
          ...(staff && college ? { collegeId: college } : {}),
          ...(staff && course ? { courseId: course } : {}),
        }),
      batchesSchema,
    );
  const base = staff ? (superAdmin ? '/super-admin' : '/admin') : '/student';
  const content = (
    <>
      {staff && (
        <div className="coding-filters">
          <CollegePicker
            superAdmin={superAdmin}
            permission="progress.view"
            value={college}
            onChange={(v) => {
              setCollege(v);
              setCourse('');
              setPage(1);
            }}
          />
          <CoursePicker
            collegeId={college}
            value={course}
            onChange={(v) => {
              setCourse(v);
              setPage(1);
            }}
          />
        </div>
      )}
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        <div className="learning-card-grid">
          {q.data?.items.map((b) => (
            <article className="student-card" key={b.id}>
              <h2>{b.name}</h2>
              <p>{b.course}</p>
              <Link
                href={
                  base +
                  '/batches/' +
                  b.id +
                  '/progress' +
                  (reports ? '?reports=true' : '')
                }
              >
                View verified progress →
              </Link>
            </article>
          ))}
        </div>
        {q.data && !q.data.items.length && (
          <p>
            No eligible Batches are available. Staff need explicit college.view
            and progress.view permissions.
          </p>
        )}
        {q.data && (
          <Pagination
            page={page}
            total={q.data.items.length}
            totalPages={q.data.totalPages}
            onChange={setPage}
          />
        )}
      </QueryState>
    </>
  );
  return staff ? (
    content
  ) : (
    <StudentShell
      title="Your verified progress."
      description="Progress supported by trusted submission evidence, scoped to your current Batch enrollment."
    >
      <Link href="/student/coding-accounts">Manage coding accounts</Link>
      {content}
    </StudentShell>
  );
}
function Evidence({
  batchId,
  assignmentId,
  studentProfileId,
  onClose,
}: {
  batchId: string;
  assignmentId: string;
  studentProfileId?: string;
  onClose: () => void;
}) {
  const q = useAdministration(
    '/batches/' +
      batchId +
      '/progress/assignments/' +
      assignmentId +
      '/evidence' +
      (studentProfileId ? '?studentProfileId=' + studentProfileId : ''),
    evidenceSchema,
  );
  return (
    <section className="student-card" aria-label="Submission evidence">
      <h3>Submission evidence</h3>
      <p>
        Evidence records what the provider reported when fetched. Current
        account ownership and assignment eligibility still control attribution.
      </p>
      <Button variant="outline" onClick={onClose}>
        Close evidence
      </Button>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data?.items.map((e) => (
          <article key={e.id}>
            <p>
              <Status value={e.verdict} /> · {e.platform} · {e.handle} ·{' '}
              {e.language}
            </p>
            <p>
              Submitted {new Date(e.submittedAt).toISOString()} · Fetched{' '}
              {new Date(e.fetchedAt).toISOString()}
            </p>
            <p>
              {e.sourceType} · {e.confidence} · {e.adapterVersion}
            </p>
            <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">
              Submission {e.providerSubmissionId} ↗
            </a>
          </article>
        ))}
        {q.data && !q.data.items.length && (
          <p>
            No trusted submission evidence has been recorded for this
            assignment.
          </p>
        )}
      </QueryState>
    </section>
  );
}
export function AssignmentProgress({
  batchId,
  items,
  studentProfileId,
}: {
  batchId: string;
  items: z.infer<typeof progressItemSchema>[];
  studentProfileId?: string;
}) {
  const [evidence, setEvidence] = useState<string | null>(null);
  return (
    <>
      <div className="learning-card-grid">
        {items.map((p) => (
          <article className="student-card" key={p.id}>
            <span className="eyebrow">
              Day {p.dayNumber} · {p.platform}
            </span>
            <h3>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {p.title} ↗
              </a>
            </h3>
            <Status value={p.status} />
            {p.reason && <p>{p.reason.replaceAll('_', ' ').toLowerCase()}</p>}
            <p>Sync: {p.syncStatus.replaceAll('_', ' ').toLowerCase()}</p>
            {p.solvedAt && (
              <p>Accepted {new Date(p.solvedAt).toLocaleString()}</p>
            )}
            <Button variant="outline" onClick={() => setEvidence(p.id)}>
              View evidence
            </Button>
          </article>
        ))}
      </div>
      {!items.length && <p>No released assignments match these filters.</p>}
      {evidence && (
        <Evidence
          batchId={batchId}
          assignmentId={evidence}
          studentProfileId={studentProfileId}
          onClose={() => setEvidence(null)}
        />
      )}
    </>
  );
}
export function DayProgress({
  batchId,
  day,
}: {
  batchId: string;
  day: number;
}) {
  return (
    <section aria-label="Verified coding progress">
      <h2>Verified coding progress</h2>
      <StudentProgressContent batchId={batchId} initialDay={day} />
    </section>
  );
}
export function StudentProgress({ batchId }: { batchId: string }) {
  return (
    <StudentShell
      title="Your coding progress."
      description="Only verified submissions within the Batch and enrollment window count."
    >
      <Link href="/student/progress">All Batches</Link> ·{' '}
      <Link href="/student/coding-accounts">Coding accounts</Link>
      <StudentProgressContent batchId={batchId} />
    </StudentShell>
  );
}
function StudentProgressContent({
  batchId,
  initialDay,
}: {
  batchId: string;
  initialDay?: number;
}) {
  const [page, setPage] = useState(1),
    [platform, setPlatform] = useState(''),
    [status, setStatus] = useState(''),
    [day, setDay] = useState(initialDay ? String(initialDay) : '');
  const command = useCommand();
  const params = new URLSearchParams({
    page: String(page),
    ...(platform ? { platform } : {}),
    ...(status ? { status } : {}),
    ...(day ? { day } : {}),
  });
  const q = useAdministration(
    '/students/me/batches/' + batchId + '/progress?' + params,
    dashboardSchema,
  );
  return (
    <>
      <Filters
        platform={platform}
        status={status}
        day={day}
        onPlatform={(v) => {
          setPage(1);
          setPlatform(v);
        }}
        onStatus={(v) => {
          setPage(1);
          setStatus(v);
        }}
        onDay={(v) => {
          setPage(1);
          setDay(v);
        }}
      />
      <div className="admin-actions">
        <Button variant="outline" onClick={() => void q.refetch()}>
          Reload progress
        </Button>
        {platforms.map((p) => (
          <Button
            key={p}
            disabled={command.isPending}
            onClick={() =>
              command.mutate({
                path: '/batches/' + batchId + '/progress/refresh',
                body: { platform: p, confirmed: true },
              })
            }
          >
            Refresh {p}
          </Button>
        ))}
      </div>
      <p>
        Refresh queues a background check and requires verified ownership.
        Provider failures and incomplete history do not erase recorded solves.
      </p>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <h2>{q.data.batchName}</h2>
            <p>{q.data.course}</p>
            <Metrics value={q.data.summary} />
            <p>
              Completion uses all released assigned problems. Unavailable
              coverage remains in the denominator.
            </p>
            {!q.data.eligibleAfter && (
              <p role="alert">
                Actual activation timestamps are missing. Verified attribution
                is blocked.
              </p>
            )}
            <details>
              <summary>By platform and Learning Day</summary>
              {q.data.platforms.map((p) => (
                <p key={p.platform}>
                  {p.platform}: {p.solved}/{p.assigned} solved; {p.unavailable}{' '}
                  unavailable
                </p>
              ))}
              {q.data.days.map((d) => (
                <p key={d.day}>
                  Day {d.day}: {d.solved}/{d.assigned} solved; {d.unavailable}{' '}
                  unavailable
                </p>
              ))}
            </details>
            <AssignmentProgress batchId={batchId} items={q.data.items} />
            <Pagination
              page={page}
              total={q.data.total}
              totalPages={q.data.totalPages}
              onChange={setPage}
            />
            <details>
              <summary>Recent sync jobs</summary>
              {q.data.jobs.map((j) => (
                <p key={j.id}>
                  <Status value={j.status} /> · Coverage{' '}
                  {j.coverage.toLowerCase()} {j.error?.replaceAll('_', ' ')}
                </p>
              ))}
            </details>
          </>
        )}
      </QueryState>
    </>
  );
}
function Filters({
  platform,
  status,
  day,
  onPlatform,
  onStatus,
  onDay,
}: {
  platform: string;
  status: string;
  day: string;
  onPlatform: (v: string) => void;
  onStatus: (v: string) => void;
  onDay: (v: string) => void;
}) {
  return (
    <div className="coding-filters">
      <label>
        Platform
        <select value={platform} onChange={(e) => onPlatform(e.target.value)}>
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select value={status} onChange={(e) => onStatus(e.target.value)}>
          <option value="">All statuses</option>
          {[
            'NOT_STARTED',
            'ATTEMPTED_VERIFIED',
            'SOLVED_VERIFIED',
            'VERIFICATION_UNAVAILABLE',
          ].map((s) => (
            <option key={s} value={s}>
              {s.replaceAll('_', ' ').toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label>
        Learning Day
        <input
          type="number"
          min={1}
          max={1000000000}
          value={day}
          onChange={(e) => onDay(e.target.value)}
        />
      </label>
    </div>
  );
}
export function StaffProgress({ batchId }: { batchId: string }) {
  const [page, setPage] = useState(1),
    [platform, setPlatform] = useState(''),
    [status, setStatus] = useState(''),
    [day, setDay] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [assignmentPage, setAssignmentPage] = useState(1),
    [studentFilter, setStudentFilter] = useState(''),
    [problemFilter, setProblemFilter] = useState(''),
    [verification, setVerification] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const command = useCommand();
  const filters = {
    assignmentPage,
    studentProfileId: studentFilter || undefined,
    problemId: problemFilter || undefined,
    verification: verification || undefined,
    from: from ? from + 'T00:00:00.000Z' : undefined,
    to: to ? to + 'T23:59:59.999Z' : undefined,
  };
  const params = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(filters)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ),
    page: String(page),
    ...(platform ? { platform } : {}),
    ...(status ? { status } : {}),
    ...(day ? { day } : {}),
  });
  const q = useAdministration(
      '/batches/' + batchId + '/progress?' + params,
      matrixSchema,
    ),
    student = q.data?.items.find((v) => v.id === selected);
  return (
    <>
      <p className="student-notice">
        Dashboard tables are paginated. Report downloads include all matching
        authorized rows; unavailable verification remains separate from checked
        no-verified-solve results.
      </p>
      <Filters
        platform={platform}
        status={status}
        day={day}
        onPlatform={(v) => {
          setPage(1);
          setPlatform(v);
        }}
        onStatus={(v) => {
          setPage(1);
          setStatus(v);
        }}
        onDay={(v) => {
          setPage(1);
          setDay(v);
        }}
      />
      <div className="coding-filters">
        <label>
          Student
          <select
            value={studentFilter}
            onChange={(e) => {
              setStudentFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Students on roster</option>
            {q.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.rollNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          Problem
          <select
            value={problemFilter}
            onChange={(e) => {
              setProblemFilter(e.target.value);
              setAssignmentPage(1);
            }}
          >
            <option value="">All problems</option>
            {[
              ...new Map(
                q.data?.items
                  .flatMap((v) => v.items)
                  .map((v) => [v.problemId, v]) ?? [],
              ).values(),
            ].map((v) => (
              <option key={v.problemId} value={v.problemId}>
                {v.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ownership
          <select
            value={verification}
            onChange={(e) => setVerification(e.target.value)}
          >
            <option value="">All ownership states</option>
            {[
              'UNLINKED',
              'PENDING_VERIFICATION',
              'VERIFIED',
              'VERIFICATION_UNAVAILABLE',
              'REVOKED',
            ].map((v) => (
              <option key={v} value={v}>
                {v.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          From submission date (UTC)
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through submission date (UTC)
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          Assignment page
          <input
            type="number"
            min={1}
            max={1000}
            value={assignmentPage}
            onChange={(e) =>
              setAssignmentPage(
                Math.max(1, Math.min(1000, Number(e.target.value) || 1)),
              )
            }
          />
        </label>
      </div>
      <div className="admin-actions">
        <Button variant="outline" onClick={() => void q.refetch()}>
          Reload matrix
        </Button>
        <Button
          variant="outline"
          disabled={command.isPending}
          onClick={async () => {
            setError('');
            try {
              const result = await command.mutateAsync({
                path: '/batches/' + batchId + '/progress/refresh-batch',
                body: {
                  platform: platform || 'CODEFORCES',
                  page,
                  pageSize: q.data?.pageSize ?? 10,
                  confirmed: true,
                },
              });
              const parsed = z
                .object({ items: z.array(z.object({ outcome: z.string() })) })
                .parse(result);
              setError(
                parsed.items.filter((v) => v.outcome === 'QUEUED').length +
                  ' accounts queued; ' +
                  parsed.items.filter((v) => v.outcome !== 'QUEUED').length +
                  ' skipped (ownership, cooldown or eligibility).',
              );
            } catch {
              setError(
                'Batch refresh could not be queued. Current progress.manage permission is required.',
              );
            }
          }}
        >
          Refresh roster page {platform || 'CODEFORCES'}
        </Button>
      </div>
      <ReportDownloads
        batchId={batchId}
        filters={{
          ...filters,
          platform: platform || undefined,
          status: status || undefined,
          day: day ? Number(day) : undefined,
        }}
      />
      {error && <p role="alert">{error}</p>}
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <h2>{q.data.batchName}</h2>
            <DataTable
              items={q.data.items}
              empty="No currently eligible Students"
              columns={[
                {
                  key: 'student',
                  label: 'Student',
                  render: (r) => (
                    <Button variant="ghost" onClick={() => setSelected(r.id)}>
                      {r.name}
                      <br />
                      {r.rollNumber}
                    </Button>
                  ),
                },
                {
                  key: 'solved',
                  label: 'Verified solves',
                  render: (r) => r.summary.solved + '/' + r.summary.assigned,
                },
                {
                  key: 'attempted',
                  label: 'Verified attempts',
                  render: (r) => r.summary.attempted,
                },
                {
                  key: 'unavailable',
                  label: 'Unavailable',
                  render: (r) => r.summary.unavailable,
                },
                {
                  key: 'completion',
                  label: 'Completion',
                  render: (r) => r.summary.completionPercent + '%',
                },
                {
                  key: 'matrix',
                  label: 'Assignment status (20 per page)',
                  render: (r) => (
                    <div>
                      {r.items.map((p) => (
                        <p key={p.id}>
                          Day {p.dayNumber} · {p.title}:{' '}
                          <Status value={p.status} />
                        </p>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
            <Pagination
              page={page}
              total={q.data.total}
              totalPages={q.data.totalPages}
              onChange={setPage}
            />
            <ProblemAnalytics batchId={batchId} platform={platform} day={day} />
            {student && (
              <section className="student-card">
                <h2>{student.name} · Evidence and sync history</h2>
                <Metrics value={student.summary} />
                <div className="admin-actions">
                  {platforms.map((platform) => (
                    <Button
                      key={platform}
                      disabled={command.isPending}
                      onClick={() =>
                        command.mutate({
                          path: '/batches/' + batchId + '/progress/refresh',
                          body: {
                            platform,
                            studentProfileId: student.id,
                            confirmed: true,
                          },
                        })
                      }
                    >
                      Refresh {platform}
                    </Button>
                  ))}
                </div>
                <AssignmentProgress
                  batchId={batchId}
                  items={student.items}
                  studentProfileId={student.id}
                />
                {student.jobs.map((j) => (
                  <p key={j.id}>
                    <Status value={j.status} /> {j.coverage} {j.error}
                  </p>
                ))}
              </section>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}

function ProblemAnalytics({
  batchId,
  platform,
  day,
}: {
  batchId: string;
  platform: string;
  day: string;
}) {
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    page: String(page),
    ...(platform ? { platform } : {}),
    ...(day ? { day } : {}),
  });
  const q = useAdministration(
    '/batches/' + batchId + '/progress/analytics?' + params,
    analyticsSchema,
  );
  return (
    <section aria-label="Problem analytics">
      <h2>Problem-wise analytics</h2>
      <p>
        Counts include currently eligible Students across the Batch roster, up
        to 2,000 members. Platform and Learning Day filters apply.
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
              columns={[
                {
                  key: 'problem',
                  label: 'Problem',
                  render: (r) => 'Day ' + r.dayNumber + ' · ' + r.title,
                },
                {
                  key: 'students',
                  label: 'Eligible Students',
                  render: (r) => r.eligibleStudents,
                },
                {
                  key: 'solved',
                  label: 'Verified solves',
                  render: (r) => r.solved,
                },
                {
                  key: 'attempted',
                  label: 'Verified attempts',
                  render: (r) => r.attempted,
                },
                {
                  key: 'unavailable',
                  label: 'Unavailable',
                  render: (r) => r.unavailable,
                },
              ]}
            />
            <Pagination
              page={page}
              total={q.data.total}
              totalPages={q.data.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </QueryState>
    </section>
  );
}

export function ProblemProgressBadge({
  batchId,
  day,
  problemId,
}: {
  batchId: string;
  day: number;
  problemId: string;
}) {
  const q = useAdministration(
      '/students/me/batches/' + batchId + '/progress/days/' + day,
      dashboardSchema,
    ),
    item = q.data?.items.find((v) => v.problemId === problemId);
  if (q.isPending) return <p role="status">Checking verified progress…</p>;
  if (q.error)
    return (
      <p>
        Progress unavailable.{' '}
        <Button variant="ghost" onClick={() => void q.refetch()}>
          Retry progress
        </Button>
      </p>
    );
  return (
    <div aria-label="Problem progress">
      <Status value={item?.status ?? 'VERIFICATION_UNAVAILABLE'} />
      {item?.solvedAt && (
        <p>
          Verified accepted submission ·{' '}
          {new Date(item.solvedAt).toLocaleString()}
        </p>
      )}
      <Link href={'/student/batches/' + batchId + '/progress'}>
        Evidence and refresh →
      </Link>
    </div>
  );
}
