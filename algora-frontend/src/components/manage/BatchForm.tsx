'use client';
import { useState } from 'react';
import { Button, Combobox, Input, Notice, Select, Textarea } from '@/components/ui';
import { loadActiveColleges } from '@/lib/options';
import type { Batch } from './types';

const d = (s?: string) => (s ? s.slice(0, 10) : '');

export function BatchForm({ initial, onSubmit, submitLabel }: { initial?: Batch; onSubmit: (b: Record<string, unknown>) => Promise<void>; submitLabel: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const [collegeId, setCollegeId] = useState(initial?.collegeId ?? '');
  const [start, setStart] = useState(d(initial?.startDate)); const [end, setEnd] = useState(d(initial?.endDate));
  const dateError = start && end && end < start ? 'End date must not be before the start date.' : undefined;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(undefined);
    if (dateError) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body: Record<string, unknown> = { name: f.name, description: f.description, status: f.status };
    if (collegeId) body.collegeId = collegeId;
    else if (initial?.collegeId) body.collegeId = null;
    if (f.startDate) body.startDate = f.startDate;
    if (f.endDate) body.endDate = f.endDate;
    setBusy(true);
    try { await onSubmit(body); } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Something went wrong. Please try again.'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      {err && <Notice tone="error">{err}</Notice>}
      <fieldset className="space-y-4">
        <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Details</legend>
        <Input label="Name" name="name" required maxLength={120} defaultValue={initial?.name} placeholder="JNTU Java Bootcamp – Jan 2026" />
        <Textarea label="Description (optional)" name="description" maxLength={2000} defaultValue={initial?.description} />
        <Combobox label="College (optional)" labelHidden={false} value={collegeId} selectedLabel={initial?.college ?? undefined} onChange={setCollegeId}
          load={loadActiveColleges} loadOnFocus emptyLabel="No college" hint="Search by name or code. Ask a Super Admin if your college is missing." />
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Schedule and visibility</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Start date" name="startDate" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="End date" name="endDate" type="date" value={end} onChange={(e) => setEnd(e.target.value)} error={dateError} />
        </div>
        <Select label="Status" name="status" defaultValue={initial?.status ?? 'DRAFT'} options={['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))}
          hint="Students see only Active batches. Archived batches are read-only." />
      </fieldset>
      <Button loading={busy} type="submit">{submitLabel}</Button>
    </form>
  );
}
