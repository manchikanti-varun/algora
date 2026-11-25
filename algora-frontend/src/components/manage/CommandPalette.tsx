'use client';

import Link from 'next/link';
import { ArrowUpRight, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApi, useDebounced } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { Modal, SearchInput } from '@/components/ui';

type Destination = { label: string; href: string; detail?: string; external?: boolean };
type SearchPage<T> = { items: T[] };

export function CommandPalette({ destinations, onClose }: { destinations: Destination[]; onClose: () => void }) {
  const [input, setInput] = useState('');
  const router = useRouter();
  const query = useDebounced(input.trim(), 250);
  const ready = query.length >= 2 && input.trim() === query;
  const params = ready ? qs({ q: query, pageSize: 4 }) : null;
  const students = useApi<SearchPage<{ _id: string; fullName: string; rollNumber?: string }>>(params && '/students' + params);
  const batches = useApi<SearchPage<{ _id: string; name: string; college?: string }>>(params && '/batches' + params);
  const courses = useApi<SearchPage<{ _id: string; title: string }>>(params && '/courses' + params);
  const problems = useApi<SearchPage<{ title: string; url: string; problemNumber?: number }>>(params && '/problem-library' + params);

  const sections: { title: string; rows: Destination[] }[] = [{
    title: 'Pages and actions',
    rows: destinations.filter((item) => item.label.toLowerCase().includes(input.trim().toLowerCase())),
  }];
  if (ready) {
    sections.push(
      { title: 'Students', rows: students.loading ? [] : (students.data?.items ?? []).map((item) => ({ label: item.fullName, detail: item.rollNumber, href: '/manage/students/' + item._id })) },
      { title: 'Batches', rows: batches.loading ? [] : (batches.data?.items ?? []).map((item) => ({ label: item.name, detail: item.college, href: '/manage/batches/' + item._id })) },
      { title: 'Courses', rows: courses.loading ? [] : (courses.data?.items ?? []).map((item) => ({ label: item.title, href: '/manage/courses/' + item._id })) },
      { title: 'Problems', rows: problems.loading ? [] : (problems.data?.items ?? []).map((item) => ({ label: item.title, detail: item.problemNumber ? `#${item.problemNumber}` : undefined, href: item.url, external: true })) },
    );
  }
  const first = sections.find((section) => section.rows.length)?.rows[0];
  const requests = [students, batches, courses, problems];
  const fetching = input.trim().length >= 2 && (!ready || requests.some((result) => result.loading));
  const hasError = ready && requests.some((result) => result.error);

  return <Modal open wide title="Search Algora" onClose={onClose}>
    <form role="search" className="flex items-center gap-3" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }} onSubmit={(event) => {
      event.preventDefault();
      if (!first || fetching) return;
      if (first.external) window.open(first.href, '_blank', 'noopener,noreferrer');
      else router.push(first.href);
      onClose();
    }}>
      <Search size={18} aria-hidden="true" />
      <SearchInput autoFocus label="Search Algora" value={input} onChange={(value) => setInput(value.slice(0, 60))} placeholder="Page, student, batch, course or problem" />
    </form>
    {fetching && <p role="status" className="text-sm text-slate-600">Searching…</p>}
    {hasError && <p role="status" className="text-sm text-slate-600">Some results could not be loaded.</p>}
    {!fetching && !first && <p role="status" className="text-sm text-slate-600">No results. Try another name or problem number.</p>}
    <div className="max-h-[50dvh] space-y-4 overflow-y-auto">
      {sections.filter((section) => section.rows.length).map((section) => <section key={section.title}>
        <h3 className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-slate-500">{section.title}</h3>
        <ul>{section.rows.map((row) => <li key={row.href}>
          <Link href={row.href} target={row.external ? '_blank' : undefined} rel={row.external ? 'noopener noreferrer' : undefined} onClick={onClose}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600">
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {row.detail && <span className="text-xs text-slate-500">{row.detail}</span>}
            {row.external && <ArrowUpRight aria-label="Opens in a new tab" size={14} />}
          </Link>
        </li>)}</ul>
      </section>)}
    </div>
  </Modal>;
}
