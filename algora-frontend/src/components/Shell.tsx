'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth, type Role } from '@/lib/auth';
import { cx, PageSkeleton } from './ui';

export interface NavItem { href: string; label: string; roles?: Role[]; icon?: string }

/** UI guard only. Every API call is independently authorised by the backend. */
function useGuard(allow: Role[], loginPath: string) {
  const { user, loading, expired } = useAuth();
  const router = useRouter();
  const ok = !!user && allow.includes(user.role);
  useEffect(() => {
    if (loading || ok) return;
    if (user) router.replace(user.role === 'STUDENT' ? '/student/dashboard' : '/manage/dashboard'); // wrong portal
    else router.replace(`${loginPath}${expired ? '?expired=1' : ''}`);
  }, [loading, ok, user, expired, loginPath, router]);
  return ok;
}

export function ManageShell({ nav, children }: { nav: { section: string; items: NavItem[] }[]; children: ReactNode }) {
  const ok = useGuard(['SUPER_ADMIN', 'TRAINER'], '/trainer/login');
  const { user, logout } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!ok || !user) return <div className="p-8"><PageSkeleton /></div>;
  const active = (href: string) => path === href || (href !== '/manage/dashboard' && path.startsWith(href + '/')) || path === href;
  const sidebar = (
    <nav aria-label="Management" className="flex h-full flex-col">
      <Link href="/manage/dashboard" className="mb-6 flex items-center gap-2 px-3 text-lg font-bold text-white"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500 text-sm">A</span>Algora</Link>
      <div className="flex-1 space-y-5 overflow-y-auto">
        {nav.map((s) => {
          const items = s.items.filter((i) => !i.roles || i.roles.includes(user.role));
          if (!items.length) return null;
          return (
            <div key={s.section}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.section}</p>
              {items.map((i) => (
                <Link key={i.href} href={i.href} onClick={() => setOpen(false)} aria-current={active(i.href) ? 'page' : undefined}
                  className={cx('block rounded-lg px-3 py-1.5 text-sm', active(i.href) ? 'bg-slate-800 font-medium text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white')}>{i.label}</Link>
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-4 border-t border-slate-800 px-3 pt-4 text-xs text-slate-400">
        <p className="truncate font-medium text-slate-200">{user.fullName}</p>
        <p className="truncate">{user.role === 'SUPER_ADMIN' ? 'Super Admin' : `Trainer · ${user.trainerId}`}</p>
        <button className="mt-2 text-indigo-300 hover:text-white" onClick={async () => { await logout(); router.replace('/trainer/login'); }}>Sign out</button>
      </div>
    </nav>
  );
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 hidden w-60 bg-slate-900 p-4 lg:block">{sidebar}</aside>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} /><aside className="absolute inset-y-0 left-0 w-64 bg-slate-900 p-4">{sidebar}</aside></div>}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 ring-1 ring-slate-300" aria-label="Open navigation">☰</button>
          <span className="font-semibold">Algora</span>
        </header>
        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export function StudentShell({ children, nav, aside }: { children: ReactNode; nav: NavItem[]; aside?: ReactNode }) {
  const ok = useGuard(['STUDENT'], '/login');
  const { user, logout } = useAuth();
  const path = usePathname();
  const router = useRouter();
  if (!ok || !user) return <div className="p-8"><PageSkeleton /></div>;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/student/dashboard" className="flex items-center gap-2 font-bold text-slate-900"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-sm text-white">A</span>Algora</Link>
          <nav aria-label="Student" className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {nav.map((n) => {
              const on = path === n.href || path.startsWith(n.href + '/') || (n.href === '/student/courses' && path.startsWith('/student/chapters'));
              return <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={cx('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm', on ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100')}>{n.label}</Link>;
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {aside}
            <span className="hidden text-sm text-slate-600 md:inline">{user.fullName}</span>
            <button className="text-sm text-slate-500 hover:text-slate-800" onClick={async () => { await logout(); router.replace('/login'); }}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
