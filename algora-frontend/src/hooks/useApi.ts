'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, cachedApiValue, errorMessage } from '@/lib/api';

interface Result<T> { path: string; data: T | null; error: string | null; loading: boolean }

/** Keep cached content during a same-route refresh and isolate results by URL. */
export function useApi<T>(path: string | null) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const sequence = useRef(0);
  // Verify current chapter access and account state on every fresh visit.
  const cache = !!path && !path.startsWith('/student/');
  const reload = useCallback(async () => {
    if (!path) return;
    const id = ++sequence.current;
    setResult((previous) => ({
      path, data: previous?.path === path ? previous.data : (cache ? cachedApiValue<T>(path) ?? null : null), error: null, loading: true,
    }));
    try {
      const data = await api<T>(path, { cache });
      if (id === sequence.current) setResult({ path, data, error: null, loading: false });
    } catch (error) {
      if (id === sequence.current) setResult({ path, data: null, error: errorMessage(error), loading: false });
    }
  }, [path, cache]);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return invalidate;
  }, [reload, invalidate]);

  const setData = useCallback((data: T | null | ((old: T | null) => T | null)) => {
    if (!path) return;
    setResult((old) => ({ path, data: typeof data === 'function' ? (data as (old: T | null) => T | null)(old?.path === path ? old.data : null) : data, error: null, loading: false }));
  }, [path]);
  const current = result && result.path === path ? result : null;
  return { data: current ? current.data : (path && cache ? cachedApiValue<T>(path) ?? null : null), error: current?.error ?? null, loading: current?.loading ?? !!path, reload, setData };
}

/** Debounced value for search inputs. */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
