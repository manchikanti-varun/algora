'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { BarList, Button, Card, DataTable, DifficultyBadge, EmptyState, ErrorState, Grid, PageHeader, Pagination, ProgressBar, StatCard, StatusBadge, TableSkeleton, Tabs, timeAgo, useToast } from '@/components/ui';
import { Filters, useFilterQuery, useFilterState } from '@/components/manage/Filters';
import type { Overview, Paged, PerfRow } from '@/components/manage/types';
import { useApi } from '@/hooks/useApi';
import { download, errorMessage, qs } from '@/lib/api';

// Sort keys the API accepts for /analytics/students.
const SORT_KEYS = ['points', 'solved', 'completionPct', 'name', 'rollNumber', 'lastVerifiedAt', 'lastSyncAt'];
const EXPORT_TYPE: Record<string, string> = { students: 'student', chapters: 'chapter', problems: 'problem' };

export default function Page() {
  const router = useRouter();
  const { state, set, clearFilters } = useFilterState({ tab: 'students', sort: 'points', dir: 'desc', page: '1' });
  const query = useFilterQuery(state);
  const tab = ['students', 'chapters', 'problems'].includes(state.tab) ? state.tab : 'students';
  const sortKey = SORT_KEYS.includes(state.sort) ? state.sort : 'points';
  const dir: 'asc' | 'desc' = state.dir === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(state.page) || 1);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const o = useApi<Overview>(`/analytics/overview${qs(query)}`);
  const rows = useApi<Paged<PerfRow>>(tab === 'students' ? `/analytics/students${qs({ ...query, page, sort: sortKey, dir })}` : null);
  const chapters = useApi<{ items: { batchCourseId: string; batch: string; course: string; chapter: string; problems: number; students: number; completedStudents: number; avgCompletionPct: number | null }[] }>(tab === 'chapters' ? `/analytics/chapters${qs(query)}` : null);
  const problems = useApi<{ items: { batch: string; course: string; chapter: string; problem: string; slug: string; difficulty: string; students: number; verifiedSolved: number; solvedPct: number | null }[] }>(tab === 'problems' ? `/analytics/problems${qs(query)}` : null);

  const onSort = (key: string) => set({ sort: key, dir: sortKey === key && dir === 'desc' ? 'asc' : 'desc', page: '' });
  const exp = async () => {
    setExporting(true);
    try { await download(`/reports/export${qs({ ...query, type: EXPORT_TYPE[tab] })}`); } catch (e) { toast.error(errorMessage(e)); } finally { setExporting(false); }
  };
  const t = o.data?.totals;
  const anyFilter = !!(state.q || state.batchId || state.courseId || state.collegeId || state.chapterId || state.difficulty || state.verification || state.maxPct || state.from || state.to);
  const clearEmpty = anyFilter ? <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button> : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Based on verified problems and the chapters currently visible to students."
        actions={<Button variant="secondary" icon={<Download size={15} aria-hidden />} loading={exporting} onClick={exp}>Export {tab} CSV</Button>} />
      <Filters value={state} onChange={set} onClear={clearFilters} />
      {o.error ? <ErrorState message={o.error} retry={o.reload} /> : t && (
        <Grid>
          <StatCard label="Students" value={o.data!.verification.studentsInScope} hint={`${t.activeStudents7d} active in the last 7 days`} />
          <StatCard label="Average completion" value={t.avgCompletionPct === null ? '—' : `${t.avgCompletionPct}%`} />
          <StatCard label="Verified problems" value={t.verifiedCompletions} tone="good" hint="Student and problem pairs" />
          <StatCard label="LeetCode connection" value={o.data!.verification.coveragePct === null ? '—' : `${o.data!.verification.coveragePct}%`} hint="Students with a connected account" tone={o.data!.verification.coveragePct === 100 ? 'good' : 'warn'} />
        </Grid>
      )}
      {o.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Course completion"><BarList items={o.data.courseCompletion.map((c) => ({ label: c.title, value: c.avgCompletionPct, sub: `${c.completed} completed` }))} max={100} format={(n) => `${n}%`} /></Card>
          <Card title="Batch comparison"><BarList items={o.data.batchComparison.map((b) => ({ label: b.name, value: b.avgCompletionPct, sub: `${b.students} students` }))} max={100} format={(n) => `${n}%`} /></Card>
        </div>
      )}
      <Tabs active={tab} onChange={(k) => set({ tab: k, page: '' })} tabs={[{ key: 'students', label: 'Students' }, { key: 'chapters', label: 'Chapters' }, { key: 'problems', label: 'Problems' }]}>
        {tab === 'students' && (
          <Card flush>
            {rows.error ? <div className="p-4"><ErrorState message={rows.error} retry={rows.reload} /></div> : !rows.data ? <TableSkeleton rows={8} /> : (
              <>
                <DataTable rows={rows.data.items} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} sort={{ key: sortKey, dir }} onSort={onSort} columnsKey="analytics-students" caption="Student progress"
                  onRowClick={(r) => router.push(`/manage/students/${r.studentId}`)}
                  empty={<EmptyState title="No students match these filters" action={clearEmpty} />}
                  columns={[
                    { key: 'name', header: 'Student', sortable: true, cell: (r) => <div><Link className="font-medium text-accent-fg hover:underline" href={`/manage/students/${r.studentId}`}>{r.name}</Link><p className="text-xs text-fg-subtle">{r.rollNumber}</p></div> },
                    { key: 'batch', header: 'Batch', cell: (r) => r.batch },
                    { key: 'course', header: 'Course', cell: (r) => r.course },
                    { key: 'solved', header: 'Verified', sortable: true, cell: (r) => <span className="tabular-nums">{r.solved} / {r.accessible}</span> },
                    { key: 'completionPct', header: 'Completion', sortable: true, className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" /> },
                    { key: 'points', header: 'Points', sortable: true, align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{r.points}</span> },
                    { key: 'rank', header: 'Rank', align: 'right', cell: (r) => <span className="tabular-nums">#{r.rank}</span> },
                    { key: 'college', header: 'College', optional: true, defaultHidden: true, cell: (r) => r.college ?? '—' },
                    { key: 'rollNumber', header: 'Roll number', optional: true, defaultHidden: true, sortable: true, cell: (r) => r.rollNumber },
                    { key: 'easy', header: 'Easy', optional: true, defaultHidden: true, align: 'right', cell: (r) => <span className="tabular-nums">{r.easy}</span> },
                    { key: 'medium', header: 'Medium', optional: true, defaultHidden: true, align: 'right', cell: (r) => <span className="tabular-nums">{r.medium}</span> },
                    { key: 'hard', header: 'Hard', optional: true, defaultHidden: true, align: 'right', cell: (r) => <span className="tabular-nums">{r.hard}</span> },
                    { key: 'lastVerifiedAt', header: 'Last verified', optional: true, defaultHidden: true, sortable: true, cell: (r) => timeAgo(r.lastVerifiedAt) },
                    { key: 'lastSyncAt', header: 'Last update', optional: true, defaultHidden: true, sortable: true, cell: (r) => timeAgo(r.lastSyncAt) },
                    { key: 'link', header: 'LeetCode', optional: true, defaultHidden: true, cell: (r) => <StatusBadge status={r.linkState} /> },
                  ]} />
                <Pagination page={page} pageSize={rows.data.pageSize} total={rows.data.total} onPage={(p) => set({ page: String(p) })} />
              </>
            )}
          </Card>
        )}
        {tab === 'chapters' && (
          <Card flush>
            {chapters.error ? <div className="p-4"><ErrorState message={chapters.error} retry={chapters.reload} /></div> : !chapters.data ? <TableSkeleton /> : (
              <DataTable rows={chapters.data.items} rowKey={(c) => `${c.batchCourseId}-${c.chapter}`} caption="Chapter completion" empty={<EmptyState title="No visible chapters match these filters" action={clearEmpty} />} columns={[
                { key: 'b', header: 'Batch', cell: (c) => c.batch }, { key: 'c', header: 'Course', cell: (c) => c.course }, { key: 'ch', header: 'Chapter', cell: (c) => <span className="font-medium">{c.chapter}</span> },
                { key: 'p', header: 'Problems', align: 'right', cell: (c) => <span className="tabular-nums">{c.problems}</span> },
                { key: 'd', header: 'Completed', cell: (c) => <span className="tabular-nums">{c.completedStudents} / {c.students}</span> },
                { key: 'a', header: 'Average completion', className: 'min-w-44', cell: (c) => <ProgressBar value={c.avgCompletionPct} size="sm" /> },
              ]} />)}
          </Card>
        )}
        {tab === 'problems' && (
          <Card flush>
            {problems.error ? <div className="p-4"><ErrorState message={problems.error} retry={problems.reload} /></div> : !problems.data ? <TableSkeleton /> : (
              <DataTable rows={problems.data.items} rowKey={(p) => `${p.batch}-${p.course}-${p.chapter}-${p.slug}`} caption="Problem completion" empty={<EmptyState title="No visible problems match these filters" action={clearEmpty} />} columns={[
                { key: 'b', header: 'Batch', cell: (p) => p.batch }, { key: 'ch', header: 'Chapter', cell: (p) => p.chapter },
                { key: 'p', header: 'Problem', cell: (p) => <a className="text-accent-fg hover:underline" href={`https://leetcode.com/problems/${p.slug}/`} target="_blank" rel="noopener noreferrer">{p.problem}</a> },
                { key: 'd', header: 'Difficulty', cell: (p) => <DifficultyBadge d={p.difficulty} /> },
                { key: 's', header: 'Verified', cell: (p) => <span className="tabular-nums">{p.verifiedSolved} / {p.students}</span> },
                { key: 'pct', header: 'Share verified', className: 'min-w-40', cell: (p) => <ProgressBar value={p.solvedPct} size="sm" /> },
              ]} />)}
          </Card>
        )}
      </Tabs>
    </div>
  );
}
