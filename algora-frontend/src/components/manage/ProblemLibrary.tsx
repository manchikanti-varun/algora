'use client';

import { useRef, useState } from 'react';
import { Button, DifficultyBadge, Input, Notice, Select, Textarea } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { api, errorMessage, qs } from '@/lib/api';

export type CatalogEntry = {
  _id: string;
  problemNumber?: number;
  title: string;
  slug: string;
  url: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topics: string[];
  isPremium?: boolean;
};

export function CatalogBrowser({ assigned = [], selected, onSelect, onAdd }: {
  assigned?: string[];
  selected?: CatalogEntry[];
  onSelect?: (entries: CatalogEntry[]) => void;
  onAdd?: (entries: CatalogEntry[]) => Promise<boolean>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [topic, setTopic] = useState('');
  const [premium, setPremium] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const search = useDebounced(query);
  const searchTopic = useDebounced(topic);
  const result = useApi<{ items: CatalogEntry[]; total: number; catalogTotal: number; numbered: number }>(
    '/problem-library' + qs({ q: search, difficulty, topic: searchTopic, premium, page, pageSize: 15 }),
  );
  const filtered = !!(query || difficulty || topic || premium);
  const pending = result.loading || query !== search || topic !== searchTopic;
  const visible = pending ? [] : result.data?.items ?? [];
  const eligible = visible.filter((entry) => !assigned.includes(entry.slug));
  const selectedIds = new Set(selected?.map((entry) => entry._id));
  const allSelected = eligible.length > 0 && eligible.every((entry) => selectedIds.has(entry._id));
  const exact = /^\d+$/.test(query.trim()) && eligible.length === 1 && eligible[0].problemNumber === Number(query) ? eligible[0] : null;

  async function addExact() {
    if (!exact || !onAdd || busy) return;
    setBusy(true);
    try {
      if (await onAdd([exact])) {
        setQuery('');
        const field = formRef.current?.elements.namedItem('catalog-search');
        if (field instanceof HTMLInputElement) field.focus();
      }
    } finally { setBusy(false); }
  }

  return <div className="space-y-3">
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); void addExact(); }} className="grid gap-3 sm:grid-cols-2">
      <Input name="catalog-search" label="Problem number, title, slug or URL" value={query} maxLength={300}
        onChange={(event) => { setQuery(event.target.value); setPage(1); }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void addExact();
        }} />
      <Input label="Topic" value={topic} maxLength={60} onChange={(event) => { setTopic(event.target.value); setPage(1); }} />
      <Select label="Difficulty" value={difficulty} onChange={(event) => { setDifficulty(event.target.value); setPage(1); }}
        options={[{ value: '', label: 'All difficulties' }, ...['EASY', 'MEDIUM', 'HARD'].map((value) => ({ value, label: value }))]} />
      <Select label="Availability" value={premium} onChange={(event) => { setPremium(event.target.value); setPage(1); }}
        options={[{ value: '', label: 'All availability' }, { value: 'false', label: 'Free' }, { value: 'true', label: 'Premium' }]} />
      {exact && onAdd && <Button type="submit" loading={busy}>Add {exact.title}</Button>}
    </form>
    {filtered && <Button size="sm" variant="ghost" onClick={() => { setQuery(''); setDifficulty(''); setTopic(''); setPremium(''); setPage(1); }}>Clear filters</Button>}
    {pending && <p role="status">Searching the library…</p>}
    {!pending && result.error && <Notice tone="error">{result.error} <Button size="sm" onClick={result.reload}>Retry</Button></Notice>}
    {!pending && !result.error && visible.length === 0 && <p role="status">No matching problems. Adjust the filters or enter the problem manually.</p>}
    {!onSelect && result.data && <p className="text-sm text-slate-500">{result.data.catalogTotal} catalog entries · {result.data.numbered} with problem numbers</p>}
    {visible.length > 0 && <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-slate-200">
          {onSelect && <th className="p-2"><input type="checkbox" aria-label="Select all available results" checked={allSelected} disabled={!eligible.length}
            onChange={() => onSelect(allSelected ? selected!.filter((entry) => !eligible.some((item) => item._id === entry._id))
              : [...selected!, ...eligible.filter((entry) => !selectedIds.has(entry._id))])} /></th>}
          {['Number', 'Title', 'Difficulty', 'Topics', 'Availability'].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}
        </tr></thead>
        <tbody>{visible.map((entry) => <tr key={entry._id} className="border-b border-slate-100">
          {onSelect && <td className="p-2"><input type="checkbox" aria-label={`Select ${entry.title}`} disabled={assigned.includes(entry.slug)} checked={selectedIds.has(entry._id)}
            onChange={() => onSelect(selectedIds.has(entry._id) ? selected!.filter((item) => item._id !== entry._id) : [...selected!, entry])} /></td>}
          <td className="p-2 tabular-nums">{entry.problemNumber ?? '—'}</td>
          <td className="p-2"><a className="font-medium hover:underline" href={entry.url} target="_blank" rel="noopener noreferrer">{entry.title}</a>
            {assigned.includes(entry.slug) && <span className="block text-xs text-slate-500">Already added</span>}</td>
          <td className="p-2"><DifficultyBadge d={entry.difficulty} /></td>
          <td className="p-2">{entry.topics.join(', ') || '—'}</td>
          <td className="p-2">{entry.isPremium === undefined ? 'Unknown' : entry.isPremium ? 'Premium' : 'Free'}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {!pending && (result.data?.total ?? 0) > 15 && result.data && <div className="flex items-center gap-3 text-sm">
      <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
      <span>Page {page} of {Math.ceil(result.data.total / 15)}</span>
      <Button size="sm" variant="secondary" disabled={page * 15 >= result.data.total} onClick={() => setPage(page + 1)}>Next</Button>
    </div>}
  </div>;
}

type Resolved = { identifier: string; status: string; problem?: CatalogEntry };

export function BulkProblemLookup({ assigned, onAdd }: { assigned: string[]; onAdd: (entries: CatalogEntry[]) => Promise<boolean> }) {
  const [input, setInput] = useState('');
  const [rows, setRows] = useState<Resolved[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligible = rows.flatMap((row) => row.status === 'MATCHED' && row.problem && !assigned.includes(row.problem.slug) ? [row.problem] : []);
  const unresolved = rows.some((row) => !row.problem);
  async function preview() {
    setBusy(true);
    setError('');
    setRows([]);
    try { setRows((await api<{ rows: Resolved[] }>('/problem-library/resolve', { method: 'POST', body: { input } })).rows); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <Textarea label="Problem identifiers" hint="Use commas or new lines. A list of problem numbers can also use spaces." value={input} rows={4} maxLength={16000}
      disabled={busy} onChange={(event) => { setInput(event.target.value); setRows([]); setError(''); }} />
    <Button variant="secondary" loading={busy} disabled={!input.trim()} onClick={preview}>Preview matches</Button>
    {error && <Notice tone="error">{error}</Notice>}
    {!!rows.length && <ul className="divide-y divide-slate-100 text-sm" aria-label="Bulk match preview">
      {rows.map((row, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span>{row.identifier}{row.problem && ` · ${row.problem.title}`}{row.problem?.isPremium && ' · Premium'}</span>
        <span>{row.problem && assigned.includes(row.problem.slug) ? 'Already assigned' : row.status.toLowerCase().replaceAll('_', ' ')}</span>
        {!row.problem && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>Remove entry</Button>}
      </li>)}
    </ul>}
    {!!rows.length && <Button disabled={!eligible.length || unresolved} loading={busy} onClick={async () => {
      setBusy(true);
      try { if (await onAdd(eligible)) { setRows([]); setInput(''); } }
      finally { setBusy(false); }
    }}>Add {eligible.length} {eligible.length === 1 ? 'problem' : 'problems'} to chapter</Button>}
  </div>;
}
