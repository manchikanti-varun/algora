import type { Option } from '@/components/ui';
import { api, qs } from './api';
/**
 * Stable loaders for <Combobox load={...}>. They search on the server, so lists are never cut off at a page size.
 * Module-level functions keep their identity, which the Combobox relies on. Reads use the API's short-lived cache
 * (cleared automatically after any write), so reopening a selector does not repeat the same request.
 */
type Paged<T> = { items: T[] };
const read = { cache: true } as const;
const dates = (a?: string, b?: string) => {
  if (!a || !b) return undefined;
  const f = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${f(a)}–${f(b)}`;
};
export const loadBatches = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; name: string; college?: string | null; collegeCode?: string | null; startDate?: string; endDate?: string; status: string }>>(`/batches${qs({ q, pageSize: 25 })}`, read)).items
    .map((b) => ({
      value: b._id,
      // The label is always the batch name. College and dates are secondary context, never a substitute for the name.
      label: b.name,
      detail: b.status === 'ACTIVE'
        ? [b.college ? `${b.college}${b.collegeCode ? ` [${b.collegeCode}]` : ''}` : '', dates(b.startDate, b.endDate)].filter(Boolean).join(' · ') || undefined
        : b.status[0] + b.status.slice(1).toLowerCase(),
    }));
export const loadCourses = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; title: string; status: string }>>(`/courses${qs({ q, pageSize: 25 })}`, read)).items
    .map((c) => ({ value: c._id, label: c.title, detail: c.status === 'PUBLISHED' ? undefined : c.status[0] + c.status.slice(1).toLowerCase() }));
export const loadPublishedCourses = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; title: string; chapterCount?: number }>>(`/courses${qs({ q, status: 'PUBLISHED', pageSize: 25 })}`, read)).items
    .map((c) => ({ value: c._id, label: c.title, detail: c.chapterCount !== undefined ? `${c.chapterCount} chapters` : undefined }));
export const loadColleges = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; name: string; code?: string | null }>>(`/colleges${qs({ q, pageSize: 25 })}`, read)).items
    .map((c) => ({ value: c._id, label: c.code ? `${c.name} [${c.code}]` : c.name }));
export const loadActiveColleges = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; name: string; code?: string | null }>>(`/colleges${qs({ q, status: 'ACTIVE', pageSize: 25 })}`, read)).items
    .map((c) => ({ value: c._id, label: c.code ? `${c.name} [${c.code}]` : c.name }));

export const loadStudents = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; fullName: string; rollNumber: string }>>(`/students${qs({ q, pageSize: 25 })}`, read)).items
    .map((s) => ({ value: s._id, label: s.fullName, detail: s.rollNumber }));

/** Canonical colleges from the public registry endpoint, used before a session exists (registration, access requests). */
export const loadPublicColleges = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; name: string; code?: string }>>(`/auth/colleges${qs({ q })}`, read)).items
    .map((c) => ({ value: c._id, label: c.name, detail: c.code }));
