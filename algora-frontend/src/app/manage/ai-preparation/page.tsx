'use client';
import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge, Button, Card, Checkbox, DataTable, DifficultyBadge, ErrorState, Grid, Notice, PageHeader, Select, StatCard, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, download, errorMessage, qs } from '@/lib/api';

const base = '/ai/preparation';
interface Option { _id: string; title: string; aiLanguage?: string }
interface PrepStatus { status: string; updatedAt?: string; version: number }
interface Problem extends PrepStatus { id: string; title: string; number?: number; catalogId?: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; topics: string[] }
interface Job { _id: string; status: string; active: boolean; tasks: { problemId?: string; status: string; error?: string }[] }
interface Chapter {
  course: { title: string }; chapter: { title: string; description?: string }; guide: PrepStatus;
  problems: Problem[]; canEdit: boolean; enabled: boolean; jobs: Job[];
}
interface Scope { chapterId: string; problemId?: string; language: string }
interface Material { content: Record<string, unknown>; version: number; status: string; model?: string; provider?: string; editedBy?: string; reviewedAt?: string; sectionReviews?: Record<string, { at: string }>; history: { version: number; status: string; content: Record<string, unknown> }[] }
interface Hint { level: number; text: string; status: string; version: number }
const label = (s: string) => s.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const title = (s: string) => label(s.replace(/([A-Z])/g, ' $1').trim());
const option = (item: Option) => ({ value: item._id, label: item.title });

export default function Page() {
  return <Suspense fallback={<p>Loading preparation…</p>}><Workspace /></Suspense>;
}

