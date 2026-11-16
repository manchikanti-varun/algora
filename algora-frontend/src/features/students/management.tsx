'use client';
import { useState } from 'react';
import { z } from 'zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import {
  DataTable,
  Pagination,
  QueryState,
  Status,
  Field,
  Dialog,
  Confirmation,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { ProfileFacts } from './profile';
import {
  yearLabel,
  profileSchema,
  correctionSchema,
  pageSchema,
  type Correction,
} from './contracts';
const detailSchema = z.object({
  profile: profileSchema,
  canVerify: z.boolean(),
  email: z.email().optional(),
  verificationEvidence: z.string().optional(),
  college: z
    .object({ id: z.string(), name: z.string(), status: z.string() })
    .nullable()
    .optional(),
});
export function StudentManagement({
  superAdmin = false,
}: {
  superAdmin?: boolean;
}) {
  const prefix = superAdmin ? '/super-admin' : '/admin';
  const [collegeSearch, setCollegeSearch] = useState(''),
    [collegePage, setCollegePage] = useState(1),
    [collegeLabel, setCollegeLabel] = useState('');
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [college, setCollege] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState<'directory' | 'corrections'>('directory');
  const params = new URLSearchParams({ page: String(page), search });
  if (status) params.set('status', status);
  if (college) params.set('collegeId', college);
  const q = useAdministration(
    prefix + '/students?' + params,
    pageSchema(profileSchema),
  );
  const colleges = useAdministration(
    superAdmin
      ? '/super-admin/colleges?pageSize=50&sort=name&direction=asc&page=' +
          collegePage +
          '&search=' +
          encodeURIComponent(collegeSearch)
      : '/admin/colleges',
    z.object({
      items: z.array(z.object({ id: z.string(), name: z.string() })),
      total: z.number().optional(),
      totalPages: z.number().optional(),
    }),
  );
  return (
    <>
      <div className="student-actions">
        <Button
          variant={tab === 'directory' ? 'default' : 'outline'}
          onClick={() => setTab('directory')}
        >
          Student directory
        </Button>
        <Button
          variant={tab === 'corrections' ? 'default' : 'outline'}
          onClick={() => setTab('corrections')}
        >
          Correction reviews
        </Button>
      </div>
      <div className="student-card">
        <div className="student-grid">
          {superAdmin && (
            <Field label="Find a college">
              <input
                aria-label="Find a college filter"
                value={collegeSearch}
                onChange={(e) => {
                  setCollegeSearch(e.target.value);
                  setCollegePage(1);
                }}
              />
            </Field>
          )}
          <Field label="Search students">
            <input
              aria-label="Search students"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Name or roll number"
            />
          </Field>
          <Field label="Verification status">
            <select
              aria-label="Verification status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All verification states</option>
              {['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="College filter">
            <select
              aria-label="College filter"
              value={college}
              onChange={(e) => {
                setCollege(e.target.value);
                setCollegeLabel(
                  colleges.data?.items.find((c) => c.id === e.target.value)
                    ?.name ?? 'Selected college',
                );
                setPage(1);
              }}
            >
              <option value="">All authorized colleges</option>
              {college &&
                !colleges.data?.items.some((c) => c.id === college) && (
                  <option value={college}>{collegeLabel}</option>
                )}
              {colleges.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {superAdmin && colleges.data && (
          <Pagination
            page={collegePage}
            total={colleges.data.total ?? colleges.data.items.length}
            totalPages={colleges.data.totalPages ?? 1}
            onChange={setCollegePage}
          />
        )}
        {colleges.error && (
          <p role="status">
            College filter unavailable. The directory remains restricted by
            backend permissions.
          </p>
        )}
      </div>
      {tab === 'directory' ? (
        <QueryState
          pending={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
        >
          {q.data && (
            <>
              <DataTable
                items={q.data.items}
                empty="No matching students"
                columns={[
                  {
                    key: 'name',
                    label: 'Student',
                    render: (p) => (
                      <>
                        <strong>{p.fullName}</strong>
                        <br />
                        {p.studentUsername}
                      </>
                    ),
                  },
                  {
                    key: 'roll',
                    label: 'Roll number',
                    render: (p) => p.rollNumber,
                  },
                  {
                    key: 'college',
                    label: 'College',
                    render: (p) =>
                      p.collegeName ??
                      colleges.data?.items.find((c) => c.id === p.collegeId)
                        ?.name ??
                      'College unavailable',
                  },
                  {
                    key: 'year',
                    label: 'Year of Study',
                    render: (p) => yearLabel(p.yearOfStudy),
                  },
                  {
                    key: 'verification',
                    label: 'Verification',
                    render: (p) => <Status value={p.verificationStatus} />,
                  },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (p) => (
                      <Button
                        variant="outline"
                        onClick={() => setSelected(p.id)}
                      >
                        View student
                      </Button>
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
      ) : (
        <CorrectionQueue
          prefix={prefix}
          college={college}
          onSelect={setSelected}
        />
      )}
      <Dialog
        open={!!selected}
        title="Student identity review"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <StudentDetail key={selected} prefix={prefix} id={selected} />
        )}
      </Dialog>
    </>
  );
}
function StudentDetail({ prefix, id }: { prefix: string; id: string }) {
  const q = useAdministration(prefix + '/students/' + id, detailSchema);
  const command = useCommand();
  const [evidence, setEvidence] = useState(''),
    [note, setNote] = useState(''),
    [action, setAction] = useState<'verify' | 'reject-verification' | null>(
      null,
    );
  async function submit() {
    if (!q.data || !action) return;
    try {
      await command.mutateAsync({
        path: prefix + '/students/' + id + '/' + action,
        body: {
          expectedRevision: q.data.profile.revision,
          confirmed: true,
          ...(action === 'verify'
            ? { method: 'AUTHORIZED_MANUAL', evidenceReference: evidence }
            : { reviewNote: note }),
        },
      });
      setAction(null);
      setEvidence('');
      setNote('');
    } catch {
      setAction(null);
    }
  }
  return (
    <QueryState
      pending={q.isPending}
      error={q.error}
      onRetry={() => void q.refetch()}
    >
      {q.data && (
        <div className="student-detail">
          <Status value={q.data.profile.verificationStatus} />
          <ProfileFacts
            profile={q.data.profile}
            email={q.data.email}
            college={q.data.college?.name}
          />
          {q.data.verificationEvidence && (
            <p>
              Restricted verification evidence reference:{' '}
              {q.data.verificationEvidence}
            </p>
          )}
          {q.data.canVerify &&
            q.data.profile.verificationStatus !== 'VERIFIED' && (
              <section className="student-card">
                <h2>Review institutional identity</h2>
                <p>
                  Roster import is not implemented. Use authorized manual
                  verification only after independently reviewing trusted
                  evidence. Do not paste documents, credentials or sensitive
                  document numbers here.
                </p>
                <Field label="Evidence reference / reason">
                  <textarea
                    aria-label="Verification evidence reference"
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    maxLength={1000}
                  />
                </Field>
                <Button
                  disabled={evidence.trim().length < 15 || command.isPending}
                  onClick={() => setAction('verify')}
                >
                  Verify identity
                </Button>
                <Field label="Rejection feedback">
                  <textarea
                    aria-label="Verification rejection feedback"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={1000}
                  />
                </Field>
                <Button
                  variant="outline"
                  disabled={note.trim().length < 15 || command.isPending}
                  onClick={() => setAction('reject-verification')}
                >
                  Reject verification
                </Button>
              </section>
            )}
          {!q.data.canVerify && (
            <p>
              Verification and correction actions require student.verify
              permission.
            </p>
          )}
          {command.error && <p role="alert">{command.error.message}</p>}
          <Confirmation
            open={!!action}
            title={
              action === 'verify'
                ? 'Confirm trusted manual verification?'
                : 'Reject institutional verification?'
            }
            description="This action is audited. Confirm you are authorized to review this college identity and have independently checked the evidence."
            busy={command.isPending}
            onClose={() => setAction(null)}
            onConfirm={() => void submit()}
          />
        </div>
      )}
    </QueryState>
  );
}
function CorrectionQueue({
  prefix,
  college,
  onSelect,
}: {
  prefix: string;
  college: string;
  onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<Correction | null>(null);
  const q = useAdministration(
    prefix +
      '/student-correction-requests?page=' +
      page +
      (college ? '&collegeId=' + college : ''),
    pageSchema(correctionSchema),
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
            empty="No correction requests"
            columns={[
              {
                key: 'changes',
                label: 'Requested corrections',
                render: (c) => (
                  <dl>
                    {Object.entries(c.requestedChanges).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                ),
              },
              {
                key: 'reason',
                label: 'Reason / feedback',
                render: (c) => (
                  <>
                    {c.reason}
                    <p>{c.reviewNote}</p>
                  </>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                render: (c) => <Status value={c.status} />,
              },
              {
                key: 'actions',
                label: 'Review',
                render: (c) => (
                  <div className="student-actions">
                    <Button
                      variant="outline"
                      onClick={() => onSelect(c.studentProfileId)}
                    >
                      View profile
                    </Button>
                    {c.status === 'PENDING' && (
                      <Button onClick={() => setSelected(c)}>
                        Review correction
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <Pagination
            page={page}
            totalPages={q.data.totalPages}
            total={q.data.total}
            onChange={setPage}
          />
        </>
      )}
      <Dialog
        open={!!selected}
        title="Review protected identity correction"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <CorrectionReview
            prefix={prefix}
            correction={selected}
            onDone={() => setSelected(null)}
          />
        )}
      </Dialog>
    </QueryState>
  );
}
function CorrectionReview({
  prefix,
  correction: c,
  onDone,
}: {
  prefix: string;
  correction: Correction;
  onDone: () => void;
}) {
  const q = useAdministration(
    prefix + '/students/' + c.studentProfileId,
    detailSchema,
  );
  const command = useCommand();
  const [note, setNote] = useState(''),
    [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const transfer =
    !!c.requestedChanges.collegeId &&
    c.requestedChanges.collegeId !== q.data?.profile.collegeId;
  return (
    <QueryState
      pending={q.isPending}
      error={q.error}
      onRetry={() => void q.refetch()}
    >
      {q.data && (
        <>
          <h3>Current identity</h3>
          <ProfileFacts
            profile={q.data.profile}
            email={q.data.email}
            college={q.data.college?.name}
          />
          <h3>Requested changes</h3>
          <dl>
            {Object.entries(c.requestedChanges).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p>Reason: {c.reason}</p>
          <p>
            Approval keeps the permanent student username and resets
            verification. Review current values carefully; the request was
            submitted at profile revision {c.profileRevision}, current revision{' '}
            {q.data.profile.revision}.
          </p>
          {transfer && prefix === '/admin' && (
            <p role="status">
              College transfers must be reviewed by the Super Admin.
            </p>
          )}
          <Field label="Shared review note">
            <textarea
              aria-label="Correction review note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
            />
          </Field>
          {q.data.canVerify && (
            <div className="student-actions">
              <Button
                disabled={
                  note.trim().length < 15 ||
                  command.isPending ||
                  (transfer && prefix === '/admin')
                }
                onClick={() => setAction('approve')}
              >
                Approve correction
              </Button>
              <Button
                variant="outline"
                disabled={note.trim().length < 15 || command.isPending}
                onClick={() => setAction('reject')}
              >
                Reject correction
              </Button>
            </div>
          )}
          {command.error && <p role="alert">{command.error.message}</p>}
          <Confirmation
            open={!!action}
            title={
              action === 'approve'
                ? 'Approve identity changes?'
                : 'Reject correction request?'
            }
            description="Your review is audited and the note is shared with the student. Approved identity changes require reverification."
            busy={command.isPending}
            onClose={() => setAction(null)}
            onConfirm={() => {
              if (action)
                void command
                  .mutateAsync({
                    path:
                      prefix +
                      '/student-correction-requests/' +
                      c.id +
                      '/' +
                      action,
                    body: {
                      expectedRevision: q.data.profile.revision,
                      reviewNote: note,
                      confirmed: true,
                    },
                  })
                  .then(onDone)
                  .catch(() => setAction(null));
            }}
          />
        </>
      )}
    </QueryState>
  );
}
