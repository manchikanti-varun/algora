'use client';
import { useCallback, useState } from 'react';
const KEY = 'algora.batchCourseId';
/** Selected batch-course context, remembered across pages. Validated against what the API returns. */
export function useContextChoice() {
  const [id, setId] = useState<string | null>(() => (typeof window === 'undefined' ? null : localStorage.getItem(KEY)));
  const choose = useCallback((v: string) => { localStorage.setItem(KEY, v); setId(v); }, []);
  return [id, choose] as const;
}
