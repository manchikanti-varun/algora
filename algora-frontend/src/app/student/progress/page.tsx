'use client';
import { Card, DataTable, EmptyState, ErrorState, fmtDate, fmtDateTime, PageHeader, PageSkeleton, ProgressBar } from '@/components/ui';
import { ContextPicker } from '@/components/student/ContextPicker';
import { SyncPanel, useSync } from '@/components/student/SyncProvider';
import { useContextChoice } from '@/components/student/useContextChoice';
import type { ChapterProgress, Dashboard, Diff, DiffCount } from '@/components/student/types';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';

interface Hist { slug: string; title?: string; earliestObservedSolvedAt: string | null; latestObservedSolvedAt: string | null; firstVerifiedAt: string | null }
interface Prog { selected: Dashboard['selected']; chapters: ChapterProgress[]; difficulty: Record<Diff, DiffCount> | null; history: Hist[] }

export default function Page() {
  const [choice, choose] = useContextChoice();
  const { version } = useSync();
  const ctx = useApi<Dashboard>('/student/dashboard');
  const valid = ctx.data?.contexts.some((c) => c.batchCourseId === choice);
  const p = useApi<Prog>(ctx.data ? `/student/progress${qs({ batchCourseId: valid ? choice! : undefined, v: version })}` : null);
  if (ctx.error || p.error) return <ErrorState message={(ctx.error ?? p.error)!} />;
  if (!p.data) return <PageSkeleton />;
  // Weekly counts by the date Algora first verified each problem (reliable), shown separately from observed submission times.
  const weeks = new Map<string, number>();
  for (const h of p.data.history) { if (!h.firstVerifiedAt) continue; const d = new Date(h.firstVerifiedAt); const w = new Date(d); w.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = w.toISOString().slice(0, 10); weeks.set(k, (weeks.get(k) ?? 0) + 1); }
  const wk = [...weeks].sort(([a], [b]) => a.localeCompare(b)).reduce<[string, number, number][]>((acc, [k, n]) => [...acc, [k, n, (acc.at(-1)?.[2] ?? 0) + n]], []);
  const max = Math.max(1, ...wk.map(([, n]) => n));
  return (
    <div className="space-y-6">
      <PageHeader title="My progress" subtitle={p.data.selected ? `${p.data.selected.courseTitle} · ${p.data.selected.batchName}` : undefined} actions={<ContextPicker contexts={ctx.data!.contexts} value={valid ? choice! : p.data.selected?.batchCourseId} onChange={choose} />} />
      <SyncPanel />
      <Card title="Chapters">
        {!p.data.chapters.length ? <EmptyState title="No chapters unlocked yet" /> : (
          <ul className="space-y-3">{p.data.chapters.map((c) => <li key={c.chapterId}><div className="mb-1 flex justify-between text-sm"><span>{c.title}</span><span className="text-slate-500">{c.solved} / {c.total}</span></div><ProgressBar value={c.completionPct} size="sm" label={`${c.title} progress`} /></li>)}</ul>
        )}
      </Card>
      <Card title="Verified per week (all courses)">
        {!wk.length ? <EmptyState title="Nothing verified yet" /> : (
          <ul className="space-y-2">{wk.map(([k, n, cum]) => (
            <li key={k} className="grid grid-cols-[7rem_1fr_6rem] items-center gap-3 text-sm"><span className="text-slate-500">Week of {fmtDate(k)}</span>
              <div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${(n / max) * 100}%` }} /></div>
              <span className="text-right tabular-nums text-slate-600">+{n} · total {cum}</span></li>))}</ul>
        )}
        <p className="mt-3 text-xs text-slate-500">Grouped by when Algora first verified each problem. Rank history is not shown because Algora does not yet store ranking snapshots; it will not reconstruct past ranks.</p>
      </Card>
      <Card title="Verified problems">
        <DataTable rows={p.data.history} rowKey={(h) => h.slug} empty={<EmptyState title="No verified problems yet" />} columns={[
          { key: 't', header: 'Problem', cell: (h) => <a className="text-indigo-700 hover:underline" href={`https://leetcode.com/problems/${h.slug}/`} target="_blank" rel="noopener noreferrer">{h.title ?? h.slug}</a> },
          { key: 'e', header: 'Earliest accepted seen', cell: (h) => fmtDateTime(h.earliestObservedSolvedAt) },
          { key: 'l', header: 'Latest accepted seen', cell: (h) => fmtDateTime(h.latestObservedSolvedAt) },
          { key: 'v', header: 'First verified', cell: (h) => fmtDateTime(h.firstVerifiedAt) },
        ]} />
      </Card>
    </div>
  );
}
