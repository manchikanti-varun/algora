'use client';
import { Archive, ChevronDown, ChevronUp, Download, ExternalLink, ListChecks, Pencil, Plus } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, Checkbox, DifficultyBadge, EmptyState, ErrorState, IconButton, Input, Menu, Modal, Notice, PageHeader, PageSkeleton, Select, StatusBadge, Tabs, Textarea, useConfirm, useToast } from '@/components/ui';
import { BulkProblemLookup, CatalogBrowser, type CatalogEntry } from '@/components/manage/ProblemLibrary';
import { useApi } from '@/hooks/useApi';
import { useTrackRecent } from '@/hooks/useRecent';
import { useUrlState } from '@/hooks/useUrlState';
import { api, download, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Chapter, CourseDetail, Problem } from '@/components/manage/types';
/** Client-side preview of the backend's canonical slug rule. The backend is authoritative. */
const previewSlug = (url: string) => { try { const u = new URL(url.trim()); if (!/^(www\.)?leetcode\.com$/.test(u.hostname) || u.protocol !== 'https:') return null; return u.pathname.match(/^\/problems\/([A-Za-z0-9-]{1,100})(\/|$)/)?.[1].toLowerCase() ?? null; } catch { return null; } };
type ProblemBody = { title: string; url: string; difficulty: string };
export default function Page() {
  const { courseId } = useParams<{ courseId: string }>();
  const { user } = useAuth();
  const can = !!user?.canManageCourses;
  const [showArchived, setShowArchived] = useState(false);
  const c = useApi<CourseDetail>(`/courses/${courseId}${can && showArchived ? '?includeArchived=1' : ''}`);
  const [url, setUrl] = useUrlState({ tab: 'content' });
  const tab = url.tab === 'preview' ? 'preview' : 'content';
  useTrackRecent(c.data ? { href: `/manage/courses/${courseId}`, label: c.data.title, kind: 'Course' } : null);
  const toast = useToast(); const confirm = useConfirm();
  const [modal, setModal] = useState<null | { kind: 'course' } | { kind: 'chapter'; ch?: Chapter } | { kind: 'problem'; ch: Chapter; p: Problem }>(null);
  const [busy, setBusy] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [libraryChapterId, setLibraryChapterId] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await c.reload(); return true; } catch (e) { toast.error(errorMessage(e)); return false; } finally { setBusy(false); }
  }
  /** Updates the screen immediately, saves in the background, then refreshes. A failed save reloads the server order. */
  async function reorder(update: (d: CourseDetail) => CourseDetail, call: () => Promise<unknown>) {
    c.setData((d) => (d ? update(d) : d));
    setReordering(true);
    try { await call(); } catch (e) { toast.error(errorMessage(e)); }
    try { await c.reload(); } finally { setReordering(false); }
  }
  if (c.error) return <ErrorState message={c.error} retry={c.reload} />;
  if (!c.data) return <PageSkeleton />;
  const course = c.data;
  const libraryChapter = course.chapters.find((chapter) => chapter._id === libraryChapterId);
  const activeChapters = course.chapters.filter((x) => x.status === 'ACTIVE');
  const problemCount = activeChapters.reduce((a, ch) => a + ch.problems.filter((p) => p.status === 'ACTIVE').length, 0);
  const moveChapter = (ch: Chapter, dir: -1 | 1) => {
    const i = activeChapters.findIndex((x) => x._id === ch._id); const other = activeChapters[i + dir]; if (!other) return;
    void reorder((d) => {
      const list = [...d.chapters]; const a = list.findIndex((x) => x._id === ch._id); const b = list.findIndex((x) => x._id === other._id);
      [list[a], list[b]] = [list[b], list[a]]; return { ...d, chapters: list };
    }, () => api(`/chapters/${ch._id}/reorder`, { method: 'PATCH', body: { position: i + dir } }));
  };
  const moveProblem = (ch: Chapter, p: Problem, dir: -1 | 1) => {
    const ids = ch.problems.filter((x) => x.status === 'ACTIVE').map((x) => x._id);
    const i = ids.indexOf(p._id); const j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void reorder((d) => ({ ...d, chapters: d.chapters.map((x) => {
      if (x._id !== ch._id) return x;
      const active = ids.map((id) => x.problems.find((q) => q._id === id)).filter((q): q is Problem => !!q);
      return { ...x, problems: [...active, ...x.problems.filter((q) => q.status !== 'ACTIVE')] };
    }) }), () => api(`/chapters/${ch._id}/reorder`, { method: 'PATCH', body: { problemIds: ids } }));
  };
  const setStatus = async (status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED', done: string) => {
    if (status === 'ARCHIVED' && !(await confirm({ title: 'Archive this course?', body: 'Archived courses disappear for students in every batch. History is kept and you can restore it.', confirmLabel: 'Archive', danger: true }))) return;
    void run(() => api(`/courses/${courseId}`, { method: 'PATCH', body: { status } }), done);
  };
  const archiveProblem = async (p: Problem) => {
    try {
      await api(`/problems/${p._id}`, { method: 'PATCH', body: { status: 'ARCHIVED' } });
      toast.success('Problem archived', { action: { label: 'Undo', onClick: () => { void run(() => api(`/problems/${p._id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }), 'Problem restored'); } } });
      await c.reload();
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const archiveChapter = async (ch: Chapter) => {
    if (await confirm({ title: `Archive “${ch.title}”?`, body: 'It disappears for students in every batch. Verified progress is kept.', confirmLabel: 'Archive', danger: true }))
      void run(() => api(`/chapters/${ch._id}`, { method: 'PATCH', body: { status: 'ARCHIVED' } }), 'Chapter archived');
  };
  const saveProblem = async (ch: Chapter, p: Problem | undefined, b: ProblemBody) =>
    run(() => p ? api(`/problems/${p._id}`, { method: 'PATCH', body: b }) : api(`/chapters/${ch._id}/problems`, { method: 'POST', body: b }), 'Problem saved');
  const noProblems = !problemCount;
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: 'Courses', href: '/manage/courses' }, { label: course.title }]} title={course.title} meta={<StatusBadge status={course.status} />}
        subtitle={`${activeChapters.length} ${activeChapters.length === 1 ? 'chapter' : 'chapters'} · ${problemCount} ${problemCount === 1 ? 'problem' : 'problems'}`}
        actions={can && <>
          {course.status === 'DRAFT' && <>
            {noProblems && <span className="text-[13px] text-fg-muted">Add at least one problem to publish</span>}
            <Button disabled={noProblems || busy} onClick={() => setStatus('PUBLISHED', 'Course published')}>Publish</Button>
          </>}
          {course.status === 'PUBLISHED' && <Button variant="secondary" disabled={busy} onClick={() => setStatus('DRAFT', 'Course unpublished')}>Unpublish</Button>}
          {course.status === 'ARCHIVED' && <Button disabled={busy} onClick={() => setStatus('DRAFT', 'Course restored')}>Restore</Button>}
          <Menu label="Course actions" items={[
            { label: 'Edit details', icon: <Pencil size={15} aria-hidden />, onSelect: () => setModal({ kind: 'course' }) },
            { label: 'Archive course', icon: <Archive size={15} aria-hidden />, danger: true, hidden: course.status === 'ARCHIVED', onSelect: () => void setStatus('ARCHIVED', 'Course archived') },
          ]} />
        </>} />
      {course.description && <p className="-mt-3 mb-5 max-w-3xl whitespace-pre-line text-sm text-fg-muted">{course.description}</p>}
      {!can && <div className="mb-5"><Notice tone="info">You can view this course. Editing requires course permission from the Super Admin.</Notice></div>}
      <Tabs active={tab} onChange={(k) => setUrl({ tab: k })} tabs={[{ key: 'content', label: 'Content' }, { key: 'preview', label: 'Student preview' }]}>
        {tab === 'content' ? (
          <div className="space-y-4">
            <p className="text-[13px] text-fg-muted">New chapters start hidden in every batch. Changes apply to all batches using this course.</p>
            {can && <div className="flex flex-wrap items-center justify-between gap-3">
              <Button icon={<Plus size={16} aria-hidden />} onClick={() => setModal({ kind: 'chapter' })}>Add chapter</Button>
              <Checkbox label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            </div>}
            {!course.chapters.length && <Card><EmptyState title="No chapters yet" body="Add a chapter, then add LeetCode problems to it."
              action={can ? <Button icon={<Plus size={16} aria-hidden />} onClick={() => setModal({ kind: 'chapter' })}>Add chapter</Button> : undefined} /></Card>}
            {course.chapters.map((ch) => {
              const archived = ch.status !== 'ACTIVE';
              const idx = activeChapters.findIndex((x) => x._id === ch._id);
              const probs = ch.problems.filter((p) => showArchived || p.status === 'ACTIVE');
              const activeProbs = ch.problems.filter((p) => p.status === 'ACTIVE');
              const selected = (picked[ch._id] ?? []).filter((id) => activeProbs.some((p) => p._id === id));
              const select = (ids: string[]) => setPicked((current) => ({ ...current, [ch._id]: ids }));
              return (
                <Card key={ch._id} className={archived ? 'opacity-70' : ''}
                  title={<>{archived ? ch.title : `${idx + 1}. ${ch.title}`}{archived && <Badge className="ml-2">Archived</Badge>}</>}
                  description={`${activeProbs.length} ${activeProbs.length === 1 ? 'problem' : 'problems'}`}
                  actions={can && (archived
                    ? <Button size="sm" variant="secondary" onClick={() => void run(() => api(`/chapters/${ch._id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }), 'Chapter restored')}>Restore</Button>
                    : <>
                      <Button size="sm" variant="secondary" icon={<Plus size={15} aria-hidden />} onClick={() => setLibraryChapterId(ch._id)}>Add problems</Button>
                      <IconButton label="Move chapter up" icon={<ChevronUp size={16} aria-hidden />} disabled={idx === 0 || reordering} onClick={() => moveChapter(ch, -1)} />
                      <IconButton label="Move chapter down" icon={<ChevronDown size={16} aria-hidden />} disabled={idx === activeChapters.length - 1 || reordering} onClick={() => moveChapter(ch, 1)} />
                      <Menu label="Chapter actions" items={[
                        { label: 'Edit chapter', icon: <Pencil size={15} aria-hidden />, onSelect: () => setModal({ kind: 'chapter', ch }) },
                        { label: 'Export problems', icon: <Download size={15} aria-hidden />, onSelect: () => void download(`/chapters/${ch._id}/problems/export`).catch((error) => toast.error(errorMessage(error))) },
                        'separator',
                        { label: 'Archive chapter', icon: <Archive size={15} aria-hidden />, danger: true, onSelect: () => void archiveChapter(ch) },
                      ]} />
                    </>)}>
                  {ch.description && <p className="mb-3 text-sm text-fg-muted">{ch.description}</p>}
                  {can && !archived && activeProbs.length > 0 && <div className="mb-2">
                    <Checkbox label={`Select all in ${ch.title}`} checked={selected.length === activeProbs.length}
                      onChange={(e) => select(e.target.checked ? activeProbs.map((p) => p._id) : [])} />
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
                  {!probs.length ? <p className="text-sm text-fg-muted">No problems in this chapter.</p> : (
                    <ul className="divide-y divide-line">
                      {probs.map((p) => {
                        const pi = activeProbs.findIndex((x) => x._id === p._id);
                        return (
                          <li key={p._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                            {can && !archived && p.status === 'ACTIVE' && <input type="checkbox" className="h-4 w-4" aria-label={`Select ${p.title}`}
                              checked={selected.includes(p._id)} onChange={(e) => select(e.target.checked ? [...selected, p._id] : selected.filter((id) => id !== p._id))} />}
                            <span className="w-6 tabular-nums text-fg-subtle">{p.status === 'ACTIVE' ? pi + 1 : '—'}</span>
                            <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium text-accent-fg hover:underline">{p.title}<ExternalLink size={13} aria-hidden /></a>
                            <DifficultyBadge d={p.difficulty} />{p.status !== 'ACTIVE' && <Badge>Archived</Badge>}
                            {can && <span className="ml-auto flex items-center gap-1">
                              {p.status === 'ACTIVE' ? <>
                                <IconButton label="Move problem up" icon={<ChevronUp size={16} aria-hidden />} disabled={pi === 0 || reordering} onClick={() => moveProblem(ch, p, -1)} />
                                <IconButton label="Move problem down" icon={<ChevronDown size={16} aria-hidden />} disabled={pi === activeProbs.length - 1 || reordering} onClick={() => moveProblem(ch, p, 1)} />
                                <Menu label="Problem actions" items={[
                                  { label: 'Edit problem', icon: <Pencil size={15} aria-hidden />, onSelect: () => setModal({ kind: 'problem', ch, p }) },
                                  { label: 'Archive problem', icon: <Archive size={15} aria-hidden />, onSelect: () => void archiveProblem(p) },
                                ]} />
                              </> : <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/problems/${p._id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }), 'Problem restored')}>Restore</Button>}
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
        ) : (
          <div className="space-y-4">
            <p className="text-[13px] text-fg-muted">Students see only chapters that are visible in their batch.</p>
            {!activeChapters.length && <Card><EmptyState compact title="No chapters yet" /></Card>}
            {activeChapters.map((ch, i) => (
              <Card key={ch._id} title={`${i + 1}. ${ch.title}`}>
                <ul className="space-y-1.5 text-sm">{ch.problems.filter((p) => p.status === 'ACTIVE').map((p) => (
                  <li key={p._id} className="flex items-center justify-between gap-2">
                    <a className="inline-flex items-center gap-1 text-accent-fg hover:underline" href={p.url} target="_blank" rel="noopener noreferrer">{p.title}<ExternalLink size={13} aria-hidden /></a>
                    <DifficultyBadge d={p.difficulty} />
                  </li>))}</ul>
              </Card>
            ))}
          </div>
        )}
      </Tabs>
      {libraryChapter && <AddProblems chapter={libraryChapter} onClose={() => setLibraryChapterId(null)}
        onAdd={async (entries) => {
          const result = await api<{ added: number; alreadyAssigned: number }>(`/problem-library/chapters/${libraryChapter._id}/assign`, {
            method: 'POST', body: { ids: entries.map((entry) => entry._id) },
          });
          await c.reload();
          return result;
        }}
        onSaveManual={(b) => saveProblem(libraryChapter, undefined, b)} />}
      <CourseModal open={modal?.kind === 'course'} course={course} onClose={() => setModal(null)} onSave={(b) => run(() => api(`/courses/${courseId}`, { method: 'PATCH', body: b }), 'Course updated').then((ok) => ok && setModal(null))} busy={busy} />
      <ChapterModal key={modal?.kind === 'chapter' ? modal.ch?._id ?? 'new' : 'x'} open={modal?.kind === 'chapter'} ch={modal?.kind === 'chapter' ? modal.ch : undefined} busy={busy} onClose={() => setModal(null)}
        onSave={(b) => run(() => modal?.kind === 'chapter' && modal.ch ? api(`/chapters/${modal.ch._id}`, { method: 'PATCH', body: b }) : api(`/courses/${courseId}/chapters`, { method: 'POST', body: b }), 'Chapter saved').then((ok) => ok && setModal(null))} />
      <Modal open={modal?.kind === 'problem'} onClose={() => setModal(null)} title="Edit problem">
        {modal?.kind === 'problem' && <ProblemForm key={modal.p._id} initial={modal.p} busy={busy}
          existing={modal.ch.problems.filter((x) => x.status === 'ACTIVE' && x._id !== modal.p._id).map((x) => x.slug)}
          onCancel={() => setModal(null)}
          onSave={async (b) => { if (await saveProblem(modal.ch, modal.p, b)) setModal(null); }} />}
      </Modal>
    </div>
  );
}
function ProblemBulkActions({ count, targets, busy, onApply }: {
  count: number; targets: Chapter[]; busy: boolean;
  onApply: (action: 'archive' | 'copy' | 'move', targetChapterId?: string) => Promise<void>;
}) {
  const [action, setAction] = useState<'archive' | 'copy' | 'move'>('archive');
  const [target, setTarget] = useState('');
  return <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-line bg-subtle p-3">
    <span className="flex items-center gap-1.5 self-center text-sm text-fg"><ListChecks size={16} aria-hidden="true" /> {count} selected</span>
    <div className="w-48"><Select label="Action" value={action} onChange={(e) => setAction(e.target.value as typeof action)}
      options={[{ value: 'archive', label: 'Archive' }, { value: 'copy', label: 'Copy to chapter' }, { value: 'move', label: 'Move to chapter' }]} /></div>
    {action !== 'archive' && <div className="w-48"><Select label="Destination chapter" value={target} onChange={(e) => setTarget(e.target.value)}
      options={[{ value: '', label: 'Choose chapter' }, ...targets.map((item) => ({ value: item._id, label: item.title }))]} /></div>}
    <Button size="sm" loading={busy} disabled={count > 100 || (action !== 'archive' && !target)}
      onClick={() => void onApply(action, action === 'archive' ? undefined : target)}>Apply</Button>
    {count > 100 && <p role="status" className="w-full text-xs text-fg-muted">Select up to 100 problems per action.</p>}
  </div>;
}
function AddProblems({ chapter, onClose, onAdd, onSaveManual }: {
  chapter: Chapter;
  onClose: () => void;
  onAdd: (entries: CatalogEntry[]) => Promise<{ added: number; alreadyAssigned: number }>;
  onSaveManual: (body: ProblemBody) => Promise<boolean>;
}) {
  const [tab, setTab] = useState('browse');
  const [selected, setSelected] = useState<CatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
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
    <Tabs tabs={[{ key: 'browse', label: 'Browse library' }, { key: 'bulk', label: 'Paste list' }, { key: 'manual', label: 'Enter manually' }]}
      active={tab} onChange={(key) => { if (!busy) setTab(key); }} className="!mb-0" />
    {feedback && <div role={feedback.tone === 'error' ? 'alert' : 'status'}><Notice tone={feedback.tone}>{feedback.text}</Notice></div>}
    <div hidden={tab !== 'browse'} className="space-y-3">
      <Card flush><CatalogBrowser assigned={assigned} selected={pending} onSelect={setSelected} onAdd={add} /></Card>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface py-3">
        <span role="status" className="text-sm text-fg">{pending.length} selected</span>
        <Button loading={busy} disabled={!pending.length || pending.length > 100}
          onClick={async () => { if (await add(pending)) setSelected([]); }}>Add {pending.length} {pending.length === 1 ? 'problem' : 'problems'} to chapter</Button>
      </div>
      {pending.length > 100 && <Notice tone="warn">Add up to 100 problems at a time.</Notice>}
    </div>
    {tab === 'bulk' && <BulkProblemLookup assigned={assigned} onAdd={add} />}
    {tab === 'manual' && <ProblemForm key={formKey} existing={assigned} busy={busy}
      onSave={async (b) => {
        setBusy(true); setFeedback(null);
        const ok = await onSaveManual(b);
        setBusy(false);
        if (ok) setFormKey((k) => k + 1);
      }} />}
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
/** Add or edit one problem by LeetCode URL. Used inside the "Enter manually" tab and the "Edit problem" dialog. */
function ProblemForm({ initial, existing, busy, onSave, onCancel }: { initial?: Problem; existing: string[]; busy: boolean; onSave: (b: ProblemBody) => void | Promise<void>; onCancel?: () => void }) {
  const [t, setT] = useState(initial?.title ?? ''); const [u, setU] = useState(initial?.url ?? ''); const [d, setD] = useState<string>(initial?.difficulty ?? 'EASY');
  const slug = previewSlug(u);
  const dup = !!slug && existing.includes(slug);
  const urlErr = u && !slug ? 'Use a link like https://leetcode.com/problems/two-sum/' : dup ? 'This problem is already in this chapter' : undefined;
  const submit = (e: FormEvent) => { e.preventDefault(); if (t.trim() && slug && !dup) void onSave({ title: t, url: u, difficulty: d }); };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="LeetCode URL" value={u} onChange={(e) => setU(e.target.value)} placeholder="https://leetcode.com/problems/two-sum/" error={urlErr} hint={slug ? <>Canonical slug: <code>{slug}</code></> : undefined} autoFocus />
      <Input label="Title" value={t} onChange={(e) => setT(e.target.value)} maxLength={150} placeholder="Two Sum" />
      <Select label="Difficulty" value={d} onChange={(e) => setD(e.target.value)} options={[{ value: 'EASY', label: 'Easy' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HARD', label: 'Hard' }]} />
      <p className="text-xs text-fg-subtle">The same problem may appear in other chapters. Students earn points for it once per ranking scope.</p>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={busy} disabled={!t.trim() || !slug || dup}>Save</Button>
      </div>
    </form>
  );
}
