'use client';
import { useApi } from '@/hooks/useApi';
import { Button, InlineSelect, SearchInput } from '@/components/ui';
import type { Batch, Course, CourseDetail, Paged } from './types';

export interface FilterState {
  collegeId: string; batchId: string; courseId: string; chapterId: string; difficulty: string; verification: string; q: string; from: string; to: string; dateBasis: string; maxPct: string;
}
export const emptyFilters: FilterState = { collegeId: '', batchId: '', courseId: '', chapterId: '', difficulty: '', verification: '', q: '', from: '', to: '', dateBasis: 'verified', maxPct: '' };
export const toQuery = (f: FilterState) => ({ ...f, from: f.from ? new Date(f.from).toISOString() : '', to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : '', dateBasis: f.from || f.to ? f.dateBasis : '' });

/** Shared analytics/report filters. Options come from the API and are already scoped to what the user may see. */
export function Filters({ value, onChange, show = { q: true, college: true } }: { value: FilterState; onChange: (f: FilterState) => void; show?: { q?: boolean; college?: boolean } }) {
  const batches = useApi<Paged<Batch>>('/batches?pageSize=100');
  const courses = useApi<Paged<Course>>('/courses?pageSize=100');
  const colleges = useApi<Paged<{ _id: string; name: string }>>(show.college ? '/colleges?pageSize=100' : null);
  const course = useApi<CourseDetail>(value.courseId ? `/courses/${value.courseId}` : null);
  const set = (p: Partial<FilterState>) => onChange({ ...value, ...p });
  const dirty = JSON.stringify(value) !== JSON.stringify(emptyFilters);
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2" role="search">
      {show.q && <SearchInput value={value.q} onChange={(q) => set({ q })} placeholder="Name or roll number" />}
      {show.college && <InlineSelect label="College" value={value.collegeId} onChange={(collegeId) => set({ collegeId })} options={[{ value: '', label: 'All colleges' }, ...(colleges.data?.items ?? []).map((c) => ({ value: c._id, label: c.name }))]} />}
      <InlineSelect label="Batch" value={value.batchId} onChange={(batchId) => set({ batchId })} options={[{ value: '', label: 'All batches' }, ...(batches.data?.items ?? []).map((b) => ({ value: b._id, label: b.name }))]} />
      <InlineSelect label="Course" value={value.courseId} onChange={(courseId) => set({ courseId, chapterId: '' })} options={[{ value: '', label: 'All courses' }, ...(courses.data?.items ?? []).map((c) => ({ value: c._id, label: c.title }))]} />
      {value.courseId && <InlineSelect label="Chapter" value={value.chapterId} onChange={(chapterId) => set({ chapterId })} options={[{ value: '', label: 'All chapters' }, ...(course.data?.chapters ?? []).map((c) => ({ value: c._id, label: c.title }))]} />}
      <InlineSelect label="Difficulty" value={value.difficulty} onChange={(difficulty) => set({ difficulty })} options={[{ value: '', label: 'All difficulties' }, { value: 'EASY', label: 'Easy' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HARD', label: 'Hard' }]} />
      <InlineSelect label="LeetCode account" value={value.verification} onChange={(verification) => set({ verification })} options={[{ value: '', label: 'Any link status' }, { value: 'LINKED', label: 'Linked' }, { value: 'UNLINKED', label: 'Not linked' }]} />
      <InlineSelect label="Completion" value={value.maxPct} onChange={(maxPct) => set({ maxPct })} options={[{ value: '', label: 'Any completion' }, { value: '25', label: '≤ 25% (needs support)' }, { value: '50', label: '≤ 50%' }]} />
      <label className="text-xs text-slate-500">From<input type="date" aria-label="From date" value={value.from} onChange={(e) => set({ from: e.target.value })} className="ml-1 rounded-lg px-2 py-1.5 text-sm ring-1 ring-slate-300" /></label>
      <label className="text-xs text-slate-500">To<input type="date" aria-label="To date" value={value.to} onChange={(e) => set({ to: e.target.value })} className="ml-1 rounded-lg px-2 py-1.5 text-sm ring-1 ring-slate-300" /></label>
      {(value.from || value.to) && <InlineSelect label="Date basis" value={value.dateBasis} onChange={(dateBasis) => set({ dateBasis })} options={[{ value: 'verified', label: 'First verified in range' }, { value: 'submitted', label: 'Submission observed in range' }]} />}
      {dirty && <Button variant="ghost" size="sm" onClick={() => onChange(emptyFilters)}>Clear filters</Button>}
    </div>
  );
}
