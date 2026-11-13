'use client';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { apiGet } from '@/lib/api/client';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import {
  QueryState,
  Pagination,
  Status,
  Confirmation,
  Dialog,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import {
  revisionSchema,
  revisionDetail,
  pageSchema,
  studentDaySchema,
  type Revision,
  type Day,
  dayLabel,
} from './contracts';
import { DayEditor } from './day-editor';
import { DayContent } from './render';
export function CurriculumBuilder({
  courseId,
  superAdmin = false,
}: {
  courseId: string;
  superAdmin?: boolean;
}) {
  const prefix = superAdmin ? '/super-admin' : '/admin',
    base = '/courses/' + courseId + '/curriculum';
  const [page, setPage] = useState(1),
    [dayPage, setDayPage] = useState(1),
    [selected, setSelected] = useState(''),
    [edit, setEdit] = useState<Day | null | undefined>(),
    [action, setAction] = useState<{
      kind: 'publish' | 'clone';
      revision: Revision;
    } | null>(null),
    [remove, setRemove] = useState<Day | null>(null),
    [preview, setPreview] = useState<string | null>(null),
    [busyOrder, setBusyOrder] = useState(false),
    [error, setError] = useState('');
  const list = useAdministration(
    base + '?page=' + page,
    pageSchema(revisionSchema),
  );
  const detail = useAdministration(
    base + '/revisions/' + selected + '?page=' + dayPage,
    revisionDetail,
    !!selected,
  );
  const command = useCommand();
  async function create(sourceRevisionId: string | null = null) {
    setError('');
    try {
      const data = await command.mutateAsync({
        path: base + '/drafts',
        body: { sourceRevisionId },
      });
      setSelected(revisionSchema.parse(data).id);
      setDayPage(1);
      setEdit(undefined);
    } catch {}
  }
  async function move(day: Day, delta: number) {
    if (!detail.data) return;
    setBusyOrder(true);
    setError('');
    try {
      const all: Day[] = [];
      let cursor = 1,
        totalPages = 1;
      do {
        const response = await apiGet(
          base + '/revisions/' + selected + '?pageSize=50&page=' + cursor,
          revisionDetail,
        );
        all.push(...response.days.items);
        totalPages = response.days.totalPages;
        cursor++;
      } while (cursor <= totalPages);
      const index = all.findIndex((d) => d.id === day.id),
        target = index + delta;
      if (index < 0 || target < 0 || target >= all.length) return;
      const ids = all.map((d) => d.id);
      [ids[index], ids[target]] = [ids[target]!, ids[index]!];
      await command.mutateAsync({
        path: base + '/revisions/' + selected + '/days/reorder',
        body: { dayIds: ids, expectedRevision: detail.data.revision.revision },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reorder failed');
    } finally {
      setBusyOrder(false);
    }
  }
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={prefix + '/courses'}>Courses</Link> / Curriculum builder
      </nav>
      <div className="curriculum-workspace">
        <aside className="curriculum-sidebar">
          <span className="eyebrow">AUTHORING WORKSPACE</span>
          <h2>Curriculum revisions</h2>
          <Button onClick={() => void create()} disabled={command.isPending}>
            Create empty draft
          </Button>
          <QueryState
            pending={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
          >
            {list.data?.items.length === 0 && (
              <p>No curriculum revisions yet. Create a draft to begin.</p>
            )}
            <div className="revision-list">
              {list.data?.items.map((r) => (
                <button
                  className={selected === r.id ? 'selected' : ''}
                  key={r.id}
                  onClick={() => {
                    setSelected(r.id);
                    setDayPage(1);
                    setEdit(undefined);
                  }}
                >
                  <strong>Revision {r.revisionNumber}</strong>
                  <Status value={r.status} />
                  {r.publishedAt && (
                    <span>{new Date(r.publishedAt).toLocaleDateString()}</span>
                  )}
                </button>
              ))}
            </div>
            {list.data && (
              <Pagination
                page={page}
                total={list.data.total}
                totalPages={list.data.totalPages}
                onChange={setPage}
              />
            )}
          </QueryState>
          <Link href={prefix + '/problems'}>
            Problem catalog & editorials ↗
          </Link>
          <p>
            No production content is prepopulated. Learning Days may use any
            valid positive number; numbering is not limited to a fixed bootcamp
            length.
          </p>
        </aside>
        <section className="curriculum-main">
          {!selected ? (
            <section className="student-card">
              <h2>Build a deliberate learning path</h2>
              <p>
                Select a revision or create a new draft. Organize topics,
                trusted resources, coding problems and explanatory editorials
                one day at a time.
              </p>
            </section>
          ) : (
            <QueryState
              pending={detail.isPending}
              error={detail.error}
              onRetry={() => void detail.refetch()}
            >
              {detail.data && (
                <>
                  <header className="curriculum-revision-header">
                    <div>
                      <Status value={detail.data.revision.status} />
                      <h2>Revision {detail.data.revision.revisionNumber}</h2>
                      <p>
                        {detail.data.days.total} Learning Days · authoring
                        revision {detail.data.revision.revision}
                      </p>
                    </div>
                    <div className="student-actions">
                      {detail.data.revision.status === 'DRAFT' ? (
                        <>
                          <Button onClick={() => setEdit(null)}>
                            Add Learning Day
                          </Button>
                          <Button
                            variant="outline"
                            disabled={!detail.data.days.total}
                            onClick={() =>
                              setAction({
                                kind: 'publish',
                                revision: detail.data.revision,
                              })
                            }
                          >
                            Review & publish
                          </Button>
                        </>
                      ) : (
                        <Button
                          onClick={() =>
                            setAction({
                              kind: 'clone',
                              revision: detail.data.revision,
                            })
                          }
                        >
                          Clone to a new draft
                        </Button>
                      )}
                    </div>
                  </header>
                  {detail.data.revision.status !== 'DRAFT' && (
                    <div className="student-notice">
                      Immutable published snapshot. Make changes by cloning into
                      a new draft. Batch assignments remain pinned until a
                      separate reviewed assignment.
                    </div>
                  )}
                  <div className="curriculum-day-list">
                    {detail.data.days.items.map((d, i) => (
                      <article className="student-card" key={d.id}>
                        <div>
                          <span className="eyebrow">
                            {dayLabel(d.dayNumber)}
                          </span>
                          <Status value={d.publicationStatus} />
                          <h3>{d.title}</h3>
                          <p>
                            {d.topics.length} topics · {d.resources.length}{' '}
                            resources · {d.problemAssignments.length} problem
                            assignments
                          </p>
                          {d.publishAt && (
                            <p>
                              Scheduled:{' '}
                              {new Date(d.publishAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <div className="student-actions">
                          <Button
                            variant="outline"
                            onClick={() => setPreview(d.id)}
                          >
                            Instructor preview
                          </Button>
                          {detail.data!.revision.status === 'DRAFT' && (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => setEdit(d)}
                              >
                                Edit day
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={
                                  busyOrder || (dayPage === 1 && i === 0)
                                }
                                onClick={() => void move(d, -1)}
                              >
                                Move day up
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={
                                  busyOrder ||
                                  (dayPage === detail.data!.days.totalPages &&
                                    i === detail.data!.days.items.length - 1)
                                }
                                onClick={() => void move(d, 1)}
                              >
                                Move day down
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => setRemove(d)}
                              >
                                Remove day
                              </Button>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  {!detail.data.days.items.length && (
                    <section className="student-card">
                      <h3>Your first Learning Day starts here.</h3>
                      <p>
                        Add properties first, then work through topics,
                        resources and problem assignments in separate panels.
                      </p>
                    </section>
                  )}
                  <Pagination
                    page={dayPage}
                    total={detail.data.days.total}
                    totalPages={detail.data.days.totalPages}
                    onChange={(v) => {
                      setDayPage(v);
                      setEdit(undefined);
                    }}
                  />
                </>
              )}
            </QueryState>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      </div>
      <Dialog
        open={edit !== undefined && !!detail.data}
        title={edit ? 'Edit Learning Day' : 'Add Learning Day'}
        onClose={() => setEdit(undefined)}
      >
        {edit !== undefined && detail.data && (
          <DayEditor
            key={(edit?.id ?? 'new') + ':' + detail.data.revision.revision}
            courseId={courseId}
            revisionId={selected}
            expectedRevision={detail.data.revision.revision}
            item={edit}
            onDone={() => setEdit(undefined)}
          />
        )}
      </Dialog>
      <Confirmation
        open={!!action}
        title={
          action?.kind === 'publish'
            ? 'Publish an immutable curriculum snapshot?'
            : 'Clone this published revision?'
        }
        description={
          action?.kind === 'publish'
            ? 'Review all days and exact editorial choices. Draft/unpublished days remain private, schedules use server time, hidden editorials are removed from Student responses. Publishing does not automatically change any Batch assignment.'
            : 'Create an independently editable draft. Existing published content and Batch history stay pinned to their current version.'
        }
        busy={command.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (!action) return;
          if (action.kind === 'clone') {
            void create(action.revision.id).then(() => setAction(null));
          } else
            void command
              .mutateAsync({
                path: base + '/revisions/' + action.revision.id + '/publish',
                body: {
                  expectedRevision: action.revision.revision,
                  confirmed: true,
                },
              })
              .then(() => setAction(null))
              .catch(() => setAction(null));
        }}
      />
      <Confirmation
        open={!!remove}
        title="Remove this draft Learning Day?"
        description="Only draft content may be removed. Published snapshots remain immutable."
        busy={command.isPending}
        onClose={() => setRemove(null)}
        onConfirm={() => {
          if (remove && detail.data)
            void command
              .mutateAsync({
                path: base + '/revisions/' + selected + '/days/' + remove.id,
                method: 'DELETE',
                body: {
                  expectedRevision: detail.data.revision.revision,
                  confirmed: true,
                },
              })
              .then(() => setRemove(null))
              .catch(() => setRemove(null));
        }}
      />
      <Dialog
        open={!!preview}
        title="Instructor preview · Student-safe projection"
        onClose={() => setPreview(null)}
      >
        {preview && (
          <InstructorPreview
            base={
              base + '/revisions/' + selected + '/days/' + preview + '/preview'
            }
          />
        )}
      </Dialog>
    </>
  );
}
function InstructorPreview({ base }: { base: string }) {
  const q = useAdministration(
    base,
    z.object({
      preview: studentDaySchema,
      currentlyReleasedBySchedule: z.boolean(),
      serverTime: z.string(),
    }),
  );
  return (
    <QueryState
      pending={q.isPending}
      error={q.error}
      onRetry={() => void q.refetch()}
    >
      {q.data && (
        <>
          <div className="student-notice">
            Instructor-only preview.{' '}
            {q.data.currentlyReleasedBySchedule
              ? 'The snapshot’s original schedule permits release.'
              : 'The snapshot is not currently released by its original schedule.'}{' '}
            Batch release restrictions and effective enrollment are still
            checked for real Students. Hidden editorials and instructor-only
            resources are omitted here.
          </div>
          <DayContent day={q.data.preview} />
        </>
      )}
    </QueryState>
  );
}