function Workspace() {
  const params = useSearchParams();
  const library = params.get('library');
  const [course, setCourse] = useState(params.get('courseId') ?? '');
  const [chapter, setChapter] = useState(params.get('chapterId') ?? '');
  const [chosenLanguage, setLang] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [show, setShow] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [coursePage, setCoursePage] = useState(1);
  const [chapterPage, setChapterPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const [showUsage, setShowUsage] = useState(false);
  const toast = useToast();
  const courses = useApi<{ items: Option[]; languages: string[]; more: boolean }>(`${base}/courses?page=${coursePage}`);
  const lang = chosenLanguage || courses.data?.items.find((item) => item._id === course)?.aiLanguage || 'Java';
  const chapters = useApi<{ items: Option[]; more: boolean }>(course && !library ? `${base}/courses/${course}/chapters?page=${chapterPage}` : null);
  const view = useApi<Chapter>(chapter && !library ? `${base}/chapters/${chapter}${qs({ language: lang })}` : null);
  const standaloneJob = useApi<Omit<Job, '_id' | 'active'>>(library && jobId ? `${base}/jobs/${jobId}` : null);
  const usage = useApi<{ items: { _id: { workload: string; status: string }; requests: number; outbound: number }[] }>(
    course && showUsage ? `${base}/usage/${course}` : null,
  );
  const scope = { chapterId: library ? 'library' : chapter, problemId: library ?? problem, language: lang };
  async function generate(action: string, targetProblem?: string, section?: string, confirm?: boolean) {
    setBusy(true);
    try {
      const result = await api<{ job: Job | null }>(`${base}/generate`, { method: 'POST',
        body: { ...scope, problemId: targetProblem, action, selected: picked, section, confirm, notes } });
      toast.success(result.job ? 'Generation queued' : 'Current material is ready to reuse');
      setJobId(result.job?._id);
      void view.reload();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const select = (id?: string) => { setProblem(id); setShow(true); };
  const doc = view.data;
  const prepared = doc?.problems.filter((p) => !['NOT_PREPARED', 'OUTDATED'].includes(p.status)) ?? [];
  const difficulty = ['EASY', 'MEDIUM', 'HARD'].map((d) => `${doc?.problems.filter((p) => p.difficulty === d).length ?? 0} ${d.toLowerCase()}`).join(' · ');
  const canGenerate = doc?.enabled && !busy;
  return (
    <div className="space-y-5">
      <PageHeader title="AI Teaching Preparation" subtitle="Generate complete problem preparation and chapter teaching guides with GPT-OSS 120B."
        actions={doc && <Badge tone={doc.enabled ? 'success' : 'neutral'} dot>{doc.enabled ? 'Generation available' : 'Generation unavailable'}</Badge>} />
      <div className="print:hidden"><Card>
        <div className="grid gap-3 sm:grid-cols-3">
          {!library && <>
            <Select label="Course" value={course} onChange={(e) => { setCourse(e.target.value); setLang(''); setChapter(''); setChapterPage(1); setPicked([]); setShow(false); }}
              options={[{ value: '', label: 'Select a course' }, ...(courses.data?.items ?? []).map(option)]} />
            <Select label="Chapter" value={chapter} disabled={!course} onChange={(e) => { setChapter(e.target.value); setPicked([]); setShow(false); }}
              options={[{ value: '', label: 'Select a chapter' }, ...(chapters.data?.items ?? []).map(option)]} />
          </>}
          <Select label="Programming language" value={lang} onChange={(e) => { setLang(e.target.value); setPicked([]); }}
            options={(courses.data?.languages ?? ['Java']).map((x) => ({ value: x, label: x }))} />
        </div>
        {!library && <div className="mt-2 flex flex-wrap gap-2">
          {coursePage > 1 && <Button size="sm" variant="ghost" onClick={() => setCoursePage(coursePage - 1)}>Previous courses</Button>}
          {courses.data?.more && <Button size="sm" variant="ghost" onClick={() => setCoursePage(coursePage + 1)}>More courses</Button>}
          {chapterPage > 1 && <Button size="sm" variant="ghost" onClick={() => setChapterPage(chapterPage - 1)}>Previous chapters</Button>}
          {chapters.data?.more && <Button size="sm" variant="ghost" onClick={() => setChapterPage(chapterPage + 1)}>More chapters</Button>}
        </div>}
        {course && !library && doc?.canEdit && <Button size="sm" variant="ghost" onClick={() => void api(`${base}/courses/${course}/language`, {
          method: 'PUT', body: { language: lang },
        }).then(() => { toast.success('Course language saved'); void courses.reload(); }).catch((e) => toast.error(errorMessage(e)))}>Set as course language</Button>}
        <details className="mt-3 rounded-lg border border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg">Optional teaching notes</summary>
          <div className="border-t border-line p-3">
            <Textarea label="Known constraints or excerpts" rows={3} maxLength={2400} value={notes} onChange={(e) => setNotes(e.target.value)}
              hint="Relevant excerpts are sent to the configured Groq provider. Remove confidential or personal information." />
          </div>
        </details>
      </Card></div>
      {(courses.error || chapters.error || view.error) && <ErrorState message={courses.error ?? chapters.error ?? view.error!} retry={() => void (view.error ? view.reload() : chapters.error ? chapters.reload() : courses.reload())} />}
      {library && <Card title="Problem Library preparation" actions={<Button size="sm" onClick={() => void generate('problem', library)} loading={busy}>Prepare problem</Button>}>
        {jobId && <div className="flex items-center gap-2"><p>Job status {label(standaloneJob.data?.status ?? 'QUEUED')}</p><Button size="sm" variant="ghost" onClick={() => void standaloneJob.reload()}>Refresh progress</Button></div>}
      </Card>}
      {course && !library && <Card title="Course AI usage" actions={<Button size="sm" variant="ghost" onClick={() => setShowUsage(!showUsage)}>{showUsage ? 'Hide usage' : 'Show usage'}</Button>}>
        {showUsage && (usage.error ? <ErrorState message={usage.error} retry={usage.reload} /> : usage.data?.items.length ? (
          <ul>{usage.data.items.map((item) => <li key={JSON.stringify(item._id)} className="text-sm">
            {label(item._id.workload)} · {label(item._id.status)} · {item.requests} events · {item.outbound} provider attempts
          </li>)}</ul>
        ) : <p className="text-sm text-fg-muted">{usage.loading ? 'Loading usage…' : 'No activity in the last 30 days.'}</p>)}
      </Card>}
      {doc && <div className="space-y-5 print:hidden">
        <Card title={doc.chapter.title} description={[doc.course.title, doc.chapter.description, difficulty].filter(Boolean).join(' · ')}>
          <Grid>
            <StatCard label="Assigned" value={doc.problems.length} />
            <StatCard label="Prepared" value={prepared.length} />
            <StatCard label="Unprepared" value={doc.problems.length - prepared.length} />
            <StatCard label="Reviewed or ready" value={prepared.filter((p) => ['REVIEWED', 'READY'].includes(p.status)).length} />
            <StatCard label="Drafts" value={prepared.filter((p) => p.status === 'DRAFT').length} />
            <StatCard label="Preparation progress" value={`${doc.problems.length ? Math.round(100 * prepared.length / doc.problems.length) : 0}%`} />
          </Grid>
          <p className="mt-3 text-sm text-fg-muted">Teaching guide {label(doc.guide.status)}{doc.guide.updatedAt ? ` · ${new Date(doc.guide.updatedAt).toLocaleString()}` : ''}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void generate('chapter')} disabled={!canGenerate}>Generate Complete Chapter Preparation</Button>
            <Button variant="secondary" onClick={() => select()}>View chapter guide</Button>
            <Button variant="secondary" disabled={!canGenerate} onClick={() => void generate('remaining')}>Prepare remaining</Button>
            <Button variant="secondary" disabled={!canGenerate || !picked.length} onClick={() => void generate('selected')}>Prepare selected</Button>
            <Button variant="secondary" disabled={!canGenerate} onClick={() => void generate('refresh')}>Refresh outdated</Button>
            <Button variant="secondary" disabled={!canGenerate} onClick={() => void generate('retry')}>Retry failed</Button>
            <Button variant="ghost" onClick={() => void download(`${base}/export${qs({ chapterId: chapter, language: lang })}`).catch((e) => toast.error(errorMessage(e)))}>Export chapter</Button>
          </div>
          {!doc.enabled && <Notice tone="warn">Generation is unavailable because the Staff workload is disabled or no eligible Groq configuration is active. Saved preparation remains accessible.</Notice>}
        </Card>
        {!!doc.jobs.length && <Card title="Generation progress" actions={<Button size="sm" variant="ghost" onClick={() => void view.reload()}>Refresh progress</Button>}>
          <ul className="space-y-2">{doc.jobs.map((job) => <li key={job._id} className="text-sm">
            <strong>{label(job.status)}</strong> · {job.tasks.filter((task) => ['DRAFT', 'REUSED'].includes(task.status)).length}/{job.tasks.length} complete
            {job.status === 'PAUSED' && <Button size="sm" variant="secondary" onClick={() => void api(`${base}/jobs/${job._id}/resume`, { method: 'POST' }).then(view.reload).catch((e) => toast.error(errorMessage(e)))}>Resume job</Button>}
            {job.active && job.status !== 'GENERATING' && <Button size="sm" variant="ghost" onClick={() => void api(`${base}/jobs/${job._id}/cancel`, { method: 'POST' }).then(view.reload).catch((e) => toast.error(errorMessage(e)))}>Cancel job</Button>}
            <ul className="mt-1 pl-4">{job.tasks.map((task) => <li key={task.problemId ?? 'guide'}>
              {doc.problems.find((p) => p.id === task.problemId)?.title ?? 'Chapter guide'} · {label(task.status)}{task.error && ` · ${task.error}`}
            </li>)}</ul>
          </li>)}</ul>
        </Card>}
        <Card title="Assigned problems" flush>
          <DataTable caption="Assigned chapter problems" rows={doc.problems} rowKey={(p) => p.id}
            empty={<p className="px-5 py-6 text-sm text-fg-muted">No assigned problems.</p>}
            columns={[
              { key: 'select', header: 'Select', cell: (p) => <Checkbox label={<span className="sr-only">Select {p.title}</span>} checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((id) => id !== p.id))} /> },
              { key: 'problem', header: 'Problem', cell: (p) => <div className="min-w-52 whitespace-normal"><p className="font-medium text-fg">{p.number ? `#${p.number} · ` : ''}{p.title}</p><p className="mt-0.5 text-xs text-fg-muted">{p.topics.join(', ') || 'Topics unavailable'}</p></div> },
              { key: 'difficulty', header: 'Difficulty', cell: (p) => <DifficultyBadge d={p.difficulty} /> },
              { key: 'status', header: 'Preparation', cell: (p) => <StatusBadge status={p.status} /> },
              { key: 'updated', header: 'Last generated', optional: true, cell: (p) => p.updatedAt ? new Date(p.updatedAt).toLocaleString() : 'Not generated' },
              { key: 'actions', header: 'Actions', align: 'right', cell: (p) => <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => select(p.id)}>View preparation</Button><Button size="sm" variant="ghost" disabled={!canGenerate} onClick={() => void generate('problem', p.id)}>Prepare</Button></div> },
            ]} />
        </Card>
      </div>}
      {(library || (show && doc)) && <MaterialView key={JSON.stringify(scope)} scope={scope} generate={generate} busy={busy} enabled={!!library || !!doc?.enabled} />}
    </div>
  );
}

