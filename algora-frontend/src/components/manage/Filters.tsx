'use client';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Combobox, DateInput, FilterChips, InlineSelect, Popover, SearchInput, type Option } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { loadBatches, loadColleges, loadCourses } from '@/lib/options';
import type { CourseDetail } from './types';

export interface FilterState {
  collegeId: string; batchId: string; courseId: string; chapterId: string; difficulty: string; verification: string; q: string; from: string; to: string; dateBasis: string; maxPct: string;
}
export const emptyFilters: FilterState = { collegeId: '', batchId: '', courseId: '', chapterId: '', difficulty: '', verification: '', q: '', from: '', to: '', dateBasis: 'verified', maxPct: '' };
const FILTER_KEYS = Object.keys(emptyFilters) as (keyof FilterState)[];

/** Filters plus page-specific keys (tab, sort, page...) in the URL. Changing a filter resets `page` when the page has one. */
export function useFilterState<E extends Record<string, string>>(extra: E) {
  const [state, setState, resetState] = useUrlState<FilterState & E>({ ...emptyFilters, ...extra });
  const set = (patch: Partial<FilterState & E>) => {
    const touchesFilter = FILTER_KEYS.some((k) => k in patch);
    setState(touchesFilter && 'page' in extra && !('page' in patch) ? ({ ...patch, page: '' } as Partial<FilterState & E>) : patch);
  };
  const clearFilters = () => setState({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])), ...('page' in extra ? { page: '' } : {}) } as Partial<FilterState & E>);
  return { state, set, clearFilters, reset: resetState };
}

/** API query object. `from` is the start of the day, `to` the end of the day; dateBasis only applies with a date. */
export const toQuery = (f: FilterState) => ({
  collegeId: f.collegeId, batchId: f.batchId, courseId: f.courseId, chapterId: f.chapterId, difficulty: f.difficulty, verification: f.verification, q: f.q, maxPct: f.maxPct,
  from: f.from ? new Date(f.from).toISOString() : '',
  to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : '',
  dateBasis: f.from || f.to ? f.dateBasis : '',
});
/** Memoised query object (stable while the filters do not change). */
export function useFilterQuery(f: FilterState) {
  const { collegeId, batchId, courseId, chapterId, difficulty, verification, q, maxPct, from, to, dateBasis } = f;
  return useMemo(() => toQuery({ collegeId, batchId, courseId, chapterId, difficulty, verification, q, maxPct, from, to, dateBasis }), [collegeId, batchId, courseId, chapterId, difficulty, verification, q, maxPct, from, to, dateBasis]);
}

/** Text typed by the user, written to the URL after a short pause. Returns [text to show, onChange]. */
export function useDebouncedUrlText(value: string, commit: (v: string) => void, ms = 300): [string, (v: string) => void] {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    if (draft === null) return;
    if (draft === value) { const t0 = setTimeout(() => setDraft(null), 0); return () => clearTimeout(t0); }
    const t = setTimeout(() => commit(draft), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value, ms]);
  return [draft ?? value, setDraft];
}

