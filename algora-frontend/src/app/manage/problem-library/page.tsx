'use client';

import { useState } from 'react';
import { CatalogBrowser } from '@/components/manage/ProblemLibrary';
import { Button, Card, fmtDateTime, Input, Modal, Notice, PageHeader, Select, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/lib/auth';
import { api, download, errorMessage } from '@/lib/api';

type ImportResult = {
  applied: boolean;
  errorCsv: string | null;
  counts: Record<string, number>;
  rows: { row: number; slug?: string; status: string; message?: string; details?: { path: string; message: string }[] }[];
};
type Dataset = { csv: string } | { rows: unknown[] };

export default function Page() {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState<'import' | 'manual' | 'history' | null>(null);
  const [version, setVersion] = useState(0);
  function changed() { setVersion((value) => value + 1); }

  return <>
    <PageHeader title="Problem Library" subtitle="Search reusable LeetCode metadata by number, title, topic, or URL."
      actions={user?.role === 'SUPER_ADMIN' && <>
        <Button variant="ghost" onClick={() => setOpen('history')}>Import history</Button>
        <Button variant="secondary" onClick={() => setOpen('manual')}>Add entry</Button>
        <Button onClick={() => setOpen('import')}>Import metadata</Button>
      </>} />
    <Card><CatalogBrowser key={version} /></Card>
    {open === 'import' && <CatalogImport onClose={() => setOpen(null)} onImport={changed} />}
    {open === 'history' && <ImportHistory onClose={() => setOpen(null)} />}
    {open === 'manual' && <ManualEntry onClose={() => setOpen(null)} onSave={() => {
      changed(); setOpen(null); toast.success('Catalog entry saved');
    }} />}
  </>;
}

function CatalogImport({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const [source, setSource] = useState('');
  const [update, setUpdate] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  async function load(file?: File) {
    setDataset(null); setResult(null); setError(''); setFileName('');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 800_000) throw new Error('Choose a file up to 800 KB');
      const content = await file.text();
      const name = file.name.toLowerCase();
      if (name.endsWith('.csv')) setDataset({ csv: content });
      else if (name.endsWith('.json')) {
        const rows: unknown = JSON.parse(content);
        if (!Array.isArray(rows)) throw new Error('Supply a JSON array of catalog entries');
        setDataset({ rows });
      } else throw new Error('Choose a CSV or JSON file');
      setFileName(file.name);
    } catch (e) { setError(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function submit(apply: boolean) {
    setError(''); setBusy(true);
    try {
      if (dataset && new TextEncoder().encode(JSON.stringify({ ...dataset, source, update, apply })).length > 1_000_000) {
        setError('This file exceeds the import request limit. Split it into smaller files.');
        return;
      }
      const response = await api<ImportResult>('/problem-library/import', { method: 'POST', body: { ...dataset, source, update, apply } });
      setResult(response);
      if (apply) onImport();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return <Modal open title="Import problem metadata" onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Use a dataset with reuse rights for the problem metadata. Include titles, links and identifiers only.</p>
      <Button variant="secondary" size="sm" onClick={() => void download('/problem-library/template').catch((e) => setError(errorMessage(e)))}>Download CSV template</Button>
      <Input label="Source and access reference" value={source} maxLength={150} disabled={busy}
        onChange={(e) => { setSource(e.target.value); setResult(null); }} />
      <div className="rounded border border-dashed border-slate-300 p-3" onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (!busy) void load(e.dataTransfer.files[0]); }}>
        <Input label="Choose or drop a CSV or JSON file" type="file" accept=".csv,.json" disabled={busy}
          onChange={(e) => void load(e.target.files?.[0])} />
        {fileName && <p className="text-sm">{fileName}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={update} disabled={busy}
        onChange={(e) => { setUpdate(e.target.checked); setResult(null); }} /> Update existing metadata with the same slug</label>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy} disabled={!dataset || !source.trim()} onClick={() => submit(false)}>Preview import</Button>
        <Button disabled={busy || !result || result.applied || !(result.counts.INSERT || result.counts.UPDATE)} onClick={() => submit(true)}>Apply import</Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {result && <>
        {result.errorCsv && <Button variant="secondary" size="sm" onClick={() => {
          const url = URL.createObjectURL(new Blob([result.errorCsv!], { type: 'text/csv' }));
          const link = Object.assign(document.createElement('a'), { href: url, download: 'catalog-import-errors.csv' });
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Download error report</Button>}
        <p role="status" className="text-sm">{result.applied ? 'Import results' : 'Preview'} · {Object.entries(result.counts).map(([status, count]) => `${count} ${status.toLowerCase().replaceAll('_', ' ')}`).join(' · ')}</p>
        <div className="max-h-52 overflow-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Row</th><th>Problem</th><th>Result</th></tr></thead>
          <tbody>{result.rows.map((row) => <tr key={row.row} className="border-t border-slate-100">
            <td>{row.row}</td><td>{row.slug ?? '—'}</td><td>{row.status.toLowerCase().replaceAll('_', ' ')}
              {row.message && ` · ${row.message}`}{row.details?.map((detail) => ` · ${detail.path} ${detail.message}`)}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </div>
  </Modal>;
}

function ImportHistory({ onClose }: { onClose: () => void }) {
  const result = useApi<{ items: {
    _id: string; createdAt: string; actorId?: { fullName: string };
    metadata: { source: string; rows: number; counts: Record<string, number> };
  }[] }>('/audit-logs?action=catalog.import&pageSize=20');
  return <Modal open wide title="Recent catalog imports" onClose={onClose}>
    {result.loading && <p role="status">Loading imports…</p>}
    {result.error && <Notice tone="error">{result.error} <Button onClick={result.reload}>Retry</Button></Notice>}
    {result.data?.items.length === 0 && <p>No catalog imports yet.</p>}
    <ul className="divide-y divide-slate-100 text-sm">
      {result.data?.items.map((entry) => <li key={entry._id} className="space-y-1 py-3">
        <p className="break-words font-medium">{entry.metadata.source}</p>
        <p className="text-slate-600">{fmtDateTime(entry.createdAt)} · {entry.actorId?.fullName ?? 'Super Admin'} · {entry.metadata.rows} rows</p>
        <p className="text-slate-600">{Object.entries(entry.metadata.counts).map(([status, count]) => `${count} ${status.toLowerCase().replaceAll('_', ' ')}`).join(' · ')}</p>
      </li>)}
    </ul>
  </Modal>;
}

function ManualEntry({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [problemNumber, setNumber] = useState('');
  const [difficulty, setDifficulty] = useState('EASY');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Modal open title="Add catalog entry" onClose={() => { if (!busy) onClose(); }}>
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true); setError('');
      try {
        await api('/problem-library', { method: 'POST', body: {
          title, url, difficulty, ...(problemNumber ? { problemNumber: Number(problemNumber) } : {}),
        } });
        onSave();
      } catch (e) { setError(errorMessage(e)); }
      finally { setBusy(false); }
    }}>
      <Input label="Title" required maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input label="LeetCode URL" type="url" required maxLength={300} value={url} onChange={(e) => setUrl(e.target.value)} />
      <Input label="Problem number (optional)" type="number" min={1} max={99999999} value={problemNumber} onChange={(e) => setNumber(e.target.value)} />
      <Select label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
        options={['EASY', 'MEDIUM', 'HARD'].map((value) => ({ value, label: value }))} />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" loading={busy}>Save entry</Button>
    </form>
  </Modal>;
}