function MaterialView({ scope, generate, busy, enabled }: { scope: Scope; generate: (action: string, problem?: string, section?: string, confirm?: boolean) => Promise<void>; busy: boolean; enabled: boolean }) {
  const q = qs({ ...scope });
  const view = useApi<{ material: Material | null; hints: Hint[]; canEdit: boolean; outdated: boolean; context: { title?: string } }>(`${base}/material${q}`);
  const toast = useToast();
  const [edit, setEdit] = useState<string | null>(null);
  const [section, setSection] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState('material');
  const [working, setWorking] = useState(false);
  const data = view.data;
  const material = data?.material;
  async function save(status: string, reviewSection?: string) {
    if (!material) return;
    setWorking(true);
    try {
      await api(`${base}/material`, { method: 'PATCH', body: { ...scope, status, reviewSection, version: material.version, ...(edit === null ? {} : { content: JSON.parse(edit) }) } });
      setEdit(null);
      await view.reload();
      toast.success('Preparation saved');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setWorking(false); }
  }
  return <Card title={data?.context.title ?? (scope.problemId ? 'Problem preparation' : 'Chapter teaching guide')}
    description="Staff only. Generated reference code requires review before teaching.">
    {view.error && <ErrorState message={view.error} retry={view.reload} />}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
      <Tabs active={tab} onChange={setTab} className="mb-0" tabs={[{ key: 'material', label: 'Preparation' }, { key: 'chat', label: 'Ask a follow-up' }]} />
      <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" onClick={() => void view.reload()}>Reload material</Button>
      {material && <Button size="sm" variant="ghost" onClick={() => window.print()}>Print preparation</Button>}
      <Button size="sm" variant="ghost" onClick={() => void download(`${base}/export${q}`).catch((e) => toast.error(errorMessage(e)))}>Export</Button>
      </div>
    </div>
    {tab === 'chat' ? <StaffChat scope={scope} enabled={enabled} /> : material ? (
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">{label(material.status)} · Version {material.version}{material.provider && ` · ${material.provider}`}{material.model && ` · ${material.model}`}{material.editedBy && ' · Staff edited'}{material.reviewedAt && ` · Reviewed ${new Date(material.reviewedAt).toLocaleString()}`}</p>
        {data?.outdated && <Notice tone="warn">The assigned context changed. Review this material before teaching.</Notice>}
        {edit === null ? <Sections data={material.content} /> : <Textarea label="Preparation fields and reference code (JSON)" rows={18} className="font-mono" value={edit} onChange={(e) => setEdit(e.target.value)} />}
        {data?.canEdit && <div className="flex flex-wrap gap-2 print:hidden">
          {edit === null ? <Button variant="secondary" onClick={() => setEdit(JSON.stringify(material.content, null, 2))}>Edit material</Button> : <>
            <Button loading={working} onClick={() => void save('DRAFT')}>Save draft</Button>
            <Button variant="secondary" onClick={() => setEdit(null)}>Cancel editing</Button>
          </>}
          <Button variant="secondary" disabled={working} onClick={() => void save('REVIEWED')}>Mark reviewed</Button>
          <Button variant="secondary" disabled={working} onClick={() => void save('READY')}>Ready for teaching</Button>
        </div>}
        {data?.canEdit && <div className="space-y-2 print:hidden">
          <Select label="Regeneration scope" value={section} onChange={(e) => { setSection(e.target.value); setConfirm(false); }}
            options={[{ value: '', label: scope.problemId ? 'Whole problem' : 'Chapter summary' }, ...Object.keys(material.content).map((field) => ({ value: field, label: title(field) }))]} />
          {section && edit === null && <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={working} onClick={() => void save('REVIEWED', section)}>Review selected section</Button>
            {material.sectionReviews?.[section] && <span className="text-xs text-fg-muted">Reviewed {new Date(material.sectionReviews[section].at).toLocaleString()}</span>}
          </div>}
          <Checkbox label="Save a new draft version and keep the previous content in history" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <Button variant="secondary" disabled={!confirm || busy || !enabled} onClick={() => { void generate(section ? 'section' : scope.problemId ? 'problem' : 'summary', scope.problemId, section || undefined, confirm); setConfirm(false); }}>Regenerate</Button>
        </div>}
        {scope.problemId && scope.chapterId !== 'library' && data?.canEdit && <div className="space-y-3 print:hidden">
          <h3 className="font-semibold">Student-safe hints</h3>
          <p className="text-sm text-fg-muted">Review each hint for solution disclosure before publishing it separately.</p>
          {[1, 2, 3, 4].map((level) => {
            const current = data.hints.find((hint) => hint.level === level);
            const suggestions = material.content.hints;
            return <HintEditor key={`${level}:${current?.version ?? material.version}`} scope={scope} level={level} current={current}
              proposed={Array.isArray(suggestions) ? String(suggestions[level - 1] ?? '') : ''} refresh={view.reload} />;
          })}
        </div>}
        {!!material.history.length && <details className="print:hidden"><summary className="cursor-pointer font-medium">Version history</summary>
          {material.history.map((record) => <details key={record.version} className="my-2"><summary>Version {record.version} · {label(record.status)}</summary><Sections data={record.content} /></details>)}
        </details>}
      </div>
    ) : <p className="text-sm text-fg-muted">{view.loading ? 'Loading preparation…' : 'No saved preparation for this selection.'}</p>}
  </Card>;
}

