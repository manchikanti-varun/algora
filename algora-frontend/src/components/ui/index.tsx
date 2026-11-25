'use client';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ---------- Buttons ----------
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-indigo-600',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-rose-600',
  ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:outline-indigo-600',
};
export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm', variants[variant], className)}
      disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}
export const ButtonLink = ({ href, children, variant = 'primary', className }: { href: string; children: ReactNode; variant?: Variant; className?: string }) => (
  <Link href={href} className={cx('inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition', variants[variant], className)}>{children}</Link>
);

// ---------- Layout primitives ----------
export const Card = ({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) => (
  <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
    {(title || actions) && (
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
        {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className="p-5">{children}</div>
  </section>
);
export const PageHeader = ({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) => (
  <div className="mb-6">
    {back && <Link href={back.href} className="mb-2 inline-block text-sm text-indigo-600 hover:underline">← {back.label}</Link>}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  </div>
);
export const StatCard = ({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    <p className={cx('mt-1 text-2xl font-semibold', { default: 'text-slate-900', good: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-rose-600' }[tone])}>{value ?? '—'}</p>
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
);
export const Grid = ({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => (
  <div className={cx('grid gap-4', { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols])}>{children}</div>
);

// ---------- Status ----------
type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'indigo';
const tones: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200', blue: 'bg-sky-50 text-sky-700 ring-sky-200', indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
};
export const Badge = ({ children, tone = 'gray' }: { children: ReactNode; tone?: Tone }) => (
  <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone])}>{children}</span>
);
const STATUS_TONE: Record<string, Tone> = {
  VISIBLE: 'green', ACTIVE: 'green', PUBLISHED: 'green', VERIFIED: 'green', LINKED: 'green', SYNC_SUCCESS: 'green', APPROVED: 'green', CLAIMED: 'green', SUCCESS: 'green',
  DRAFT: 'gray', IDLE: 'gray', INACTIVE: 'gray', COMPLETED: 'blue', SYNCING: 'blue', SYNC_PENDING: 'blue', UNLINKED: 'gray', NO_SUBMISSIONS_OBSERVED: 'gray',
  ARCHIVED: 'gray', CANCELLED: 'gray', SUPERSEDED: 'gray',
  PENDING: 'amber', PENDING_APPROVAL: 'amber', PENDING_VERIFICATION: 'amber', REVALIDATION_REQUIRED: 'amber', RATE_LIMITED: 'amber', PARTIAL: 'amber', VERIFICATION_UNAVAILABLE: 'amber',
  POSSIBLE_EVIDENCE_GAP: 'amber', SUBMISSIONS_UNAVAILABLE: 'amber',
  SUSPENDED: 'red', REJECTED: 'red', REVOKED: 'red', SYNC_FAILED: 'red', PROVIDER_UNAVAILABLE: 'red', FAILED: 'red', ACCOUNT_NOT_FOUND: 'red',
};
export const human = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? 'gray'}>{human(status)}</Badge>;
export const DifficultyBadge = ({ d }: { d: 'EASY' | 'MEDIUM' | 'HARD' | string }) => <Badge tone={d === 'EASY' ? 'green' : d === 'MEDIUM' ? 'amber' : 'red'}>{human(d)}</Badge>;

export function ProgressBar({ value, label, size = 'md' }: { value: number | null; label?: string; size?: 'sm' | 'md' }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className={cx('flex-1 overflow-hidden rounded-full bg-slate-100', size === 'sm' ? 'h-1.5' : 'h-2.5')} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-label={label ?? 'Progress'}>
        <div className={cx('h-full rounded-full transition-all', v >= 100 ? 'bg-emerald-500' : 'bg-indigo-500')} style={{ width: `${v}%` }} />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-slate-600">{value === null ? '—' : `${Math.round(v)}%`}</span>
    </div>
  );
}

/** Horizontal bar chart without a chart library. Values are real numbers from the API. */
export function BarList({ items, max, format = (n) => String(n) }: { items: { label: string; value: number | null; sub?: string }[]; max?: number; format?: (n: number) => string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value ?? 0));
  if (!items.length) return <EmptyState title="No data yet" />;
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-2"><span className="truncate text-slate-700">{i.label}</span><span className="tabular-nums text-slate-500">{i.value === null ? '—' : format(i.value)}{i.sub ? ` · ${i.sub}` : ''}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${((i.value ?? 0) / m) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

// ---------- Feedback ----------
export const Skeleton = ({ className }: { className?: string }) => <div className={cx('animate-pulse rounded-md bg-slate-200/70', className)} aria-hidden />;
export const PageSkeleton = () => (
  <div role="status" aria-label="Loading" className="space-y-4">
    <Skeleton className="h-8 w-64" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
    <Skeleton className="h-64" />
  </div>
);
export const TableSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <div role="status" aria-label="Loading" className="space-y-2">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
);
export const EmptyState = ({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center">
    <p className="font-medium text-slate-700">{title}</p>
    {body && <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">{body}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
export const ErrorState = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
    <span>{message}</span>{retry && <Button variant="secondary" size="sm" onClick={retry}>Retry</Button>}
  </div>
);
export const Notice = ({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: string; children: ReactNode }) => (
  <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-lg border px-4 py-3 text-sm', { info: 'border-sky-200 bg-sky-50 text-sky-900', warn: 'border-amber-200 bg-amber-50 text-amber-900', error: 'border-rose-200 bg-rose-50 text-rose-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-900' }[tone])}>
    {title && <p className="font-medium">{title}</p>}<div className={title ? 'mt-0.5' : ''}>{children}</div>
  </div>
);

// ---------- Forms ----------
export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={id} className="block font-medium text-slate-700">{label}</label>
      {children(id)}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
    </div>
  );
}
const inputCls = 'block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 disabled:bg-slate-50';
export const Input = ({ label, error, hint, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }) => (
  <Field label={label} error={error} hint={hint}>{(id) => <input id={id} className={inputCls} aria-invalid={!!error || undefined} {...p} />}</Field>
);
export const Textarea = ({ label, error, hint, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: ReactNode }) => (
  <Field label={label} error={error} hint={hint}>{(id) => <textarea id={id} className={inputCls} rows={3} {...p} />}</Field>
);
export const Select = ({ label, options, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: { value: string; label: string }[] }) => (
  <Field label={label}>{(id) => <select id={id} className={inputCls} {...p}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}</Field>
);
export const SearchInput = ({ value, onChange, placeholder = 'Search…', label = 'Search', autoFocus = false }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; autoFocus?: boolean }) => (
  <input type="search" autoFocus={autoFocus} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(inputCls, 'max-w-xs')} />
);
export const InlineSelect = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
  <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputCls, 'w-auto')}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
);

