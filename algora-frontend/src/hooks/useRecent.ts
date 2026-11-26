'use client';
import { useEffect } from 'react';
const KEY = 'algora.recent';
export interface RecentItem { href: string; label: string; kind: string; at: number }
/** Recently visited records (batches, courses, students) for the command palette. Stored locally, newest first, max 8. */
export function readRecent(): RecentItem[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecentItem[]).slice(0, 8); } catch { return []; }
}
export function useTrackRecent(item: { href: string; label: string; kind: string } | null) {
  const href = item?.href, label = item?.label, kind = item?.kind;
  useEffect(() => {
    if (!href || !label || !kind) return;
    try {
      const list = readRecent().filter((r) => r.href !== href);
      localStorage.setItem(KEY, JSON.stringify([{ href, label, kind, at: Date.now() }, ...list].slice(0, 8)));
    } catch { /* storage unavailable: recent list is optional */ }
  }, [href, label, kind]);
}
