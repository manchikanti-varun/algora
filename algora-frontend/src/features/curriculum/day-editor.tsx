'use client';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import { Field, Pagination } from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import {
  dayForm,
  problemSchema,
  editorialSchema,
  pageSchema,
  type Day,
  type DayForm,
} from './contracts';
import { SafeMarkdown } from './render';
const defaultDay = (): DayForm => ({
  dayNumber: 1,
  title: '',
  description: '',
  learningObjectives: [],
  topics: [],
  resources: [],
  problemAssignments: [],
  publicationStatus: 'DRAFT',
  publishAt: null,
});
const localTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return (
    [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-') +
    'T' +
    [
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
    ].join(':')
  );
};
export function DayEditor({
  courseId,
  revisionId,
  expectedRevision,
  item,
  onDone,
}: {
  courseId: string;
  revisionId: string;
  expectedRevision: number;
  item: Day | null;
  onDone: () => void;
}) {
  const command = useCommand(),
    [tab, setTab] = useState('Properties');
  const f = useForm<DayForm>({
    resolver: zodResolver(dayForm),
    defaultValues: item ?? defaultDay(),
  });
  const topics = useFieldArray({
      control: f.control,
      name: 'topics',
      keyName: 'formKey',
    }),
    resources = useFieldArray({
      control: f.control,
      name: 'resources',
      keyName: 'formKey',
    }),
    assignments = useFieldArray({
      control: f.control,
      name: 'problemAssignments',
      keyName: 'formKey',
    });
  const values = useWatch({ control: f.control }),
    status = values.publicationStatus;
  return (
    <form
      className="student-card curriculum-editor"
      onSubmit={f.handleSubmit(async (body) => {
        try {
          await command.mutateAsync({
            path:
              '/courses/' +
              courseId +
              '/curriculum/revisions/' +
              revisionId +
              '/days' +
              (item ? '/' + item.id : ''),
            method: item ? 'PATCH' : 'POST',
            body: { ...body, expectedRevision },
          });
          onDone();
        } catch {}
      })}
    >
      <div
        className="learning-tabs"
        role="tablist"
        aria-label="Learning Day editor sections"
      >
        {[
          'Properties',
          'Topics & objectives',
          'Resources',
          'Problems',
          'Preview',
        ].map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
          >
            {v}
          </button>
        ))}
      </div>
      {tab === 'Properties' && (
        <>
          <div className="student-grid">
            <Field
              label="Day number"
              error={f.formState.errors.dayNumber?.message}
            >
              <input
                type="number"
                min={1}
                max={1000000000}
                aria-label="Day number"
                {...f.register('dayNumber', { valueAsNumber: true })}
              />
            </Field>
            <Field label="Day title" error={f.formState.errors.title?.message}>
              <input aria-label="Day title" {...f.register('title')} />
            </Field>
          </div>
          <Field label="Day description (Markdown)">
            <textarea
              aria-label="Day description"
              {...f.register('description')}
            />
          </Field>
          <div className="curriculum-context">
            <h3>Student release settings</h3>
            <Field label="Publication status">
              <select
                aria-label="Day publication status"
                {...f.register('publicationStatus')}
              >
                {['DRAFT', 'PUBLISHED', 'SCHEDULED', 'UNPUBLISHED'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            {status === 'SCHEDULED' && (
              <Field label="Release date and time">
                <input
                  aria-label="Day publish time"
                  type="datetime-local"
                  defaultValue={localTime(values.publishAt ?? null)}
                  onChange={(e) => {
                    const date = e.target.value
                      ? new Date(e.target.value)
                      : null;
                    f.setValue(
                      'publishAt',
                      date && !Number.isNaN(date.getTime())
                        ? date.toISOString()
                        : null,
                      { shouldValidate: true },
                    );
                  }}
                />
                <p>
                  Your timezone:{' '}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}. The API
                  stores UTC and checks server time.
                </p>
              </Field>
            )}
            <p>
              Release settings take effect only after the curriculum revision is
              published and assigned to a Batch. Published snapshots cannot be
              edited in place.
            </p>
          </div>
        </>
      )}
      {tab === 'Topics & objectives' && (
        <>
          <Field label="Learning objectives (one per line)">
            <textarea
              aria-label="Learning objectives"
              defaultValue={item?.learningObjectives.join('\n') ?? ''}
              onChange={(e) =>
                f.setValue(
                  'learningObjectives',
                  e.target.value.split('\n').filter((v) => v.trim()),
                  { shouldValidate: true },
                )
              }
            />
          </Field>
          {topics.fields.map((t, i) => (
            <fieldset className="curriculum-section" key={t.formKey}>
              <legend>Topic {i + 1}</legend>
              <Field label="Topic title">
                <input
                  aria-label={'Topic ' + (i + 1) + ' title'}
                  {...f.register(`topics.${i}.title`)}
                />
              </Field>
              <Field label="Topic description">
                <textarea
                  aria-label={'Topic ' + (i + 1) + ' description'}
                  {...f.register(`topics.${i}.description`)}
                />
              </Field>
              <Field label="Estimated reading minutes">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  aria-label={'Topic ' + (i + 1) + ' minutes'}
                  {...f.register(`topics.${i}.estimatedMinutes`, {
                    setValueAs: (v) =>
                      v === '' || v === null || v === undefined
                        ? null
                        : Number(v),
                  })}
                />
              </Field>
              <OrderButtons
                index={i}
                total={topics.fields.length}
                noun="topic"
                move={topics.move}
                remove={() => topics.remove(i)}
              />
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={topics.fields.length >= 100}
            onClick={() =>
              topics.append({
                id: crypto.randomUUID(),
                title: '',
                description: '',
                estimatedMinutes: null,
              })
            }
          >
            Add topic
          </Button>
        </>
      )}
      {tab === 'Resources' && (
        <>
          {resources.fields.map((r, i) => (
            <fieldset key={r.formKey} className="curriculum-section">
              <legend>Resource {i + 1}</legend>
              <Field label="Resource title">
                <input
                  aria-label={'Resource ' + (i + 1) + ' title'}
                  {...f.register(`resources.${i}.title`)}
                />
              </Field>
              <div className="student-grid">
                <Field label="Resource type">
                  <select
                    aria-label={'Resource ' + (i + 1) + ' type'}
                    {...f.register(`resources.${i}.type`)}
                  >
                    {[
                      'ARTICLE',
                      'VIDEO',
                      'DOCUMENT',
                      'NOTES',
                      'EXTERNAL_LINK',
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Visibility">
                  <select
                    aria-label={'Resource ' + (i + 1) + ' visibility'}
                    {...f.register(`resources.${i}.visibility`)}
                  >
                    <option value="STUDENT">Student resource</option>
                    <option value="INSTRUCTOR_ONLY">Instructor-only</option>
                  </select>
                </Field>
              </div>
              <Field label="Public HTTPS link">
                <input
                  aria-label={'Resource ' + (i + 1) + ' URL'}
                  {...f.register(`resources.${i}.url`, {
                    setValueAs: (v) => v || null,
                  })}
                />
              </Field>
              <Field label="Description">
                <input
                  aria-label={'Resource ' + (i + 1) + ' description'}
                  {...f.register(`resources.${i}.description`)}
                />
              </Field>
              <Field label="Notes (Markdown)">
                <textarea
                  aria-label={'Resource ' + (i + 1) + ' notes'}
                  {...f.register(`resources.${i}.notes`)}
                />
              </Field>
              <OrderButtons
                noun="resource"
                index={i}
                total={resources.fields.length}
                move={resources.move}
                remove={() => resources.remove(i)}
              />
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={resources.fields.length >= 100}
            onClick={() =>
              resources.append({
                id: crypto.randomUUID(),
                title: '',
                type: 'ARTICLE',
                url: null,
                description: '',
                notes: '',
                visibility: 'STUDENT',
              })
            }
          >
            Add resource
          </Button>
          <p>
            Documents link to externally hosted files. Algora does not fetch
            URLs, generate link previews or upload documents.
          </p>
        </>
      )}
      {tab === 'Problems' && (
        <>
          {assignments.fields.map((a, i) => (
            <fieldset key={a.formKey} className="curriculum-section">
              <legend>Problem assignment {i + 1}</legend>
              <ProblemPicker
                value={values.problemAssignments?.[i]?.problemId ?? ''}
                onChange={(v) => {
                  f.setValue(`problemAssignments.${i}.problemId`, v);
                  f.setValue(`problemAssignments.${i}.editorialId`, null);
                }}
              />
              <Field label="Category">
                <select
                  aria-label={'Assignment ' + (i + 1) + ' category'}
                  {...f.register(`problemAssignments.${i}.category`)}
                >
                  {['REQUIRED', 'OPTIONAL', 'CHALLENGE'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Instructor note">
                <textarea
                  aria-label={'Assignment ' + (i + 1) + ' instructor note'}
                  {...f.register(`problemAssignments.${i}.instructorNote`)}
                />
              </Field>
              {values.problemAssignments?.[i]?.problemId && (
                <EditorialPicker
                  problemId={values.problemAssignments[i]!.problemId}
                  value={values.problemAssignments[i]?.editorialId ?? ''}
                  onChange={(v) =>
                    f.setValue(`problemAssignments.${i}.editorialId`, v || null)
                  }
                />
              )}
              <Field label="Student editorial visibility">
                <select
                  aria-label={'Assignment ' + (i + 1) + ' editorial visibility'}
                  {...f.register(`problemAssignments.${i}.editorialVisibility`)}
                >
                  <option value="HIDDEN">Hidden from Student API</option>
                  <option value="VISIBLE">Visible editorial</option>
                </select>
              </Field>
              <OrderButtons
                noun="assignment"
                index={i}
                total={assignments.fields.length}
                move={assignments.move}
                remove={() => assignments.remove(i)}
              />
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={assignments.fields.length >= 100}
            onClick={() =>
              assignments.append({
                problemId: '',
                category: 'REQUIRED',
                instructorNote: '',
                editorialId: null,
                editorialVisibility: 'HIDDEN',
              })
            }
          >
            Assign coding problem
          </Button>
        </>
      )}
      {tab === 'Preview' && (
        <section>
          <h2>{values.title || 'Untitled Learning Day'}</h2>
          <SafeMarkdown text={values.description ?? ''} />
          <ol>
            {values.learningObjectives?.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ol>
          <p>
            Save this draft, then choose Instructor preview to inspect complete
            problem metadata and student-safe editorial projections.
          </p>
        </section>
      )}
      {f.formState.isSubmitted && !f.formState.isValid && (
        <p role="alert">
          Check the required title/number, topic and resource fields, valid
          HTTPS URLs, schedule and duplicate problem assignments.
        </p>
      )}
      {command.error && <p role="alert">{command.error.message}</p>}
      <div className="student-actions">
        <Button disabled={command.isPending}>Save Learning Day</Button>
      </div>
    </form>
  );
}
function OrderButtons({
  index,
  total,
  noun,
  move,
  remove,
}: {
  index: number;
  total: number;
  noun: string;
  move: (from: number, to: number) => void;
  remove: () => void;
}) {
  return (
    <div className="student-actions">
      <Button
        type="button"
        variant="outline"
        disabled={index === 0}
        onClick={() => move(index, index - 1)}
      >
        Move {noun} up
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={index === total - 1}
        onClick={() => move(index, index + 1)}
      >
        Move {noun} down
      </Button>
      <Button type="button" variant="ghost" onClick={remove}>
        Remove {noun}
      </Button>
    </div>
  );
}
function ProblemPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [label, setLabel] = useState('Assigned problem');
  const q = useAdministration(
    '/problems?page=' + page + '&search=' + encodeURIComponent(search),
    pageSchema(problemSchema),
  );
  return (
    <div>
      <Field label="Find a coding problem">
        <input
          aria-label="Find a coding problem"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <Field label="Coding problem">
        <select
          aria-label="Coding problem"
          value={value}
          onChange={(e) => {
            setLabel(
              q.data?.items.find((p) => p.id === e.target.value)?.title ??
                'Assigned problem',
            );
            onChange(e.target.value);
          }}
        >
          <option value="">Choose a catalog problem</option>
          {value && !q.data?.items.some((p) => p.id === value) && (
            <option value={value}>{label}</option>
          )}
          {q.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} · {p.platform}
            </option>
          ))}
        </select>
      </Field>
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data && (
        <Pagination
          page={page}
          total={q.data.total}
          totalPages={q.data.totalPages}
          onChange={setPage}
        />
      )}
    </div>
  );
}
function EditorialPicker({
  problemId,
  value,
  onChange,
}: {
  problemId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const q = useAdministration(
    '/problems/' + problemId + '/editorials?status=PUBLISHED&page=' + page,
    pageSchema(editorialSchema),
  );
  return (
    <Field label="Exact published editorial version">
      <select
        aria-label="Published editorial version"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">No editorial assigned</option>
        {value && !q.data?.items.some((e) => e.id === value) && (
          <option value={value}>Assigned published version</option>
        )}
        {q.data?.items.map((e) => (
          <option key={e.id} value={e.id}>
            {e.body.title} · v{e.versionNumber}
          </option>
        ))}
      </select>
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data && (
        <Pagination
          page={page}
          total={q.data.total}
          totalPages={q.data.totalPages}
          onChange={setPage}
        />
      )}
    </Field>
  );
}