function Sections({ data }: { data: Record<string, unknown> }) {
  const approaches = Array.isArray(data.approaches) ? data.approaches as Record<string, string>[] : [];
  return <div className="space-y-4">
    {typeof data.understanding === 'string' && <section><h3 className="font-semibold">Problem understanding</h3><p className="whitespace-pre-wrap text-sm">{data.understanding}</p></section>}
    {!!approaches.length && <section className="space-y-3">
      <h3 className="font-semibold">Complexity comparison</h3>
      <div className="overflow-x-auto"><table className="w-full min-w-160 text-left text-sm">
        <thead><tr>{['Approach', 'Time', 'Auxiliary space', 'Difficulty', 'Suitability', 'Trade-offs', 'Teaching order'].map((name) => <th key={name} className="border-b border-line p-2">{name}</th>)}</tr></thead>
        <tbody>{approaches.map((item, index) => <tr key={index}>{['name', 'time', 'space', 'difficulty', 'suitability', 'tradeoffs', 'teachingOrder'].map((key) => <td key={key} className="border-b border-line p-2 align-top">{item[key]}</td>)}</tr>)}</tbody>
      </table></div>
      {approaches.map((item, index) => <details key={index} className="rounded-lg border border-line p-3" open>
        <summary className="cursor-pointer font-medium">{item.name}</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm">{item.idea}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm">{item.algorithm}</p>
        <h4 className="mt-3 font-medium">Complexity derivation</h4><p className="whitespace-pre-wrap text-sm">{item.derivation}</p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-subtle p-3 text-xs"><code>{item.code}</code></pre>
        <p className="mt-2 whitespace-pre-wrap text-sm">{item.mistakes}</p>
      </details>)}
    </section>}
    {Object.entries(data).filter(([key]) => !['understanding', 'approaches', 'hints'].includes(key)).map(([key, value]) => <section key={key}>
      <h3 className="font-semibold">{key === 'mistakes' ? 'Anticipated mistakes' : title(key)}</h3>
      <p className="whitespace-pre-wrap break-words text-sm">{String(value)}</p>
    </section>)}
  </div>;
}

