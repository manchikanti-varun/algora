'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, ExternalLink, Sparkles } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Button, ButtonLink, Card, DifficultyBadge, EmptyState, ErrorState, FilterChips, InlineSelect, PageHeader, PageSkeleton, ProgressBar, SearchInput } from '@/components/ui';
import { useSync } from '@/components/student/SyncProvider';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { api, qs } from '@/lib/api';
const StudentMentor = dynamic(() => import('@/components/ai/StudentMentor'), { ssr: false });
interface P { _id: string; title: string; url: string; slug: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; problemNumber: number | null; points: number; topics: string[]; verified: boolean; catalogEligible?: boolean; hasAiHistory?: boolean; evidence: { firstVerifiedAt: string | null; latestObservedSolvedAt: string | null } | null }
interface R { chapter: { _id: string; title: string; description?: string; studentAiEnabled: boolean; aiEnabled: boolean }; course: { _id: string; title: string }; batchName: string; problems: P[]; prev: { _id: string; title: string } | null; next: { _id: string; title: string } | null }
interface Course { batchCourseId: string; chapters: { _id: string }[] }
const shortDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const DIFFS = [{ value: '', label: 'All difficulties' }, { value: 'EASY', label: 'Easy' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HARD', label: 'Hard' }];
const STATUSES = [{ value: '', label: 'All problems' }, { value: 'verified', label: 'Verified' }, { value: 'awaiting', label: 'Awaiting verification' }];
function NotAvailable() {
  return (
    <div>
      <PageHeader title="Chapter not available" breadcrumbs={[{ label: 'My Learning', href: '/student/courses' }, { label: 'Chapter' }]} />
      <Card><EmptyState title="This chapter is not available to you." action={<ButtonLink href="/student/courses" variant="secondary">Back to My Learning</ButtonLink>} /></Card>
    </div>
  );
}
function Inner() {
  const { chapterId } = useParams<{ chapterId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const batchCourseId = searchParams.get('batchCourseId') ?? '';
  const initialAi = searchParams.get('ai');
  const [mentor, setMentor] = useState<string | null>(null);
  const { version } = useSync();
  const [f, setF, resetF] = useUrlState({ q: '', diff: '', status: '' });
  // Old links have no batchCourseId: find the course that contains this chapter.
  const courses = useApi<{ items: Course[] }>(batchCourseId ? null : '/student/courses');
  const found = courses.data?.items.find((c) => c.chapters.some((ch) => ch._id === chapterId))?.batchCourseId;
  useEffect(() => { if (!batchCourseId && found) router.replace(`/student/chapters/${chapterId}${qs({ batchCourseId: found })}`); }, [batchCourseId, found, chapterId, router]);
  const r = useApi<R>(batchCourseId ? `/student/chapters/${chapterId}${qs({ batchCourseId, v: version })}` : null);
  const refreshChapter = r.reload;
  useEffect(() => {
    if (!batchCourseId) return;
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshChapter(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [batchCourseId, refreshChapter]);
  if (!batchCourseId) {
    if (courses.error) return <ErrorState message={courses.error} retry={courses.reload} />;
    if (courses.data && !found) return <NotAvailable />;
    return <PageSkeleton />;
  }
  if (r.error) return r.error === 'Chapter not found' ? <NotAvailable /> : <ErrorState message={r.error} retry={r.reload} />;
  if (!r.data) return <PageSkeleton />;
  const d = r.data;
  const selectedProblem = d.problems.find((problem) => problem._id === (mentor || initialAi));
  const closeMentor = () => {
    setMentor(null);
    if (initialAi) {
      const params = new URLSearchParams(searchParams);
      params.delete('ai');
      router.replace(`/student/chapters/${chapterId}?${params}`, { scroll: false });
    }
  };
  const search = f.q.trim().toLowerCase();
  const shown = d.problems.filter((p) => (!f.diff || p.difficulty === f.diff) &&
    (!f.status || (f.status === 'verified') === p.verified) &&
    (!search || p.title.toLowerCase().includes(search) || p.slug.includes(search) || String(p.problemNumber) === search || p.topics.some((t) => t.toLowerCase().includes(search))));
  const verified = d.problems.filter((p) => p.verified).length;
  const link = (c: { _id: string }) => `/student/chapters/${c._id}?batchCourseId=${batchCourseId}`;
  const chips = [
    ...(f.q ? [{ key: 'q', label: `“${f.q}”`, onRemove: () => setF({ q: '' }) }] : []),
    ...(f.diff ? [{ key: 'd', label: DIFFS.find((o) => o.value === f.diff)?.label ?? f.diff, onRemove: () => setF({ diff: '' }) }] : []),
    ...(f.status ? [{ key: 's', label: STATUSES.find((o) => o.value === f.status)?.label ?? f.status, onRemove: () => setF({ status: '' }) }] : []),
  ];
  return (
    <div className="space-y-6">
      <PageHeader title={d.chapter.title} subtitle={d.chapter.description ? <span className="block max-w-3xl whitespace-pre-line">{d.chapter.description}</span> : d.batchName}
        breadcrumbs={[{ label: 'My Learning', href: '/student/courses' }, { label: d.course.title, href: `/student/courses/${batchCourseId}` }, { label: d.chapter.title }]}
        actions={d.problems.length > 0 && (
          <div className="w-56">
            <p className="mb-1 text-right text-[13px] text-fg-muted">{verified} of {d.problems.length} verified</p>
            <ProgressBar value={(verified / d.problems.length) * 100} label="Chapter progress" />
          </div>
        )} />
      <Card flush footer={<p className="text-xs text-fg-subtle">A problem is verified after Algora sees an accepted submission from your LeetCode account.</p>}>
        <div className="space-y-2 border-b border-line px-4 py-2.5">
          <div className="grid gap-2 sm:grid-cols-[minmax(240px,1fr)_180px_180px]">
            <SearchInput label="Search problems" placeholder="Search problems" value={f.q} onChange={(v) => setF({ q: v })} />
            <InlineSelect label="Difficulty" value={f.diff} onChange={(v) => setF({ diff: v })} options={DIFFS} />
            <InlineSelect label="Status" value={f.status} onChange={(v) => setF({ status: v })} options={STATUSES} />
          </div>
          <FilterChips chips={chips} onClear={resetF} />
        </div>
        {!d.problems.length ? <EmptyState compact title="No problems yet" body="Your trainer has not added problems to this chapter." />
          : !shown.length ? <EmptyState compact title="No problems match" body="Try a different search or clear the filters." action={<Button variant="secondary" size="sm" onClick={resetF}>Clear filters</Button>} /> : (
            <ul className="divide-y divide-line">
              {shown.map((p) => {
                const meta = [p.problemNumber !== null ? `#${p.problemNumber}` : null, p.topics.length ? p.topics.join(', ') : null,
                  p.verified && p.evidence?.firstVerifiedAt ? `Verified ${shortDate(p.evidence.firstVerifiedAt)}` : null].filter(Boolean);
                return (
                  <li key={p._id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto_minmax(155px,auto)_auto]">
                    <span className={`order-3 inline-flex sm:order-none sm:col-start-4 sm:row-start-1 items-center gap-1.5 text-[13px] ${p.verified ? 'text-success-fg' : 'text-fg-muted'}`}>
                      {p.verified ? <CheckCircle2 size={16} aria-hidden /> : <Circle size={16} aria-hidden />}
                      {p.verified ? 'Verified' : 'Awaiting verification'}
                    </span>
                    <div className="min-w-0 sm:col-start-1 sm:row-start-1">
                      <p className="font-medium text-fg">{p.title}</p>
                      {meta.length > 0 && <p className="mt-0.5 text-xs text-fg-subtle">{meta.join(' · ')}</p>}
                    </div>
                    <span className="justify-self-end sm:col-start-2 sm:row-start-1"><DifficultyBadge d={p.difficulty} /></span>
                    <span className="order-4 text-xs tabular-nums text-fg-muted sm:order-none sm:col-start-3 sm:row-start-1">{p.points} pts</span>
                    <div className="order-5 flex flex-wrap gap-2 sm:order-none sm:col-start-5 sm:row-start-1">
                      <ButtonLink external href={p.url} variant="secondary" size="sm" icon={<ExternalLink size={13} aria-hidden />}
                        onClick={() => { void api('/student/ai/practice', { method: 'PUT', body: { batchCourseId, problemId: p._id } }).catch(() => {}); }}>
                        Solve<span className="sr-only"> {p.title} on LeetCode (opens in a new tab)</span>
                      </ButtonLink>
                      {d.chapter.aiEnabled && p.catalogEligible ? (
                        <Button size="sm" variant="ghost" icon={<Sparkles size={14} aria-hidden />} onClick={() => setMentor(p._id)}>Ask AI</Button>
                      ) : p.hasAiHistory && (
                        <Button size="sm" variant="ghost" onClick={() => setMentor(p._id)}>AI history</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </Card>
      {selectedProblem && <StudentMentor key={selectedProblem._id} selection={{ batchCourseId, problemId: selectedProblem._id }} close={closeMentor} chapterAvailable={d.chapter.aiEnabled} onAvailabilityChange={refreshChapter} />}
      {(d.prev || d.next) && (
        <nav className="grid gap-3 sm:grid-cols-2" aria-label="Chapter navigation">
          {d.prev ? (
            <Link href={link(d.prev)} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-hover">
              <ChevronLeft size={18} aria-hidden className="shrink-0 text-fg-subtle" />
              <span className="min-w-0"><span className="block text-xs text-fg-subtle">Previous chapter</span><span className="block truncate text-sm font-medium text-fg">{d.prev.title}</span></span>
            </Link>
          ) : <span />}
          {d.next ? (
            <Link href={link(d.next)} className="flex items-center justify-end gap-3 rounded-lg border border-line bg-surface p-4 text-right transition-colors hover:border-line-strong hover:bg-hover sm:col-start-2">
              <span className="min-w-0"><span className="block text-xs text-fg-subtle">Next chapter</span><span className="block truncate text-sm font-medium text-fg">{d.next.title}</span></span>
              <ChevronRight size={18} aria-hidden className="shrink-0 text-fg-subtle" />
            </Link>
          ) : null}
        </nav>
      )}
    </div>
  );
}
export default function Page() { return <Suspense fallback={<PageSkeleton />}><Inner /></Suspense>; }
