'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DataTable,
  Pagination,
  QueryState,
} from '@/components/shared/admin-ui';
import { auditSchema, pageSchema } from '@/features/administration/contracts';
import { listPath, useAdministration } from '@/features/administration/queries';
const actions = [
  'COURSE_CREATED',
  'COURSE_UPDATED',
  'COURSE_PUBLISHED',
  'COURSE_ARCHIVED',
  'BATCH_CREATED',
  'BATCH_UPDATED',
  'BATCH_ACTIVATED',
  'BATCH_COMPLETED',
  'BATCH_ARCHIVED',
  'ENROLLMENT_CREATED',
  'PENDING_ENROLLMENT_CREATED',
  'ENROLLMENT_ACTIVATED',
  'ENROLLMENT_WITHDRAWN',
  'ENROLLMENT_TRANSFERRED',
  'BULK_IMPORT_COMPLETED',
  'IMPORT_CONFLICTS',
  'ENROLLMENT_RECONCILED',
  'ENROLLMENT_RECONCILIATION_RETRIED',
  'STUDENT_REGISTERED',
  'STUDENT_PROFILE_UPDATED',
  'STUDENT_VERIFIED',
  'STUDENT_VERIFICATION_REJECTED',
  'STUDENT_QR_ISSUED',
  'STUDENT_QR_ROTATED',
  'STUDENT_CORRECTION_REQUESTED',
  'STUDENT_CORRECTION_CANCELLED',
  'STUDENT_CORRECTION_APPROVED',
  'STUDENT_CORRECTION_REJECTED',
  'STUDENT_IDENTITY_CORRECTED',
  'SUPER_ADMIN_PROVISIONED',
  'COLLEGE_CREATED',
  'COLLEGE_UPDATED',
  'COLLEGE_STATUS_CHANGED',
  'ADMIN_REQUEST_SUBMITTED',
  'ADMIN_REQUEST_CANCELLED',
  'ADMIN_REQUEST_APPROVED',
  'ADMIN_REQUEST_REJECTED',
  'ADMIN_ROLE_GRANTED',
  'ADMIN_SUSPENDED',
  'ADMIN_REACTIVATED',
  'COLLEGE_ASSIGNED',
  'COLLEGE_ACCESS_REVOKED',
  'ADMIN_PERMISSIONS_UPDATED',
];
export function AuditView() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dates, setDates] = useState({ from: '', to: '' });
  const query = useAdministration(
    listPath('/super-admin/audit-logs', { page, action, search, ...dates }),
    pageSchema(auditSchema),
  );
  return (
    <Card className="table-card">
      <div className="table-controls audit-controls">
        <input
          aria-label="Search audit records"
          placeholder="Search actor or action…"
          value={search}
          maxLength={100}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Filter audit action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a.toLowerCase().replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <label>
          From (UTC)
          <input
            aria-label="Audit start date"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To (UTC)
          <input
            aria-label="Audit end date"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button
          variant="outline"
          onClick={() => {
            if (from && to && from > to) {
              toast.error('The end date must follow the start date');
              return;
            }
            setDates({
              from: from ? new Date(from + 'T00:00:00.000Z').toISOString() : '',
              to: to ? new Date(to + 'T23:59:59.999Z').toISOString() : '',
            });
            setPage(1);
          }}
        >
          Apply dates
        </Button>
      </div>
      <p className="field-help">
        Append-only administrative history. Timestamps are displayed in your
        browser’s local timezone.
      </p>
      <QueryState
        pending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data && (
          <>
            <DataTable
              items={query.data.items}
              empty="No audit records match these filters"
              columns={[
                {
                  key: 'actor',
                  label: 'Actor',
                  render: (a) => (
                    <div>
                      <strong>{a.actorName}</strong>
                      <small>{a.actorUserId}</small>
                    </div>
                  ),
                },
                {
                  key: 'action',
                  label: 'Action',
                  render: (a) => a.action.toLowerCase().replaceAll('_', ' '),
                },
                {
                  key: 'target',
                  label: 'Target',
                  render: (a) => (
                    <div>
                      <span>{a.targetType.toLowerCase()}</span>
                      <small>
                        <code>{a.targetId}</code>
                      </small>
                    </div>
                  ),
                },
                {
                  key: 'summary',
                  label: 'Change summary',
                  render: (a) =>
                    a.metadata.before || a.metadata.after
                      ? [a.metadata.before, a.metadata.after]
                          .filter(Boolean)
                          .join(' → ')
                      : a.metadata.permissions
                        ? a.metadata.permissions.join(', ')
                        : a.metadata.count !== undefined
                          ? `${a.metadata.count} items`
                          : 'Recorded',
                },
                {
                  key: 'time',
                  label: 'Timestamp',
                  render: (a) => new Date(a.createdAt).toLocaleString(),
                },
              ]}
            />
            <Pagination {...query.data} onChange={setPage} />
          </>
        )}
      </QueryState>
    </Card>
  );
}
