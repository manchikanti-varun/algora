'use client';
import { useState } from 'react';
import { Button, Card, Notice, PageHeader, useToast } from '@/components/ui';
import { emptyFilters, Filters, toQuery, type FilterState } from '@/components/manage/Filters';
import { download, errorMessage, qs } from '@/lib/api';

const REPORTS = [
  { type: 'student', title: 'Student report', body: 'One row per student and course: roll number, college, batch, difficulty breakdown, solved, completion, points, rank, last verification and LeetCode link status.' },
  { type: 'batch', title: 'Batch report', body: 'Per batch: status, dates, students, pending enrollments, active courses, average completion and verified completions.' },
  { type: 'course', title: 'Course report', body: 'Per course: student-course rows, average completion and students who completed all available problems.' },
  { type: 'chapter', title: 'Chapter report', body: 'Per unlocked chapter of each batch-course: problems, students who completed it and average completion.' },
  { type: 'problem', title: 'Problem report', body: 'Per unlocked problem of each batch-course: difficulty and how many students have verified it.' },
];
export default function Page() {
  const [f, setF] = useState<FilterState>(emptyFilters);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const go = async (type: string) => { setBusy(type); try { await download(`/reports/export${qs({ ...toQuery(f), type })}`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); } };
  return (
    <div>
      <PageHeader title="Reports" subtitle="CSV exports respect your access: trainers only export their batches. Contact details are never included." />
      <Filters value={f} onChange={setF} />
      <div className="mb-4"><Notice tone="info">Exports are recorded in the audit log. Values starting with =, +, - or @ are escaped so spreadsheets do not run them as formulas.</Notice></div>
      <div className="grid gap-4 md:grid-cols-2">
        {REPORTS.map((r) => (
          <Card key={r.type} title={r.title} actions={<Button size="sm" loading={busy === r.type} onClick={() => go(r.type)}>Download CSV</Button>}>
            <p className="text-sm text-slate-600">{r.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
