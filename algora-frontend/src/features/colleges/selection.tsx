'use client';
import { useState } from 'react';
import { Pagination, QueryState } from '@/components/shared/admin-ui';
import { useAdministration, listPath } from '@/features/administration/queries';
import {
  pageSchema,
  collegeOptionSchema,
  type CollegeOption,
  type Grant,
  type Permission,
} from '@/features/administration/contracts';
import { z } from 'zod';
export function CollegeSelection({
  value,
  onChange,
  options,
  eligible = false,
  onCollegeNames,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  options?: CollegeOption[];
  eligible?: boolean;
  onCollegeNames?: (options: CollegeOption[]) => void;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = useAdministration(
    listPath(
      eligible
        ? '/admin-access-requests/eligible-colleges'
        : '/super-admin/colleges',
      {
        page,
        search,
        status: eligible ? '' : 'ACTIVE',
        sort: 'name',
        direction: 'asc',
      },
    ),
    pageSchema(collegeOptionSchema),
    !options,
  );
  const choices = options ?? query.data?.items ?? [];
  const listing = (
    <div
      className="college-options"
      role="group"
      aria-label="College selection"
    >
      {choices.length ? (
        choices.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={value.includes(c.id)}
              disabled={!value.includes(c.id) && value.length >= 20}
              onChange={(e) => {
                onCollegeNames?.(choices);
                onChange(
                  e.target.checked
                    ? [...value, c.id]
                    : value.filter((id) => id !== c.id),
                );
              }}
            />
            <span>
              <strong>{c.name}</strong>
              <small>
                {c.code}
                {c.city ? ' · ' + c.city : ''}
              </small>
            </span>
          </label>
        ))
      ) : (
        <p>No eligible colleges are available.</p>
      )}
    </div>
  );
  return (
    <div className="college-selection">
      {!options && (
        <input
          aria-label="Search colleges"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Find a college…"
        />
      )}
      <span className="selection-count">
        {value.length} selected · maximum 20
      </span>
      {options ? (
        listing
      ) : (
        <QueryState
          pending={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        >
          {listing}
          {query.data && <Pagination {...query.data} onChange={setPage} />}
        </QueryState>
      )}
    </div>
  );
}
const definitions = z.object({
  permissions: z.array(
    z.object({
      key: z.enum([
        'college.view',
        'course.manage',
        'batch.manage',
        'student.view',
        'student.verify',
        'student.enroll',
        'attendance.manage',
        'report.view',
      ]),
      label: z.string(),
      availableNow: z.boolean(),
    }),
  ),
});
export function PermissionMatrix({
  grants,
  onChange,
  names,
}: {
  grants: Grant[];
  onChange: (grants: Grant[]) => void;
  names: Record<string, string>;
}) {
  const query = useAdministration('/super-admin/permissions', definitions);
  function toggle(collegeId: string, key: Permission, checked: boolean) {
    onChange(
      grants.map((g) =>
        g.collegeId !== collegeId
          ? g
          : {
              ...g,
              permissions: checked
                ? [
                    ...new Set([
                      ...g.permissions,
                      key,
                      ...(key === 'student.verify'
                        ? ['student.view' as const]
                        : []),
                    ]),
                  ]
                : g.permissions.filter(
                    (p) =>
                      p !== key &&
                      !(key === 'student.view' && p === 'student.verify'),
                  ),
            },
      ),
    );
  }
  return (
    <QueryState
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <div className="permission-matrix">
        {grants.map((g) => (
          <fieldset key={g.collegeId}>
            <legend>{names[g.collegeId] ?? 'Selected college'}</legend>
            {query.data?.permissions.map((p) => (
              <label key={p.key}>
                <input
                  type="checkbox"
                  checked={g.permissions.includes(p.key)}
                  disabled={p.key === 'college.view'}
                  onChange={(e) => toggle(g.collegeId, p.key, e.target.checked)}
                />
                <span>
                  {p.label}
                  {!p.availableNow && (
                    <small>Reserved for a future phase</small>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </QueryState>
  );
}