// ---------- Table ----------
export interface Column<T> { key: string; header: ReactNode; cell: (row: T) => ReactNode; className?: string; sortable?: boolean }
export function DataTable<T>({ columns, rows, rowKey, empty, sort, onSort, rowClassName }: {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode; sort?: { key: string; dir: 'asc' | 'desc' }; onSort?: (key: string) => void; rowClassName?: (r: T) => string | undefined;
}) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>{columns.map((c) => (
            <th key={c.key} scope="col" className={cx('whitespace-nowrap px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500', c.className)}
              aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              {c.sortable && onSort ? <button className="inline-flex items-center gap-1 hover:text-slate-800" onClick={() => onSort(c.key)}>{c.header}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button> : c.header}
            </th>))}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((r) => <tr key={rowKey(r)} className={cx('hover:bg-slate-50/60', rowClassName?.(r))}>{columns.map((c) => <td key={c.key} className={cx('whitespace-nowrap px-5 py-2.5 text-slate-700', c.className)}>{c.cell(r)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="mt-3 text-xs text-slate-500">{total} {total === 1 ? 'result' : 'results'}</p> : null;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
      <p className="text-slate-500">Page {page} of {pages} · {total} results</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </nav>
  );
}

// ---------- Tabs ----------
export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; hidden?: boolean }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="mb-5 border-b border-slate-200" role="tablist">
      <div className="-mb-px flex gap-4 overflow-x-auto">
        {tabs.filter((t) => !t.hidden).map((t) => (
          <button key={t.key} role="tab" aria-selected={active === t.key} onClick={() => onChange(t.key)}
            className={cx('whitespace-nowrap border-b-2 px-1 pb-2.5 text-sm font-medium', active === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>{t.label}</button>
        ))}
      </div>
    </div>
  );
}

// ---------- Modal / confirm ----------
export function Modal({ open, onClose, title, children, footer, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} className={cx("m-auto max-h-[calc(100dvh-2rem)] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40", wide ? "w-[min(56rem,calc(100vw-2rem))]" : "w-[min(32rem,calc(100vw-2rem))]")} aria-labelledby={titleId}>
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 id={titleId} className="font-semibold text-slate-900">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
          </div>
          <div className="space-y-4 px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

// ---------- Toasts ----------
type ToastT = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: ToastT['tone'], text: string) => void>(() => {});
export const useToast = () => {
  const push = useContext(ToastCtx);
  return { success: (t: string) => push('success', t), error: (t: string) => push('error', t), info: (t: string) => push('info', t) };
};

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const push = useCallback((tone: ToastT['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const done = (v: boolean) => { confirm?.resolve(v); setConfirm(null); };
  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        <Modal open={!!confirm} onClose={() => done(false)} title={confirm?.title ?? ''}
          footer={<><Button variant="secondary" onClick={() => done(false)}>Cancel</Button><Button variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => done(true)} autoFocus>{confirm?.confirmLabel ?? 'Confirm'}</Button></>}>
          {confirm?.body && <div className="text-sm text-slate-600">{confirm.body}</div>}
        </Modal>
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={cx('rounded-lg px-4 py-3 text-sm shadow-lg ring-1', { success: 'bg-emerald-600 text-white ring-emerald-700', error: 'bg-rose-600 text-white ring-rose-700', info: 'bg-slate-800 text-white ring-slate-900' }[t.tone])} role={t.tone === 'error' ? 'alert' : 'status'}>{t.text}</div>
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

// ---------- Formatting ----------
export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export function timeAgo(d?: string | Date | null) {
  if (!d) return 'never';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
