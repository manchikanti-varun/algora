'use client';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { cx } from './format';

export const Skeleton = ({ className }: { className?: string }) => <div className={cx('animate-pulse rounded-md bg-subtle', className)} aria-hidden />;
export const PageSkeleton = () => (
  <div role="status" aria-label="Loading" className="space-y-6">
    <div className="space-y-2"><Skeleton className="h-3 w-32" /><Skeleton className="h-7 w-64" /></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[84px]" />)}</div>
    <Skeleton className="h-64" />
  </div>
);
export const TableSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <div role="status" aria-label="Loading" className="space-y-2 p-1">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
);

export const EmptyState = ({ title, body, action, icon: Icon, compact }: { title: string; body?: ReactNode; action?: ReactNode; icon?: LucideIcon; compact?: boolean }) => (
  <div className={cx('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-12')}>
    {Icon && <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-subtle text-fg-subtle"><Icon size={18} aria-hidden /></span>}
    <p className="text-sm font-medium text-fg">{title}</p>
    {body && <div className="mt-1 max-w-sm text-sm text-fg-muted">{body}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorState = ({ message, retry, title = 'Something went wrong' }: { message: string; retry?: () => void; title?: string }) => (
  <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm">
    <div className="flex items-start gap-2.5">
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger-fg" aria-hidden />
      <div><p className="font-medium text-danger-fg">{title}</p><p className="mt-0.5 text-fg-muted">{message}</p></div>
    </div>
    {retry && <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>}
  </div>
);

type NoticeTone = 'info' | 'warn' | 'error' | 'success';
const noticeTone: Record<NoticeTone, { cls: string; icon: LucideIcon; iconCls: string }> = {
  info: { cls: 'border-info-line bg-info-soft', icon: Info, iconCls: 'text-info-fg' },
  warn: { cls: 'border-warning-line bg-warning-soft', icon: AlertTriangle, iconCls: 'text-warning-fg' },
  error: { cls: 'border-danger-line bg-danger-soft', icon: AlertCircle, iconCls: 'text-danger-fg' },
  success: { cls: 'border-success-line bg-success-soft', icon: CheckCircle2, iconCls: 'text-success-fg' },
};
/** Inline callout. Use for state the user must know about, not for routine explanations. */
export const Notice = ({ tone = 'info', title, children, action, className }: { tone?: NoticeTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) => {
  const t = noticeTone[tone]; const Icon = t.icon;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm', t.cls, className)}>
      <Icon size={16} className={cx('mt-0.5 shrink-0', t.iconCls)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className={cx('text-fg-muted', title ? 'mt-0.5' : '')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};