function HintEditor({ scope, level, current, proposed, refresh }: { scope: Scope; level: number; current?: Hint; proposed: string; refresh: () => Promise<void> }) {
  const [text, setText] = useState(current?.text ?? proposed);
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  async function save(status: string) {
    setSaving(true);
    try {
      await api(`${base}/hints`, { method: 'PUT', body: { ...scope, level, text, status, version: current?.version ?? 0, ...(status === 'PUBLISHED' ? { reviewed } : {}) } });
      await refresh();
      toast.success('Hint saved');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setSaving(false); }
  }
  return <div className="space-y-2 rounded-md border border-line p-3">
    <Textarea label={`Level ${level} hint · ${current ? label(current.status) : 'Unpublished draft'}`} maxLength={600} value={text}
      onChange={(e) => { setText(e.target.value); setReviewed(false); }} />
    <Checkbox label="I reviewed this hint for solution disclosure" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={!text.trim() || saving} onClick={() => void save('DRAFT')}>Save hint draft</Button>
      <Button size="sm" disabled={!text.trim() || saving || !reviewed} onClick={() => void save('PUBLISHED')}>Publish hint</Button>
      {current?.status === 'PUBLISHED' && <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save('UNPUBLISHED')}>Unpublish hint</Button>}
    </div>
  </div>;
}

