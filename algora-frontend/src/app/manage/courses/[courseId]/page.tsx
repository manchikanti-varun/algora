'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, DifficultyBadge, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, PageSkeleton, Select, StatusBadge, Tabs, Textarea, useConfirm, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Chapter, CourseDetail, Problem } from '@/components/manage/types';

/** Client-side preview of the backend's canonical slug rule. The backend is authoritative. */
const previewSlug = (url: string) => { try { const u = new URL(url.trim()); if (!/^(www\.)?leetcode\.com$/.test(u.hostname) || u.protocol !== 'https:') return null; return u.pathname.match(/^\/problems\/([A-Za-z0-9-]{1,100})(\/|$)/)?.[1].toLowerCase() ?? null; } catch { return null; } };

export default function Page() {
  const { courseId } = useParams<{ courseId: string }>();
  const { user } = useAuth();
  const can = !!user?.canManageCourses;
  const [showArchived, setShowArchived] = useState(false);
  const c = useApi<CourseDetail>(`/courses/${courseId}${can && showArchived ? '?includeArchived=1' : ''}`);
  const [tab, setTab] = useState('content');
  const toast = useToast(); const confirm = useConfirm();
  const [modal, setModal] = useState<null | { kind: 'course' } | { kind: 'chapter'; ch?: Chapter } | { kind: 'problem'; ch: Chapter; p?: Problem }>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await c.reload(); return true; } catch (e) { toast.error(errorMessage(e)); return false; } finally { setBusy(false); }
  }
  if (c.error) return <ErrorState message={c.error} retry={c.reload} />;
  if (!c.data) return <PageSkeleton />;
  const course = c.data;
  const activeChapters = course.chapters.filter((x) => x.status === 'ACTIVE');
  const problemCount = activeChapters.reduce((a, ch) => a + ch.problems.filter((p) => p.status === 'ACTIVE').length, 0);

  const moveChapter = (ch: Chapter, dir: -1 | 1) => { const i = activeChapters.findIndex((x) => x._id === ch._id); run(() => api(`/chapters/${ch._id}/reorder`, { method: 'PATCH', body: { position: i + dir } })); };
  const moveProblem = (ch: Chapter, p: Problem, dir: -1 | 1) => {
    const ids = ch.problems.filter((x) => x.status === 'ACTIVE').map((x) => x._id);
    const i = ids.indexOf(p._id); const j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => api(`/chapters/${ch._id}/reorder`, { method: 'PATCH', body: { problemIds: ids } }));
  };
  const setStatus = async (status: string) => {
    if (status === 'ARCHIVED' && !(await confirm({ title: 'Archive this course?', body: 'Archived courses disappear for students in every batch. History is kept and you can restore it.', confirmLabel: 'Archive', danger: true }))) return;
    run(() => api(`/courses/${courseId}`, { method: 'PATCH', body: { status } }), `Course ${status.toLowerCase()}`);
  };

  return (
    <div>
      <PageHeader back={{ href: '/manage/courses', label: 'Courses' }} title={<span className="flex items-center gap-3">{course.title}<StatusBadge status={course.status} /></span>}
        subtitle={`${activeChapters.length} chapters · ${problemCount} problems`}
        actions={can && <>
          <Button variant="secondary" onClick={() => setModal({ kind: 'course' })}>Edit details</Button>
          {course.status === 'DRAFT' && <Button disabled={!problemCount} title={!problemCount ? 'Add at least one problem first' : undefined} onClick={() => setStatus('PUBLISHED')}>Publish</Button>}
          {course.status === 'PUBLISHED' && <Button variant="secondary" onClick={() => setStatus('DRAFT')}>Unpublish</Button>}
          {course.status !== 'ARCHIVED' ? <Button variant="ghost" onClick={() => setStatus('ARCHIVED')}>Archive</Button> : <Button onClick={() => setStatus('DRAFT')}>Restore</Button>}
        </>} />
      {course.description && <p className="-mt-3 mb-5 max-w-3xl whitespace-pre-line text-sm text-slate-600">{course.description}</p>}
      {!can && <Notice tone="info">You can view this course. Editing requires course permission from the Super Admin.</Notice>}
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'content', label: 'Content' }, { key: 'preview', label: 'Student preview' }]} />

      {tab === 'content' && (
        <div className="space-y-4">
          {can && <div className="flex flex-wrap items-center justify-between gap-2">
            <Button onClick={() => setModal({ kind: 'chapter' })}>Add chapter</Button>
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived chapters and problems</label>
          </div>}
          <Notice tone="info">New chapters are hidden in every batch until a trainer unlocks them. Reordering and edits apply to all batches using this course.</Notice>
          {!course.chapters.length && <EmptyState title="No chapters yet" body="Add a chapter, then add LeetCode problems to it." />}
          {course.chapters.map((ch) => {
            const archived = ch.status !== 'ACTIVE';
            const idx = activeChapters.findIndex((x) => x._id === ch._id);
            const probs = ch.problems.filter((p) => showArchived || p.status === 'ACTIVE');
            const activeProbs = ch.problems.filter((p) => p.status === 'ACTIVE');
            return (
              <Card key={ch._id} className={archived ? 'opacity-70' : ''}
                title={<span className="flex items-center gap-2"><span className="text-slate-400">{archived ? '—' : idx + 1}.</span>{ch.title}{archived && <Badge>Archived</Badge>}<span className="text-xs font-normal text-slate-500">{activeProbs.length} problems</span></span>}
                actions={can && (archived
                  ? <Button size="sm" variant="secondary" onClick={() => run(() => api(`/chapters/${ch._id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }), 'Chapter restored')}>Restore</Button>
                  : <>
                    <Button size="sm" variant="ghost" aria-label="Move chapter up" disabled={idx === 0 || busy} onClick={() => moveChapter(ch, -1)}>↑</Button>
                    <Button size="sm" variant="ghost" aria-label="Move chapter down" disabled={idx === activeChapters.length - 1 || busy} onClick={() => moveChapter(ch, 1)}>↓</Button>
                    <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'chapter', ch })}>Edit</Button>
                    <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'problem', ch })}>Add problem</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Archive “${ch.title}”?`, body: 'It disappears for students in every batch. Verified progress is kept.', confirmLabel: 'Archive', danger: true })) run(() => api(`/chapters/${ch._id}`, { method: 'PATCH', body: { status: 'ARCHIVED' } }), 'Chapter archived'); }}>Archive</Button>
                  </>)}>
                {ch.description && <p className="mb-3 text-sm text-slate-600">{ch.description}</p>}
                {!probs.length ? <p className="text-sm text-slate-500">No problems in this chapter.</p> : (
                  <ul className="divide-y divide-slate-100">
                    {probs.map((p) => {
                      const pi = activeProbs.findIndex((x) => x._id === p._id);
                      return (
                        <li key={p._id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                          <span className="w-6 text-slate-400">{p.status === 'ACTIVE' ? pi + 1 : '—'}</span>
                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 hover:underline">{p.title}</a>
                          <code className="text-xs text-slate-500">{p.slug}</code>
                          <DifficultyBadge d={p.difficulty} />{p.status !== 'ACTIVE' && <Badge>Archived</Badge>}
                          {can && <span className="ml-auto flex gap-1">
                            {p.status === 'ACTIVE' ? <>
                              <Button size="sm" variant="ghost" aria-label="Move problem up" disabled={pi === 0 || busy} onClick={() => moveProblem(ch, p, -1)}>↑</Button>
                              <Button size="sm" variant="ghost" aria-label="Move problem down" disabled={pi === activeProbs.length - 1 || busy} onClick={() => moveProblem(ch, p, 1)}>↓</Button>
                              <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'problem', ch, p })}>Edit</Button>
                              <Button size="sm" variant="ghost" onClick={() => run(() => api(`/problems/${p._id}`, { method: 'PATCH', body: { status: 'ARCHIVED' } }), 'Problem archived')}>Archive</Button>
                            </> : <Button size="sm" variant="ghost" onClick={() => run(() => api(`/problems/${p._id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }), 'Problem restored')}>Restore</Button>}
                          </span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {tab === 'preview' && (
        <div className="space-y-3">
          <Notice tone="info">This is every active chapter. Students only see the chapters unlocked for their batch.</Notice>
          {activeChapters.map((ch, i) => (
            <Card key={ch._id} title={`${i + 1}. ${ch.title}`}>
              <ul className="space-y-1.5 text-sm">{ch.problems.filter((p) => p.status === 'ACTIVE').map((p) => (
                <li key={p._id} className="flex items-center justify-between gap-2"><a className="text-indigo-700 hover:underline" href={p.url} target="_blank" rel="noopener noreferrer">{p.title} ↗</a><DifficultyBadge d={p.difficulty} /></li>))}</ul>
            </Card>
          ))}
        </div>
      )}

      <CourseModal open={modal?.kind === 'course'} course={course} onClose={() => setModal(null)} onSave={(b) => run(() => api(`/courses/${courseId}`, { method: 'PATCH', body: b }), 'Course updated').then((ok) => ok && setModal(null))} busy={busy} />
      <ChapterModal key={modal?.kind === 'chapter' ? modal.ch?._id ?? 'new' : 'x'} open={modal?.kind === 'chapter'} ch={modal?.kind === 'chapter' ? modal.ch : undefined} busy={busy} onClose={() => setModal(null)}
        onSave={(b) => run(() => modal?.kind === 'chapter' && modal.ch ? api(`/chapters/${modal.ch._id}`, { method: 'PATCH', body: b }) : api(`/courses/${courseId}/chapters`, { method: 'POST', body: b }), 'Chapter saved').then((ok) => ok && setModal(null))} />
      <ProblemModal key={modal?.kind === 'problem' ? modal.p?._id ?? `new-${modal.ch._id}` : 'x'} open={modal?.kind === 'problem'} p={modal?.kind === 'problem' ? modal.p : undefined} busy={busy} onClose={() => setModal(null)}
        existing={modal?.kind === 'problem' ? modal.ch.problems.filter((x) => x.status === 'ACTIVE' && x._id !== modal.p?._id).map((x) => x.slug) : []}
        onSave={(b) => run(() => modal?.kind === 'problem' && modal.p ? api(`/problems/${modal.p._id}`, { method: 'PATCH', body: b }) : api(`/chapters/${(modal as { ch: Chapter }).ch._id}/problems`, { method: 'POST', body: b }), 'Problem saved').then((ok) => ok && setModal(null))} />
    </div>
  );
}

function CourseModal({ open, course, onClose, onSave, busy }: { open: boolean; course: CourseDetail; onClose: () => void; onSave: (b: { title: string; description: string }) => void; busy: boolean }) {
  const [t, setT] = useState(course.title); const [d, setD] = useState(course.description ?? '');
  return (
    <Modal open={open} onClose={onClose} title="Edit course" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!t.trim()} onClick={() => onSave({ title: t, description: d })}>Save</Button></>}>
      <Input label="Title" value={t} onChange={(e) => setT(e.target.value)} maxLength={150} />
      <Textarea label="Description" value={d} onChange={(e) => setD(e.target.value)} rows={4} maxLength={5000} />
    </Modal>
  );
}
function ChapterModal({ open, ch, onClose, onSave, busy }: { open: boolean; ch?: Chapter; onClose: () => void; onSave: (b: { title: string; description: string }) => void; busy: boolean }) {
  const [t, setT] = useState(ch?.title ?? ''); const [d, setD] = useState(ch?.description ?? '');
  return (
    <Modal open={open} onClose={onClose} title={ch ? 'Edit chapter' : 'Add chapter'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!t.trim()} onClick={() => onSave({ title: t, description: d })}>Save</Button></>}>
      <Input label="Title" value={t} onChange={(e) => setT(e.target.value)} maxLength={150} autoFocus />
      <Textarea label="Description (optional)" value={d} onChange={(e) => setD(e.target.value)} maxLength={5000} />
    </Modal>
  );
}
function ProblemModal({ open, p, existing, onClose, onSave, busy }: { open: boolean; p?: Problem; existing: string[]; onClose: () => void; onSave: (b: { title: string; url: string; difficulty: string }) => void; busy: boolean }) {
  const [t, setT] = useState(p?.title ?? ''); const [u, setU] = useState(p?.url ?? ''); const [d, setD] = useState<string>(p?.difficulty ?? 'EASY');
  const slug = previewSlug(u);
  const dup = !!slug && existing.includes(slug);
  const urlErr = u && !slug ? 'Use a link like https://leetcode.com/problems/two-sum/' : dup ? 'This problem is already in this chapter' : undefined;
  return (
    <Modal open={open} onClose={onClose} title={p ? 'Edit problem' : 'Add LeetCode problem'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!t.trim() || !slug || dup} onClick={() => onSave({ title: t, url: u, difficulty: d })}>Save</Button></>}>
      <Input label="LeetCode URL" value={u} onChange={(e) => setU(e.target.value)} placeholder="https://leetcode.com/problems/two-sum/" error={urlErr} hint={slug ? <>Canonical slug: <code>{slug}</code></> : undefined} autoFocus />
      <Input label="Title" value={t} onChange={(e) => setT(e.target.value)} maxLength={150} placeholder="Two Sum" />
      <Select label="Difficulty" value={d} onChange={(e) => setD(e.target.value)} options={[{ value: 'EASY', label: 'Easy' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HARD', label: 'Hard' }]} />
      <p className="text-xs text-slate-500">The same problem may appear in other chapters. Students earn points for it once per ranking scope.</p>
    </Modal>
  );
}
