'use client';
import { InlineSelect } from '@/components/ui';
import type { Ctx } from './types';
/** Course and batch choice. Only shown when the student has two or more. */
export function ContextPicker({ contexts, value, onChange }: { contexts: Ctx[]; value: string | undefined; onChange: (v: string) => void }) {
  if (contexts.length < 2) return null;
  return <InlineSelect label="Course and batch" value={value ?? ''} onChange={onChange} options={contexts.map((c) => ({ value: c.batchCourseId, label: `${c.courseTitle} · ${c.batchName}` }))} />;
}
