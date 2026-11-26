'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/**
 * Page state kept in the URL query string (filters, tabs, sort, page), so reload, Back/Forward and shared links keep context.
 * Defaults are omitted from the URL. Requires a <Suspense> boundary above (both shells provide one).
 */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void, () => void] {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const key = JSON.stringify(defaults);
  const state = useMemo(() => {
    const d = JSON.parse(key) as T;
    return Object.fromEntries(Object.keys(d).map((k) => [k, params.get(k) ?? d[k]])) as T;
  }, [params, key]);
  const set = useCallback((patch: Partial<T>) => {
    const d = JSON.parse(key) as T;
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '' || v === d[k]) next.delete(k); else next.set(k, String(v)); }
    const s = next.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
  }, [params, router, path, key]);
  const reset = useCallback(() => {
    const d = JSON.parse(key) as T; const next = new URLSearchParams(params.toString());
    for (const k of Object.keys(d)) next.delete(k);
    const s = next.toString(); router.replace(s ? `${path}?${s}` : path, { scroll: false });
  }, [params, router, path, key]);
  return [state, set, reset];
}
