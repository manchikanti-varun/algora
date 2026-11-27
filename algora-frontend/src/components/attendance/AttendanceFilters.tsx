'use client';
import { CalendarDays, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, Combobox, DateInput, FilterChips, InlineSelect, Popover } from '@/components/ui';
import { datePreset, fmtAttendanceDateShort, sessionLabel } from '@/lib/attendance';
import { loadBatches, loadColleges } from '@/lib/options';

export interface AttendanceScope {
  batchId: string; collegeId: string; from: string; to: string; sessionType: string;
  /** Kept compatible with the URL state helper, which stores a flat string map. */
  [key: string]: string;
}

const PRESETS: { key: Parameters<typeof datePreset>[0]; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: 'thisWeek', label: 'This week' },
  { key: 'lastWeek', label: 'Last week' }, { key: 'thisMonth', label: 'This month' }, { key: 'lastMonth', label: 'Last month' },
];

/** Batch / college / session / date-range filters used across attendance pages. */
export function AttendanceScopeFilters({ value, onChange, onClear, lockBatch, extra }: {
  value: AttendanceScope; onChange: (patch: Partial<AttendanceScope>) => void; onClear: () => void;
  lockBatch?: boolean; extra?: ReactNode;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const remember = (id: string, label?: string) => { if (id && label) setNames((n) => ({ ...n, [id]: label })); };
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (value.batchId) chips.push({ key: 'batch', label: `Batch: ${names[value.batchId] ?? 'Selected batch'}`, onRemove: () => onChange({ batchId: '' }) });
  if (value.collegeId) chips.push({ key: 'college', label: `College: ${names[value.collegeId] ?? 'Selected college'}`, onRemove: () => onChange({ collegeId: '' }) });
  if (value.sessionType) chips.push({ key: 'type', label: sessionLabel(value.sessionType), onRemove: () => onChange({ sessionType: '' }) });
  if (value.from || value.to) {
    chips.push({
      key: 'date', onRemove: () => onChange({ from: '', to: '' }),
      label: value.from && value.to ? `${fmtAttendanceDateShort(value.from)} – ${fmtAttendanceDateShort(value.to)}` : value.from ? `From ${fmtAttendanceDateShort(value.from)}` : `Until ${fmtAttendanceDateShort(value.to)}`,
    });
  }
  return (
    <div className="space-y-2" role="search" aria-label="Attendance filters">
      <div className="flex flex-wrap items-center gap-2">
        <Combobox label="Batch" value={value.batchId} disabled={lockBatch} selectedLabel={names[value.batchId]} load={loadBatches} emptyLabel={lockBatch ? undefined : 'All batches'}
          onChange={(id, o) => { remember(id, o?.label); onChange({ batchId: id }); }} />
        <Combobox label="College" value={value.collegeId} selectedLabel={names[value.collegeId]} load={loadColleges} emptyLabel="All colleges"
          onChange={(id, o) => { remember(id, o?.label); onChange({ collegeId: id }); }} />
        <InlineSelect label="Session" value={value.sessionType} onChange={(sessionType) => onChange({ sessionType })}
          options={[{ value: '', label: 'All sessions' }, { value: 'MORNING', label: 'Morning' }, { value: 'AFTERNOON', label: 'Afternoon' }]} />
        <DateInput label="From" labelHidden={false} value={value.from} onChange={(from) => onChange({ from })} />
        <DateInput label="To" labelHidden={false} value={value.to} onChange={(to) => onChange({ to })} />
        <Popover label="Date presets" variant="secondary" align="start" button={<><CalendarDays size={15} aria-hidden />Presets</>}>
          <p className="mb-2 text-xs font-medium text-fg-subtle">Quick ranges</p>
          <ul className="space-y-1">
            {PRESETS.map((p) => (
              <li key={p.key}><button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-hover" onClick={() => onChange(datePreset(p.key))}>{p.label}</button></li>
            ))}
          </ul>
          {(value.from || value.to) && <Button className="mt-2" variant="ghost" size="xs" icon={<X size={13} aria-hidden />} onClick={() => onChange({ from: '', to: '' })}>Clear dates</Button>}
        </Popover>
        {extra}
      </div>
      <FilterChips chips={chips} onClear={onClear} />
    </div>
  );
}
