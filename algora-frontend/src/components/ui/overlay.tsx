'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CheckCircle2, Info, MoreHorizontal, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, buttonClass, type Size, type Variant } from './button';
import { cx } from './format';

// ---------- Modal ----------
export function Modal({ open, onClose, title, description, children, footer, wide = false }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-labelledby={titleId}
      className={cx('m-auto max-h-[calc(100dvh-2rem)] overflow-hidden rounded-xl border border-line p-0 shadow-pop', wide ? 'w-[min(60rem,calc(100vw-1.5rem))]' : 'w-[min(32rem,calc(100vw-1.5rem))]')}>
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-fg">{title}</h2>
              {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg" aria-label="Close"><X size={16} /></button>
          </div>
          <div className="space-y-4 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-subtle px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------- Floating layer (menus, popovers) ----------
/** Positions a floating panel under its trigger with fixed coordinates, so it is never clipped by scrolling containers. */
function useFloating(open: boolean, close: () => void, align: 'start' | 'end') {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect(); if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      const top = below < 220 && r.top > below ? Math.max(8, r.top - Math.min(320, r.top - 12)) : r.bottom + 4;
      setPos({ top, maxHeight: Math.max(160, below < 220 && r.top > below ? r.top - 16 : below), ...(align === 'end' ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) }) });
    };
    place();
    const onScroll = (e: Event) => { if (panel.current && e.target instanceof Node && panel.current.contains(e.target)) return; close(); };
    window.addEventListener('resize', close); window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, true); };
  }, [open, align, close]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);
  return { trigger, panel, pos };
}

export interface MenuItem { label: string; onSelect?: () => void; href?: string; external?: boolean; icon?: ReactNode; danger?: boolean; disabled?: boolean; hidden?: boolean; description?: string }
/**
 * Dropdown menu (role="menu"). Arrow keys move, Enter selects, Escape closes and returns focus to the trigger.
 * `items` may include `'separator'` strings.
 */
export function Menu({ label, items, button, icon, variant = 'ghost', size = 'sm', align = 'end', header, nameFromLabel }: {
  label: string; items: (MenuItem | 'separator')[]; button?: ReactNode; icon?: ReactNode; variant?: Variant; size?: Size; align?: 'start' | 'end'; header?: ReactNode;
  /** Use `label` as the accessible name even when `button` has content (for non-text content such as initials). */
  nameFromLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { trigger, panel, pos } = useFloating(open, close, align);
  const menuId = useId();
  const visible = items.filter((i) => i === 'separator' || !i.hidden);
  useEffect(() => { if (open && pos) panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus(); }, [open, pos, panel]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els.at(-1)?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); trigger.current?.focus(); }
    else if (e.key === 'Tab') close();
  };
  const pick = (i: MenuItem) => { if (i.disabled) return; close(); i.onSelect?.(); };
  const itemCls = (i: MenuItem) => cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none focus:bg-hover',
    i.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-hover', i.danger ? 'text-danger-fg' : 'text-fg');
  return (
    <>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={button && !nameFromLabel ? undefined : label} title={button && !nameFromLabel ? undefined : label}
        onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        className={button ? buttonClass(variant, size) : cx(buttonClass(variant, size), 'px-0', { xs: 'h-7 w-7', sm: 'h-8 w-8', md: 'h-9 w-9' }[size])}>
        {button ?? icon ?? <MoreHorizontal size={16} aria-hidden />}
      </button>
      {open && pos && (
        <div ref={panel} id={menuId} role="menu" aria-label={label} onKeyDown={onKey} style={{ top: pos.top, left: pos.left, right: pos.right, maxHeight: pos.maxHeight }}
          className="animate-pop-in fixed z-50 min-w-48 max-w-72 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop">
          {header && <div className="border-b border-line px-2.5 pb-2 pt-1.5">{header}</div>}
          {visible.map((i, idx) => i === 'separator'
            ? <div key={`s${idx}`} role="separator" className="my-1 h-px bg-line" />
            : i.href && !i.disabled
              ? (i.external
                ? <a key={i.label} role="menuitem" tabIndex={-1} href={i.href} target="_blank" rel="noopener noreferrer" onClick={close} className={itemCls(i)}>{i.icon}<span className="min-w-0 flex-1">{i.label}</span></a>
                : <Link key={i.label} role="menuitem" tabIndex={-1} href={i.href} onClick={close} className={itemCls(i)}>{i.icon}<span className="min-w-0 flex-1">{i.label}</span></Link>)
              : <div key={i.label} role="menuitem" tabIndex={-1} aria-disabled={i.disabled || undefined} onClick={() => pick(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); } }} className={itemCls(i)}>
                {i.icon}<span className="min-w-0 flex-1">{i.label}{i.description && <span className="block text-xs text-fg-subtle">{i.description}</span>}</span>
              </div>)}
        </div>
      )}
    </>
  );
}

