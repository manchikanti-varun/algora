'use client';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { apiMutate } from '@/lib/api/client';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import { useQueryClient } from '@tanstack/react-query';
import {
  DataTable,
  Field,
  Status,
  Dialog,
  Confirmation,
  Pagination,
  QueryState,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { rollSchema } from '@/features/students/contracts';
import {
  batchSchema,
  enrollmentSchema,
  enrollmentStatuses,
  previewSchema,
  importResultSchema,
  pageSchema,
  historySchema,
  type Enrollment,
  type ImportResult,
} from './contracts';
import { DestinationPicker } from './transfer-options';
export function EnrollmentWorkspace({
  id,
  superAdmin = false,
}: {
  id: string;
  superAdmin?: boolean;
}) {
  const [tab, setTab] = useState('Current'),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [action, setAction] = useState<{
      row: Enrollment;
      kind: 'withdraw' | 'transfer';
    } | null>(null);
  const batch = useAdministration('/batches/' + id, batchSchema);
  const history = tab === 'History',
    viewRoster = !!batch.data?.canViewRoster;
  const q = useAdministration(
    '/batches/' +
      id +
      (history ? '/enrollment-history' : '/enrollments') +
      '?page=' +
      page +
      '&search=' +
      encodeURIComponent(search) +
      (status
        ? '&status=' + status
        : tab === 'Pending'
          ? '&status=PENDING'
          : ''),
    pageSchema(enrollmentSchema),
    viewRoster && ['Current', 'Pending', 'History'].includes(tab),
  );
  const prefix = superAdmin ? '/super-admin' : '/admin';
  const tabs = [
    'Current',
    'Pending',
    'Add student',
    'Bulk import',
    'History',
    'Events',
  ];
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={prefix + '/batches'}>Batches</Link> /{' '}
        <Link href={prefix + '/batches/' + id}>Batch details</Link> /
        Enrollments
      </nav>
      <QueryState
        pending={batch.isPending}
        error={batch.error}
        onRetry={() => void batch.refetch()}
      >
        {batch.data && (
          <>
            <div className="student-notice">
              <strong>{batch.data.name}</strong> · {batch.data.snapshot.title}
              <br />
              {batch.data.seatCount} reserved memberships
              {batch.data.capacity !== null ? ' of ' + batch.data.capacity : ''}
              . Pending records reserve capacity and grant no learning access.
            </div>
            <div
              className="learning-tabs"
              role="tablist"
              aria-label="Enrollment sections"
            >
              {tabs
                .filter((t) =>
                  ['Add student', 'Bulk import'].includes(t)
                    ? batch.data!.canEnroll
                    : ['History', 'Events'].includes(t)
                      ? (batch.data!.canViewHistory ??
                        batch.data!.canViewRoster)
                      : batch.data!.canViewRoster,
                )
                .map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => {
                      setTab(t);
                      setPage(1);
                      setStatus('');
                      setSearch('');
                    }}
                  >
                    {t}
                  </button>
                ))}
            </div>
            {['Current', 'Pending', 'History'].includes(tab) &&
              (viewRoster ? (
                <>
                  <div className="learning-toolbar">
                    <Field label="Find roll number">
                      <input
                        aria-label="Find roll number"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                      />
                    </Field>
                    <Field label="Enrollment status">
                      <select
                        aria-label="Enrollment status"
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="">
                          {tab === 'Pending'
                            ? 'All pending states'
                            : 'All current states'}
                        </option>
                        {(history
                          ? enrollmentStatuses
                          : [
                              'PENDING_REGISTRATION',
                              'PENDING_VERIFICATION',
                              'ACTIVE',
                            ]
                        ).map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <QueryState
                    pending={q.isPending}
                    error={q.error}
                    onRetry={() => void q.refetch()}
                  >
                    {q.data && (
                      <>
                        <DataTable
                          items={q.data.items}
                          empty="No matching memberships"
                          columns={[
                            {
                              key: 'roll',
                              label: 'Roll number',
                              render: (e) => <strong>{e.rollNumber}</strong>,
                            },
                            {
                              key: 'status',
                              label: 'Status',
                              render: (e) => (
                                <>
                                  <Status value={e.status} />
                                  <p>
                                    {e.reason
                                      .replaceAll('_', ' ')
                                      .toLowerCase()}
                                  </p>
                                </>
                              ),
                            },
                            {
                              key: 'source',
                              label: 'Source',
                              render: (e) => e.source.toLowerCase(),
                            },
                            {
                              key: 'actions',
                              label: 'Actions',
                              render: (e) => (
                                <div className="student-actions">
                                  {batch.data?.canEnroll &&
                                    [
                                      'ACTIVE',
                                      'PENDING_REGISTRATION',
                                      'PENDING_VERIFICATION',
                                    ].includes(e.status) && (
                                      <>
                                        <Button
                                          variant="outline"
                                          onClick={() =>
                                            setAction({
                                              row: e,
                                              kind: 'withdraw',
                                            })
                                          }
                                        >
                                          Withdraw
                                        </Button>
                                        <Button
                                          variant="outline"
                                          onClick={() =>
                                            setAction({
                                              row: e,
                                              kind: 'transfer',
                                            })
                                          }
                                        >
                                          Transfer
                                        </Button>
                                      </>
                                    )}
                                  {e.transferredTo && (
                                    <span>Transferred out</span>
                                  )}
                                  {e.transferredFrom && (
                                    <span>Transferred in</span>
                                  )}
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
                      </>
                    )}
                  </QueryState>
                </>
              ) : (
                <p>
                  You need student.view permission to read this roster.
                  Enrollment actions remain subject to separate permissions.
                </p>
              ))}
            {tab === 'Add student' && batch.data.canEnroll && (
              <ManualEnrollment id={id} />
            )}{' '}
            {tab === 'Bulk import' && batch.data.canEnroll && (
              <BulkEnrollment id={id} />
            )}{' '}
            {tab === 'Events' && viewRoster && <EnrollmentEvents id={id} />}
            <Dialog
              open={!!action}
              title={
                action?.kind === 'withdraw'
                  ? 'Withdraw membership'
                  : 'Transfer membership'
              }
              onClose={() => setAction(null)}
            >
              {action && (
                <MembershipAction
                  key={action.row.id + action.kind}
                  row={action.row}
                  kind={action.kind}
                  superAdmin={superAdmin}
                  courseId={batch.data.courseId}
                  collegeId={batch.data.collegeId}
                  onDone={() => setAction(null)}
                />
              )}
            </Dialog>
          </>
        )}
      </QueryState>
    </>
  );
}
function Results({
  rows,
  heading = 'Import results',
}: {
  rows: ImportResult[];
  heading?: string;
}) {
  const [page, setPage] = useState(1);
  const counts = rows.reduce<Record<string, number>>(
    (a, r) => ((a[r.outcome] = (a[r.outcome] ?? 0) + 1), a),
    {},
  );
  return (
    <section className="student-card">
      <h2>{heading}</h2>
      <p>
        {rows.length} input rows ·{' '}
        {
          new Set(
            rows
              .filter((r) => /^[A-Z0-9]{10}$/.test(r.rollNumber))
              .map((r) => r.rollNumber),
          ).size
        }{' '}
        unique valid rolls
      </p>
      <dl className="learning-summary">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k}>
            <dt>{k.replaceAll('_', ' ').toLowerCase()}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <DataTable
        items={rows
          .slice((page - 1) * 25, page * 25)
          .map((r) => ({ ...r, id: String(r.row) }))}
        columns={[
          { key: 'row', label: 'Row', render: (r) => r.row },
          {
            key: 'roll',
            label: 'Roll number',
            render: (r) => r.rollNumber || 'Empty',
          },
          {
            key: 'outcome',
            label: 'Outcome',
            render: (r) => <Status value={r.outcome} />,
          },
          {
            key: 'reason',
            label: 'Reason',
            render: (r) => r.reason.replaceAll('_', ' ').toLowerCase(),
          },
        ]}
      />
      <Pagination
        page={page}
        total={rows.length}
        totalPages={Math.ceil(rows.length / 25)}
        onChange={setPage}
      />
    </section>
  );
}
export function ManualEnrollment({ id }: { id: string }) {
  const [roll, setRoll] = useState(''),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<z.infer<typeof importResultSchema> | null>(
      null,
    ),
    [key, setKey] = useState(''),
    [keyRoll, setKeyRoll] = useState(''),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const data = await apiMutate(
        '/batches/' + id + '/enrollments',
        'POST',
        importResultSchema,
        {
          rollNumber: rollSchema.parse(roll),
          requestKey: key,
          confirmed: true,
        },
      );
      setResult(data);
      setConfirm(false);
      await client.invalidateQueries({ queryKey: ['administration'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enrollment failed');
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="student-card">
      <h2>Add one student</h2>
      <p>
        Use the current ten-character roll number only. Verified students may
        activate; unregistered and unverified students remain pending. No lookup
        by email, name or phone.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = rollSchema.safeParse(roll);
          if (!parsed.success) {
            setError('Enter exactly 10 ASCII letters or digits.');
            return;
          }
          setRoll(parsed.data);
          setError('');
          if (!key || keyRoll !== parsed.data) {
            setKey(crypto.randomUUID());
            setKeyRoll(parsed.data);
          }
          setConfirm(true);
        }}
      >
        <Field label="Student roll number">
          <input
            aria-label="Student roll number"
            value={roll}
            onChange={(e) => setRoll(e.target.value)}
            maxLength={30}
          />
        </Field>
        <Button disabled={busy}>Review enrollment</Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && <Results rows={result.results} heading="Enrollment result" />}
      <Confirmation
        open={confirm}
        title={'Enroll ' + roll + '?'}
        description="Current permissions, identity, batch eligibility and capacity will be checked again. A pending membership reserves a seat without granting learning access."
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => void submit()}
      />
    </section>
  );
}
export function BulkEnrollment({ id }: { id: string }) {
  const [mode, setMode] = useState<'PASTE' | 'FILE'>('PASTE'),
    [text, setText] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(
      null,
    ),
    [results, setResults] = useState<z.infer<typeof importResultSchema> | null>(
      null,
    ),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const client = useQueryClient();
  async function makePreview() {
    setBusy(true);
    setError('');
    setPreview(null);
    setResults(null);
    try {
      let body: unknown = { kind: 'PASTE', text };
      if (mode === 'FILE') {
        if (!file || file.size > 1024 * 1024)
          throw new Error('Select a CSV or XLSX file of at most 1 MiB.');
        const ext = file.name.split('.').at(-1)?.toLowerCase();
        if (!['csv', 'xlsx'].includes(ext ?? ''))
          throw new Error('Only CSV and XLSX files are accepted.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192)
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 8192),
          );
        body = { kind: ext === 'csv' ? 'CSV' : 'XLSX', base64: btoa(binary) };
      }
      setPreview(
        await apiMutate(
          '/batches/' + id + '/enrollments/preview',
          'POST',
          previewSchema,
          body,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      setResults(
        await apiMutate(
          '/batches/' + id + '/enrollments/import',
          'POST',
          importResultSchema,
          { previewToken: preview.previewToken, confirmed: true },
        ),
      );
      setConfirm(false);
      await client.invalidateQueries({ queryKey: ['administration'] });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Import failed; retry this preview to avoid duplicate work',
      );
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="student-card">
      <h2>Import a student list</h2>
      <p>
        Up to 200 rolls per import. Preview does not reserve seats or authorize
        later access. Confirmation rechecks current state; results can differ
        from the preview.
      </p>
      <div className="student-actions">
        <Button
          variant={mode === 'PASTE' ? 'default' : 'outline'}
          onClick={() => {
            setMode('PASTE');
            setPreview(null);
          }}
        >
          Paste rolls
        </Button>
        <Button
          variant={mode === 'FILE' ? 'default' : 'outline'}
          onClick={() => {
            setMode('FILE');
            setPreview(null);
          }}
        >
          CSV / Excel file
        </Button>
      </div>
      {mode === 'PASTE' ? (
        <Field label="Roll numbers">
          <textarea
            aria-label="Roll numbers"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            maxLength={12000}
            placeholder="One per line, comma-separated or whitespace-separated"
          />
        </Field>
      ) : (
        <Field label="CSV or XLSX file">
          <input
            aria-label="CSV or XLSX file"
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
          <p>
            Required column: Roll Number (RollNumber, Roll_No or Roll No also
            accepted). Extra columns are ignored. The first XLSX worksheet is
            used; store rolls as text to retain leading zeros. Formulas and
            ambiguous numeric cells are rejected. Uploads are not stored as
            files.
          </p>
        </Field>
      )}
      <Button onClick={() => void makePreview()} disabled={busy}>
        Validate & preview
      </Button>
      {error && <p role="alert">{error}</p>}
      {preview && !results && (
        <>
          {preview.warnings.map((w) => (
            <p key={w} role="status">
              {w}
            </p>
          ))}
          <Results rows={preview.results} heading="Import preview" />
          <p>
            Preview expires at{' '}
            {new Date(preview.expiresAt).toLocaleTimeString()}. Expected
            conflicts are skipped individually; all accepted rows and this
            result record commit in one bounded transaction. Unexpected failures
            roll back the operation.
          </p>
          <Button onClick={() => setConfirm(true)} disabled={busy}>
            Confirm import
          </Button>
        </>
      )}
      {results && (
        <>
          <p role="status">
            {results.replayed
              ? 'Previous committed results recovered.'
              : 'Import transaction committed.'}
          </p>
          <Results rows={results.results} />
        </>
      )}
      <Confirmation
        open={confirm}
        title="Import eligible rows?"
        description="Invalid and conflicting rows will be reported without enrollment. Every accepted row is revalidated. Repeating this exact preview returns the same committed results."
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => void execute()}
      />
    </section>
  );
}
function MembershipAction({
  row,
  kind,
  superAdmin,
  courseId,
  collegeId,
  onDone,
}: {
  row: Enrollment;
  kind: 'withdraw' | 'transfer';
  superAdmin: boolean;
  courseId: string;
  collegeId: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState(''),
    [dest, setDest] = useState(''),
    [confirm, setConfirm] = useState(false),
    command = useCommand();
  return (
    <section className="student-card">
      <h3>{row.rollNumber}</h3>
      <p>
        Membership and review history remain preserved. Transfer is limited to
        another eligible batch of the same course and college.
      </p>
      {kind === 'transfer' && (
        <DestinationPicker
          sourceId={row.batchId}
          courseId={courseId}
          collegeId={collegeId}
          value={dest}
          onChange={setDest}
        />
      )}
      <Field label="Reason">
        <textarea
          aria-label="Membership change reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
        />
      </Field>
      <Button
        disabled={
          reason.trim().length < 10 ||
          (kind === 'transfer' && !dest) ||
          command.isPending
        }
        onClick={() => setConfirm(true)}
      >
        Review {kind}
      </Button>
      {command.error && <p role="alert">{command.error.message}</p>}
      <Confirmation
        open={confirm}
        title={
          kind === 'withdraw'
            ? 'Withdraw this membership?'
            : 'Transfer this membership?'
        }
        description="Current college permissions, identity, destination eligibility and capacity will be checked. The action is audited and effective source access ends immediately."
        busy={command.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          void command
            .mutateAsync({
              path:
                '/batches/' +
                row.batchId +
                '/enrollments/' +
                row.id +
                '/' +
                kind,
              body: {
                reason,
                expectedRevision: row.revision,
                confirmed: true,
                ...(kind === 'transfer' ? { destinationBatchId: dest } : {}),
              },
            })
            .then(onDone)
            .catch(() => setConfirm(false))
        }
      />
      {superAdmin && (
        <p>
          Cross-college identity changes require the separate profile correction
          workflow.
        </p>
      )}
    </section>
  );
}
function EnrollmentEvents({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const q = useAdministration(
    '/batches/' + id + '/enrollment-events?page=' + page,
    pageSchema(historySchema),
  );
  return (
    <QueryState
      pending={q.isPending}
      error={q.error}
      onRetry={() => void q.refetch()}
    >
      {q.data && (
        <>
          <DataTable
            items={q.data.items}
            empty="No enrollment events yet"
            columns={[
              { key: 'action', label: 'Event', render: (e) => e.action },
              {
                key: 'change',
                label: 'Transition',
                render: (e) => (
                  <>
                    {e.before ?? 'New'} → {e.after}
                  </>
                ),
              },
              { key: 'reason', label: 'Reason', render: (e) => e.reason },
              {
                key: 'time',
                label: 'Time',
                render: (e) => new Date(e.createdAt).toLocaleString(),
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
  );
}
