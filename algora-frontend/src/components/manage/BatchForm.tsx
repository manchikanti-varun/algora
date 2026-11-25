'use client';
import { useState } from 'react';
import { Button, Input, Notice, Select, Textarea } from '@/components/ui';
import type { Batch } from './types';

const d = (s?: string) => (s ? s.slice(0, 10) : '');
export function BatchForm({ initial, onSubmit, submitLabel }: { initial?: Batch; onSubmit: (b: Record<string, unknown>) => Promise<void>; submitLabel: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(undefined);
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (f.startDate && f.endDate && f.endDate < f.startDate) return setErr('End date must not be before start date');
    const body: Record<string, unknown> = { name: f.name, description: f.description, status: f.status };
    if (f.college) body.college = f.college;
    if (f.startDate) body.startDate = f.startDate;
    if (f.endDate) body.endDate = f.endDate;
    setBusy(true);
    try { await onSubmit(body); } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Failed'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {err && <Notice tone="error">{err}</Notice>}
      <Input label="Name" name="name" required maxLength={120} defaultValue={initial?.name} placeholder="JNTU Java Bootcamp – Jan 2026" />
      <Textarea label="Description" name="description" maxLength={2000} defaultValue={initial?.description} />
      <Input label="College (optional)" name="college" defaultValue={initial?.college ?? ''} hint="Matched case-insensitively to an existing college, or created." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Start date" name="startDate" type="date" defaultValue={d(initial?.startDate)} />
        <Input label="End date" name="endDate" type="date" defaultValue={d(initial?.endDate)} />
      </div>
      <Select label="Status" name="status" defaultValue={initial?.status ?? 'DRAFT'} options={['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} />
      <p className="text-xs text-slate-500">Only ACTIVE batches are shown to students and included in automatic synchronization. ARCHIVED batches are read-only.</p>
      <Button loading={busy} type="submit">{submitLabel}</Button>
    </form>
  );
}
