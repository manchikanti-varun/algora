'use client';
import { useCallback, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { useSync } from './SyncProvider';
import type { Dashboard } from './types';
const KEY = 'algora.batchCourseId';
/** Selected course-and-batch, remembered across pages. */
export function useContextChoice() {
  const [id, setId] = useState<string | null>(() => (typeof window === 'undefined' ? null : localStorage.getItem(KEY)));
  const choose = useCallback((v: string) => { localStorage.setItem(KEY, v); setId(v); }, []);
  return [id, choose] as const;
}
/**
 * The student's dashboard for the remembered course. One request in the normal case; if the API rejects the saved
 * choice (for example access was removed) it falls back to the default course. Reloads when a progress update finishes.
 */
export function useStudentDashboard() {
  const [choice, choose] = useContextChoice();
  const { version } = useSync();
  const first = useApi<Dashboard>(`/student/dashboard${qs({ batchCourseId: choice ?? undefined, v: version })}`);
  const retry = !!choice && !!first.error;
  const fallback = useApi<Dashboard>(retry ? `/student/dashboard${qs({ v: version })}` : null);
  const src = retry ? fallback : first;
  const reload = () => { void first.reload(); if (retry) void fallback.reload(); };
  return { data: src.data, error: src.error, loading: src.loading, reload, selectedId: src.data?.selected?.batchCourseId, choose };
}
