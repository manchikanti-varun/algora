'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Confirmation,
  DataTable,
  Dialog,
  Field,
  Pagination,
  QueryState,
  SearchFilter,
  Status,
} from '@/components/shared/admin-ui';
import {
  CollegeSelection,
  PermissionMatrix,
} from '@/features/colleges/selection';
import {
  pageSchema,
  requestSchema,
  requestDetailSchema,
  type Grant,
} from '@/features/administration/contracts';
import {
  listPath,
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
const reviewForm = z.object({
  reviewNote: z.string().trim().max(1000),
  internalNote: z.string().trim().max(1000),
});
function ReviewEditor({
  record,
  onClose,
}: {
  record: z.infer<typeof requestDetailSchema>;
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<Grant[]>(() =>
    record.colleges
      .filter((c) => c.status === 'ACTIVE')
      .map((c) => ({ collegeId: c.id, permissions: ['college.view'] })),
  );
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const command = useCommand();
  const form = useForm({
    resolver: zodResolver(reviewForm),
    defaultValues: {
      reviewNote: record.reviewNote,
      internalNote: record.internalNote ?? '',
    },
  });
  const names = Object.fromEntries(record.colleges.map((c) => [c.id, c.name]));
  async function prepare(action: 'approve' | 'reject') {
    if (!(await form.trigger())) return;
    if (action === 'reject' && form.getValues('reviewNote').length < 10) {
      form.setError('reviewNote', {
        message: 'Provide at least 10 characters explaining the rejection',
      });
      return;
    }
    if (action === 'approve' && !grants.length) {
      setSelectionError('Select at least one active requested college');
      return;
    }
    setDecision(action);
  }
  async function decide() {
    if (!decision) return;
    try {
      await command.mutateAsync({
        path: '/super-admin/admin-requests/' + record.id + '/' + decision,
        body: {
          ...form.getValues(),
          ...(decision === 'approve' ? { assignments: grants } : {}),
        },
      });
      setDecision(null);
      onClose();
    } catch {
      setDecision(null);
    }
  }
  return (
    <>
      <div className="review-profile">
        <div>
          <strong>{record.fullName}</strong>
          <p>{record.email}</p>
        </div>
        <Status value={record.status} />
      </div>
      <section className="reason-box">
        <span className="eyebrow">REQUESTER’S REASON</span>
        <p>{record.reason}</p>
      </section>
      {record.status === 'PENDING' ? (
        <>
          <h3>Approve college access</h3>
          <p className="field-help">
            Select a subset of the requested active colleges. Student
            registration is not required.
          </p>
          <CollegeSelection
            options={record.colleges.filter((c) => c.status === 'ACTIVE')}
            value={grants.map((g) => g.collegeId)}
            onChange={(ids) => {
              setGrants(
                ids.map(
                  (id) =>
                    grants.find((g) => g.collegeId === id) ?? {
                      collegeId: id,
                      permissions: ['college.view'],
                    },
                ),
              );
              setSelectionError('');
            }}
          />
          {selectionError && (
            <p role="alert" className="field-error">
              {selectionError}
            </p>
          )}
          <PermissionMatrix
            grants={grants}
            onChange={setGrants}
            names={names}
          />
          <form className="admin-form" onSubmit={(e) => e.preventDefault()}>
            <Field
              label="Message shared with requester"
              error={form.formState.errors.reviewNote?.message}
            >
              <textarea
                aria-label="Message shared with requester"
                {...form.register('reviewNote')}
                rows={3}
              />
            </Field>
            <Field
              label="Private administrative note"
              error={form.formState.errors.internalNote?.message}
            >
              <textarea
                aria-label="Private administrative note"
                {...form.register('internalNote')}
                rows={2}
              />
              <small>Never included in the requester’s status response.</small>
            </Field>
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={command.isPending}
                onClick={() => void prepare('reject')}
              >
                Reject request
              </Button>
              <Button
                disabled={command.isPending}
                onClick={() => void prepare('approve')}
              >
                Approve admin access
              </Button>
            </div>
          </form>
          <Confirmation
            open={!!decision}
            title={
              decision === 'approve'
                ? 'Approve this administrator?'
                : 'Reject this request?'
            }
            description={
              decision === 'approve'
                ? 'The existing Google account will become an active Admin for the selected colleges. A permanent name-based username will be allocated and existing sessions invalidated.'
                : 'The requester will see your shared review message. Their student account will remain available and they may submit a new request.'
            }
            busy={command.isPending}
            onClose={() => setDecision(null)}
            onConfirm={() => void decide()}
          />
        </>
      ) : (
        <div className="notice">
          <strong>This request has been {record.status.toLowerCase()}.</strong>
          <p>{record.reviewNote || 'No shared note was added.'}</p>
          {record.internalNote && <p>Private note: {record.internalNote}</p>}
        </div>
      )}
    </>
  );
}
function ReviewDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdministration(
    '/super-admin/admin-requests/' + id,
    requestDetailSchema,
  );
  return (
    <QueryState
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <ReviewEditor
          key={query.data.id + query.data.status}
          record={query.data}
          onClose={onClose}
        />
      )}
    </QueryState>
  );
}
export function AdminApprovals() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [selected, setSelected] = useState<string | null>(null);
  const query = useAdministration(
    listPath('/super-admin/admin-requests', { page, search, status }),
    pageSchema(requestSchema),
  );
  return (
    <>
      <Card className="table-card">
        <SearchFilter
          search={search}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          status={status}
          onStatus={(v) => {
            setStatus(v);
            setPage(1);
          }}
          statuses={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']}
        />
        <QueryState
          pending={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        >
          {query.data && (
            <>
              <DataTable
                items={query.data.items}
                empty="No matching access requests"
                columns={[
                  {
                    key: 'person',
                    label: 'Requester',
                    render: (r) => (
                      <div>
                        <strong>{r.fullName}</strong>
                        <small>{r.email}</small>
                      </div>
                    ),
                  },
                  {
                    key: 'scope',
                    label: 'Requested scope',
                    render: (r) => r.requestedCollegeIds.length + ' colleges',
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (r) => <Status value={r.status} />,
                  },
                  {
                    key: 'created',
                    label: 'Submitted',
                    render: (r) => new Date(r.createdAt).toLocaleDateString(),
                  },
                  {
                    key: 'review',
                    label: 'Review',
                    render: (r) => (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={'Review ' + r.fullName}
                        onClick={() => setSelected(r.id)}
                      >
                        Review details
                      </Button>
                    ),
                  },
                ]}
              />
              <Pagination {...query.data} onChange={setPage} />
            </>
          )}
        </QueryState>
      </Card>
      <Dialog
        open={!!selected}
        title="Admin access review"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <ReviewDetails id={selected} onClose={() => setSelected(null)} />
        )}
      </Dialog>
    </>
  );
}
