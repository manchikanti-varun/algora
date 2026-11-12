'use client';
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
  courseSchema,
  courseFormSchema,
  pageSchema,
  type Course,
  type CourseForm,
} from './contracts';
import { CollegePicker, useCollegeOptions } from './options';
export function CourseCatalog({
  superAdmin = false,
}: {
  superAdmin?: boolean;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [difficulty, setDifficulty] = useState(''),
    [scope, setScope] = useState(''),
    [edit, setEdit] = useState<Course | null | undefined>(undefined),
    [detail, setDetail] = useState<Course | null>(null),
    [action, setAction] = useState<{
      course: Course;
      action: 'publish' | 'archive';
    } | null>(null);
  const command = useCommand(),
    options = useCollegeOptions(superAdmin, 'course.manage');
  const p = new URLSearchParams({ page: String(page), search });
  if (status) p.set('status', status);
  if (difficulty) p.set('difficulty', difficulty);
  if (scope) p.set('scope', scope);
  const q = useAdministration('/courses?' + p, pageSchema(courseSchema));
  return (
    <>
      <div className="learning-toolbar">
        <Field label="Search courses">
          <input
            aria-label="Search courses"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        {[
          ['Status', status, setStatus, ['DRAFT', 'PUBLISHED', 'ARCHIVED']],
          [
            'Difficulty',
            difficulty,
            setDifficulty,
            ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'],
          ],
          ['Scope', scope, setScope, ['PLATFORM', 'COLLEGE']],
        ].map(([label, value, set, values]) => (
          <Field key={String(label)} label={String(label)}>
            <select
              aria-label={'Course ' + label}
              value={String(value)}
              onChange={(e) => {
                (set as (v: string) => void)(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All {String(label).toLowerCase()} values</option>
              {(values as string[]).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        ))}
        {(superAdmin || options.items.length > 0) && (
          <Button onClick={() => setEdit(null)}>Create course</Button>
        )}
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
              empty="No courses in your authorized catalog"
              columns={[
                {
                  key: 'title',
                  label: 'Course',
                  render: (c) => (
                    <>
                      <strong>{c.title}</strong>
                      <p>
                        {c.code} · {c.difficulty.toLowerCase()}
                      </p>
                    </>
                  ),
                },
                {
                  key: 'scope',
                  label: 'Ownership',
                  render: (c) => (
                    <>
                      {c.scope === 'PLATFORM'
                        ? 'Platform curriculum'
                        : 'College-owned curriculum'}
                      {c.sharedCollegeIds.length > 0 && (
                        <p>Explicitly shared</p>
                      )}
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
                  label: 'Actions',
                  render: (c) => (
                    <div className="student-actions">
                      <Button variant="outline" onClick={() => setDetail(c)}>
                        Details
                      </Button>
                      {c.canManage && c.status !== 'ARCHIVED' && (
                        <>
                          <Button variant="outline" onClick={() => setEdit(c)}>
                            Edit
                          </Button>
                          {c.status === 'DRAFT' && (
                            <Button
                              onClick={() =>
                                setAction({ course: c, action: 'publish' })
                              }
                            >
                              Publish
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            onClick={() =>
                              setAction({ course: c, action: 'archive' })
                            }
                          >
                            Archive
                          </Button>
                        </>
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
        title={edit ? 'Edit course' : 'Create course draft'}
        onClose={() => setEdit(undefined)}
      >
        {edit !== undefined && (
          <CourseEditor
            key={edit?.id ?? 'new'}
            superAdmin={superAdmin}
            course={edit}
            onDone={() => setEdit(undefined)}
          />
        )}
      </Dialog>
      <Dialog
        open={!!detail}
        title="Course details"
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="student-card">
            <h2>{detail.title}</h2>
            <Status value={detail.status} />
            <p className="learning-prose">{detail.description}</p>
            <dl className="student-grid">
              <div>
                <dt>Scope</dt>
                <dd>{detail.scope}</dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd>{detail.revision}</dd>
              </div>
              <div>
                <dt>Estimated study days</dt>
                <dd>{detail.estimatedDurationDays ?? 'Not set'}</dd>
              </div>
              <div>
                <dt>Tags</dt>
                <dd>{detail.tags.join(', ') || 'None'}</dd>
              </div>
            </dl>
            <p>Learning-day content is not available in this phase.</p>
          </div>
        )}
      </Dialog>
      <Confirmation
        open={!!action}
        title={
          action?.action === 'publish'
            ? 'Publish this course?'
            : 'Archive this course?'
        }
        description="This action is audited. Existing batch snapshots remain preserved; archived courses cannot grant current learning access."
        busy={command.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (action)
            void command
              .mutateAsync({
                path: '/courses/' + action.course.id + '/' + action.action,
                body: {
                  expectedRevision: action.course.revision,
                  confirmed: true,
                },
              })
              .then(() => setAction(null))
              .catch(() => setAction(null));
        }}
      />
    </>
  );
}
function CourseEditor({
  superAdmin,
  course,
  onDone,
}: {
  superAdmin: boolean;
  course: Course | null;
  onDone: () => void;
}) {
  const command = useCommand(),
    f = useForm<CourseForm>({
      resolver: zodResolver(courseFormSchema),
      defaultValues: course ?? {
        title: '',
        code: '',
        slug: '',
        description: '',
        shortDescription: '',
        difficulty: 'BEGINNER',
        estimatedDurationDays: null,
        tags: [],
        scope: superAdmin ? 'PLATFORM' : 'COLLEGE',
        ownerCollegeId: null,
        sharedCollegeIds: [],
      },
    });
  const scope = useWatch({ control: f.control, name: 'scope' }),
    owner = useWatch({ control: f.control, name: 'ownerCollegeId' }),
    shared = useWatch({ control: f.control, name: 'sharedCollegeIds' });
  const [shareChoice, setShareChoice] = useState('');
  return (
    <form
      className="student-card"
      onSubmit={f.handleSubmit(async (body) => {
        try {
          await command.mutateAsync({
            path: course ? '/courses/' + course.id : '/courses',
            method: course ? 'PATCH' : 'POST',
            body: {
              ...body,
              ...(course ? { expectedRevision: course.revision } : {}),
            },
          });
          onDone();
        } catch {}
      })}
    >
      <div className="student-grid">
        {(['title', 'code', 'slug', 'shortDescription'] as const).map((key) => (
          <Field
            key={key}
            label={
              {
                title: 'Course title',
                code: 'Course code',
                slug: 'URL slug',
                shortDescription: 'Short description',
              }[key]
            }
            error={f.formState.errors[key]?.message}
          >
            <input
              aria-label={
                {
                  title: 'Course title',
                  code: 'Course code',
                  slug: 'URL slug',
                  shortDescription: 'Short description',
                }[key]
              }
              {...f.register(key)}
            />
          </Field>
        ))}
        <Field label="Difficulty">
          <select aria-label="Difficulty" {...f.register('difficulty')}>
            {['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Estimated duration in days">
          <input
            aria-label="Estimated duration in days"
            type="number"
            min={1}
            max={1000}
            {...f.register('estimatedDurationDays', {
              setValueAs: (v) =>
                v === '' || v === null || v === undefined ? null : Number(v),
            })}
          />
        </Field>
        <Field label="Ownership scope">
          <select
            aria-label="Ownership scope"
            disabled={!superAdmin || !!course}
            {...f.register('scope')}
            onChange={(e) => {
              f.setValue('scope', e.target.value as 'PLATFORM' | 'COLLEGE');
              f.setValue('ownerCollegeId', null);
              f.setValue('sharedCollegeIds', []);
            }}
          >
            <option value="PLATFORM">Platform</option>
            <option value="COLLEGE">College</option>
          </select>
        </Field>
      </div>
      {scope === 'COLLEGE' &&
        (course ? (
          <p>College owner: {owner}. Ownership remains fixed.</p>
        ) : (
          <CollegePicker
            superAdmin={superAdmin}
            permission="course.manage"
            value={owner ?? ''}
            onChange={(v) =>
              f.setValue('ownerCollegeId', v, { shouldValidate: true })
            }
            label="Course owner college"
          />
        ))}
      {superAdmin && scope === 'COLLEGE' && (
        <section>
          <h3>Explicit college sharing</h3>
          <CollegePicker
            superAdmin
            value={shareChoice}
            onChange={(v) => {
              setShareChoice(v);
              if (v && v !== owner && !shared.includes(v) && shared.length < 20)
                f.setValue('sharedCollegeIds', [...shared, v]);
            }}
            label="Share with college"
          />
          {shared.map((id) => (
            <div key={id}>
              {id}{' '}
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  f.setValue(
                    'sharedCollegeIds',
                    shared.filter((v) => v !== id),
                  )
                }
              >
                Remove sharing
              </Button>
            </div>
          ))}
        </section>
      )}
      <Field
        label="Description"
        error={f.formState.errors.description?.message}
      >
        <textarea
          aria-label="Course description"
          {...f.register('description')}
        />
      </Field>
      <Field label="Tags, separated by commas">
        <input
          aria-label="Course tags"
          defaultValue={course?.tags.join(', ') ?? ''}
          onChange={(e) =>
            f.setValue(
              'tags',
              e.target.value
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
              { shouldValidate: true },
            )
          }
        />
      </Field>
      {Object.values(f.formState.errors).map((e, i) => (
        <p key={i} role="alert">
          {e.message}
        </p>
      ))}
      {command.error && <p role="alert">{command.error.message}</p>}
      <Button disabled={command.isPending}>Save course</Button>
    </form>
  );
}
