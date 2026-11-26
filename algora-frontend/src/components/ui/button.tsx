'use client';
import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './format';

export type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';
export type Size = 'xs' | 'sm' | 'md';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]',
  secondary: 'bg-surface text-fg ring-1 ring-inset ring-line-strong hover:bg-hover',
  danger: 'bg-danger text-white hover:brightness-110',
  ghost: 'text-fg-muted hover:bg-hover hover:text-fg',
  subtle: 'bg-subtle text-fg hover:bg-hover',
};
const sizes: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs gap-1',
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};
export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', className?: string) =>
  cx('inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50',
    sizes[size], variants[variant], className);

export const Spinner = ({ className }: { className?: string }) => (
  <span className={cx('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} aria-hidden />
);

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

/** Icon-only button. `label` is required: it is the accessible name and the tooltip. */
export function IconButton({ label, icon, variant = 'ghost', size = 'sm', className, ...p }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { label: string; icon: ReactNode; variant?: Variant; size?: Size }) {
  const square = { xs: 'h-7 w-7', sm: 'h-8 w-8', md: 'h-9 w-9' }[size];
  return (
    <button type="button" aria-label={label} title={label}
      className={cx(buttonClass(variant, size), 'px-0', square, className)} {...p}>
      {icon}
    </button>
  );
}

export const ButtonLink = ({ href, children, variant = 'primary', size = 'md', icon, className, external, ...p }:
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; children: ReactNode; variant?: Variant; size?: Size; icon?: ReactNode; external?: boolean }) =>
  external
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass(variant, size, className)} {...p}>{icon}{children}</a>
    : <Link href={href} className={buttonClass(variant, size, className)} {...p}>{icon}{children}</Link>;
