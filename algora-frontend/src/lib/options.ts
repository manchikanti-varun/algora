import type { Option } from '@/components/ui';
import { api, qs } from './api';
/**
 * Stable loaders for <Combobox load={...}>. They search on the server, so lists are never cut off at a page size.
 * Module-level functions keep their identity, which the Combobox relies on.
 */
type Paged<T> = { items: T[] };
export const loadBatches = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; name: string; college?: string | null; status: string }>>(`/batches${qs({ q, pageSize: 25 })}`)).items
    .map((b) => ({ value: b._id, label: b.name, detail: b.status === 'ACTIVE' ? b.college ?? undefined : b.status[0] + b.status.slice(1).toLowerCase() }));
export const loadCourses = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; title: string; status: string }>>(`/courses${qs({ q, pageSize: 25 })}`)).items
    .map((c) => ({ value: c._id, label: c.title, detail: c.status === 'PUBLISHED' ? undefined : c.status[0] + c.status.slice(1).toLowerCase() }));
export const loadPublishedCourses = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; title: string; chapterCount?: number }>>(`/courses${qs({ q, status: 'PUBLISHED', pageSize: 25 })}`)).items
    .map((c) => ({ value: c._id, label: c.title, detail: c.chapterCount !== undefined ? `${c.chapterCount} chapters` : undefined }));
export const loadColleges = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; name: string; code?: string | null }>>(`/colleges${qs({ q, pageSize: 25 })}`)).items
    .map((c) => ({ value: c._id, label: c.code ? `${c.name} [${c.code}]` : c.name }));
export const loadActiveColleges = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; name: string; code?: string | null }>>(`/colleges${qs({ q, status: 'ACTIVE', pageSize: 25 })}`)).items
    .map((c) => ({ value: c._id, label: c.code ? `${c.name} [${c.code}]` : c.name }));

/** Canonical colleges from the public registry endpoint, used before a session exists (registration, access requests). */
export const loadPublicColleges = async (q: string): Promise<Option[]> =>
  (await api<Paged<{ _id: string; name: string; code?: string }>>(`/auth/colleges${qs({ q })}`)).items
    .map((c) => ({ value: c._id, label: c.name, detail: c.code }));
