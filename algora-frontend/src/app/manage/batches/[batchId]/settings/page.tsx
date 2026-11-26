'use client';
import { useState } from 'react';
import { Button, Card, Combobox, EmptyState, useConfirm, usePageTitle, useToast } from '@/components/ui';
import { BatchForm } from '@/components/manage/BatchForm';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import type { Paged } from '@/components/manage/types';

export default function Page() {
  const { batch, reload } = useBatch();
  usePageTitle(`Settings · ${batch.name}`);
  const { user } = useAuth();
  const toast = useToast(); const confirm = useConfirm();
  const admin = isAdmin(user);
  const trainers = useApi<Paged<{ _id: string; fullName: string; trainerId: string; status: string }>>(admin ? '/trainers?pageSize=100' : null);
  const [pick, setPick] = useState('');
  const assigned = new Set((batch.trainers ?? []).map((t) => t._id));
  const options = (trainers.data?.items ?? []).filter((t) => t.status === 'ACTIVE' && !assigned.has(t._id)).map((t) => ({ value: t._id, label: t.fullName, detail: t.trainerId }));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Batch details">
        <BatchForm key={JSON.stringify(batch)} initial={batch} submitLabel="Save changes" onSubmit={async (b) => {
          if (b.status === 'ARCHIVED' && batch.status !== 'ARCHIVED' && !(await confirm({ title: 'Archive this batch?', body: 'Archived batches are read-only and hidden from students. Data is kept.', confirmLabel: 'Archive', danger: true }))) return;
          try { await api(`/batches/${batch._id}`, { method: 'PATCH', body: b }); toast.success('Batch updated'); await reload(); } catch (e) { throw new Error(errorMessage(e)); }
        }} />
      </Card>
      <Card title="Trainers" description={admin ? undefined : 'Only the Super Admin can change trainer assignments.'}>
        {(batch.trainers ?? []).length ? (
          <ul className="mb-4 divide-y divide-line text-sm">{batch.trainers!.map((t) => (
            <li key={t._id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate text-fg">{t.fullName} <span className="ml-1 text-xs text-fg-subtle">{t.trainerId}</span></span>
              {admin && <Button size="sm" variant="ghost" onClick={async () => {
                if (await confirm({ title: `Remove ${t.fullName} from this batch?`, confirmLabel: 'Remove', danger: true })) {
                  try { await api(`/batches/${batch._id}/trainers/${t._id}`, { method: 'DELETE' }); toast.success('Trainer removed'); reload(); } catch (e) { toast.error(errorMessage(e)); }
                }
              }}>Remove</Button>}
            </li>))}</ul>
        ) : <div className="mb-4"><EmptyState compact title="No trainers assigned" /></div>}
        {admin && (
          <div className="flex flex-wrap items-start gap-2">
            <div className="w-full sm:w-64"><Combobox label="Trainer to assign" value={pick} onChange={setPick} options={options} placeholder="Select a trainer…" /></div>
            <Button disabled={!pick} onClick={async () => { try { await api(`/batches/${batch._id}/trainers`, { method: 'POST', body: { trainerId: pick } }); toast.success('Trainer assigned'); setPick(''); reload(); } catch (e) { toast.error(errorMessage(e)); } }}>Assign</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
