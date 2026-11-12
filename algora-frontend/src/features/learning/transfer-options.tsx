'use client';
import { useState } from 'react';
import { useAdministration } from '@/features/administration/queries';
import { Field, Pagination } from '@/components/shared/admin-ui';
import { batchSchema, pageSchema } from './contracts';
export function DestinationPicker({
  sourceId,
  courseId,
  collegeId,
  value,
  onChange,
}: {
  sourceId: string;
  courseId: string;
  collegeId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [label, setLabel] = useState('Selected destination');
  const q = useAdministration(
    '/batches?courseId=' +
      courseId +
      '&collegeId=' +
      collegeId +
      '&page=' +
      page +
      '&search=' +
      encodeURIComponent(search),
    pageSchema(batchSchema),
  );
  const items =
    q.data?.items.filter(
      (b) =>
        b.id !== sourceId &&
        b.canEnroll &&
        ['DRAFT', 'ACTIVE'].includes(b.status),
    ) ?? [];
  return (
    <>
      <Field label="Find destination batch">
        <input
          aria-label="Find destination batch"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <Field label="Destination batch">
        <select
          aria-label="Destination batch"
          value={value}
          onChange={(e) => {
            setLabel(
              items.find((b) => b.id === e.target.value)?.name ??
                'Selected destination',
            );
            onChange(e.target.value);
          }}
        >
          <option value="">Choose an eligible batch</option>
          {value && !items.some((b) => b.id === value) && (
            <option value={value}>{label}</option>
          )}
          {items.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
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
    </>
  );
}
