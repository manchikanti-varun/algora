'use client';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, DifficultyBadge, ErrorState, Input, Modal, Notice, Select, Textarea } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, ApiError, errorMessage, qs } from '@/lib/api';
import { readAiDraft, rememberAiDraft } from '@/lib/aiDrafts';
import { useAuth } from '@/lib/auth';

const modes = ['Hint', 'Get started', 'Debug my code', 'Failing tests', 'Compilation error', 'Runtime error', 'Time limit', 'Memory limit', 'Explain a concept', 'Review my attempt'];
const hintLevels = ['Understanding', 'Observation', 'Direction', 'Refinement'];
const base = '/student/ai';
interface Turn { requestKey: string; mode: string; question?: string; answer: Record<string, string> }
interface Conversation { _id: string; language: string; level: number; updatedAt?: string; turns: Turn[] }
interface Availability {
  enabled: boolean; provider: boolean; remaining: number; languages: string[]; codeLimit: number;
  problem: { title: string; number?: number; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; course: string; chapter: string };
}
interface Selection { batchCourseId: string; problemId: string }

interface MentorProps { selection: Selection; chapterAvailable: boolean; onAvailabilityChange: () => Promise<void> }

export default function StudentMentor({ close, ...props }: MentorProps & { close: () => void }) {
  return <Modal open onClose={close} title="AI Coding Mentor" wide><Mentor {...props} /></Modal>;
}

