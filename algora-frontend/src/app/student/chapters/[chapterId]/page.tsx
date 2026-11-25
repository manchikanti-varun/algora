'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Card, DifficultyBadge, EmptyState, ErrorState, fmtDateTime, InlineSelect, PageHeader, PageSkeleton, ProgressBar } from '@/components/ui';
import { useSync } from '@/components/student/SyncProvider';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';

interface P { _id: string; title: string; url: string; slug: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; verified: boolean; evidence: { firstVerifiedAt: string | null; latestObservedSolvedAt: string | null } | null }
interface R { chapter: { _id: string; title: string; description?: string }; course: { _id: string; title: string }; batchName: string; problems: P[]; prev: { _id: string; title: string } | null; next: { _id: string; title: string } | null }

function Inner() {
  const { chapterId } = useParams<{ chapterId: string }>();
  const batchCourseId = useSearchParams().get('batchCourseId') ?? '';
  const { version } = useSync();
  const [diff, setDiff] = useState(''); const [ver, setVer] = useState('');
  const r = useApi<R>(batchCourseId ? `/student/chapters/${chapterId}${qs({ batchCourseId, v: version })}` : null);
  if (!batchCourseId) return <ErrorState message="Open this chapter from your course page." />;
  if (r.error) return <ErrorState message={r.error === 'Chapter not found' ? 'This chapter is not available to you.' : r.error} />;
  if (!r.data) return <PageSkeleton />;
  const d = r.data;
  const shown = d.problems.filter((p) => (!diff || p.difficulty === diff) && (!ver || (ver === 'verified') === p.verified));
  const solved = d.problems.filter((p) => p.verified).length;
  const link = (c: { _id: string }) => `/student/chapters/${c._id}?batchCourseId=${batchCourseId}`;
  return (
    <div className="space-y-6">
      <PageHeader back={{ href: `/student/courses/${batchCourseId}`, label: d.course.title }} title={d.chapter.title} subtitle={`${solved} of ${d.problems.length} verified`} />
      {d.chapter.description && <p className="-mt-3 max-w-3xl whitespace-pre-line text-sm text-slate-600">{d.chapter.description}</p>}
      <Card><ProgressBar value={d.problems.length ? (solved / d.problems.length) * 100 : null} label="Chapter completion" /></Card>
      <Card title="Problems" actions={<>
        <InlineSelect label="Difficulty" value={diff} onChange={setDiff} options={[{ value: '', label: 'All difficulties' }, { value: 'EASY', label: 'Easy' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HARD', label: 'Hard' }]} />
        <InlineSelect label="Verification" value={ver} onChange={setVer} options={[{ value: '', label: 'All problems' }, { value: 'verified', label: 'Verified' }, { value: 'unverified', label: 'Not verified yet' }]} />
      </>}>
        {!shown.length ? <EmptyState title="No problems match" /> : (
          <ul className="divide-y divide-slate-100">
            {shown.map((p) => (
              <li key={p._id} className="flex flex-wrap items-center gap-3 py-3">
                <span aria-label={p.verified ? 'Verified' : 'Not verified yet'} className={p.verified ? 'grid h-6 w-6 place-items-center rounded-full bg-emerald-100 text-xs text-emerald-700' : 'grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-xs text-slate-400'}>{p.verified ? '✓' : '○'}</span>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">{p.title} <span aria-hidden>↗</span><span className="sr-only"> (opens LeetCode in a new tab)</span></a>
                <DifficultyBadge d={p.difficulty} />
                <span className="ml-auto text-xs text-slate-500">{p.verified ? `Verified ${fmtDateTime(p.evidence?.firstVerifiedAt)}${p.evidence?.latestObservedSolvedAt ? ` · last accepted ${fmtDateTime(p.evidence.latestObservedSolvedAt)}` : ''}` : 'Not verified yet'}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">“Not verified yet” means Algora has not seen an accepted submission from your verified account, not that you have not solved it.</p>
      </Card>
      <nav className="flex justify-between gap-2 text-sm" aria-label="Chapter navigation">
        {d.prev ? <Link className="text-indigo-600 hover:underline" href={link(d.prev)}>← {d.prev.title}</Link> : <span />}
        {d.next ? <Link className="text-indigo-600 hover:underline" href={link(d.next)}>{d.next.title} →</Link> : <span />}
      </nav>
    </div>
  );
}
export default function Page() { return <Suspense fallback={<PageSkeleton />}><Inner /></Suspense>; }