/** Click-to-open panel for supplementary details (not for actions; use Menu for those). */
export function Popover({ label, button, children, variant = 'ghost', size = 'sm', align = 'end', className }: {
  label: string; button: ReactNode; children: ReactNode; variant?: Variant; size?: Size; align?: 'start' | 'end'; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { trigger, panel, pos } = useFloating(open, close, align);
  const id = useId();
  return (
    <>
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label} onClick={() => setOpen((v) => !v)} className={cx(buttonClass(variant, size), className)}>{button}</button>
      {open && pos && (
        <div ref={panel} id={id} role="dialog" aria-label={label} onKeyDown={(e) => { if (e.key === 'Escape') { close(); trigger.current?.focus(); } }}
          style={{ top: pos.top, left: pos.left, right: pos.right, maxHeight: pos.maxHeight }}
          className="animate-pop-in fixed z-50 w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-line bg-surface p-4 text-sm shadow-pop">
          {children}
        </div>
      )}
    </>
  );
}

// ---------- Tabs ----------
/**
 * ARIA tabs. Arrow keys move between tabs. When `children` is given it is rendered as the active tab panel.
 * Keep the active key in the URL (useUrlState) so Back, reload and shared links work.
 */
export function Tabs({ tabs, active, onChange, children, className }: {
  tabs: { key: string; label: ReactNode; hidden?: boolean; count?: number }[]; active: string; onChange: (k: string) => void; children?: ReactNode; className?: string;
}) {
  const base = useId();
  const shown = tabs.filter((t) => !t.hidden);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? shown.length - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const j = (n + shown.length) % shown.length;
    refs.current[j]?.focus(); onChange(shown[j].key);
  };
  return (
    <>
      <div role="tablist" className={cx('mb-5 flex gap-1 overflow-x-auto border-b border-line', className)}>
        {shown.map((t, i) => {
          const on = active === t.key;
          return (
            <button key={t.key} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`${base}-t-${t.key}`} aria-selected={on} aria-controls={children ? `${base}-p` : undefined}
              tabIndex={on ? 0 : -1} onClick={() => onChange(t.key)} onKeyDown={(e) => onKey(e, i)}
              className={cx('-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-1 text-sm font-medium transition-colors',
                on ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg')}>
              {t.label}
              {t.count !== undefined && <span className={cx('rounded-full px-1.5 text-xs tabular-nums', on ? 'bg-accent-soft text-accent-fg' : 'bg-subtle text-fg-muted')}>{t.count}</span>}
            </button>
          );
        })}
      </div>
      {children && <div role="tabpanel" id={`${base}-p`} aria-labelledby={`${base}-t-${active}`}>{children}</div>}
    </>
  );
}

/** Route-based sub-navigation that looks like Tabs (each item is a page). */
export function LinkTabs({ items, label }: { items: { href: string; label: string; exact?: boolean }[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((i) => {
        const on = i.exact ? path === i.href : path === i.href || path.startsWith(i.href + '/');
        return <Link key={i.href} href={i.href} aria-current={on ? 'page' : undefined}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-1 text-sm font-medium transition-colors', on ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg')}>{i.label}</Link>;
      })}
    </nav>
  );
}

// ---------- Toasts and confirmation ----------
interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

type ToastTone = 'success' | 'error' | 'info';
interface ToastAction { label: string; onClick: () => void }
type ToastT = { id: number; tone: ToastTone; text: string; action?: ToastAction };
const ToastCtx = createContext<(tone: ToastTone, text: string, action?: ToastAction) => void>(() => {});
/** `success(text, { action: { label: 'Undo', onClick } })` adds a button to the toast. */
export const useToast = () => {
  const push = useContext(ToastCtx);
  return {
    success: (t: string, o?: { action?: ToastAction }) => push('success', t, o?.action),
    error: (t: string, o?: { action?: ToastAction }) => push('error', t, o?.action),
    info: (t: string, o?: { action?: ToastAction }) => push('info', t, o?.action),
  };
};
export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((tone: ToastTone, text: string, action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text, action }]);
    setTimeout(() => dismiss(id), action ? 8000 : tone === 'error' ? 7000 : 4500);
  }, [dismiss]);
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const done = (v: boolean) => { confirm?.resolve(v); setConfirm(null); };
  const icon = { success: <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success-fg" aria-hidden />, error: <XCircle size={16} className="mt-0.5 shrink-0 text-danger-fg" aria-hidden />, info: <Info size={16} className="mt-0.5 shrink-0 text-info-fg" aria-hidden /> };
  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        <Modal open={!!confirm} onClose={() => done(false)} title={confirm?.title ?? ''}
          footer={<><Button variant="secondary" onClick={() => done(false)}>Cancel</Button><Button variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => done(true)} autoFocus>{confirm?.confirmLabel ?? 'Confirm'}</Button></>}>
          {confirm?.body ? <div className="text-sm text-fg-muted">{confirm.body}</div> : <span className="sr-only">Please confirm.</span>}
        </Modal>
        <div className="pointer-events-none fixed bottom-20 right-3 z-[60] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 sm:bottom-4 sm:right-4" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="animate-slide-up pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm text-fg shadow-pop">
              {icon[t.tone]}
              <p className="min-w-0 flex-1">{t.text}</p>
              {t.action && <button type="button" onClick={() => { t.action!.onClick(); dismiss(t.id); }} className="shrink-0 rounded px-1.5 text-sm font-medium text-accent-fg hover:underline">{t.action.label}</button>}
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-fg-subtle hover:bg-hover hover:text-fg"><X size={14} /></button>
            </div>
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}