const DIFFICULTY = [{ value: '', label: 'All difficulties' }, { value: 'EASY', label: 'Easy' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HARD', label: 'Hard' }];
const VERIFICATION = [{ value: '', label: 'Any' }, { value: 'LINKED', label: 'Connected' }, { value: 'UNLINKED', label: 'Not connected' }];
const COMPLETION = [{ value: '', label: 'Any' }, { value: '25', label: '25% or less' }, { value: '50', label: '50% or less' }];
const BASIS = [{ value: 'verified', label: 'First verified in range' }, { value: 'submitted', label: 'Accepted submission seen in range' }];
const label = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
const dateText = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Shared analytics/report filters. Options are searched on the server and scoped to what the user may see.
 * Pass the object from `useFilterState`.
 */
export function Filters({ value, onChange, onClear, show = { q: true, college: true } }: {
  value: FilterState; onChange: (patch: Partial<FilterState>) => void; onClear: () => void; show?: { q?: boolean; college?: boolean };
}) {
  const course = useApi<CourseDetail>(value.courseId ? `/courses/${value.courseId}` : null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [text, setText] = useDebouncedUrlText(value.q, (q) => onChange({ q }));
  const remember = (o?: Option) => { if (o) setNames((n) => ({ ...n, [o.value]: o.label })); };
  const nm = (id: string, fallback: string) => names[id] ?? fallback;
  const chapterName = course.data?.chapters.find((c) => c._id === value.chapterId)?.title ?? 'Chapter';
  const hasDate = !!(value.from || value.to);
  const moreCount = [show.college && value.collegeId, value.chapterId, value.difficulty, value.verification, value.maxPct, value.from, value.to].filter(Boolean).length;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (show.q && value.q) chips.push({ key: 'q', label: `Search: ${value.q}`, onRemove: () => onChange({ q: '' }) });
  if (value.batchId) chips.push({ key: 'batchId', label: `Batch: ${nm(value.batchId, 'Selected batch')}`, onRemove: () => onChange({ batchId: '' }) });
  if (value.courseId) chips.push({ key: 'courseId', label: `Course: ${nm(value.courseId, course.data?.title ?? 'Selected course')}`, onRemove: () => onChange({ courseId: '', chapterId: '' }) });
  if (show.college && value.collegeId) chips.push({ key: 'collegeId', label: `College: ${nm(value.collegeId, 'Selected college')}`, onRemove: () => onChange({ collegeId: '' }) });
  if (value.chapterId) chips.push({ key: 'chapterId', label: `Chapter: ${chapterName}`, onRemove: () => onChange({ chapterId: '' }) });
  if (value.difficulty) chips.push({ key: 'difficulty', label: `Difficulty: ${label(DIFFICULTY, value.difficulty)}`, onRemove: () => onChange({ difficulty: '' }) });
  if (value.verification) chips.push({ key: 'verification', label: `LeetCode: ${label(VERIFICATION, value.verification)}`, onRemove: () => onChange({ verification: '' }) });
  if (value.maxPct) chips.push({ key: 'maxPct', label: `Completion: ${label(COMPLETION, value.maxPct)}`, onRemove: () => onChange({ maxPct: '' }) });
  if (hasDate) chips.push({
    key: 'date', onRemove: () => onChange({ from: '', to: '', dateBasis: '' }),
    label: `${value.from && value.to ? `${dateText(value.from)} to ${dateText(value.to)}` : value.from ? `From ${dateText(value.from)}` : `Until ${dateText(value.to)}`} (${label(BASIS, value.dateBasis).toLowerCase()})`,
  });

  return (
    <div className="space-y-2" role="search" aria-label="Filters">
      <div className="flex flex-wrap items-center gap-2">
        {show.q && <SearchInput value={text} onChange={setText} placeholder="Name or roll number" label="Name or roll number" />}
        <Combobox label="Batch" value={value.batchId} onChange={(batchId, o) => { remember(o); onChange({ batchId }); }} load={loadBatches} emptyLabel="All batches" />
        <Combobox label="Course" value={value.courseId} onChange={(courseId, o) => { remember(o); onChange({ courseId, chapterId: '' }); }} load={loadCourses} emptyLabel="All courses" />
        <Popover label="More filters" variant="secondary" align="start" button={<><SlidersHorizontal size={15} aria-hidden />More filters{moreCount > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-xs tabular-nums text-accent-fg">{moreCount}</span>}</>}>
          <div className="space-y-3">
            {show.college && <Combobox label="College" labelHidden={false} value={value.collegeId} onChange={(collegeId, o) => { remember(o); onChange({ collegeId }); }} load={loadColleges} emptyLabel="All colleges" className="[&_input]:w-full" />}
            {value.courseId && (
              <Field label="Chapter">
                <InlineSelect label="Chapter" className="w-full" value={value.chapterId} onChange={(chapterId) => onChange({ chapterId })}
                  options={[{ value: '', label: 'All chapters' }, ...(course.data?.chapters ?? []).map((c) => ({ value: c._id, label: c.title }))]} />
              </Field>
            )}
            <Field label="Difficulty"><InlineSelect label="Difficulty" className="w-full" value={value.difficulty} onChange={(difficulty) => onChange({ difficulty })} options={DIFFICULTY} /></Field>
            <Field label="LeetCode account"><InlineSelect label="LeetCode account" className="w-full" value={value.verification} onChange={(verification) => onChange({ verification })} options={VERIFICATION} /></Field>
            <Field label="Completion"><InlineSelect label="Completion" className="w-full" value={value.maxPct} onChange={(maxPct) => onChange({ maxPct })} options={COMPLETION} /></Field>
            <div className="flex flex-wrap gap-3">
              <DateInput label="From" labelHidden={false} value={value.from} onChange={(from) => onChange({ from })} />
              <DateInput label="To" labelHidden={false} value={value.to} onChange={(to) => onChange({ to })} />
            </div>
            {hasDate && <Field label="Date basis"><InlineSelect label="Date basis" className="w-full" value={value.dateBasis} onChange={(dateBasis) => onChange({ dateBasis })} options={BASIS} /></Field>}
          </div>
        </Popover>
      </div>
      <FilterChips chips={chips} onClear={onClear} />
    </div>
  );
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="mb-1 text-xs font-medium text-fg-muted" aria-hidden>{text}</p>{children}</div>;
}
