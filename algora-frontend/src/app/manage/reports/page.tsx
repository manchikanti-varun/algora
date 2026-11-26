'use client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, PageHeader, useToast } from '@/components/ui';
import { Filters, useFilterQuery, useFilterState } from '@/components/manage/Filters';
import { download, errorMessage, qs } from '@/lib/api';

const REPORTS = [
  { type: 'student', title: 'Student report', body: 'One row per student and course, with batch, difficulty counts, verified problems, completion, points, rank and LeetCode status.' },
  { type: 'batch', title: 'Batch report', body: 'Each batch with its dates, students, reserved enrollments, courses, average completion and verified problems.' },
  { type: 'course', title: 'Course report', body: 'Each course with its student rows, average completion and students who finished every available problem.' },
  { type: 'chapter', title: 'Chapter report', body: 'Each visible chapter of every course in a batch: problems, students who finished it and average completion.' },
  { type: 'problem', title: 'Problem report', body: 'Each visible problem of every course in a batch: difficulty and how many students have verified it.' },
];

export default function Page() {
  const { state, set, clearFilters } = useFilterState({});
  const query = useFilterQuery(state);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const go = async (type: string) => {
    setBusy(type);
    try { await download(`/reports/export${qs({ ...query, type })}`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="CSV exports for the batches you can access. Contact details are never included." />
      <Filters value={state} onChange={set} onClear={clearFilters} />
      <Card flush footer={<p className="text-xs text-fg-subtle">Exports are recorded in Audit Logs. Values starting with =, +, - or @ are escaped so spreadsheets do not run them as formulas.</p>}>
        <ul className="divide-y divide-line">
          {REPORTS.map((r) => (
            <li key={r.type} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <h2 className="text-sm font-semibold text-fg">{r.title}</h2>
                <p className="text-[13px] text-fg-muted">{r.body}</p>
              </div>
              <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden />} loading={busy === r.type} onClick={() => go(r.type)}>Download CSV</Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
