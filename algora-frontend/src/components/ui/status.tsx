'use client';
import type { ReactNode } from 'react';
import { statusLabel, statusTone, type Tone } from '@/lib/status';
import { cx } from './format';

const toneCls: Record<Tone, string> = {
  neutral: 'bg-subtle text-fg-muted ring-line',
  success: 'bg-success-soft text-success-fg ring-success-line',
  warning: 'bg-warning-soft text-warning-fg ring-warning-line',
  danger: 'bg-danger-soft text-danger-fg ring-danger-line',
  info: 'bg-info-soft text-info-fg ring-info-line',
  accent: 'bg-accent-soft text-accent-fg ring-accent-line',
};
const dotCls: Record<Tone, string> = {
  neutral: 'bg-fg-subtle', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info-fg', accent: 'bg-accent',
};
export type { Tone };
/** Legacy tone names still accepted so older call sites read naturally. */
type LegacyTone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'indigo';
const legacy: Record<LegacyTone, Tone> = { gray: 'neutral', green: 'success', amber: 'warning', red: 'danger', blue: 'info', indigo: 'accent' };
const toTone = (t: Tone | LegacyTone): Tone => (t in legacy ? legacy[t as LegacyTone] : (t as Tone));

export const Badge = ({ children, tone = 'neutral', dot, className }: { children: ReactNode; tone?: Tone | LegacyTone; dot?: boolean; className?: string }) => {
  const t = toTone(tone);
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', toneCls[t], className)}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', dotCls[t])} aria-hidden />}
      {children}
    </span>
  );
};
/** Badge for any backend status string, using the shared vocabulary in lib/status.ts. */
export const StatusBadge = ({ status, label, dot = true }: { status: string; label?: string; dot?: boolean }) =>
  <Badge tone={statusTone(status)} dot={dot}>{label ?? statusLabel(status)}</Badge>;
export const DifficultyBadge = ({ d }: { d: string }) => <Badge tone={statusTone(d)}>{statusLabel(d)}</Badge>;

export function ProgressBar({ value, label, size = 'md', showValue = true, className }: { value: number | null; label?: string; size?: 'sm' | 'md'; showValue?: boolean; className?: string }) {
  const v = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <div className={cx('min-w-0 flex-1 overflow-hidden rounded-full bg-progress-track', size === 'sm' ? 'h-2' : 'h-2.5')} role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={v ?? undefined} aria-valuetext={v === null ? 'Not available' : `${Math.round(v * 10) / 10}%`} aria-label={label ?? 'Progress'}>
        <div className={cx('h-full rounded-full transition-[width] duration-300', v === 100 ? 'bg-success' : 'bg-progress-fill')} style={{ width: `${v ?? 0}%` }} />
      </div>
      {showValue && <span className="w-12 shrink-0 text-right text-xs tabular-nums text-fg-muted">{v === null ? '—' : `${Math.round(v * 10) / 10}%`}</span>}
    </div>
  );
}

/** Horizontal bars. Values are real numbers from the API; the list doubles as the accessible description. */
export function BarList({ items, max, format = (n) => String(n), empty = 'No data yet' }: { items: { label: ReactNode; value: number | null; sub?: string; href?: string; key?: string }[]; max?: number; format?: (n: number) => string; empty?: string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value ?? 0));
  if (!items.length) return <p className="py-6 text-center text-sm text-fg-subtle">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((i, idx) => (
        <li key={i.key ?? idx} className="text-sm">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-fg">{i.label}</span>
            <span className="shrink-0 tabular-nums text-fg-muted">{i.value === null ? '—' : format(i.value)}{i.sub && <span className="text-fg-subtle"> · {i.sub}</span>}</span>
          </div>
          <ProgressBar value={i.value !== null && m > 0 ? i.value / m * 100 : null} size="sm" showValue={false}
            label={typeof i.label === 'string' ? i.label : undefined} />
        </li>
      ))}
    </ul>
  );
}
