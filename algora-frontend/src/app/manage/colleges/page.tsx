'use client';
import { useState } from 'react';
import { Button, Card, DataTable, EmptyState, ErrorState, Input, Menu, Modal, PageHeader, Pagination, SearchInput, StatusBadge, TableSkeleton, useToast } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { api, errorMessage, qs } from '@/lib/api';
import type { Paged } from '@/components/manage/types';
interface College { _id: string; name: string; status: string; students: number; batches: number }
export default function Page() {
  const [u, setU] = useUrlState({ q: '', page: '1' });
  const page = Number(u.page) || 1;
  const dq = useDebounced(u.q);
  const list = useApi<Paged<College>>(`/colleges${qs({ q: dq, page })}`);
  const toast = useToast();
  const [edit, setEdit] = useState<{ id?: string; name: string } | null>(null); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (edit!.id) await api(`/colleges/${edit!.id}`, { method: 'PATCH', body: { name: edit!.name } });
      else await api('/colleges', { method: 'POST', body: { name: edit!.name } });
      toast.success(edit!.id ? 'College renamed' : 'College added'); setEdit(null); void list.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function setStatus(c: College, status: 'ACTIVE' | 'ARCHIVED', undo = true) {
    try {
      await api(`/colleges/${c._id}`, { method: 'PATCH', body: { status } });
      if (status === 'ARCHIVED' && undo) toast.success('College archived', { action: { label: 'Undo', onClick: () => void setStatus(c, 'ACTIVE', false) } });
      else toast.success(status === 'ACTIVE' ? 'College restored' : 'College archived');
      void list.reload();
    } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <div>
      <PageHeader title="Colleges" subtitle="Colleges are created when students register. Rename one to merge spelling variants." actions={<Button onClick={() => setEdit({ name: '' })}>Add college</Button>} />
      <Card flush>
        <div className="border-b border-line px-4 py-2.5"><SearchInput value={u.q} onChange={(v) => setU({ q: v, page: '1' })} placeholder="Search colleges" label="Search colleges" /></div>
        {list.error ? <ErrorState message={list.error} retry={list.reload} /> : !list.data ? <TableSkeleton /> : (
          <>
            <DataTable rows={list.data.items} rowKey={(c) => c._id} caption="Colleges"
              empty={<EmptyState compact title="No colleges found" body={u.q ? 'Try a different search.' : 'Add a college, or wait for students to register.'} action={u.q ? undefined : <Button size="sm" onClick={() => setEdit({ name: '' })}>Add college</Button>} />}
              columns={[
                { key: 'name', header: 'College', cell: (c) => <span className="font-medium">{c.name}</span> },
                { key: 's', header: 'Students', cell: (c) => <span className="tabular-nums">{c.students}</span> },
                { key: 'b', header: 'Batches', cell: (c) => <span className="tabular-nums">{c.batches}</span> },
                { key: 'st', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
                { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (c) => (
                  <Menu label={`Actions for ${c.name}`} items={[
                    { label: 'Rename', onSelect: () => setEdit({ id: c._id, name: c.name }) },
                    c.status === 'ACTIVE' ? { label: 'Archive', onSelect: () => void setStatus(c, 'ARCHIVED') } : { label: 'Restore', onSelect: () => void setStatus(c, 'ACTIVE') },
                  ]} />) },
              ]} />
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setU({ page: String(p) })} />
          </>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Rename college' : 'Add college'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} disabled={(edit?.name.trim().length ?? 0) < 2} onClick={save}>Save</Button></>}>
        <Input label="Name" value={edit?.name ?? ''} onChange={(e) => setEdit({ ...edit!, name: e.target.value })} autoFocus />
      </Modal>
    </div>
  );
}
