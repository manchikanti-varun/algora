'use client';
import Link from 'next/link';
import { useState } from 'react';
import { BarList, Button, Card, DataTable, ErrorState, Grid, PageHeader, Pagination, ProgressBar, StatCard, StatusBadge, TableSkeleton, Tabs, timeAgo, useToast, DifficultyBadge, EmptyState } from '@/components/ui';
import { emptyFilters, Filters, toQuery, type FilterState } from '@/components/manage/Filters';
import { useApi, useDebounced } from '@/hooks/useApi';
import { download, errorMessage, qs } from '@/lib/api';
import type { Overview, Paged, PerfRow } from '@/components/manage/types';

export default function Page() {
  const [f, setF] = useState<FilterState>(emptyFilters);
  const df = useDebounced(f, 350);
  const [tab, setTab] = useState('students');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'points', dir: 'desc' });
  const q = toQuery(df);
  const o = useApi<Overview>(`/analytics/overview${qs(q)}`);
  const rows = useApi<Paged<PerfRow>>(tab === 'students' ? `/analytics/students${qs({ ...q, page, sort: sort.key, dir: sort.dir })}` : null);
  const chapters = useApi<{ items: { batchCourseId: string; batch: string; course: string; chapter: string; problems: number; students: number; completedStudents: number; avgCompletionPct: number | null }[] }>(tab === 'chapters' ? `/analytics/chapters${qs(q)}` : null);
  const problems = useApi<{ items: { batch: string; course: string; chapter: string; problem: string; slug: string; difficulty: string; students: number; verifiedSolved: number; solvedPct: number | null }[] }>(tab === 'problems' ? `/analytics/problems${qs(q)}` : null);
  const toast = useToast();
  const onSort = (key: string) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const exp = (type: string) => download(`/reports/export${qs({ ...q, type })}`).catch((e) => toast.error(errorMessage(e)));
  const t = o.data?.totals;
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Computed from verified evidence and current chapter visibility." actions={<Button variant="secondary" onClick={() => exp(tab === 'chapters' ? 'chapter' : tab === 'problems' ? 'problem' : 'student')}>Export CSV</Button>} />
      <Filters value={f} onChange={(v) => { setF(v); setPage(1); }} />
      {o.error ? <ErrorState message={o.error} retry={o.reload} /> : t && (
        <Grid>
          <StatCard label="Students in scope" value={o.data!.verification.studentsInScope} hint={`${t.activeStudents7d} active in 7 days`} />
          <StatCard label="Average completion" value={t.avgCompletionPct === null ? '—' : `${t.avgCompletionPct}%`} />
          <StatCard label="Verified completions" value={t.verifiedCompletions} tone="good" />
          <StatCard label="Verification coverage" value={o.data!.verification.coveragePct === null ? '—' : `${o.data!.verification.coveragePct}%`} hint="Students with a verified LeetCode account" tone={o.data!.verification.coveragePct === 100 ? 'good' : 'warn'} />
        </Grid>
      )}
      {o.data && <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Course completion"><BarList items={o.data.courseCompletion.map((c) => ({ label: c.title, value: c.avgCompletionPct, sub: `${c.completed} completed` }))} max={100} format={(n) => `${n}%`} /></Card>
        <Card title="Batch comparison"><BarList items={o.data.batchComparison.map((b) => ({ label: b.name, value: b.avgCompletionPct, sub: `${b.students} students` }))} max={100} format={(n) => `${n}%`} /></Card>
      </div>}
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'students', label: 'Students' }, { key: 'chapters', label: 'Chapters' }, { key: 'problems', label: 'Problems' }]} />
      {tab === 'students' && <Card>
        {rows.error ? <ErrorState message={rows.error} retry={rows.reload} /> : !rows.data ? <TableSkeleton rows={8} /> : (
          <>
            <DataTable rows={rows.data.items} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} sort={sort} onSort={onSort} empty={<EmptyState title="No matching students" />} columns={[
              { key: 'rollNumber', header: 'Roll number', sortable: true, cell: (r) => <code className="text-xs">{r.rollNumber}</code> },
              { key: 'name', header: 'Student', sortable: true, cell: (r) => <Link className="font-medium text-indigo-700 hover:underline" href={`/manage/students/${r.studentId}`}>{r.name}</Link> },
              { key: 'college', header: 'College', cell: (r) => r.college ?? '—' },
              { key: 'batch', header: 'Batch', cell: (r) => r.batch }, { key: 'course', header: 'Course', cell: (r) => r.course },
              { key: 'e', header: 'E', cell: (r) => r.easy }, { key: 'm', header: 'M', cell: (r) => r.medium }, { key: 'h', header: 'H', cell: (r) => r.hard },
              { key: 'solved', header: 'Solved', sortable: true, cell: (r) => `${r.solved}/${r.accessible}` },
              { key: 'completionPct', header: 'Completion', sortable: true, className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" /> },
              { key: 'points', header: 'Points', sortable: true, cell: (r) => <strong>{r.points}</strong> },
              { key: 'rank', header: 'Rank', cell: (r) => `#${r.rank}` },
              { key: 'lastVerifiedAt', header: 'Last verified', sortable: true, cell: (r) => timeAgo(r.lastVerifiedAt) },
              { key: 'link', header: 'LeetCode', cell: (r) => <StatusBadge status={r.linkState} /> },
            ]} />
            <Pagination page={page} pageSize={rows.data.pageSize} total={rows.data.total} onPage={setPage} />
          </>
        )}
      </Card>}
      {tab === 'chapters' && <Card>
        {chapters.error ? <ErrorState message={chapters.error} retry={chapters.reload} /> : !chapters.data ? <TableSkeleton /> : (
          <DataTable rows={chapters.data.items} rowKey={(c) => `${c.batchCourseId}-${c.chapter}`} empty={<EmptyState title="No unlocked chapters in scope" />} columns={[
            { key: 'b', header: 'Batch', cell: (c) => c.batch }, { key: 'c', header: 'Course', cell: (c) => c.course }, { key: 'ch', header: 'Chapter', cell: (c) => <span className="font-medium">{c.chapter}</span> },
            { key: 'p', header: 'Problems', cell: (c) => c.problems }, { key: 'd', header: 'Completed', cell: (c) => `${c.completedStudents} / ${c.students}` },
            { key: 'a', header: 'Average completion', className: 'min-w-44', cell: (c) => <ProgressBar value={c.avgCompletionPct} size="sm" /> },
          ]} />)}
      </Card>}
      {tab === 'problems' && <Card>
        {problems.error ? <ErrorState message={problems.error} retry={problems.reload} /> : !problems.data ? <TableSkeleton /> : (
          <DataTable rows={problems.data.items} rowKey={(p) => `${p.batch}-${p.course}-${p.chapter}-${p.slug}`} empty={<EmptyState title="No unlocked problems in scope" />} columns={[
            { key: 'b', header: 'Batch', cell: (p) => p.batch }, { key: 'ch', header: 'Chapter', cell: (p) => p.chapter },
            { key: 'p', header: 'Problem', cell: (p) => <a className="text-indigo-700 hover:underline" href={`https://leetcode.com/problems/${p.slug}/`} target="_blank" rel="noopener noreferrer">{p.problem}</a> },
            { key: 'd', header: 'Difficulty', cell: (p) => <DifficultyBadge d={p.difficulty} /> },
            { key: 's', header: 'Verified', cell: (p) => `${p.verifiedSolved} / ${p.students}` },
            { key: 'pct', header: 'Solved', className: 'min-w-40', cell: (p) => <ProgressBar value={p.solvedPct} size="sm" /> },
          ]} />)}
      </Card>}
    </div>
  );
}