function StaffChat({ scope, enabled }: { scope: Scope; enabled: boolean }) {
  const thread = useApi<{ turns: { question: string; answer: string; at: string }[] }>(`${base}/conversations${qs({ ...scope })}`);
  const [question, setQuestion] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`${base}/conversations`, { method: 'POST', body: { ...scope, question, consent, requestKey: crypto.randomUUID() } });
      setQuestion('');
      await thread.reload();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={ask} className="space-y-3">
    {thread.error && <ErrorState message={thread.error} retry={thread.reload} />}
    {thread.data?.turns.map((turn, index) => <div key={index} className="space-y-2 rounded-md border border-line p-3">
      <p className="font-medium">{turn.question}</p>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs">{turn.answer}</pre>
    </div>)}
    <Textarea label="Technical or teaching question" required rows={3} maxLength={4000} value={question} onChange={(e) => setQuestion(e.target.value)} />
    <Checkbox label="I understand the question and relevant context are sent to configured AI providers" description="Remove credentials, personal details and confidential information." checked={consent} onChange={(e) => setConsent(e.target.checked)} />
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={!enabled || !consent || !question.trim()} loading={busy}>Ask a follow-up</Button>
      {!!thread.data?.turns.length && <Button variant="ghost" disabled={busy} onClick={() => void api(`${base}/conversations${qs({ ...scope })}`, { method: 'DELETE' }).then(thread.reload).catch((e) => toast.error(errorMessage(e)))}>Delete conversation</Button>}
    </div>
  </form>;
}
