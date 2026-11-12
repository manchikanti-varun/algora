'use client';
import { useState } from 'react';
import { useAdministration } from '@/features/administration/queries';
import { Field, Pagination, QueryState } from '@/components/shared/admin-ui';
import {
  collegeOptionsSchema,
  courseSchema,
  pageSchema,
  type Course,
} from './contracts';
export function useCollegeOptions(superAdmin: boolean, permission?: string) {
  const q = useAdministration(
    superAdmin
      ? '/super-admin/colleges?pageSize=50&status=ACTIVE'
      : '/admin/colleges',
    collegeOptionsSchema,
  );
  return {
    ...q,
    items:
      q.data?.items.filter(
        (c) =>
          (!c.status || c.status === 'ACTIVE') &&
          (superAdmin || !permission || c.permissions?.includes(permission)),
      ) ?? [],
  };
}
export function CollegePicker({
  superAdmin,
  permission,
  value,
  onChange,
  label = 'College',
}: {
  superAdmin: boolean;
  permission?: string;
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [chosenName, setChosenName] = useState('Selected college');
  const q = useAdministration(
    superAdmin
      ? '/super-admin/colleges?status=ACTIVE&pageSize=50&page=' +
          page +
          '&search=' +
          encodeURIComponent(search)
      : '/admin/colleges',
    collegeOptionsSchema,
  );
  const items =
    q.data?.items.filter(
      (c) =>
        (!c.status || c.status === 'ACTIVE') &&
        (superAdmin || !permission || c.permissions?.includes(permission)) &&
        (!search ||
          superAdmin ||
          c.name.toLowerCase().includes(search.toLowerCase())),
    ) ?? [];
  return (
    <div>
      <Field label={'Find ' + label.toLowerCase()}>
        <input
          aria-label={'Find ' + label.toLowerCase()}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <Field label={label}>
        <select
          aria-label={label}
          value={value}
          onChange={(e) => {
            setChosenName(
              items.find((c) => c.id === e.target.value)?.name ??
                'Selected college',
            );
            onChange(e.target.value);
          }}
        >
          <option value="">Select a college</option>
          {value && !items.some((c) => c.id === value) && (
            <option value={value}>{chosenName}</option>
          )}
          {items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {q.error && <p role="alert">{q.error.message}</p>}
      {superAdmin && q.data && (
        <Pagination
          page={page}
          total={q.data.total ?? items.length}
          totalPages={q.data.totalPages ?? 1}
          onChange={setPage}
        />
      )}
    </div>
  );
}
export function CoursePicker({
  collegeId,
  value,
  onChange,
}: {
  collegeId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Course | null>(null);
  const q = useAdministration(
    '/courses?status=PUBLISHED&pageSize=50&page=' +
      page +
      '&search=' +
      encodeURIComponent(search),
    pageSchema(courseSchema),
  );
  const items =
    q.data?.items.filter(
      (c) =>
        c.scope === 'PLATFORM' ||
        c.ownerCollegeId === collegeId ||
        c.sharedCollegeIds.includes(collegeId),
    ) ?? [];
  return (
    <div>
      <Field label="Find a course">
        <input
          aria-label="Find a course"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        <Field label="Published course">
          <select
            aria-label="Published course"
            value={value}
            disabled={!collegeId}
            onChange={(e) => {
              setSelected(items.find((c) => c.id === e.target.value) ?? null);
              onChange(e.target.value);
            }}
          >
            <option value="">Select an eligible published course</option>
            {value && !items.some((c) => c.id === value) && (
              <option value={value}>
                {selected?.title ?? 'Selected course'}
              </option>
            )}
            {items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        {q.data && (
          <Pagination
            page={page}
            total={q.data.total}
            totalPages={q.data.totalPages}
            onChange={setPage}
          />
        )}
      </QueryState>
    </div>
  );
}