function Mentor({ selection, chapterAvailable, onAvailabilityChange }: MentorProps) {
  const { user } = useAuth();
  const query = qs({ ...selection });
  const available = useApi<Availability>(`${base}/availability${query}`);
  const conversations = useApi<{ items: Conversation[] }>(available.data ? `${base}/conversations${query}` : null);
  const [selected, setSelected] = useState<string | null>(null);
  const conversationId = selected === '' ? null : selected ?? conversations.data?.items[0]?._id;
  const conversation = useApi<Conversation>(conversationId ? `${base}/conversations/${conversationId}` : null);
  const [language, setLanguage] = useState('Java');
  const key = `${user?.id}:${selection.batchCourseId}:${selection.problemId}`;
  const [draft, setDraft] = useState<Record<string, string>>(() => readAiDraft(key));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [appended, setAppended] = useState<{ id: string; turn: Turn; level: number; remaining: number } | null>(null);
  const change = (field: string, value: string) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    rememberAiDraft(key, next);
  };
  const mode = draft.mode ?? 'Hint';
  const guide = available.data;
  const enabled = !!guide?.enabled && chapterAvailable;
  const local = appended?.id === conversationId ? appended : null;
  const remaining = appended?.remaining ?? guide?.remaining ?? 0;
  const level = local?.level ?? conversation.data?.level ?? 0;
  const turns = conversation.data?.turns ?? [];
  const shown = local && !turns.some((turn) => turn.requestKey === local.turn.requestKey) ? [...turns, local.turn] : turns;
  const code = !['Hint', 'Get started', 'Explain a concept'].includes(mode);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      let id = conversationId;
      if (!id) {
        const c = await api<Conversation>(`${base}/conversations`, { method: 'POST', body: { ...selection, language } });
        id = c._id;
        setSelected(id);
        void conversations.reload();
      }
      const fields = [...['question'], ...(code ? ['code'] : []),
        ...(['Debug my code', 'Compilation error', 'Runtime error'].includes(mode) ? ['error'] : []),
        ...(mode === 'Failing tests' ? ['result', 'passed', 'total', 'input', 'expected', 'actual'] : []),
        ...(['Time limit', 'Memory limit'].includes(mode) ? ['constraints', 'result'] : [])];
      const values = Object.fromEntries(fields.filter((field) => draft[field]?.trim()).map((field) =>
        [field, ['passed', 'total'].includes(field) ? Number(draft[field]) : draft[field]]));
      const result = await api<{ turn: Turn; level: number; remaining: number }>(`${base}/conversations/${id}/messages`, {
        method: 'POST', body: { ...values, mode, consent, requestKey: crypto.randomUUID() },
      });
      setAppended({ id, ...result });
      void conversation.reload();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && [403, 404].includes(err.status)) {
        void available.reload();
        void onAvailabilityChange();
      }
    }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!conversationId) return;
    setBusy(true);
    setError('');
    try { await api(`${base}/conversations/${conversationId}`, { method: 'DELETE' }); setSelected(''); void conversations.reload(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  if (available.error) return <ErrorState message={available.error} retry={available.reload} />;
  if (!guide) return <p role="status">Loading problem context…</p>;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{guide.problem.number ? `#${guide.problem.number} · ` : ''}{guide.problem.title} <DifficultyBadge d={guide.problem.difficulty} /></h3>
        <p className="text-sm text-fg-muted">{guide.problem.course} · {guide.problem.chapter}</p>
        <p className="text-sm text-fg-muted">{remaining} assistance requests remaining today</p>
      </div>
      {!enabled ? <Notice tone="info">Ask AI is unavailable. You can read your previous conversations.</Notice> :
        !guide.provider && <Notice tone="info">The AI provider is unavailable. Published hints may still be available.</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Conversation" value={conversationId ?? ''} disabled={busy} onChange={(event) => setSelected(event.target.value)}
          options={[{ value: '', label: enabled ? 'New conversation' : 'Select a conversation' }, ...(conversations.data?.items ?? []).map((item) => ({ value: item._id, label: `${item.language} · ${new Date(item.updatedAt!).toLocaleString()}` }))]} />
        {enabled && conversationId && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void remove()}>Delete conversation</Button>}
      </div>
      {(conversations.error || conversation.error) && <ErrorState message={conversations.error ?? conversation.error!} retry={() => void (conversation.error ? conversation.reload() : conversations.reload())} />}
      <div className="space-y-3" aria-live="polite">
        {shown.map((turn) => <article key={turn.requestKey} className="space-y-1 rounded-lg border border-line p-3">
          <h4 className="font-medium">{turn.mode}</h4>
          {turn.question && <p className="whitespace-pre-wrap text-sm text-fg-muted">{turn.question}</p>}
          {Object.entries(turn.answer).map(([field, value]) => value && <p key={field} className="whitespace-pre-wrap text-sm break-words">{value}</p>)}
        </article>)}
      </div>
      {enabled && <form className="space-y-3" onSubmit={send}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Assistance mode" value={mode} onChange={(e) => change('mode', e.target.value)} options={modes.map((option) => ({ value: option, label: option }))} />
          {code && <Select label="Programming language" value={conversation.data?.language ?? language} disabled={!!conversationId} onChange={(e) => setLanguage(e.target.value)}
            options={guide.languages.map((option) => ({ value: option, label: option }))} />}
        </div>
        <Textarea label={mode === 'Explain a concept' ? 'Concept in this problem' : 'Doubt, attempted approach or relevant excerpt (optional)'}
          rows={2} maxLength={2000} value={draft.question ?? ''} onChange={(e) => change('question', e.target.value)} />
        {code && <Textarea label="Your attempted code" rows={6} className="font-mono" required maxLength={guide.codeLimit}
          value={draft.code ?? ''} onChange={(e) => change('code', e.target.value)} />}
        {['Debug my code', 'Compilation error', 'Runtime error'].includes(mode) && <Input label="Error message or observed behavior" required={mode !== 'Debug my code'} maxLength={1500} value={draft.error ?? ''} onChange={(e) => change('error', e.target.value)} />}
        {['Time limit', 'Memory limit'].includes(mode) && <Input label="Known constraints (optional)" maxLength={1200} value={draft.constraints ?? ''} onChange={(e) => change('constraints', e.target.value)} />}
        {['Failing tests', 'Time limit', 'Memory limit'].includes(mode) && <Input label="Submission result (optional)" maxLength={250} value={draft.result ?? ''} onChange={(e) => change('result', e.target.value)} />}
        {mode === 'Failing tests' && <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Passed tests (optional)" type="number" min={0} value={draft.passed ?? ''} onChange={(e) => change('passed', e.target.value)} />
          <Input label="Total tests (optional)" type="number" min={1} value={draft.total ?? ''} onChange={(e) => change('total', e.target.value)} />
          {[['input', 'Failing input', 650], ['expected', 'Expected output', 350], ['actual', 'Actual output', 350]].map(([id, label, max]) =>
            <Input key={id} label={`${label} (optional)`} maxLength={Number(max)} value={draft[id] ?? ''} onChange={(e) => change(String(id), e.target.value)} />)}
        </div>}
        <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} label="I understand that relevant content may be sent to configured AI providers."
          description="Remove credentials, personal details and confidential code before sending." />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" loading={busy} disabled={!consent || !guide.enabled || !remaining || conversations.loading || (!!conversationId && conversation.loading) || (mode === 'Hint' && level >= 4)}>
          {mode === 'Hint' ? level >= 4 ? 'All hint levels viewed' : `Request ${hintLevels[level].toLowerCase()} hint` : 'Ask for guidance'}
        </Button>
      </form>}
    </div>
  );
}
