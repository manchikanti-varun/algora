'use client';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cx } from './format';

/** Sets the browser tab title ("Batches · Algora"). Every page calls this through PageHeader. */
export function usePageTitle(title: string | undefined) {
  useEffect(() => { if (title) document.title = `${title} · Algora`; }, [title]);
}

export interface Crumb { label: ReactNode; href?: string }
export const Breadcrumbs = ({ items }: { items: Crumb[] }) => (
  <nav aria-label="Breadcrumb" className="mb-2">
    <ol className="flex flex-wrap items-center gap-1 text-[13px] text-fg-subtle">
      {items.map((c, i) => (
        <li key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight size={13} aria-hidden className="shrink-0" />}
          {c.href && i < items.length - 1
            ? <Link href={c.href} className="truncate hover:text-fg hover:underline">{c.label}</Link>
            : <span aria-current={i === items.length - 1 ? 'page' : undefined} className="truncate">{c.label}</span>}
        </li>
      ))}
    </ol>
  </nav>
);

/**
 * Page title block. `title` is also the browser tab title unless `docTitle` is given (needed when `title` is not text).
 * `back` is kept for compatibility and rendered as a one-level breadcrumb.
 */
export function PageHeader({ title, subtitle, actions, back, breadcrumbs, meta, docTitle }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; breadcrumbs?: Crumb[]; meta?: ReactNode; docTitle?: string;
}) {
  usePageTitle(docTitle ?? (typeof title === 'string' ? title : undefined));
  const crumbs = breadcrumbs ?? (back ? [{ label: back.label, href: back.href }, { label: typeof title === 'string' ? title : docTitle ?? '' }] : undefined);
  return (
    <header className="mb-6">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-fg">{title}</h1>
            {meta}
          </div>
          {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Surface section. `flush` removes body padding (tables). `description` sits under the title. */
export const Card = ({ children, className, title, description, actions, flush, footer, id }: {
  children?: ReactNode; className?: string; title?: ReactNode; description?: ReactNode; actions?: ReactNode; flush?: boolean; footer?: ReactNode; id?: string;
}) => (
  <section id={id} className={cx('rounded-lg border border-line bg-surface', className)}>
    {(title || actions) && (
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
          {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className={flush ? '' : 'p-4'}>{children}</div>
    {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
  </section>
);

/** Compact metric. Optional `href` makes the whole tile a link. */
export const StatCard = ({ label, value, hint, tone = 'default', href, icon }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad'; href?: string; icon?: ReactNode;
}) => {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">{icon}{label}</p>
      <p className={cx('mt-1.5 text-2xl font-semibold tabular-nums tracking-tight', { default: 'text-fg', good: 'text-success-fg', warn: 'text-warning-fg', bad: 'text-danger-fg' }[tone])}>{value ?? '—'}</p>
      {hint && <p className="mt-1 truncate text-xs text-fg-subtle">{hint}</p>}
    </>
  );
  const cls = 'block rounded-lg border border-line bg-surface px-4 py-3.5';
  return href ? <Link href={href} className={cx(cls, 'transition-colors hover:border-line-strong hover:bg-hover')}>{body}</Link> : <div className={cls}>{body}</div>;
};
/** Metric grid: 2 columns on phones, `cols` on desktop. */
export const Grid = ({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => (
  <div className={cx('grid grid-cols-2 gap-3', { 2: 'sm:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }[cols])}>{children}</div>
);

/** Expandable section for advanced or rarely used content. Native <details>, so it is keyboard and screen-reader friendly. */
export const Disclosure = ({ summary, children, defaultOpen, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) => (
  <details open={defaultOpen} className={cx('group rounded-lg border border-line bg-surface', className)}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
      {summary}<ChevronDown size={16} aria-hidden className="shrink-0 text-fg-subtle transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-line p-4">{children}</div>
  </details>
);

/** Label / value list. */
export const DescriptionList = ({ items, cols = 3 }: { items: { label: string; value: ReactNode }[]; cols?: 2 | 3 | 4 }) => (
  <dl className={cx('grid gap-x-6 gap-y-3 text-sm', { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols])}>
    {items.map((i) => <div key={i.label} className="min-w-0"><dt className="text-xs text-fg-subtle">{i.label}</dt><dd className="mt-0.5 truncate text-fg">{i.value}</dd></div>)}
  </dl>
);
