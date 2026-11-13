'use client';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import {
  Field,
  Dialog,
  Status,
  QueryState,
  Confirmation,
  Pagination,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { CollegePicker } from '@/features/learning/options';
import {
  editorialBody,
  editorialSchema,
  pageSchema,
  type Editorial,
} from './contracts';
import { EditorialView, SafeMarkdown, Snippet } from './render';
const emptyApproach = () => ({
  id: crypto.randomUUID(),
  title: '',
  intuition: '',
  bruteForce: '',
  optimizedApproach: '',
  steps: [] as string[],
  timeComplexity: '',
  spaceComplexity: '',
  notes: '',
});
export function EditorialManager({
  problemId,
  superAdmin = false,
}: {
  problemId: string;
  superAdmin?: boolean;
}) {
  const [page, setPage] = useState(1),
    [edit, setEdit] = useState<Editorial | null | undefined>(),
    [view, setView] = useState<Editorial | null>(null),
    [action, setAction] = useState<{
      item: Editorial;
      kind: 'publish' | 'clone';
    } | null>(null);
  const q = useAdministration(
      '/problems/' + problemId + '/editorials?page=' + page,
      pageSchema(editorialSchema),
    ),
    command = useCommand();
  return (
    <section className="editorial-manager">
      <div className="student-actions">
        <h2>Editorial versions</h2>
        <Button onClick={() => setEdit(null)}>Write editorial draft</Button>
      </div>
      <p>
        Published versions are immutable. Reuse a published version or clone it
        before editing. An editorial is explanatory content, never a submission
        or solved state.
      </p>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data?.items.length === 0 && <p>No editorial versions yet.</p>}
        {q.data?.items.map((e) => (
          <article key={e.id} className="curriculum-section">
            <Status value={e.status} />
            <h3>
              {e.body.title} · v{e.versionNumber}
            </h3>
            <div className="student-actions">
              <Button variant="outline" onClick={() => setView(e)}>
                Preview editorial
              </Button>
              {e.canManage && e.status === 'DRAFT' && (
                <>
                  <Button variant="outline" onClick={() => setEdit(e)}>
                    Edit editorial
                  </Button>
                  <Button
                    onClick={() => setAction({ item: e, kind: 'publish' })}
                  >
                    Publish editorial
                  </Button>
                </>
              )}
              {e.canManage && e.status === 'PUBLISHED' && (
                <Button
                  variant="outline"
                  onClick={() => setAction({ item: e, kind: 'clone' })}
                >
                  Clone editorial
                </Button>
              )}
            </div>
          </article>
        ))}
        {q.data && (
          <Pagination
            page={page}
            total={q.data.total}
            totalPages={q.data.totalPages}
            onChange={setPage}
          />
        )}
      </QueryState>
      <Dialog
        open={edit !== undefined}
        title={edit ? 'Edit editorial draft' : 'Write an editorial'}
        onClose={() => setEdit(undefined)}
      >
        {edit !== undefined && (
          <EditorialEditor
            key={edit?.id ?? 'new'}
            item={edit}
            problemId={problemId}
            superAdmin={superAdmin}
            onDone={() => setEdit(undefined)}
          />
        )}
      </Dialog>
      <Dialog
        open={!!view}
        title="Student rendering preview"
        onClose={() => setView(null)}
      >
        {view && <EditorialView body={view.body} />}
      </Dialog>
      <Confirmation
        open={!!action}
        title={
          action?.kind === 'publish'
            ? 'Publish immutable editorial version?'
            : 'Clone editorial to a new draft?'
        }
        description="Existing published curriculum keeps the exact version and content it already captured. This action is audited."
        busy={command.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (action)
            void command
              .mutateAsync({
                path:
                  '/problems/' +
                  problemId +
                  '/editorials/' +
                  action.item.id +
                  '/' +
                  action.kind,
                body:
                  action.kind === 'publish'
                    ? {
                        expectedRevision: action.item.revision,
                        confirmed: true,
                      }
                    : { confirmed: true },
              })
              .then(() => setAction(null))
              .catch(() => setAction(null));
        }}
      />
    </section>
  );
}
const formSchema = z.object({
  ownerCollegeId: z.string().nullable(),
  body: editorialBody,
});
export function EditorialEditor({
  item,
  problemId,
  superAdmin,
  onDone,
}: {
  item: Editorial | null;
  problemId: string;
  superAdmin: boolean;
  onDone: () => void;
}) {
  const f = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: item
      ? { ownerCollegeId: item.ownerCollegeId, body: item.body }
      : {
          ownerCollegeId: null,
          body: {
            title: '',
            introduction: '',
            approaches: [emptyApproach()],
            examples: [],
            codeSolutions: [],
            additionalNotes: '',
          },
        },
  });
  const approaches = useFieldArray({
      control: f.control,
      name: 'body.approaches',
      keyName: 'formKey',
    }),
    examples = useFieldArray({
      control: f.control,
      name: 'body.examples',
      keyName: 'formKey',
    }),
    solutions = useFieldArray({
      control: f.control,
      name: 'body.codeSolutions',
      keyName: 'formKey',
    });
  const body = useWatch({ control: f.control, name: 'body' }),
    owner = useWatch({ control: f.control, name: 'ownerCollegeId' });
  const [tab, setTab] = useState('Overview');
  const command = useCommand();
  return (
    <form
      className="student-card curriculum-editor"
      onSubmit={f.handleSubmit(async (values) => {
        try {
          await command.mutateAsync({
            path:
              '/problems/' +
              problemId +
              '/editorials' +
              (item ? '/' + item.id : ''),
            method: item ? 'PATCH' : 'POST',
            body: {
              ...values,
              ...(item ? { expectedRevision: item.revision } : {}),
            },
          });
          onDone();
        } catch {}
      })}
    >
      <div
        className="learning-tabs"
        role="tablist"
        aria-label="Editorial authoring sections"
      >
        {['Overview', 'Approaches', 'Examples', 'Code', 'Notes', 'Preview'].map(
          (t) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === t}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ),
        )}
      </div>
      {tab === 'Overview' && (
        <>
          <Field
            label="Editorial title"
            error={f.formState.errors.body?.title?.message}
          >
            <input aria-label="Editorial title" {...f.register('body.title')} />
          </Field>
          {!item && (
            <>
              {superAdmin ? (
                <div className="student-notice">
                  Leave ownership as Platform for a reusable global editorial,
                  or choose an active College.
                </div>
              ) : (
                <p>
                  Choose the college whose curriculum team owns this editorial.
                </p>
              )}
              <CollegePicker
                superAdmin={superAdmin}
                permission="course.manage"
                label="Editorial owner college"
                value={owner ?? ''}
                onChange={(v) => f.setValue('ownerCollegeId', v || null)}
              />
            </>
          )}
          <Field label="Problem overview / introduction">
            <textarea
              aria-label="Editorial introduction"
              {...f.register('body.introduction')}
            />
          </Field>
          <SafeMarkdown text={body.introduction ?? ''} />
        </>
      )}
      {tab === 'Approaches' && (
        <>
          {approaches.fields.map((a, i) => (
            <fieldset className="curriculum-section" key={a.formKey}>
              <legend>Approach {i + 1}</legend>
              <Field label="Approach title">
                <input
                  aria-label={'Approach ' + (i + 1) + ' title'}
                  {...f.register(`body.approaches.${i}.title`)}
                />
              </Field>
              {(
                [
                  'intuition',
                  'bruteForce',
                  'optimizedApproach',
                  'notes',
                ] as const
              ).map((k) => (
                <Field
                  key={k}
                  label={
                    {
                      intuition: 'Intuition',
                      bruteForce: 'Brute-force approach',
                      optimizedApproach: 'Optimized approach',
                      notes: 'Approach notes',
                    }[k]
                  }
                >
                  <textarea
                    aria-label={'Approach ' + (i + 1) + ' ' + k}
                    {...f.register(`body.approaches.${i}.${k}`)}
                  />
                </Field>
              ))}
              <Field label="Step-by-step explanation (one step per line)">
                <textarea
                  aria-label={'Approach ' + (i + 1) + ' steps'}
                  defaultValue={a.steps.join('\n')}
                  onChange={(e) =>
                    f.setValue(
                      `body.approaches.${i}.steps`,
                      e.target.value.split('\n').filter((v) => v.trim()),
                    )
                  }
                />
              </Field>
              <div className="student-grid">
                <Field label="Time complexity">
                  <input
                    aria-label={'Approach ' + (i + 1) + ' time complexity'}
                    {...f.register(`body.approaches.${i}.timeComplexity`)}
                  />
                </Field>
                <Field label="Space complexity">
                  <input
                    aria-label={'Approach ' + (i + 1) + ' space complexity'}
                    {...f.register(`body.approaches.${i}.spaceComplexity`)}
                  />
                </Field>
              </div>
              <div className="student-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={i === 0}
                  onClick={() => approaches.move(i, i - 1)}
                >
                  Move approach up
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={i === approaches.fields.length - 1}
                  onClick={() => approaches.move(i, i + 1)}
                >
                  Move approach down
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={approaches.fields.length === 1}
                  onClick={() => approaches.remove(i)}
                >
                  Remove approach
                </Button>
              </div>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={approaches.fields.length >= 15}
            onClick={() => approaches.append(emptyApproach())}
          >
            Add approach
          </Button>
        </>
      )}
      {tab === 'Examples' && (
        <>
          {examples.fields.map((e, i) => (
            <fieldset className="curriculum-section" key={e.formKey}>
              <legend>Example {i + 1}</legend>
              {(['input', 'output', 'walkthrough'] as const).map((k) => (
                <Field
                  label={
                    k === 'walkthrough'
                      ? 'Example walkthrough'
                      : k === 'input'
                        ? 'Example input'
                        : 'Expected output'
                  }
                  key={k}
                >
                  <textarea
                    aria-label={'Example ' + (i + 1) + ' ' + k}
                    {...f.register(`body.examples.${i}.${k}`)}
                  />
                </Field>
              ))}
              <Button
                type="button"
                variant="ghost"
                onClick={() => examples.remove(i)}
              >
                Remove example
              </Button>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={examples.fields.length >= 20}
            onClick={() =>
              examples.append({
                id: crypto.randomUUID(),
                input: '',
                output: '',
                walkthrough: '',
              })
            }
          >
            Add example walkthrough
          </Button>
        </>
      )}
      {tab === 'Code' && (
        <>
          <p>
            Write explanatory snippets only. Code is highlighted and escaped,
            never executed.
          </p>
          {solutions.fields.map((c, i) => (
            <fieldset className="curriculum-section" key={c.formKey}>
              <legend>Code solution {i + 1}</legend>
              <div className="student-grid">
                <Field label="Approach">
                  <select
                    aria-label={'Code ' + (i + 1) + ' approach'}
                    {...f.register(`body.codeSolutions.${i}.approachId`)}
                  >
                    {body.approaches?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title || 'Untitled approach'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Language">
                  <select
                    aria-label={'Code ' + (i + 1) + ' language'}
                    {...f.register(`body.codeSolutions.${i}.language`)}
                  >
                    {['JAVA', 'PYTHON', 'CPP', 'JAVASCRIPT'].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Explanatory code">
                <textarea
                  className="code-input"
                  aria-label={'Code ' + (i + 1) + ' source'}
                  spellCheck={false}
                  {...f.register(`body.codeSolutions.${i}.code`)}
                />
              </Field>
              <Snippet
                language={body.codeSolutions?.[i]?.language ?? 'JAVA'}
                code={body.codeSolutions?.[i]?.code ?? ''}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => solutions.remove(i)}
              >
                Remove code solution
              </Button>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={solutions.fields.length >= 20}
            onClick={() =>
              solutions.append({
                id: crypto.randomUUID(),
                approachId: body.approaches[0]!.id,
                language: 'JAVA',
                code: '',
              })
            }
          >
            Add language solution
          </Button>
        </>
      )}
      {tab === 'Notes' && (
        <Field label="Additional notes">
          <textarea
            aria-label="Additional editorial notes"
            {...f.register('body.additionalNotes')}
          />
        </Field>
      )}
      {tab === 'Preview' && <EditorialView body={body} />}
      <div role="status">
        {f.formState.isSubmitted && !f.formState.isValid && (
          <p role="alert">
            Check the title, named approaches, code-language links and section
            limits before saving.
          </p>
        )}
      </div>
      {command.error && <p role="alert">{command.error.message}</p>}
      <div className="student-actions">
        <Button disabled={command.isPending}>Save editorial draft</Button>
      </div>
    </form>
  );
}
