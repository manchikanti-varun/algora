'use client';
import { Search, X } from 'lucide-react';
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './format';

export const controlCls = 'block w-full rounded-md border-0 bg-surface px-3 py-2 text-sm text-fg ring-1 ring-inset ring-line-strong placeholder:text-fg-subtle transition-shadow focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-subtle disabled:text-fg-muted aria-[invalid=true]:ring-danger';

/** Optional fields say so in their label ('Email (optional)'); required fields are the default, so no asterisks. */
export function Field({ label, error, hint, children, labelHidden }: { label: string; error?: string; hint?: ReactNode; children: (id: string, describedBy?: string) => ReactNode; labelHidden?: boolean; required?: boolean }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5 text-sm">
      <label htmlFor={id} className={cx('block font-medium text-fg', labelHidden && 'sr-only')}>{label}</label>
      {children(id, hint || error ? hintId : undefined)}
      {error ? <p id={hintId} className="text-xs text-danger-fg" role="alert">{error}</p> : hint ? <p id={hintId} className="text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
type Common = { label: string; error?: string; hint?: ReactNode; labelHidden?: boolean };
export const Input = ({ label, error, hint, labelHidden, className, ...p }: InputHTMLAttributes<HTMLInputElement> & Common) => (
  <Field label={label} error={error} hint={hint} labelHidden={labelHidden} required={p.required}>
    {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!error || undefined} className={cx(controlCls, className)} {...p} />}
  </Field>
);
export const Textarea = ({ label, error, hint, labelHidden, className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & Common) => (
  <Field label={label} error={error} hint={hint} labelHidden={labelHidden} required={p.required}>
    {(id, d) => <textarea id={id} aria-describedby={d} aria-invalid={!!error || undefined} rows={3} className={cx(controlCls, className)} {...p} />}
  </Field>
);
const selectCls = cx(controlCls, 'appearance-none bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat pr-8',
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]");
export const Select = ({ label, options, error, hint, labelHidden, className, ...p }: SelectHTMLAttributes<HTMLSelectElement> & Common & { options: { value: string; label: string }[] }) => (
  <Field label={label} error={error} hint={hint} labelHidden={labelHidden} required={p.required}>
    {(id, d) => <select id={id} aria-describedby={d} aria-invalid={!!error || undefined} className={cx(selectCls, className)} {...p}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
  </Field>
);
/** Compact select for toolbars. The label is announced to screen readers but not shown. */
export const InlineSelect = ({ label, value, onChange, options, className, disabled }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; disabled?: boolean }) => (
  <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cx(selectCls, 'h-8 w-auto py-0 text-[13px]', className)}>
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);
export const SearchInput = ({ value, onChange, placeholder = 'Search', label = 'Search', autoFocus = false, className, onKeyDown }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label?: string; autoFocus?: boolean; className?: string; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) => (
  <div className={cx('relative w-full sm:max-w-xs', className)}>
    <Search size={15} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
    <input type="search" autoFocus={autoFocus} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder}
      className={cx(controlCls, 'h-8 py-0 pl-8 pr-8 text-[13px] [&::-webkit-search-cancel-button]:hidden')} />
    {value && <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-fg-subtle hover:bg-hover hover:text-fg"><X size={14} /></button>}
  </div>
);
export const Checkbox = ({ label, description, className, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; description?: ReactNode }) => {
  const id = useId();
  return (
    <div className={cx('flex items-start gap-2.5 text-sm', className)}>
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong" {...p} />
      <label htmlFor={id} className="text-fg">{label}{description && <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>}</label>
    </div>
  );
};
/** Accessible on/off switch. `label` is the accessible name (shown when `showLabel`). */
export function Switch({ checked, onChange, label, disabled, showLabel }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; showLabel?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={showLabel ? undefined : label} disabled={disabled} onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2 rounded-full text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
      <span className={cx('relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}>
        <span className={cx('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform', checked && 'translate-x-4')} />
      </span>
      {showLabel && <span className="text-fg">{label}</span>}
    </button>
  );
}
export const DateInput = ({ label, value, onChange, labelHidden = true }: { label: string; value: string; onChange: (v: string) => void; labelHidden?: boolean }) => (
  <label className="flex items-center gap-1.5 text-[13px] text-fg-muted">
    <span className={labelHidden ? 'sr-only' : ''}>{label}</span>
    <input type="date" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cx(controlCls, 'h-8 w-auto py-0 text-[13px]')} />
  </label>
);
