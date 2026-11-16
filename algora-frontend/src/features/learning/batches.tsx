'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
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
import {
  batchSchema,
  batchFormSchema,
  pageSchema,
  type Batch,
  type BatchForm,
} from './contracts';
import { CollegePicker, CoursePicker, useCollegeOptions } from './options';
export function BatchCatalog({ superAdmin = false }: { superAdmin?: boolean }) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [college, setCollege] = useState(''),
    [course, setCourse] = useState(''),
    [edit, setEdit] = useState<Batch | null | undefined>();
  const prefix = superAdmin ? '/super-admin' : '/admin',
    permissions = useCollegeOptions(superAdmin, 'batch.manage');
  const p = new URLSearchParams({ page: String(page), search });
  if (status) p.set('status', status);
  if (college) p.set('collegeId', college);
  if (course) p.set('courseId', course);
  const q = useAdministration('/batches?' + p, pageSchema(batchSchema));
  return (
    <>
      <div className="learning-toolbar">
        <Field label="Search batches">
          <input
            aria-label="Search batches"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Batch status">
          <select
            aria-label="Batch status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All states</option>
            {['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        {(superAdmin || permissions.items.length > 0) && (
          <Button onClick={() => setEdit(null)}>Create batch</Button>
        )}
      </div>
      <details className="student-card">
        <summary>College and course filters</summary>
        <CollegePicker
          superAdmin={superAdmin}
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
      </details>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <DataTable
              items={q.data.items}
              empty="No matching batches"
              columns={[
                {
                  key: 'batch',
                  label: 'Batch',
                  render: (b) => (
                    <>
                      <Link href={prefix + '/batches/' + b.id}>{b.name}</Link>
                      <p>
                        {b.code} · {b.snapshot.title}
                      </p>
                    </>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: (b) => <Status value={b.status} />,
                },
                {
                  key: 'seats',
                  label: 'Reserved memberships',
                  render: (b) => (
                    <>
                      {b.seatCount}
                      {b.capacity !== null ? ' / ' + b.capacity : ''}
                    </>
                  ),
                },
                {
                  key: 'dates',
                  label: 'Dates',
                  render: (b) => (
                    <>
                      {b.startDate ?? 'Not set'} – {b.endDate ?? 'Not set'}
                    </>
                  ),
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (b) => (
                    <div className="student-actions">
                      <Link href={prefix + '/batches/' + b.id + '/analytics'}>
                        Batch analytics
                      </Link>
                      <Button asChild variant="outline">
                        <Link href={prefix + '/batches/' + b.id}>Details</Link>
                      </Button>
                      {b.canManage &&
                        !['COMPLETED', 'ARCHIVED'].includes(b.status) && (
                          <Button variant="outline" onClick={() => setEdit(b)}>
                            Edit batch
                          </Button>
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
      <Dialog
        open={edit !== undefined}
        title={edit ? 'Edit batch' : 'Create college batch'}
        onClose={() => setEdit(undefined)}
      >
        {edit !== undefined && (
          <BatchEditor
            key={edit?.id ?? 'new'}
            superAdmin={superAdmin}
            batch={edit}
            onDone={() => setEdit(undefined)}
          />
        )}
      </Dialog>
    </>
  );
}
function BatchEditor({
  superAdmin,
  batch,
  onDone,
}: {
  superAdmin: boolean;
  batch: Batch | null;
  onDone: () => void;
}) {
  const command = useCommand(),
    f = useForm<BatchForm>({
      resolver: zodResolver(batchFormSchema),
      defaultValues: batch ?? {
        name: '',
        code: '',
        description: '',
        collegeId: '',
        courseId: '',
        startDate: null,
        endDate: null,
        capacity: null,
      },
    });
  const college = useWatch({ control: f.control, name: 'collegeId' }),
    course = useWatch({ control: f.control, name: 'courseId' });
  return (
    <form
      className="student-card"
      onSubmit={f.handleSubmit(async (values) => {
        const { courseId, collegeId, ...patch } = values;
        try {
          await command.mutateAsync({
            path: batch ? '/batches/' + batch.id : '/batches',
            method: batch ? 'PATCH' : 'POST',
            body: batch
              ? { ...patch, expectedRevision: batch.revision }
              : { ...patch, courseId, collegeId },
          });
          onDone();
        } catch {}
      })}
    >
      {!batch && (
        <>
          <CollegePicker
            superAdmin={superAdmin}
            permission="batch.manage"
            value={college}
            onChange={(v) => {
              f.setValue('collegeId', v, { shouldValidate: true });
              f.setValue('courseId', '');
            }}
          />
          <CoursePicker
            collegeId={college}
            value={course}
            onChange={(v) =>
              f.setValue('courseId', v, { shouldValidate: true })
            }
          />
        </>
      )}
      <div className="student-grid">
        {(['name', 'code'] as const).map((k) => (
          <Field
            key={k}
            label={k === 'name' ? 'Batch name' : 'Batch code'}
            error={f.formState.errors[k]?.message}
          >
            <input
              aria-label={k === 'name' ? 'Batch name' : 'Batch code'}
              {...f.register(k)}
            />
          </Field>
        ))}
        {(['startDate', 'endDate'] as const).map((k) => (
          <Field
            key={k}
            label={k === 'startDate' ? 'Start date' : 'End date'}
            error={f.formState.errors[k]?.message}
          >
            <input
              aria-label={k === 'startDate' ? 'Start date' : 'End date'}
              type="date"
              {...f.register(k, { setValueAs: (v) => v || null })}
            />
          </Field>
        ))}
        <Field label="Capacity (optional)">
          <input
            aria-label="Batch capacity"
            type="number"
            min={1}
            max={10000}
            {...f.register('capacity', {
              setValueAs: (v) =>
                v === '' || v === null || v === undefined ? null : Number(v),
            })}
          />
        </Field>
      </div>
      <Field label="Batch description">
        <textarea
          aria-label="Batch description"
          {...f.register('description')}
        />
      </Field>
      <p>
        Pending memberships reserve seats too. College and course remain fixed.
        Activation captures the current course metadata; later course edits do
        not rewrite that snapshot.
      </p>
      {Object.values(f.formState.errors).map((e, i) => (
        <p key={i} role="alert">
          {e.message}
        </p>
      ))}
      {command.error && <p role="alert">{command.error.message}</p>}
      <Button disabled={command.isPending}>Save batch</Button>
    </form>
  );
}
export function BatchDetail({
  id,
  superAdmin = false,
}: {
  id: string;
  superAdmin?: boolean;
}) {
  const q = useAdministration('/batches/' + id, batchSchema),
    command = useCommand(),
    [action, setAction] = useState<'activate' | 'complete' | 'archive' | null>(
      null,
    );
  const prefix = superAdmin ? '/super-admin' : '/admin';
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={prefix + '/courses'}>Courses</Link> /{' '}
        <Link href={prefix + '/batches'}>Batches</Link> / Details
      </nav>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <section className="student-card">
            <Status value={q.data.status} />
            <h2>{q.data.name}</h2>
            <p>{q.data.description}</p>
            <dl className="student-grid">
              <div>
                <dt>Course snapshot</dt>
                <dd>
                  {q.data.snapshot.title} · revision{' '}
                  {q.data.snapshot.courseRevision}
                </dd>
              </div>
              <div>
                <dt>Reserved memberships</dt>
                <dd>
                  {q.data.seatCount}{' '}
                  {q.data.capacity === null
                    ? '(no capacity limit)'
                    : 'of ' + q.data.capacity}
                </dd>
              </div>
              <div>
                <dt>Start / end</dt>
                <dd>
                  {q.data.startDate ?? 'Not set'} /{' '}
                  {q.data.endDate ?? 'Not set'}
                </dd>
              </div>
              <div>
                <dt>Enrollment policy</dt>
                <dd>Authorized Admin, roll number only</dd>
              </div>
            </dl>
            <p className="learning-prose">{q.data.snapshot.description}</p>
            <div className="student-actions">
              <Link
                href={prefix + '/batches/' + id + '/analytics?tab=Operations'}
              >
                Bootcamp readiness
              </Link>
              <Link href={prefix + '/batches/' + id + '/analytics'}>
                Batch analytics
              </Link>
              <Link href={prefix + '/batches/' + id + '/attendance'}>
                Attendance sessions
              </Link>
              {(q.data.canEnroll || q.data.canViewRoster) && (
                <Button asChild>
                  <Link href={prefix + '/batches/' + id + '/enrollments'}>
                    Manage enrollments
                  </Link>
                </Button>
              )}
              {q.data.canManage && (
                <Link href={prefix + '/batches/' + id + '/curriculum'}>
                  Curriculum and assignment history
                </Link>
              )}
              {q.data.canManage && q.data.status !== 'ARCHIVED' && (
                <>
                  {q.data.status === 'DRAFT' && (
                    <Button onClick={() => setAction('activate')}>
                      Activate batch
                    </Button>
                  )}
                  {q.data.status === 'ACTIVE' && (
                    <Button onClick={() => setAction('complete')}>
                      Complete batch
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => setAction('archive')}
                  >
                    Archive batch
                  </Button>
                </>
              )}
            </div>
            <p>
              Assign a published curriculum to deliver Learning Days. Use
              attendance sessions for authorized scanning and finalized records.
              Verified coding progress and analytics are available from the
              Batch analytics workspace.
            </p>
          </section>
        )}
      </QueryState>
      <Confirmation
        open={!!action}
        title={(action ?? 'Update') + ' batch?'}
        description="This change is audited. Completion and archiving preserve enrollment history and block current learning access."
        busy={command.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (action && q.data)
            void command
              .mutateAsync({
                path: '/batches/' + id + '/' + action,
                body: { expectedRevision: q.data.revision, confirmed: true },
              })
              .then(() => setAction(null))
              .catch(() => setAction(null));
        }}
      />
    </>
  );
}
