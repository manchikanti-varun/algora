import Link from 'next/link';
import { ChevronRight, GraduationCap, ShieldCheck } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { ThemePicker } from '@/components/ThemePicker';

const choices = [
  { href: '/login', title: 'Student', body: 'Follow your courses, solve problems and track verified progress.', icon: GraduationCap },
  { href: '/trainer/login', title: 'Trainer or admin', body: 'Manage batches, chapter access, students and analytics.', icon: ShieldCheck },
];

import { PageTitle } from '@/components/PageTitle';
export default function Home() {
  return (
    <main className="relative grid min-h-screen place-items-center bg-canvas p-6">
      <PageTitle title="Welcome" />
      <div className="absolute right-4 top-4"><ThemePicker /></div>
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="mb-4"><BrandMark large /></div>
          <h1 className="text-4xl font-semibold tracking-tight text-fg">Algora</h1>
          <p className="mt-2 text-sm text-fg-muted">Bootcamp courses, LeetCode practice and verified progress in one place.</p>
        </div>
        <ul className="grid gap-3">
          {choices.map(({ href, title, body, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className="group flex items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-panel transition-colors hover:border-line-strong hover:bg-hover">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-fg"><Icon size={19} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">{title}</span>
                  <span className="mt-0.5 block text-[13px] text-fg-muted">{body}</span>
                </span>
                <ChevronRight size={16} aria-hidden className="shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
