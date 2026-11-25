'use client';
import { useState } from 'react';
import { Button, Card, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, SearchInput, StatusBadge, TableSkeleton, useToast } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { api, errorMessage, qs } from '@/lib/api';
import type { Paged } from '@/components/manage/types';

interface College { _id: string; name: string; status: string; students: number; batches: number }
export default function Page() {
  const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useApi<Paged<College>>(`/colleges${qs({ q: dq, page })}`);
  const toast = useToast();
  const [edit, setEdit] = useState<{ id?: string; name: string } | null>(null); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (edit!.id) await api(`/colleges/${edit!.id}`, { method: 'PATCH', body: { name: edit!.name } });
      else await api('/colleges', { method: 'POST', body: { name: edit!.name } });
      toast.success('College saved'); setEdit(null); list.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function toggle(c: College) {
    try { await api(`/colleges/${c._id}`, { method: 'PATCH', body: { status: c.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' } }); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <div>
      <PageHeader title="Colleges" subtitle="Colleges are created automatically when students register. Merge spelling variants by renaming." actions={<Button onClick={() => setEdit({ name: '' })}>Add college</Button>} />
      <Card title={<SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search colleges" />}>
        {list.error ? <ErrorState message={list.error} retry={list.reload} /> : !list.data ? <TableSkeleton /> : (
          <>
            <DataTable rows={list.data.items} rowKey={(c) => c._id} empty={<EmptyState title="No colleges found" />} columns={[
              { key: 'name', header: 'College', cell: (c) => <span className="font-medium">{c.name}</span> },
              { key: 's', header: 'Students', cell: (c) => c.students }, { key: 'b', header: 'Batches', cell: (c) => c.batches },
              { key: 'st', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
              { key: 'a', header: '', className: 'text-right', cell: (c) => <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setEdit({ id: c._id, name: c.name })}>Rename</Button><Button size="sm" variant="ghost" onClick={() => toggle(c)}>{c.status === 'ACTIVE' ? 'Archive' : 'Restore'}</Button></div> },
            ]} />
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Rename college' : 'Add college'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} disabled={(edit?.name.trim().length ?? 0) < 2} onClick={save}>Save</Button></>}>
        <Input label="Name" value={edit?.name ?? ''} onChange={(e) => setEdit({ ...edit!, name: e.target.value })} autoFocus />
      </Modal>
    </div>
  );
}
