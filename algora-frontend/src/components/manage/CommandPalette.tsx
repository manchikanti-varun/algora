'use client';
import { ArrowUpRight, BookOpen, Clock, CornerDownLeft, GraduationCap, LibraryBig, Search, UsersRound, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi, useDebounced } from '@/hooks/useApi';
import { readRecent } from '@/hooks/useRecent';
import { qs } from '@/lib/api';
import { cx, Modal } from '@/components/ui';

type Destination = { label: string; href: string; detail?: string; external?: boolean };
type Row = Destination & { icon: ReactNode };
type SearchPage<T> = { items: T[] };

/** Global search (⌘K / Ctrl K): recent records, pages and actions, then students, batches, courses and library problems. */
export function CommandPalette({ destinations, onClose }: { destinations: Destination[]; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [active, setActive] = useState(0);
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const query = useDebounced(input.trim(), 220);
  const ready = query.length >= 2 && input.trim() === query;
  const params = ready ? qs({ q: query, pageSize: 4 }) : null;
  const students = useApi<SearchPage<{ _id: string; fullName: string; rollNumber?: string }>>(params && '/students' + params);
  const batches = useApi<SearchPage<{ _id: string; name: string; college?: string }>>(params && '/batches' + params);
  const courses = useApi<SearchPage<{ _id: string; title: string }>>(params && '/courses' + params);
  const problems = useApi<SearchPage<{ title: string; url: string; problemNumber?: number }>>(params && '/problem-library' + params);
  const [recent] = useState(readRecent);
  const term = input.trim().toLowerCase();
  const sections = useMemo(() => {
    const out: { title: string; rows: Row[] }[] = [];
    if (!term && recent.length) out.push({ title: 'Recent', rows: recent.map((r) => ({ label: r.label, href: r.href, detail: r.kind, icon: <Clock size={15} aria-hidden /> })) });
    out.push({ title: 'Pages and actions', rows: destinations.filter((d) => d.label.toLowerCase().includes(term)).map((d) => ({ ...d, icon: <Zap size={15} aria-hidden /> })) });
    if (ready) {
      out.push(
        { title: 'Students', rows: (students.data?.items ?? []).map((i) => ({ label: i.fullName, detail: i.rollNumber, href: '/manage/students/' + i._id, icon: <GraduationCap size={15} aria-hidden /> })) },
        { title: 'Batches', rows: (batches.data?.items ?? []).map((i) => ({ label: i.name, detail: i.college, href: '/manage/batches/' + i._id, icon: <UsersRound size={15} aria-hidden /> })) },
        { title: 'Courses', rows: (courses.data?.items ?? []).map((i) => ({ label: i.title, href: '/manage/courses/' + i._id, icon: <BookOpen size={15} aria-hidden /> })) },
        { title: 'Problems', rows: (problems.data?.items ?? []).map((i) => ({ label: i.title, detail: i.problemNumber ? `#${i.problemNumber}` : undefined, href: i.url, external: true, icon: <LibraryBig size={15} aria-hidden /> })) },
      );
    }
    return out.filter((s) => s.rows.length);
  }, [term, recent, destinations, ready, students.data, batches.data, courses.data, problems.data]);
  const flat = sections.flatMap((s) => s.rows);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const fetching = input.trim().length >= 2 && (!ready || [students, batches, courses, problems].some((r) => r.loading));
  const open = (r: Row) => { if (r.external) window.open(r.href, '_blank', 'noopener,noreferrer'); else router.push(r.href); onClose(); };
  let index = -1;
  return <Modal open wide title="Search Algora" onClose={onClose}>
    <div className="relative">
      <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
      <input type="search" autoFocus role="combobox" aria-expanded aria-controls="palette-results" aria-label="Search Algora" aria-activedescendant={flat[active] ? `palette-${active}` : undefined}
        value={input} onChange={(e) => { setInput(e.target.value.slice(0, 60)); setActive(0); }} placeholder="Search pages, students, batches, courses or problems"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (flat[active] && !fetching) open(flat[active]); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); } // a search field would otherwise only clear its text
        }}
        className="block h-11 w-full rounded-lg border-0 bg-subtle pl-9 pr-3 text-[15px] text-fg ring-1 ring-inset ring-line placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
    </div>
    <div ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="max-h-[55dvh] space-y-3 overflow-y-auto">
      {fetching && <p role="status" className="px-2 text-sm text-fg-subtle">Searching…</p>}
      {!fetching && !flat.length && <p role="status" className="px-2 py-4 text-center text-sm text-fg-muted">No results. Try a name, roll number or problem number.</p>}
      {sections.map((s) => <section key={s.title}>
        <h3 className="mb-1 px-2 text-xs font-medium text-fg-subtle">{s.title}</h3>
        <ul>{s.rows.map((r) => { index += 1; const i = index; return (
          <li key={s.title + r.href} id={`palette-${i}`} data-index={i} role="option" aria-selected={i === active}
            onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); open(r); }}
            className={cx('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm', i === active ? 'bg-hover text-fg' : 'text-fg')}>
            <span className="text-fg-subtle">{r.icon}</span>
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            {r.detail && <span className="shrink-0 text-xs text-fg-subtle">{r.detail}</span>}
            {r.external ? <ArrowUpRight size={14} aria-label="Opens in a new tab" className="text-fg-subtle" /> : i === active && <CornerDownLeft size={14} aria-hidden className="text-fg-subtle" />}
          </li>); })}</ul>
      </section>)}
    </div>
    <p className="hidden border-t border-line pt-3 text-xs text-fg-subtle sm:block">↑ ↓ to move · Enter to open · Esc to close</p>
  </Modal>;
}
