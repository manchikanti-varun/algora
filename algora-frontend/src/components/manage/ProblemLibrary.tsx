'use client';

import { useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button, ButtonLink, type Column, DataTable, DifficultyBadge, EmptyState, ErrorState, FilterChips, InlineSelect, Input, Notice, Pagination, Popover, SearchInput, Select, TableSkeleton, Textarea } from '@/components/ui';
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

const DIFFICULTIES = [{ value: '', label: 'All difficulties' }, { value: 'EASY', label: 'Easy' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HARD', label: 'Hard' }];
const AVAILABILITY = [{ value: '', label: 'All availability' }, { value: 'false', label: 'Free' }, { value: 'true', label: 'Premium' }];
const PAGE_SIZE = 15;
export function CatalogBrowser({ assigned = [], selected, onSelect, onAdd, preparation }: {
  preparation?: boolean;
  assigned?: string[];
  selected?: CatalogEntry[];
  onSelect?: (entries: CatalogEntry[]) => void;
  onAdd?: (entries: CatalogEntry[]) => Promise<boolean>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [topic, setTopic] = useState('');
  const [premium, setPremium] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const search = useDebounced(query);
  const searchTopic = useDebounced(topic);
  const result = useApi<{ items: CatalogEntry[]; total: number; catalogTotal: number; numbered: number }>(
    '/problem-library' + qs({ q: search, difficulty, topic: searchTopic, premium, page, pageSize: PAGE_SIZE }),
  );
  const pending = result.loading || query !== search || topic !== searchTopic;
  const visible = pending ? [] : result.data?.items ?? [];
  const eligible = visible.filter((entry) => !assigned.includes(entry.slug));
  const selectedIds = new Set(selected?.map((entry) => entry._id));
  const allSelected = eligible.length > 0 && eligible.every((entry) => selectedIds.has(entry._id));
  const exact = /^\d+$/.test(query.trim()) && eligible.length === 1 && eligible[0].problemNumber === Number(query) ? eligible[0] : null;
  const chips = [
    difficulty && { key: 'difficulty', label: `Difficulty: ${DIFFICULTIES.find((o) => o.value === difficulty)?.label}`, onRemove: () => { setDifficulty(''); setPage(1); } },
    topic && { key: 'topic', label: `Topic: ${topic}`, onRemove: () => { setTopic(''); setPage(1); } },
    premium && { key: 'premium', label: `Availability: ${AVAILABILITY.find((o) => o.value === premium)?.label}`, onRemove: () => { setPremium(''); setPage(1); } },
  ].filter((chip): chip is { key: string; label: string; onRemove: () => void } => !!chip);
  const clearAll = () => { setDifficulty(''); setTopic(''); setPremium(''); setPage(1); };
  async function addExact() {
    if (!exact || !onAdd || busy) return;
    setBusy(true);
    try {
      if (await onAdd([exact])) {
        setQuery('');
        rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      }
    } finally { setBusy(false); }
  }
  const columns: Column<CatalogEntry>[] = [
    ...(onSelect ? [{
      key: 'sel', className: 'w-10',
      header: <input type="checkbox" className="h-4 w-4" aria-label="Select all available results" checked={allSelected} disabled={!eligible.length}
        onChange={() => onSelect(allSelected ? selected!.filter((entry) => !eligible.some((item) => item._id === entry._id))
          : [...selected!, ...eligible.filter((entry) => !selectedIds.has(entry._id))])} />,
      cell: (entry: CatalogEntry) => <input type="checkbox" className="h-4 w-4" aria-label={`Select ${entry.title}`} disabled={assigned.includes(entry.slug)} checked={selectedIds.has(entry._id)}
        onChange={() => onSelect(selectedIds.has(entry._id) ? selected!.filter((item) => item._id !== entry._id) : [...selected!, entry])} />,
    }] : []),
    { key: 'n', header: 'Number', cell: (entry) => <span className="tabular-nums">{entry.problemNumber ?? '—'}</span> },
    { key: 't', header: 'Title', cell: (entry) => <div>
      <a className="font-medium text-accent-fg hover:underline" href={entry.url} target="_blank" rel="noopener noreferrer">{entry.title}</a>
      {assigned.includes(entry.slug) && <span className="block text-xs text-fg-subtle">Already added</span>}
    </div> },
    { key: 'd', header: 'Difficulty', cell: (entry) => <DifficultyBadge d={entry.difficulty} /> },
    { key: 'topics', header: 'Topics', optional: true, cell: (entry) => <span className="block max-w-xs truncate text-fg-muted">{entry.topics.join(', ') || '—'}</span> },
    { key: 'a', header: 'Availability', optional: true, cell: (entry) => entry.isPremium === undefined ? 'Unknown' : entry.isPremium ? 'Premium' : 'Free' },
    ...(preparation ? [{ key: 'prep', header: 'Preparation', cell: (entry: CatalogEntry) => <ButtonLink size="sm" variant="ghost"
      href={`/manage/ai-preparation?library=${entry._id}`}>AI Preparation</ButtonLink> }] : []),
  ];
  return <div ref={rootRef}>
    <DataTable rows={visible} rowKey={(entry) => entry._id} columns={columns} caption="Problem library"
      toolbar={<>
        <SearchInput label="Problem number, title, slug or URL" placeholder="Search by number, title, slug or URL" value={query}
          onChange={(v) => { setQuery(v.slice(0, 300)); setPage(1); }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void addExact();
          }} />
        <InlineSelect label="Difficulty" value={difficulty} onChange={(v) => { setDifficulty(v); setPage(1); }} options={DIFFICULTIES} />
        <Popover label="More filters" button={<><SlidersHorizontal size={15} aria-hidden />More filters</>} variant="secondary" size="sm" align="start">
          <div className="space-y-3">
            <Input label="Topic" value={topic} maxLength={60} onChange={(event) => { setTopic(event.target.value); setPage(1); }} />
            <Select label="Availability" value={premium} onChange={(event) => { setPremium(event.target.value); setPage(1); }} options={AVAILABILITY} />
          </div>
        </Popover>
        {exact && onAdd && <Button size="sm" loading={busy} onClick={() => void addExact()}>Add {exact.title}</Button>}
      </>}
      empty={pending ? <TableSkeleton />
        : result.error ? <div className="p-4"><ErrorState message={result.error} retry={result.reload} /></div>
          : <EmptyState compact title="No matching problems" body="Adjust the filters or enter the problem manually." />} />
    {chips.length > 0 && <div className="border-t border-line px-4 py-2.5"><FilterChips chips={chips} onClear={clearAll} /></div>}
    {!onSelect && result.data && <p className="border-t border-line px-4 py-2.5 text-[13px] text-fg-muted">{result.data.catalogTotal} catalog entries · {result.data.numbered} with problem numbers</p>}
    {!pending && result.data && <Pagination page={page} pageSize={PAGE_SIZE} total={result.data.total} onPage={setPage} className="border-t border-line" />}
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
    {!!rows.length && <ul className="divide-y divide-line text-sm" aria-label="Bulk match preview">
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
