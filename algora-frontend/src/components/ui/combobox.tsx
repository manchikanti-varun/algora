'use client';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { controlCls } from './form';
import { cx } from './format';

export interface Option { value: string; label: string; detail?: string }

/**
 * Searchable select. Pass `options` for a fixed list, or `load(query)` to search on the server (no 100-item limit:
 * the server filters). `emptyLabel` adds a "none" choice such as "All batches". Keyboard: type to filter, arrows to move,
 * Enter to choose, Escape to close.
 */
export function Combobox({ label, value, onChange, options, load, placeholder = 'Select…', emptyLabel, labelHidden = true, disabled, className, selectedLabel, hint }: {
  label: string; value: string; onChange: (value: string, option?: Option) => void; options?: Option[]; load?: (q: string) => Promise<Option[]>;
  placeholder?: string; emptyLabel?: string; labelHidden?: boolean; disabled?: boolean; className?: string; selectedLabel?: string; hint?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Option[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [known, setKnown] = useState<Record<string, string>>({});
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // remote search (debounced); also primes the label cache so a value from the URL can show its name
  useEffect(() => {
    if (!load) return;
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try { const r = await load(q.trim()); if (live) { setRemote(r); setKnown((k) => ({ ...k, ...Object.fromEntries(r.map((o) => [o.value, o.label])) })); } }
      catch { if (live) setRemote([]); } finally { if (live) setLoading(false); }
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, load]);

  const base = load ? remote ?? [] : (options ?? []).filter((o) => !q.trim() || `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const list: Option[] = [...(emptyLabel && !q.trim() ? [{ value: '', label: emptyLabel }] : []), ...base];
  const current = value ? (options?.find((o) => o.value === value)?.label ?? known[value] ?? selectedLabel ?? 'Selected') : emptyLabel ?? '';

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => { const r = box.current?.getBoundingClientRect(); if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) }); };
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !document.getElementById(`${id}-list`)?.contains(t)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, id]);

  const choose = (o: Option) => { onChange(o.value, o.value ? o : undefined); setOpen(false); setQ(''); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); setActive((a) => Math.min(list.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { if (open && list[active]) { e.preventDefault(); choose(list[active]); } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false); setQ(''); } }
  };

  return (
    <div className={cx('text-sm', className)}>
      <label htmlFor={id} className={cx('mb-1.5 block font-medium text-fg', labelHidden && 'sr-only')}>{label}</label>
      <div ref={box} className="relative">
        <input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" disabled={disabled}
          aria-activedescendant={open && list[active] ? `${id}-o-${active}` : undefined}
          value={open ? q : current} placeholder={open ? 'Type to search…' : placeholder}
          onFocus={() => { setOpen(true); setActive(0); }} onClick={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }} onKeyDown={onKey}
          onBlur={() => setTimeout(() => { if (!box.current?.contains(document.activeElement)) { setOpen(false); setQ(''); } }, 120)}
          className={cx(controlCls, 'h-8 truncate py-0 pr-14 text-[13px]', labelHidden ? 'min-w-44' : '', !open && value && 'font-medium')} />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle"><ChevronsUpDown size={14} aria-hidden /></span>
        {value && emptyLabel !== undefined && !disabled && (
          <button type="button" aria-label={`Clear ${label}`} onClick={() => onChange('')} className="absolute right-6 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-fg-subtle hover:bg-hover hover:text-fg"><X size={12} /></button>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
      {open && rect && (
        <ul id={`${id}-list`} role="listbox" aria-label={label} style={{ top: rect.top, left: rect.left, width: rect.width }}
          className="animate-pop-in fixed z-[55] max-h-72 overflow-y-auto rounded-lg border border-line bg-surface p-1 text-sm shadow-pop">
          {loading && !list.length && <li className="px-2.5 py-2 text-fg-subtle">Searching…</li>}
          {!loading && !list.length && <li className="px-2.5 py-2 text-fg-subtle">No matches</li>}
          {list.map((o, i) => (
            <li key={o.value || '__empty'} id={`${id}-o-${i}`} role="option" aria-selected={o.value === value}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setActive(i)}
              className={cx('flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5', i === active && 'bg-hover')}>
              <span className="w-4 shrink-0">{o.value === value && <Check size={14} className="text-accent-fg" aria-hidden />}</span>
              <span className="min-w-0 flex-1 truncate text-fg">{o.label}</span>
              {o.detail && <span className="shrink-0 text-xs text-fg-subtle">{o.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
