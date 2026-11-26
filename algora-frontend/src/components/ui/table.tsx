'use client';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, IconButton } from './button';
import { EmptyState } from './feedback';
import { cx } from './format';
import { Popover } from './overlay';

export interface Column<T> {
  key: string; header: ReactNode; cell: (row: T) => ReactNode; className?: string;
  /** Server-side sortable (only set this when the API supports sorting by `key`). */
  sortable?: boolean;
  /** Can be hidden by the user. `defaultHidden` starts it hidden. */
  optional?: boolean; defaultHidden?: boolean;
  /** Plain-text name used in the column chooser when `header` is not a string. */
  name?: string;
  align?: 'left' | 'right';
}

function useColumnVisibility<T>(columns: Column<T>[], storageKey?: string) {
  const [vis, setVis] = useState<Record<string, boolean>>(() => {
    const d = Object.fromEntries(columns.filter((c) => c.optional).map((c) => [c.key, !c.defaultHidden]));
    if (!storageKey || typeof window === 'undefined') return d;
    try { return { ...d, ...(JSON.parse(localStorage.getItem(`algora.cols.${storageKey}`) ?? 'null') ?? {}) }; } catch { return d; }
  });
  const set = (key: string, on: boolean) => setVis((v) => {
    const n = { ...v, [key]: on };
    if (storageKey) try { localStorage.setItem(`algora.cols.${storageKey}`, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  return { visible: (c: Column<T>) => !c.optional || vis[c.key] !== false, vis, set };
}

/** Column chooser used by DataTable when `columnsKey` is set. */
function ColumnChooser<T>({ columns, vis, set }: { columns: Column<T>[]; vis: Record<string, boolean>; set: (k: string, on: boolean) => void }) {
  const optional = columns.filter((c) => c.optional);
  return (
    <Popover label="Choose columns" button={<><Columns3 size={15} aria-hidden />Columns</>} variant="ghost" size="sm">
      <p className="mb-2 text-xs font-medium text-fg-subtle">Show columns</p>
      <ul className="space-y-1.5">
        {optional.map((c) => (
          <li key={c.key}><label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" className="h-4 w-4" checked={vis[c.key] !== false} onChange={(e) => set(c.key, e.target.checked)} />{c.name ?? (typeof c.header === 'string' ? c.header : c.key)}</label></li>
        ))}
      </ul>
    </Popover>
  );
}

/**
 * Data table. Put it in a `Card flush`. Horizontal overflow scrolls inside the table, never the page.
 * `onRowClick` makes rows clickable (keep a real link in the first cell for keyboard and screen-reader users).
 * The scroll wrapper is `relative` so visually hidden content (the caption) stays inside it and cannot widen the page.
 */
export function DataTable<T>({ columns, rows, rowKey, empty, sort, onSort, rowClassName, columnsKey, toolbar, caption, onRowClick }: {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode; sort?: { key: string; dir: 'asc' | 'desc' }; onSort?: (key: string) => void;
  rowClassName?: (r: T) => string | undefined; columnsKey?: string; toolbar?: ReactNode; caption?: string; onRowClick?: (r: T) => void;
}) {
  const { visible, vis, set } = useColumnVisibility(columns, columnsKey);
  const cols = columns.filter(visible);
  const hasChooser = !!columnsKey && columns.some((c) => c.optional);
  return (
    <div>
      {(toolbar || hasChooser) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {hasChooser && <ColumnChooser columns={columns} vis={vis} set={set} />}
        </div>
      )}
      {!rows.length ? (empty ?? <EmptyState title="Nothing here yet" compact />) : (
        <div className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2" role="region" aria-label={caption ?? 'Table'} tabIndex={0}>
          <table className="min-w-full text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr className="border-b border-line bg-subtle">
                {cols.map((c) => (
                  <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cx('whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-fg-muted', c.align === 'right' && 'text-right', c.className)}>
                    {c.sortable && onSort
                      ? <button type="button" className="inline-flex items-center gap-1 rounded hover:text-fg" onClick={() => onSort(c.key)}>
                        {c.header}{sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
                      </button>
                      : c.header}
                  </th>))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={rowKey(r)} onClick={onRowClick ? (e) => { if ((e.target as HTMLElement).closest('a,button,input,select,label,[role="menuitem"]')) return; onRowClick(r); } : undefined}
                  className={cx('border-b border-line last:border-0 transition-colors hover:bg-hover/60', onRowClick && 'cursor-pointer', rowClassName?.(r))}>
                  {cols.map((c) => <td key={c.key} className={cx('whitespace-nowrap px-4 py-3 text-fg', c.align === 'right' && 'text-right', c.className)}>{c.cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** "1–25 of 140" with previous / next. Renders inside a Card footer or below a table. */
export function Pagination({ page, pageSize, total, onPage, className }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; className?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!total) return null;
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  return (
    <nav className={cx('flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] text-fg-muted', className)} aria-label="Pagination">
      <p className="tabular-nums">{total <= pageSize ? `${total} ${total === 1 ? 'result' : 'results'}` : `${from}–${to} of ${total}`}</p>
      {pages > 1 && <div className="flex items-center gap-1">
        <IconButton label="Previous page" icon={<ChevronLeft size={16} />} disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="px-1 tabular-nums">{page} / {pages}</span>
        <IconButton label="Next page" icon={<ChevronRight size={16} />} disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>}
    </nav>
  );
}

/** Active filters as removable chips plus "Clear all". */
export function FilterChips({ chips, onClear }: { chips: { key: string; label: ReactNode; onRemove: () => void }[]; onClear: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent-fg ring-1 ring-inset ring-accent-line">
          {c.label}
          <button type="button" onClick={c.onRemove} aria-label={`Remove filter ${typeof c.label === 'string' ? c.label : ''}`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-accent-line"><X size={11} /></button>
        </span>
      ))}
      <Button variant="ghost" size="xs" onClick={onClear}>Clear all</Button>
    </div>
  );
}
