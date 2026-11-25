'use client';
import { Download, ListChecks } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, DifficultyBadge, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, PageSkeleton, Select, StatusBadge, Tabs, Textarea, useConfirm, useToast } from '@/components/ui';
import { BulkProblemLookup, CatalogBrowser, type CatalogEntry } from '@/components/manage/ProblemLibrary';
import { useApi } from '@/hooks/useApi';
import { api, download, errorMessage } from '@/lib/api';
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
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [libraryChapterId, setLibraryChapterId] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await c.reload(); return true; } catch (e) { toast.error(errorMessage(e)); return false; } finally { setBusy(false); }
  }
  if (c.error) return <ErrorState message={c.error} retry={c.reload} />;
  if (!c.data) return <PageSkeleton />;
  const course = c.data;
  const libraryChapter = course.chapters.find((chapter) => chapter._id === libraryChapterId);
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
            const selected = (picked[ch._id] ?? []).filter((id) => activeProbs.some((p) => p._id === id));
            const select = (ids: string[]) => setPicked((current) => ({ ...current, [ch._id]: ids }));
            return (
              <Card key={ch._id} className={archived ? 'opacity-70' : ''}
                title={<span className="flex items-center gap-2"><span className="text-slate-400">{archived ? '—' : idx + 1}.</span>{ch.title}{archived && <Badge>Archived</Badge>}<span className="text-xs font-normal text-slate-500">{activeProbs.length} problems</span></span>}
                actions={can && (archived
                  ? <Button size="sm" variant="secondary" onClick={() => run(() => api(`/chapters/${ch._id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }), 'Chapter restored')}>Restore</Button>
                  : <>
                    <Button size="sm" variant="ghost" aria-label="Move chapter up" disabled={idx === 0 || busy} onClick={() => moveChapter(ch, -1)}>↑</Button>
                    <Button size="sm" variant="ghost" aria-label="Move chapter down" disabled={idx === activeChapters.length - 1 || busy} onClick={() => moveChapter(ch, 1)}>↓</Button>
                    <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'chapter', ch })}>Edit</Button>
                    <Button size="sm" variant="secondary" onClick={() => setLibraryChapterId(ch._id)}>Add problems</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Archive “${ch.title}”?`, body: 'It disappears for students in every batch. Verified progress is kept.', confirmLabel: 'Archive', danger: true })) run(() => api(`/chapters/${ch._id}`, { method: 'PATCH', body: { status: 'ARCHIVED' } }), 'Chapter archived'); }}>Archive</Button>
                  </>)}>
                {ch.description && <p className="mb-3 text-sm text-slate-600">{ch.description}</p>}
                {can && !archived && activeProbs.length > 0 && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selected.length === activeProbs.length} onChange={(e) => select(e.target.checked ? activeProbs.map((p) => p._id) : [])} />
                    Select all in {ch.title}
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => void download(`/chapters/${ch._id}/problems/export`).catch((error) => toast.error(errorMessage(error)))}>
                    <Download size={16} aria-hidden="true" /> Export problems
                  </Button>
                </div>}
                {can && !archived && selected.length > 0 && <ProblemBulkActions
                  count={selected.length} busy={busy} targets={activeChapters.filter((item) => item._id !== ch._id)}
                  onApply={async (action, targetChapterId) => {
                    if (action !== 'copy' && !(await confirm({
                      title: action === 'move' ? 'Move selected problems?' : 'Archive selected problems?',
                      body: 'This changes what students can see in the source chapter. Existing submission evidence is kept.',
                      confirmLabel: action === 'move' ? 'Move problems' : 'Archive problems', danger: action === 'archive',
                    }))) return;
                    if (await run(async () => {
                      const result = await api<{ added: number; archived: number; skipped: number }>(`/chapters/${ch._id}/problems/bulk`, {
                        method: 'POST', body: { action, ids: selected, ...(targetChapterId ? { targetChapterId } : {}) },
                      });
                      toast.success(`${result.added} added · ${result.archived} archived · ${result.skipped} skipped`);
                    })) select([]);
                  }} />}
                {!probs.length ? <p className="text-sm text-slate-500">No problems in this chapter.</p> : (
                  <ul className="divide-y divide-slate-100">
                    {probs.map((p) => {
                      const pi = activeProbs.findIndex((x) => x._id === p._id);
                      return (
                        <li key={p._id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                          {can && !archived && p.status === 'ACTIVE' && <input type="checkbox" aria-label={`Select ${p.title}`}
                            checked={selected.includes(p._id)} onChange={(e) => select(e.target.checked ? [...selected, p._id] : selected.filter((id) => id !== p._id))} />}
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

      {libraryChapter && <AddProblems chapter={libraryChapter} onClose={() => setLibraryChapterId(null)}
        onManual={() => { setLibraryChapterId(null); setModal({ kind: 'problem', ch: libraryChapter }); }}
        onAdd={async (entries) => {
          const result = await api<{ added: number; alreadyAssigned: number }>(`/problem-library/chapters/${libraryChapter._id}/assign`, {
            method: 'POST', body: { ids: entries.map((entry) => entry._id) },
          });
          await c.reload();
          return result;
        }} />}
      <CourseModal open={modal?.kind === 'course'} course={course} onClose={() => setModal(null)} onSave={(b) => run(() => api(`/courses/${courseId}`, { method: 'PATCH', body: b }), 'Course updated').then((ok) => ok && setModal(null))} busy={busy} />
      <ChapterModal key={modal?.kind === 'chapter' ? modal.ch?._id ?? 'new' : 'x'} open={modal?.kind === 'chapter'} ch={modal?.kind === 'chapter' ? modal.ch : undefined} busy={busy} onClose={() => setModal(null)}
        onSave={(b) => run(() => modal?.kind === 'chapter' && modal.ch ? api(`/chapters/${modal.ch._id}`, { method: 'PATCH', body: b }) : api(`/courses/${courseId}/chapters`, { method: 'POST', body: b }), 'Chapter saved').then((ok) => ok && setModal(null))} />
      <ProblemModal key={modal?.kind === 'problem' ? modal.p?._id ?? `new-${modal.ch._id}` : 'x'} open={modal?.kind === 'problem'} p={modal?.kind === 'problem' ? modal.p : undefined} busy={busy} onClose={() => setModal(null)}
        existing={modal?.kind === 'problem' ? modal.ch.problems.filter((x) => x.status === 'ACTIVE' && x._id !== modal.p?._id).map((x) => x.slug) : []}
        onSave={(b) => run(() => modal?.kind === 'problem' && modal.p ? api(`/problems/${modal.p._id}`, { method: 'PATCH', body: b }) : api(`/chapters/${(modal as { ch: Chapter }).ch._id}/problems`, { method: 'POST', body: b }), 'Problem saved').then((ok) => ok && setModal(null))} />
    </div>
  );
}

function ProblemBulkActions({ count, targets, busy, onApply }: {
  count: number; targets: Chapter[]; busy: boolean;
  onApply: (action: 'archive' | 'copy' | 'move', targetChapterId?: string) => Promise<void>;
}) {
  const [action, setAction] = useState<'archive' | 'copy' | 'move'>('archive');
  const [target, setTarget] = useState('');
  return <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
    <span className="flex items-center gap-1.5 self-center text-sm"><ListChecks size={16} aria-hidden="true" /> {count} selected</span>
    <Select label="Action" value={action} onChange={(e) => setAction(e.target.value as typeof action)}
      options={[{ value: 'archive', label: 'Archive' }, { value: 'copy', label: 'Copy to chapter' }, { value: 'move', label: 'Move to chapter' }]} />
    {action !== 'archive' && <Select label="Destination chapter" value={target} onChange={(e) => setTarget(e.target.value)}
      options={[{ value: '', label: 'Choose chapter' }, ...targets.map((item) => ({ value: item._id, label: item.title }))]} />}
    <Button size="sm" loading={busy} disabled={count > 100 || (action !== 'archive' && !target)}
      onClick={() => void onApply(action, action === 'archive' ? undefined : target)}>Apply</Button>
    {count > 100 && <p role="status" className="w-full text-xs text-slate-600">Select up to 100 problems per action.</p>}
  </div>;
}

function AddProblems({ chapter, onClose, onManual, onAdd }: {
  chapter: Chapter;
  onClose: () => void;
  onManual: () => void;
  onAdd: (entries: CatalogEntry[]) => Promise<{ added: number; alreadyAssigned: number }>;
}) {
  const [tab, setTab] = useState('browse');
  const [selected, setSelected] = useState<CatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const assigned = chapter.problems.filter((problem) => problem.status === 'ACTIVE').map((problem) => problem.slug);
  const pending = selected.filter((entry) => !assigned.includes(entry.slug));

  async function add(entries: CatalogEntry[]) {
    if (busy) return false;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await onAdd(entries);
      setFeedback({ tone: 'success', text: `${result.added} added · ${result.alreadyAssigned} already assigned` });
      return true;
    } catch (error) {
      setFeedback({ tone: 'error', text: errorMessage(error) });
      return false;
    } finally { setBusy(false); }
  }

  return <Modal open wide onClose={() => { if (!busy) onClose(); }} title={`Add problems to ${chapter.title}`}>
    <Tabs tabs={[{ key: 'browse', label: 'Browse Library' }, { key: 'bulk', label: 'Bulk Add' }, { key: 'manual', label: 'Add Manually' }]}
      active={tab} onChange={(key) => { if (!busy) setTab(key); }} />
    <div hidden={tab !== 'browse'}>
      <CatalogBrowser assigned={assigned} selected={pending} onSelect={setSelected} onAdd={add} />
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white py-3">
        <span role="status" className="text-sm">{pending.length} selected</span>
        <Button loading={busy} disabled={!pending.length || pending.length > 100}
          onClick={async () => { if (await add(pending)) setSelected([]); }}>Add {pending.length} problems to chapter</Button>
      </div>
      {pending.length > 100 && <Notice tone="warn">Add up to 100 problems at a time.</Notice>}
    </div>
    {feedback && <div role={feedback.tone === 'error' ? 'alert' : 'status'}><Notice tone={feedback.tone}>{feedback.text}</Notice></div>}
    {tab === 'bulk' && <BulkProblemLookup assigned={assigned} onAdd={add} />}
    {tab === 'manual' && <Button onClick={onManual}>Open manual entry</Button>}
  </Modal>;
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
