'use client';
import { InlineSelect } from '@/components/ui';
import type { Ctx } from './types';
export function ContextPicker({ contexts, value, onChange }: { contexts: Ctx[]; value: string | undefined; onChange: (v: string) => void }) {
  if (contexts.length < 2) return null;
  return <InlineSelect label="Course" value={value ?? ''} onChange={onChange} options={contexts.map((c) => ({ value: c.batchCourseId, label: `${c.courseTitle} · ${c.batchName}` }))} />;
}
