'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DataTable,
  Dialog,
  Confirmation,
  Field,
  Pagination,
  QueryState,
  SearchFilter,
  Status,
} from '@/components/shared/admin-ui';
import {
  collegeSchema,
  collegeFormSchema,
  pageSchema,
  type College,
  type CollegeForm,
} from '@/features/administration/contracts';
import {
  listPath,
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
function CollegeEditor({
  college,
  onClose,
}: {
  college?: College;
  onClose: () => void;
}) {
  const command = useCommand();
  const [status, setStatus] = useState<College['status'] | null>(null);
  const form = useForm<CollegeForm>({
    resolver: zodResolver(collegeFormSchema),
    defaultValues: college
      ? {
          name: college.name,
          code: college.code,
          slug: college.slug,
          city: college.city,
          state: college.state,
          country: college.country,
        }
      : { name: '', code: '', slug: '', city: '', state: '', country: '' },
  });
  async function submit(data: CollegeForm) {
    try {
      await command.mutateAsync({
        path: college
          ? '/super-admin/colleges/' + college.id
          : '/super-admin/colleges',
        method: college ? 'PATCH' : 'POST',
        body: {
          ...data,
          ...(college ? { expectedRevision: college.revision } : {}),
        },
      });
      onClose();
    } catch {}
  }
  return (
    <>
      <p className="dialog-description">
        College records retain their history. Codes and slugs must be unique.
      </p>
      <form className="admin-form" onSubmit={form.handleSubmit(submit)}>
        <fieldset
          disabled={command.isPending || college?.status === 'ARCHIVED'}
        >
          <div className="form-grid">
            {(
              [
                { name: 'name', label: 'College name' },
                { name: 'code', label: 'College code' },
                { name: 'slug', label: 'URL slug' },
                { name: 'city', label: 'City' },
                { name: 'state', label: 'State / region' },
                { name: 'country', label: 'Country' },
              ] as const
            ).map((field) => (
              <Field
                key={field.name}
                label={field.label}
                error={form.formState.errors[field.name]?.message}
              >
                <input
                  aria-label={field.label}
                  aria-invalid={!!form.formState.errors[field.name]}
                  {...form.register(field.name)}
                />
              </Field>
            ))}
          </div>
          <div className="dialog-actions">
            <Button disabled={command.isPending} type="submit">
              {command.isPending
                ? 'Saving…'
                : college
                  ? 'Save college'
                  : 'Create college'}
            </Button>
          </div>
        </fieldset>
      </form>
      {college && (
        <div className="college-status-controls">
          <Status value={college.status} />
          {college.status !== 'ARCHIVED' && (
            <>
              <Button
                variant="outline"
                disabled={command.isPending}
                onClick={() =>
                  setStatus(college.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')
                }
              >
                {college.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Button>
              <Button
                variant="outline"
                disabled={command.isPending}
                onClick={() => setStatus('ARCHIVED')}
              >
                Archive college
              </Button>
            </>
          )}
        </div>
      )}
      <Confirmation
        open={!!status}
        title={
          status === 'ARCHIVED'
            ? 'Archive this college?'
            : 'Change college status?'
        }
        description={
          status === 'ARCHIVED'
            ? 'This preserves historical references and permanently closes this college to new administrative operations.'
            : 'Inactive colleges cannot receive new access grants or administrative operations. Existing references are preserved.'
        }
        busy={command.isPending}
        onClose={() => setStatus(null)}
        onConfirm={() => {
          if (college && status)
            void command
              .mutateAsync({
                path: '/super-admin/colleges/' + college.id + '/status',
                method: 'PATCH',
                body: { status, expectedRevision: college.revision },
              })
              .then(() => {
                setStatus(null);
                onClose();
              })
              .catch(() => {});
        }}
      />
    </>
  );
}
function CollegeDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdministration('/super-admin/colleges/' + id, collegeSchema);
  return (
    <QueryState
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <CollegeEditor
          key={query.data.id + query.data.revision}
          college={query.data}
          onClose={onClose}
        />
      )}
    </QueryState>
  );
}
export function CollegeManagement() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('name');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const query = useAdministration(
    listPath('/super-admin/colleges', {
      page,
      search,
      status,
      sort,
      direction: 'asc',
    }),
    pageSchema(collegeSchema),
  );
  return (
    <>
      <div className="section-actions">
        <p>One accurate directory for every learning community.</p>
        <Button onClick={() => setCreating(true)}>
          <Plus size={17} /> Add college
        </Button>
      </div>
      <Card className="table-card">
        <SearchFilter
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          status={status}
          onStatus={(value) => {
            setStatus(value);
            setPage(1);
          }}
          statuses={['ACTIVE', 'INACTIVE', 'ARCHIVED']}
          sort={sort}
          onSort={setSort}
          sorts={[
            { value: 'name', label: 'College name' },
            { value: 'code', label: 'College code' },
            { value: 'createdAt', label: 'Created date' },
          ]}
        />
        <QueryState
          pending={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        >
          {query.data && (
            <>
              <DataTable
                items={query.data.items}
                empty="No matching colleges"
                columns={[
                  {
                    key: 'college',
                    label: 'College',
                    render: (c) => (
                      <div>
                        <strong>{c.name}</strong>
                        <small>
                          {c.code} · {c.slug}
                        </small>
                      </div>
                    ),
                  },
                  {
                    key: 'location',
                    label: 'Location',
                    render: (c) =>
                      [c.city, c.state, c.country].filter(Boolean).join(', ') ||
                      'Not specified',
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (c) => <Status value={c.status} />,
                  },
                  {
                    key: 'actions',
                    label: 'Details',
                    render: (c) => (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={'View ' + c.name}
                        onClick={() => setSelected(c.id)}
                      >
                        View / edit <ArrowUpRight size={15} />
                      </Button>
                    ),
                  },
                ]}
              />
              <Pagination {...query.data} onChange={setPage} />
            </>
          )}
        </QueryState>
      </Card>
      <Dialog
        open={creating || !!selected}
        title={creating ? 'Add a college' : 'College details'}
        onClose={() => {
          setCreating(false);
          setSelected(null);
        }}
      >
        {creating ? (
          <CollegeEditor onClose={() => setCreating(false)} />
        ) : selected ? (
          <CollegeDetails id={selected} onClose={() => setSelected(null)} />
        ) : null}
      </Dialog>
    </>
  );
}
