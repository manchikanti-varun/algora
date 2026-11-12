'use client';
import { useEffect, useId, useRef } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from './states';
export function Status({ value }: { value: string }) {
  return (
    <span className={'status-pill status-' + value.toLowerCase()}>
      {value.replaceAll('_', ' ').toLowerCase()}
    </span>
  );
}
export function QueryState({
  pending,
  error,
  onRetry,
  children,
}: {
  pending: boolean;
  error: Error | null;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (pending)
    return (
      <div aria-label="Loading administration data">
        <Skeleton />
        <Skeleton />
      </div>
    );
  if (error)
    return (
      <section className="admin-error" role="alert">
        <AlertCircle size={24} />
        <h2>Administration is unavailable</h2>
        <p>{error.message}</p>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </section>
    );
  return <>{children}</>;
}
export function DataTable<T extends { id: string }>({
  items,
  columns,
  empty = 'Nothing here yet',
}: {
  items: T[];
  columns: {
    key: string;
    label: string;
    render: (item: T) => React.ReactNode;
  }[];
  empty?: string;
}) {
  if (!items.length)
    return (
      <EmptyState
        title={empty}
        description="Results will appear when matching records are available."
      />
    );
  return (
    <div className="data-table-scroll">
      <table className="data-table">
        <caption className="sr-only">Administration records</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {columns.map((c) => (
                <td key={c.key}>{c.render(item)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <nav className="pagination" aria-label="Results pages">
      <span>
        {total} records · Page {page} of {Math.max(1, totalPages)}
      </span>
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          aria-label="Previous page"
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          aria-label="Next page"
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </nav>
  );
}
export function SearchFilter({
  search,
  onSearch,
  status,
  onStatus,
  statuses,
  sort,
  onSort,
  sorts,
}: {
  search: string;
  onSearch: (value: string) => void;
  status: string;
  onStatus: (value: string) => void;
  statuses: string[];
  sort?: string;
  onSort?: (value: string) => void;
  sorts?: { value: string; label: string }[];
}) {
  return (
    <div className="table-controls">
      <label className="search-box">
        <Search size={17} />
        <span className="sr-only">Search records</span>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search records…"
          maxLength={100}
        />
      </label>
      <select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => onStatus(e.target.value)}
      >
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {s.toLowerCase()}
          </option>
        ))}
      </select>
      {onSort && (
        <select
          aria-label="Sort records"
          value={sort}
          onChange={(e) => onSort(e.target.value)}
        >
          {sorts?.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
export function Dialog({
  open,
  title,
  onClose,
  busy = false,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="admin-dialog"
      aria-labelledby={id}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <Button
          variant="ghost"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </header>
      {open && children}
    </dialog>
  );
}
export function Confirmation({
  open,
  title,
  description,
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Dialog open={open} title={title} onClose={onClose} busy={busy}>
      <p className="dialog-description">{description}</p>
      <div className="dialog-actions">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          {busy ? 'Saving…' : 'Confirm'}
        </Button>
      </div>
    </Dialog>
  );
}
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="form-field">
      <span className="field-label">{label}</span>
      {children}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
