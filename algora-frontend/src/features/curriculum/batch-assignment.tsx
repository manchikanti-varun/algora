'use client';
import { useState } from 'react';
import { z } from 'zod';
import { apiGet } from '@/lib/api/client';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import {
  Field,
  Confirmation,
  QueryState,
  Pagination,
  Status,
  DataTable,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import {
  batchAssignmentSchema,
  impactSchema,
  pageSchema,
  type Day,
  dayLabel,
} from './contracts';
const history = z.object({
  id: z.string(),
  previousRevisionId: z.string().nullable(),
  newRevisionId: z.string(),
  reason: z.string(),
  activeMemberships: z.number(),
  createdAt: z.string(),
});
export function BatchCurriculum({ batchId }: { batchId: string }) {
  const [page, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1),
    [choice, setChoice] = useState(''),
    [reason, setReason] = useState(''),
    [impact, setImpact] = useState<z.infer<typeof impactSchema> | null>(null),
    [error, setError] = useState('');
  const q = useAdministration(
      '/batches/' + batchId + '/curriculum?page=' + page,
      batchAssignmentSchema,
    ),
    events = useAdministration(
      '/batches/' + batchId + '/curriculum/history?page=' + historyPage,
      pageSchema(history),
    ),
    command = useCommand();
  async function review() {
    setError('');
    try {
      setImpact(
        await apiGet(
          '/batches/' +
            batchId +
            '/curriculum/assignment-preview?revisionId=' +
            choice,
          impactSchema,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review unavailable');
    }
  }
  const closed =
    q.data && ['COMPLETED', 'ARCHIVED'].includes(q.data.batch.status);
  return (
    <>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <section className="student-card">
            <h2>Batch curriculum</h2>
            <Status value={q.data.batch.status} />
            <p>
              {q.data.assignedRevision
                ? 'Pinned to published revision ' +
                  q.data.assignedRevision.revisionNumber
                : 'Curriculum not assigned. No revision was fabricated for an existing Batch.'}
            </p>
            {closed ? (
              <p>
                Completed and archived Batch curriculum references are
                immutable. Assignment history remains available below.
              </p>
            ) : (
              <>
                <Field label="Published curriculum revision">
                  <select
                    aria-label="Published curriculum revision"
                    value={choice}
                    onChange={(e) => {
                      setChoice(e.target.value);
                      setImpact(null);
                    }}
                  >
                    <option value="">
                      Choose a published revision of this Course
                    </option>
                    {q.data.options.items.map((r) => (
                      <option key={r.id} value={r.id}>
                        Revision {r.revisionNumber} · {r.dayCount} days
                      </option>
                    ))}
                  </select>
                </Field>
                <Pagination
                  page={page}
                  total={q.data.options.total}
                  totalPages={q.data.options.totalPages}
                  onChange={(v) => {
                    setPage(v);
                    setChoice('');
                    setImpact(null);
                  }}
                />
                <Field label="Assignment review reason">
                  <textarea
                    aria-label="Assignment review reason"
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setImpact(null);
                    }}
                    maxLength={1000}
                  />
                </Field>
                <Button
                  disabled={
                    !choice || reason.trim().length < 15 || command.isPending
                  }
                  onClick={() => void review()}
                >
                  Review curriculum assignment
                </Button>
                <p>
                  Active Batch upgrades affect every current member. Review the
                  new immutable revision and confirm the impact. This is never
                  an automatic move to the newest curriculum.
                </p>
              </>
            )}
            {q.data.assignedRevision && !closed && (
              <ReleaseControls
                batchId={batchId}
                courseId={q.data.assignedRevision.courseId}
                revisionId={q.data.assignedRevision.id}
                controls={q.data.releases}
              />
            )}
          </section>
        )}
      </QueryState>
      {error && <p role="alert">{error}</p>}
      {command.error && <p role="alert">{command.error.message}</p>}
      <section className="student-card">
        <h2>Curriculum assignment history</h2>
        <QueryState
          pending={events.isPending}
          error={events.error}
          onRetry={() => void events.refetch()}
        >
          {events.data && (
            <>
              <DataTable
                items={events.data.items}
                empty="No curriculum assignments yet"
                columns={[
                  {
                    key: 'change',
                    label: 'Assignment',
                    render: (e) => (
                      <>
                        {e.previousRevisionId
                          ? 'Reviewed replacement'
                          : 'First assignment'}
                        <p>
                          {e.activeMemberships} reserved memberships in the
                          reviewed impact
                        </p>
                      </>
                    ),
                  },
                  {
                    key: 'reason',
                    label: 'Review reason',
                    render: (e) => e.reason,
                  },
                  {
                    key: 'time',
                    label: 'Time',
                    render: (e) => new Date(e.createdAt).toLocaleString(),
                  },
                ]}
              />
              <Pagination
                page={historyPage}
                total={events.data.total}
                totalPages={events.data.totalPages}
                onChange={setHistoryPage}
              />
            </>
          )}
        </QueryState>
      </section>
      <Confirmation
        open={!!impact}
        title={
          impact?.batchStatus === 'ACTIVE'
            ? 'Confirm active Batch curriculum upgrade?'
            : 'Assign this published curriculum?'
        }
        description={
          impact
            ? 'This revision contains ' +
              impact.newDayCount +
              ' days and affects ' +
              impact.activeMemberships +
              ' currently reserved memberships (including pending memberships). The previous assignment is retained in history. Server authority and the reviewed impact are checked again.'
            : ''
        }
        busy={command.isPending}
        onClose={() => setImpact(null)}
        onConfirm={() => {
          if (impact)
            void command
              .mutateAsync({
                path: '/batches/' + batchId + '/curriculum/assign',
                body: {
                  curriculumRevisionId: impact.newRevisionId,
                  expectedBatchRevision: impact.batchRevision,
                  expectedPreviousRevisionId: impact.previousRevisionId,
                  impactFingerprint: impact.impactFingerprint,
                  reason,
                  confirmed: true,
                },
              })
              .then(() => {
                setImpact(null);
                setChoice('');
                setReason('');
              })
              .catch(() => setImpact(null));
        }}
      />
    </>
  );
}
function ReleaseControls({
  batchId,
  courseId,
  revisionId,
  controls,
}: {
  batchId: string;
  courseId: string;
  revisionId: string;
  controls: { dayId: string; restricted: boolean; revision: number }[];
}) {
  const [page, setPage] = useState(1),
    [action, setAction] = useState<Day | null>(null),
    [reason, setReason] = useState(''),
    [review, setReview] = useState(false);
  const q = useAdministration(
    '/batches/' + batchId + '/curriculum/days?page=' + page,
    pageSchema(
      z.object({
        id: z.string(),
        dayNumber: z.number(),
        title: z.string(),
        publicationStatus: z.string(),
      }),
    ),
  );
  const command = useCommand();
  void courseId;
  void revisionId;
  return (
    <section className="curriculum-section">
      <h3>Release restrictions</h3>
      <p>
        Withdraw or restore future Student access without changing immutable
        content. Restoration respects the original publication status and
        schedule.
      </p>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data?.items.map((day) => {
          const control = controls.find((c) => c.dayId === day.id);
          return (
            <div className="curriculum-release-row" key={day.id}>
              <span>
                {dayLabel(day.dayNumber)} · {day.title} ·{' '}
                {control?.restricted ? 'restricted' : 'original release rules'}
              </span>
              <Button
                variant="outline"
                onClick={() => {
                  setAction(day as Day);
                  setReview(false);
                  setReason('');
                }}
              >
                {control?.restricted
                  ? 'Restore original release'
                  : 'Restrict Student access'}
              </Button>
            </div>
          );
        })}
        {q.data && (
          <Pagination
            page={page}
            total={q.data.total}
            totalPages={q.data.totalPages}
            onChange={setPage}
          />
        )}
      </QueryState>
      {action && (
        <Field label="Release change reason">
          <textarea
            aria-label="Release change reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
          />
        </Field>
      )}
      {action && (
        <Button
          disabled={reason.trim().length < 15}
          onClick={() => setReview(true)}
        >
          Review release change
        </Button>
      )}
      <Confirmation
        open={!!action && review}
        title="Confirm audited release change?"
        description="This overlay affects only this Batch and assigned revision. It cannot unlock a draft day, bypass a schedule or reveal a hidden editorial."
        busy={command.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (action) {
            const control = controls.find((c) => c.dayId === action.id);
            void command
              .mutateAsync({
                path:
                  '/batches/' +
                  batchId +
                  '/curriculum/days/' +
                  action.id +
                  '/release',
                body: {
                  restricted: !control?.restricted,
                  expectedRevision: control?.revision ?? 0,
                  reason,
                  confirmed: true,
                },
              })
              .then(() => setAction(null))
              .catch(() => setAction(null));
          }
        }}
      />
    </section>
  );
}
