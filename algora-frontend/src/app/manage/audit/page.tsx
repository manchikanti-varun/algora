'use client';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, DataTable, DateInput, EmptyState, ErrorState, FilterChips, fmtDateTime, IconButton, InlineSelect, Input, Modal, PageHeader, Pagination, Popover, TableSkeleton } from '@/components/ui';
import { useApi, useDebounced } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { qs } from '@/lib/api';
import { AUDIT_GROUPS, auditLabel } from '@/lib/status';
import type { Paged } from '@/components/manage/types';
interface Log { _id: string; action: string; targetType?: string; targetId?: string; metadata?: unknown; ip?: string; createdAt: string; actorId?: { fullName: string; role: string } | null; actorRole?: string }
const roleLabel = (r: string) => r.toLowerCase().replace(/_/g, ' ');
const actorOf = (l: Log) => (l.actorId ? { name: l.actorId.fullName, role: roleLabel(l.actorId.role) } : { name: l.actorRole ? roleLabel(l.actorRole) : 'Anonymous', role: '' });
const shortId = (id?: string) => (id && id.length > 8 ? `…${id.slice(-6)}` : id ?? '');
const startOf = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const endOf = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);
const keyLabel = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
function MetaValue({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === '') return <span className="text-fg-subtle">—</span>;
  if (typeof v === 'object') return <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-subtle p-2 font-mono text-xs text-fg">{JSON.stringify(v, null, 2)}</pre>;
  if (typeof v === 'boolean') return <>{v ? 'Yes' : 'No'}</>;
  return <span className="break-words">{String(v)}</span>;
}
function Details({ log }: { log: Log }) {
  const meta = log.metadata && typeof log.metadata === 'object' && !Array.isArray(log.metadata) ? Object.entries(log.metadata as Record<string, unknown>) : null;
  const a = actorOf(log);
  const rows: [string, React.ReactNode][] = [
    ['Action', <span key="a">{auditLabel(log.action)} <span className="font-mono text-xs text-fg-subtle">{log.action}</span></span>],
    ['When', fmtDateTime(log.createdAt)],
    ['Actor', `${a.name}${a.role ? ` (${a.role})` : ''}`],
    ['Target type', log.targetType ?? '—'],
    ['Target ID', log.targetId ? <span key="t" className="break-all font-mono text-xs">{log.targetId}</span> : '—'],
    ['IP address', log.ip ? <span key="ip" className="font-mono text-xs">{log.ip}</span> : '—'],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
        {rows.map(([k, val]) => <div key={k} className="contents"><dt className="text-fg-subtle">{k}</dt><dd className="min-w-0 text-fg">{val}</dd></div>)}
      </dl>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-fg">Recorded details</h3>
        {meta === null
          ? (log.metadata ? <MetaValue v={log.metadata} /> : <p className="text-sm text-fg-subtle">No further details were recorded.</p>)
          : !meta.length ? <p className="text-sm text-fg-subtle">No further details were recorded.</p>
          : <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">{meta.map(([k, val]) => <div key={k} className="contents"><dt className="text-fg-subtle">{keyLabel(k)}</dt><dd className="min-w-0 text-fg"><MetaValue v={val} /></dd></div>)}</dl>}
      </div>
    </div>
  );
}
export default function Page() {
  const [u, setU, reset] = useUrlState({ category: '', action: '', from: '', to: '', page: '1' });
  const page = Number(u.page) || 1;
  const da = useDebounced(u.action.trim());
  const prefix = da || u.category;
  const logs = useApi<Paged<Log>>(`/audit-logs${qs({ action: prefix, from: startOf(u.from), to: endOf(u.to), page, pageSize: 50 })}`);
  const [open, setOpen] = useState<Log | null>(null);
  const group = AUDIT_GROUPS.find((g) => g.value === u.category);
  const chips = [
    u.category && { key: 'category', label: group?.label ?? u.category, onRemove: () => setU({ category: '', page: '1' }) },
    u.action && { key: 'action', label: `Action starts with “${u.action}”`, onRemove: () => setU({ action: '', page: '1' }) },
    u.from && { key: 'from', label: `From ${u.from}`, onRemove: () => setU({ from: '', page: '1' }) },
    u.to && { key: 'to', label: `To ${u.to}`, onRemove: () => setU({ to: '', page: '1' }) },
  ].filter((c): c is { key: string; label: string; onRemove: () => void } => !!c);
  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="A record of security-relevant actions: approvals, suspensions, enrollment, access changes, scoring, exports and sign-ins." />
      <Card flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <InlineSelect label="Category" value={u.category} onChange={(category) => setU({ category, page: '1' })} options={[{ value: '', label: 'All categories' }, ...AUDIT_GROUPS]} />
          <DateInput label="From date" value={u.from} onChange={(from) => setU({ from, page: '1' })} labelHidden={false} />
          <DateInput label="To date" value={u.to} onChange={(to) => setU({ to, page: '1' })} labelHidden={false} />
          <Popover label="More filters" button="More filters" align="start">
            <Input label="Action starts with" value={u.action} onChange={(e) => setU({ action: e.target.value, page: '1' })} placeholder="e.g. trainer." hint="Overrides the category when set." />
          </Popover>
        </div>
        {chips.length > 0 && <div className="border-b border-line px-4 py-2"><FilterChips chips={chips} onClear={reset} /></div>}
        {logs.error ? <ErrorState message={logs.error} retry={logs.reload} /> : !logs.data ? <TableSkeleton rows={10} /> : (
          <>
            <DataTable rows={logs.data.items} rowKey={(l) => l._id} caption="Audit log entries"
              empty={<EmptyState compact title="No entries" body={chips.length ? 'No entries match these filters.' : undefined} action={chips.length ? <Button variant="secondary" size="sm" onClick={reset}>Clear filters</Button> : undefined} />}
              columns={[
                { key: 't', header: 'When', cell: (l) => fmtDateTime(l.createdAt) },
                { key: 'a', header: 'Action', cell: (l) => <div><p>{auditLabel(l.action)}</p><p className="font-mono text-xs text-fg-subtle">{l.action}</p></div> },
                { key: 'u', header: 'Actor', cell: (l) => { const a = actorOf(l); return <div><p>{a.name}</p>{a.role && <p className="text-xs capitalize text-fg-subtle">{a.role}</p>}</div>; } },
                { key: 'g', header: 'Target', cell: (l) => l.targetType ? <div><p className="text-[13px]">{keyLabel(l.targetType)}</p><p className="font-mono text-xs text-fg-subtle" title={l.targetId}>{shortId(l.targetId)}</p></div> : '—' },
                { key: 'd', header: <span className="sr-only">Details</span>, align: 'right', cell: (l) => <IconButton label="Show details" icon={<ChevronRight size={16} aria-hidden />} onClick={() => setOpen(l)} /> },
              ]} />
            <Pagination page={page} pageSize={logs.data.pageSize} total={logs.data.total} onPage={(p) => setU({ page: String(p) })} />
          </>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Event details" wide>{open && <Details log={open} />}</Modal>
    </div>
  );
}
