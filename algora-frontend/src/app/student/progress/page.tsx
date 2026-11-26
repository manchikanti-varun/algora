'use client';
import { useMemo, useState } from 'react';
import { Card, DataTable, DifficultyBadge, EmptyState, ErrorState, BarList, fmtDate, fmtDateTime, PageHeader, PageSkeleton, Pagination, ProgressBar } from '@/components/ui';
import { ContextPicker } from '@/components/student/ContextPicker';
import { useSync } from '@/components/student/SyncProvider';
import { useStudentDashboard } from '@/components/student/useContextChoice';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
interface Hist { slug: string; title?: string; earliestObservedSolvedAt: string | null; latestObservedSolvedAt: string | null; firstVerifiedAt: string | null }
const PAGE_SIZE = 25;
const name = (h: Hist) => h.title ?? h.slug.replace(/-/g, ' ');
const time = (d: string | null) => (d ? new Date(d).getTime() : 0);
type SortKey = 'title' | 'first' | 'latest';
export default function Page() {
  const { version } = useSync();
  const dash = useStudentDashboard();
  const p = useApi<{ history: Hist[] }>(dash.selectedId ? `/student/progress${qs({ batchCourseId: dash.selectedId, view: 'history', v: version })}` : null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'first', dir: 'desc' });
  const [page, setPage] = useState(1);
  const history = p.data?.history;
  const rows = useMemo(() => {
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...(history ?? [])].sort((a, b) => sign * (sort.key === 'title' ? name(a).localeCompare(name(b))
      : sort.key === 'first' ? time(a.firstVerifiedAt) - time(b.firstVerifiedAt) : time(a.latestObservedSolvedAt) - time(b.latestObservedSolvedAt)));
  }, [history, sort]);
  if (dash.error || p.error) return <ErrorState message={(dash.error ?? p.error)!} retry={() => { dash.reload(); void p.reload(); }} />;
  if (!dash.data) return <PageSkeleton />;
  const d = dash.data;
  if (!d.selected) {
    return <div><PageHeader title="Progress" /><Card><EmptyState title="No progress yet" body="Once your trainer enrolls you in a course, your progress appears here." /></Card></div>;
  }
  if (!history) return <PageSkeleton />;
  // Weekly counts by the date Algora first verified each problem.
  const weeks = new Map<string, number>();
  for (const h of history) { if (!h.firstVerifiedAt) continue; const x = new Date(h.firstVerifiedAt); const w = new Date(x); w.setDate(x.getDate() - ((x.getDay() + 6) % 7)); const k = w.toISOString().slice(0, 10); weeks.set(k, (weeks.get(k) ?? 0) + 1); }
  const wk = [...weeks].sort(([a], [b]) => a.localeCompare(b)).reduce<[string, number, number][]>((acc, [k, n]) => [...acc, [k, n, (acc.at(-1)?.[2] ?? 0) + n]], []);
  const onSort = (key: string) => { setSort((s) => (s.key === key ? { key: s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: key as SortKey, dir: key === 'title' ? 'asc' : 'desc' })); setPage(1); };
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <div className="space-y-6">
      <PageHeader title="Progress" subtitle={`${d.selected.courseTitle} · ${d.selected.batchName}`} actions={<ContextPicker contexts={d.contexts} value={dash.selectedId} onChange={dash.choose} />} />
      <Card title="Overall completion" tone="accent">
        <p className="mb-2 text-sm text-fg-muted">{d.summary?.verifiedSolved ?? 0} of {d.summary?.accessibleProblems ?? 0} problems verified</p>
        <ProgressBar value={d.summary?.completionPct ?? null} label="Overall completion" />
      </Card>
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Card title="By difficulty">
          {d.difficulty ? (
            <div className="space-y-4">{(['EASY', 'MEDIUM', 'HARD'] as const).map((k) => (
              <div key={k} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm"><DifficultyBadge d={k} /><span className="tabular-nums text-fg-muted">{d.difficulty![k].solved} of {d.difficulty![k].total} verified</span></div>
                <ProgressBar value={d.difficulty![k].total ? (d.difficulty![k].solved / d.difficulty![k].total) * 100 : null} size="sm" label={`${k.toLowerCase()} problems verified`} />
              </div>))}</div>
          ) : <EmptyState compact title="Nothing to show yet" />}
        </Card>
        <Card title="By chapter" className="lg:col-span-2">
          {!d.chapters.length ? <EmptyState compact title="No chapters yet" body="Your trainer makes chapters visible as the course goes on." /> : (
            <ul className="space-y-3">{d.chapters.map((c) => (
              <li key={c.chapterId}>
                <div className="mb-1 flex justify-between gap-3 text-sm"><span className="min-w-0 truncate text-fg">{c.title}</span><span className="shrink-0 tabular-nums text-fg-muted">{c.solved} / {c.total}</span></div>
                <ProgressBar value={c.completionPct} size="sm" label={`${c.title} progress`} />
              </li>))}</ul>
          )}
        </Card>
      </div>
      <Card title="Verified each week" description="Based on when Algora first verified each problem across your courses.">
        {!wk.length ? <EmptyState compact title="Nothing verified yet" body="Solve a problem on LeetCode, then use Update progress." />
          : <BarList items={wk.map(([k, n, cum]) => ({ key: k, label: `Week of ${fmtDate(k)}`, value: n, sub: `${cum} in total` }))} format={(n) => `+${n}`} />}
      </Card>
      <Card title="Verified problems" flush>
        <DataTable rows={pageRows} rowKey={(h) => h.slug} caption="Verified problems" sort={sort} onSort={onSort}
          empty={<EmptyState compact title="No verified problems yet" body="Problems appear here after Algora sees an accepted submission from your LeetCode account." />}
          columns={[
            { key: 'title', header: 'Problem', sortable: true, cell: (h) => <a className="text-accent-fg hover:underline" href={`https://leetcode.com/problems/${h.slug}/`} target="_blank" rel="noopener noreferrer">{name(h)}<span className="sr-only"> (opens LeetCode in a new tab)</span></a> },
            { key: 'first', header: 'First verified', sortable: true, cell: (h) => fmtDateTime(h.firstVerifiedAt) },
            { key: 'latest', header: 'Latest accepted seen', sortable: true, cell: (h) => fmtDateTime(h.latestObservedSolvedAt) },
          ]} />
        <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} className="border-t border-line" />
      </Card>
    </div>
  );
}
