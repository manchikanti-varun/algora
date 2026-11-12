'use client';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Confirmation,
  DataTable,
  Dialog,
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
  adminSchema,
  adminDetailSchema,
  pageSchema,
  type Grant,
} from '@/features/administration/contracts';
import {
  listPath,
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import type { z } from 'zod';
function AdminEditor({
  record,
  onClose,
}: {
  record: z.infer<typeof adminDetailSchema>;
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<Grant[]>(() =>
    record.assignments
      .filter((a) => a.status === 'ACTIVE')
      .map((a) => ({ collegeId: a.collegeId, permissions: a.permissions })),
  );
  const [action, setAction] = useState<'assignments' | 'status' | null>(null);
  const command = useCommand();
  const [knownNames, setKnownNames] = useState<Record<string, string>>({});
  const names = {
    ...Object.fromEntries(
      record.assignments.map((a) => [
        a.collegeId,
        a.college?.name ?? 'Unavailable college',
      ]),
    ),
    ...knownNames,
  };
  async function save() {
    if (!action) return;
    try {
      await command.mutateAsync({
        path: '/super-admin/admins/' + record.user.id + '/' + action,
        method: 'PATCH',
        body:
          action === 'assignments'
            ? { assignments: grants, expectedRevision: record.user.revision }
            : {
                status:
                  record.user.accountStatus === 'ACTIVE'
                    ? 'SUSPENDED'
                    : 'ACTIVE',
                expectedRevision: record.user.revision,
              },
      });
      setAction(null);
      onClose();
    } catch {
      setAction(null);
    }
  }
  return (
    <>
      <div className="review-profile">
        <div>
          <strong>{record.user.displayName}</strong>
          <p>
            {record.user.email} · {record.user.username}
          </p>
        </div>
        <Status value={record.user.accountStatus} />
      </div>
      <h3>College assignments</h3>
      <p className="field-help">
        Selected colleges replace active access. Revoked history is retained.
        Inactive colleges must be removed before saving or reactivating.
      </p>
      <div className="selected-grants">
        {grants.map((g) => (
          <div key={g.collegeId}>
            <span>{names[g.collegeId] ?? 'Selected college'}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={
                'Remove assignment ' + (names[g.collegeId] ?? g.collegeId)
              }
              onClick={() =>
                setGrants(
                  grants.filter((grant) => grant.collegeId !== g.collegeId),
                )
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <CollegeSelection
        onCollegeNames={(options) =>
          setKnownNames((current) => ({
            ...current,
            ...Object.fromEntries(options.map((c) => [c.id, c.name])),
          }))
        }
        value={grants.map((g) => g.collegeId)}
        onChange={(ids) =>
          setGrants(
            ids.map(
              (id) =>
                grants.find((g) => g.collegeId === id) ?? {
                  collegeId: id,
                  permissions: ['college.view'],
                },
            ),
          )
        }
      />
      <PermissionMatrix grants={grants} onChange={setGrants} names={names} />
      <div className="dialog-actions">
        <Button
          variant="outline"
          disabled={command.isPending}
          onClick={() => setAction('status')}
        >
          {record.user.accountStatus === 'ACTIVE'
            ? 'Suspend admin'
            : 'Reactivate admin'}
        </Button>
        <Button
          disabled={command.isPending}
          onClick={() => setAction('assignments')}
        >
          Save access changes
        </Button>
      </div>
      <details className="assignment-history">
        <summary>Assignment history</summary>
        {record.assignments.length ? (
          record.assignments.map((a) => (
            <div key={a.id}>
              <strong>{a.college?.name ?? 'Historical college'}</strong>
              <Status value={a.status} />
              <p>{a.permissions.join(', ')}</p>
            </div>
          ))
        ) : (
          <p>No assignments yet.</p>
        )}
      </details>
      <Confirmation
        open={!!action}
        title={
          action === 'assignments'
            ? 'Update college access?'
            : record.user.accountStatus === 'ACTIVE'
              ? 'Suspend this administrator?'
              : 'Reactivate this administrator?'
        }
        description={
          action === 'assignments'
            ? 'Access changes are audited and existing sessions are invalidated. The administrator must sign in again.'
            : record.user.accountStatus === 'ACTIVE'
              ? 'All protected administrator operations will be blocked and existing sessions invalidated. Assignments remain available for review.'
              : 'Only currently active, valid college assignments will be usable. Revoked assignments will not be restored.'
        }
        busy={command.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => void save()}
      />
    </>
  );
}
function AdminDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdministration(
    '/super-admin/admins/' + id,
    adminDetailSchema,
  );
  return (
    <QueryState
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <AdminEditor
          key={query.data.user.id + query.data.user.revision}
          record={query.data}
          onClose={onClose}
        />
      )}
    </QueryState>
  );
}
export function AdminManagement() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const query = useAdministration(
    listPath('/super-admin/admins', { page, search, status }),
    pageSchema(adminSchema),
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
          statuses={['ACTIVE', 'SUSPENDED']}
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
                empty="No matching administrators"
                columns={[
                  {
                    key: 'name',
                    label: 'Administrator',
                    render: (a) => (
                      <div>
                        <strong>{a.displayName}</strong>
                        <small>{a.email}</small>
                      </div>
                    ),
                  },
                  {
                    key: 'username',
                    label: 'Permanent username',
                    render: (a) => <code>{a.username}</code>,
                  },
                  {
                    key: 'status',
                    label: 'Account',
                    render: (a) => <Status value={a.accountStatus} />,
                  },
                  {
                    key: 'details',
                    label: 'Access management',
                    render: (a) => (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={'Manage ' + a.displayName}
                        onClick={() => setSelected(a.id)}
                      >
                        Manage access
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
        title="Administrator access"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <AdminDetails id={selected} onClose={() => setSelected(null)} />
        )}
      </Dialog>
    </>
  );
}
