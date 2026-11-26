'use client';
import { useState } from 'react';
import { Button, Card, Combobox, DataTable, EmptyState, ErrorState, InlineSelect, Input, Menu, Modal, PageHeader, Pagination, SearchInput, StatusBadge, TableSkeleton, useConfirm, useToast } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { api, errorMessage, qs } from '@/lib/api';
import { loadColleges } from '@/lib/options';
import type { Paged } from '@/components/manage/types';
interface College { _id: string; name: string; code?: string | null; aliases?: string[]; status: string; students: number; batches: number; mergedInto?: string | null }
interface CollegeEdit { id?: string; name: string; code: string; aliases: string }
const emptyEdit = (): CollegeEdit => ({ name: '', code: '', aliases: '' });
export default function Page() {
  const [u, setU] = useUrlState({ q: '', status: '', page: '1' });
  const page = Number(u.page) || 1;
  const dq = useDebounced(u.q);
  const list = useApi<Paged<College>>(`/colleges${qs({ q: dq, status: u.status, page })}`);
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<CollegeEdit | null>(null);
  const [merge, setMerge] = useState<{ source: College; targetId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const body = (e: CollegeEdit) => ({
    name: e.name.trim(), code: e.code.trim().toUpperCase(),
    aliases: e.aliases.split(',').map((a) => a.trim()).filter(Boolean),
  });
  const valid = !!edit && edit.name.trim().length >= 2 && /^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/.test(edit.code.trim());
  async function save() {
    setBusy(true);
    try {
      if (edit!.id) await api(`/colleges/${edit!.id}`, { method: 'PATCH', body: body(edit!) });
      else await api('/colleges', { method: 'POST', body: body(edit!) });
      toast.success(edit!.id ? 'College updated' : 'College added'); setEdit(null); void list.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function reconcile() {
    if (!merge || !merge.targetId) { toast.info('Select the college to keep.'); return; }
    setBusy(true);
    try {
      const preview = await api<{ source: string; target: string; students: number; batches: number; alreadyMerged: boolean }>(
        `/colleges/${merge.source._id}/reconcile`, { method: 'POST', body: { targetId: merge.targetId, dryRun: true } });
      if (preview.alreadyMerged) { toast.info('These colleges are already merged.'); return; }
      const ok = await confirm({
        title: `Merge ${preview.source} into ${preview.target}?`,
        body: `${preview.students} student${preview.students === 1 ? '' : 's'} and ${preview.batches} batch${preview.batches === 1 ? '' : 'es'} will move to ${preview.target}. The old record is archived and kept for history. This cannot be undone from this screen.`,
        confirmLabel: 'Merge colleges', danger: true,
      });
      if (!ok) return;
      await api(`/colleges/${merge.source._id}/reconcile`, { method: 'POST', body: { targetId: merge.targetId, dryRun: false } });
      toast.success('Colleges merged'); setMerge(null); void list.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function setStatus(c: College, status: 'ACTIVE' | 'ARCHIVED', undo = true) {
    if (status === 'ARCHIVED' && !(await confirm({ title: `Archive ${c.name}?`, body: 'Existing batches and students keep their college association. New selections will not offer this college.', confirmLabel: 'Archive' }))) return;
    try {
      await api(`/colleges/${c._id}`, { method: 'PATCH', body: { status } });
      if (status === 'ARCHIVED' && undo) toast.success('College archived', { action: { label: 'Undo', onClick: () => void setStatus(c, 'ACTIVE', false) } });
      else toast.success(status === 'ACTIVE' ? 'College restored' : 'College archived');
      void list.reload();
    } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <div>
      <PageHeader title="Colleges" subtitle="The official colleges students and batches can be associated with." actions={<Button onClick={() => setEdit(emptyEdit())}>Add college</Button>} />
      <Card flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5"><SearchInput value={u.q} onChange={(v) => setU({ q: v, page: '1' })} placeholder="Search by name, code or alias" label="Search colleges" />
          <InlineSelect label="Status" value={u.status} onChange={(status) => setU({ status, page: '1' })} options={[{ value: '', label: 'All statuses' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} />
        </div>
        {list.error ? <ErrorState message={list.error} retry={list.reload} /> : !list.data ? <TableSkeleton /> : (
          <>
            <DataTable rows={list.data.items} rowKey={(c) => c._id} caption="Colleges"
              empty={<EmptyState compact title="No colleges found" body={u.q ? 'Try a different name, code or alias.' : 'Add a college before students register.'} action={u.q ? undefined : <Button size="sm" onClick={() => setEdit(emptyEdit())}>Add college</Button>} />}
              columns={[
                { key: 'name', header: 'College', cell: (c) => <div className="min-w-0"><span className="font-medium">{c.name}</span>{c.code && <span className="ml-1.5 text-xs tabular-nums text-fg-subtle">[{c.code}]</span>}{!!c.aliases?.length && <span className="block truncate text-xs text-fg-subtle">Also known as {c.aliases.join(', ')}</span>}</div> },
                { key: 's', header: 'Students', cell: (c) => <span className="tabular-nums">{c.students}</span> },
                { key: 'b', header: 'Batches', cell: (c) => <span className="tabular-nums">{c.batches}</span> },
                { key: 'st', header: 'Status', cell: (c) => <StatusBadge status={c.mergedInto ? 'MERGED' : c.status} /> },
                { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (c) => (
                  <Menu label={`Actions for ${c.name}`} items={[
                    { label: 'Edit college', onSelect: () => setEdit({ id: c._id, name: c.name, code: c.code ?? '', aliases: (c.aliases ?? []).join(', ') }) },
                    ...(!c.mergedInto && c.status === 'ACTIVE' ? [{ label: 'Merge duplicate into…', onSelect: () => setMerge({ source: c, targetId: '' }) }] : []),
                    ...(!c.mergedInto ? [c.status === 'ACTIVE' ? { label: 'Archive', onSelect: () => void setStatus(c, 'ARCHIVED') } : { label: 'Restore', onSelect: () => void setStatus(c, 'ACTIVE') }] : []),
                  ]} />) },
              ]} />
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setU({ page: String(p) })} />
          </>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit college' : 'Add college'}
        description="The code and aliases help students find the same official college while searching."
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} disabled={!valid} onClick={save}>Save</Button></>}>
        <Input label="Official name" value={edit?.name ?? ''} onChange={(e) => setEdit({ ...edit!, name: e.target.value })} autoFocus maxLength={120} placeholder="Ace Engineering College" />
        <Input label="College code" value={edit?.code ?? ''} onChange={(e) => setEdit({ ...edit!, code: e.target.value.toUpperCase() })} maxLength={20} pattern="[A-Za-z0-9][A-Za-z0-9-]{1,19}" hint="2–20 letters, digits or hyphens. Examples: ACEEC, JNTU-H." placeholder="ACEEC" />
        <Input label="Aliases (optional)" value={edit?.aliases ?? ''} onChange={(e) => setEdit({ ...edit!, aliases: e.target.value })} hint="Comma-separated names students may search for, such as ACE or Ace Engineering College." placeholder="ACE, ACEEC" />
      </Modal>
      <Modal open={!!merge} onClose={() => setMerge(null)} title={merge ? `Merge ${merge.source.name}` : 'Merge college'}
        description="Move this duplicate's students and batches to the canonical college. Nothing is deleted."
        footer={<><Button variant="secondary" onClick={() => setMerge(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={!merge?.targetId} onClick={reconcile}>Review merge</Button></>}>
        <Combobox label="Keep this college" value={merge?.targetId ?? ''} load={loadColleges} labelHidden={false}
          onChange={(value) => setMerge((m) => m ? { ...m, targetId: value } : m)} placeholder="Search the canonical college" className="[&_input]:h-9" />
      </Modal>
    </div>
  );
}
