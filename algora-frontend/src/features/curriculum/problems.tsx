'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import {
  DataTable,
  Field,
  Dialog,
  QueryState,
  Pagination,
  Status,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { CollegePicker, useCollegeOptions } from '@/features/learning/options';
import {
  problemSchema,
  problemForm,
  pageSchema,
  type Problem,
  type ProblemForm,
} from './contracts';
import { EditorialManager } from './editorials';
export function ProblemCatalog({
  superAdmin = false,
}: {
  superAdmin?: boolean;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [platform, setPlatform] = useState(''),
    [difficulty, setDifficulty] = useState(''),
    [edit, setEdit] = useState<Problem | null | undefined>(),
    [editorial, setEditorial] = useState<Problem | null>(null);
  const options = useCollegeOptions(superAdmin, 'course.manage');
  const params = new URLSearchParams({ page: String(page), search });
  if (platform) params.set('platform', platform);
  if (difficulty) params.set('difficulty', difficulty);
  const q = useAdministration('/problems?' + params, pageSchema(problemSchema));
  return (
    <>
      <div className="learning-toolbar">
        <Field label="Search problems">
          <input
            aria-label="Search problems"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Platform">
          <select
            aria-label="Problem platform filter"
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All platforms</option>
            {['LEETCODE', 'CODEFORCES', 'CODECHEF'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Difficulty">
          <select
            aria-label="Problem difficulty filter"
            value={difficulty}
            onChange={(e) => {
              setDifficulty(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All difficulties</option>
            {['EASY', 'MEDIUM', 'HARD', 'UNKNOWN'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        {(superAdmin || options.items.length > 0) && (
          <Button onClick={() => setEdit(null)}>Add coding problem</Button>
        )}
      </div>
      <p>
        Reusable instructor-provided metadata. Algora does not scrape
        statements, execute code or verify external problem ownership here.
      </p>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <DataTable
              items={q.data.items}
              empty="No matching problem metadata"
              columns={[
                {
                  key: 'problem',
                  label: 'Problem',
                  render: (p) => (
                    <>
                      <strong>{p.title}</strong>
                      <p>
                        {p.platform} · {p.platformProblemId}
                      </p>
                    </>
                  ),
                },
                {
                  key: 'difficulty',
                  label: 'Difficulty',
                  render: (p) => <Status value={p.difficulty} />,
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (p) => (
                    <div className="student-actions">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                      >
                        Official problem ↗
                      </a>
                      {p.canManage && (
                        <Button variant="outline" onClick={() => setEdit(p)}>
                          Edit metadata
                        </Button>
                      )}
                      <Button variant="outline" onClick={() => setEditorial(p)}>
                        Editorial versions
                      </Button>
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
        title={edit ? 'Edit permitted metadata' : 'Add official coding problem'}
        onClose={() => setEdit(undefined)}
      >
        {edit !== undefined && (
          <ProblemEditor
            item={edit}
            superAdmin={superAdmin}
            onDone={() => setEdit(undefined)}
          />
        )}
      </Dialog>
      <Dialog
        open={!!editorial}
        title={editorial?.title ?? 'Editorial versions'}
        onClose={() => setEditorial(null)}
      >
        {editorial && (
          <EditorialManager problemId={editorial.id} superAdmin={superAdmin} />
        )}
      </Dialog>
    </>
  );
}
function ProblemEditor({
  item,
  superAdmin,
  onDone,
}: {
  item: Problem | null;
  superAdmin: boolean;
  onDone: () => void;
}) {
  const command = useCommand(),
    [owner, setOwner] = useState(item?.ownerCollegeId ?? '');
  const f = useForm<ProblemForm>({
    resolver: zodResolver(problemForm),
    defaultValues: item ?? {
      platform: 'LEETCODE',
      title: '',
      url: '',
      difficulty: 'UNKNOWN',
      topics: [],
      description: '',
      ownerCollegeId: null,
    },
  });
  return (
    <form
      className="student-card"
      onSubmit={f.handleSubmit(async (body) => {
        try {
          await command.mutateAsync({
            path: '/problems' + (item ? '/' + item.id : ''),
            method: item ? 'PATCH' : 'POST',
            body: {
              ...body,
              ...(item
                ? {
                    platformProblemId: item.platformProblemId,
                    expectedRevision: item.revision,
                  }
                : {}),
            },
          });
          onDone();
        } catch {}
      })}
    >
      <Field label="Problem title" error={f.formState.errors.title?.message}>
        <input aria-label="Problem title" {...f.register('title')} />
      </Field>
      <div className="student-grid">
        <Field label="Platform">
          {item ? (
            <input
              aria-label="Problem platform"
              readOnly
              {...f.register('platform')}
            />
          ) : (
            <select aria-label="Problem platform" {...f.register('platform')}>
              {['LEETCODE', 'CODEFORCES', 'CODECHEF'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Difficulty">
          <select aria-label="Problem difficulty" {...f.register('difficulty')}>
            {['EASY', 'MEDIUM', 'HARD', 'UNKNOWN'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        label="Official problem URL"
        error={f.formState.errors.url?.message}
      >
        <input
          aria-label="Official problem URL"
          readOnly={!!item}
          {...f.register('url')}
          placeholder="https://leetcode.com/problems/problem-slug/"
        />
      </Field>
      <p>
        Canonical identifiers are derived and checked on the server. Platform
        and problem identity stay fixed after creation.
      </p>
      {!item && (
        <CollegePicker
          superAdmin={superAdmin}
          permission="course.manage"
          label="Problem metadata owner college"
          value={owner}
          onChange={(v) => {
            setOwner(v);
            f.setValue('ownerCollegeId', v || null);
          }}
        />
      )}
      <Field label="Topic tags">
        <input
          aria-label="Problem topic tags"
          defaultValue={item?.topics.join(', ') ?? ''}
          onChange={(e) =>
            f.setValue(
              'topics',
              e.target.value
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
            )
          }
        />
      </Field>
      <Field label="Original or permitted description">
        <textarea
          aria-label="Problem description"
          {...f.register('description')}
        />
      </Field>
      {command.error && <p role="alert">{command.error.message}</p>}
      <Button disabled={command.isPending}>Save problem metadata</Button>
    </form>
  );
}
