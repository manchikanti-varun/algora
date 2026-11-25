'use client';
import Link from 'next/link';
import { Activity, BookOpen, ChartNoAxesCombined, FileChartColumn, GraduationCap, History, LayoutDashboard, LibraryBig, LogOut, Menu, PanelLeftClose, PanelLeftOpen, School, Search, Settings, Trophy, UserRound, UserRoundCog, UsersRound, type LucideIcon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth, type Role } from '@/lib/auth';
import { cx, PageSkeleton } from './ui';
import { ThemePicker } from './ThemePicker';
import { CommandPalette } from './manage/CommandPalette';

export interface NavItem { href: string; label: string; roles?: Role[] }

const icons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, courses: BookOpen, batches: UsersRound, students: GraduationCap,
  leaderboards: Trophy, leaderboard: Trophy, 'problem-library': LibraryBig, analytics: ChartNoAxesCombined,
  progress: ChartNoAxesCombined, reports: FileChartColumn, trainers: UserRoundCog, colleges: School,
  settings: Settings, integration: Activity, audit: History, profile: UserRound,
};

function NavIcon({ href }: { href: string }) {
  const Icon = icons[href.split('/').at(-1) ?? ''];
  return Icon ? <Icon size={17} className="shrink-0" aria-hidden="true" /> : null;
}

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
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState(false);
  useEffect(() => {
    if (!ok) return;
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setSearch((value) => !value);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [ok]);
  if (!ok || !user) return <div className="p-8"><PageSkeleton /></div>;
  const active = (href: string) => path === href || (href !== '/manage/dashboard' && path.startsWith(href + '/'));
  const items = nav.flatMap((section) => section.items.filter((item) => !item.roles || item.roles.includes(user.role)));
  const current = items.find((item) => active(item.href));
  const actions = [
    ...(user.canManageCourses ? [{ href: '/manage/courses/new', label: 'Create course' }] : []),
    ...(user.role === 'SUPER_ADMIN' ? [{ href: '/manage/batches/new', label: 'Create batch' }] : []),
  ];
  const sidebar = (
    <nav aria-label="Management" className="flex h-full flex-col">
      <Link href="/manage/dashboard" aria-label="Algora home" className="mb-6 flex items-center gap-2 px-3 text-lg font-bold text-white"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-500 text-sm">A</span><span className={cx(collapsed && !open && "lg:sr-only")}>Algora</span></Link>
      <div className="flex-1 space-y-5 overflow-y-auto">
        {nav.map((s) => {
          const items = s.items.filter((i) => !i.roles || i.roles.includes(user.role));
          if (!items.length) return null;
          return (
            <div key={s.section}>
              <p className={cx("mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400", collapsed && !open && "lg:sr-only")}>{s.section}</p>
              {items.map((i) => (
                <Link key={i.href} href={i.href} onClick={() => setOpen(false)} aria-current={active(i.href) ? 'page' : undefined}
                  title={collapsed ? i.label : undefined} className={cx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm', active(i.href) ? 'bg-slate-800 font-medium text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white')}><NavIcon href={i.href} /><span className={cx(collapsed && !open && 'lg:sr-only')}>{i.label}</span></Link>
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-4 border-t border-slate-800 px-3 pt-4 text-xs text-slate-400">
        <p className={cx("truncate font-medium text-slate-200", collapsed && !open && "lg:sr-only")}>{user.fullName}</p>
        <p className={cx("truncate", collapsed && !open && "lg:sr-only")}>{user.role === 'SUPER_ADMIN' ? 'Super Admin' : `Trainer · ${user.trainerId}`}</p>
        <button title="Sign out" className="mt-2 flex items-center gap-2 text-indigo-300 hover:text-white" onClick={async () => { await logout(); router.replace('/trainer/login'); }}><LogOut size={16} aria-hidden="true" /><span className={cx(collapsed && !open && 'lg:sr-only')}>Sign out</span></button>
      </div>
    </nav>
  );
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className={cx("fixed inset-y-0 left-0 hidden bg-slate-900 p-4 lg:block", collapsed ? "w-[4.75rem]" : "w-60")}>{sidebar}</aside>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} /><aside className="absolute inset-y-0 left-0 w-64 bg-slate-900 p-4">{sidebar}</aside></div>}
      <div className={cx(collapsed ? "lg:pl-[4.75rem]" : "lg:pl-60")}>
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8">
          <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className="rounded-md p-1.5 text-slate-600 ring-1 ring-slate-300 lg:hidden" aria-label="Open navigation"><Menu size={17} /></button>
          <button type="button" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((value) => !value)} className="hidden rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:block">
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current?.label ?? 'Algora'}</span>
          <button type="button" aria-keyshortcuts="Meta+K Control+K" onClick={() => setSearch(true)}
            className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            <Search size={16} aria-hidden="true" />Search <kbd className="hidden text-xs text-slate-500 sm:inline">⌘/Ctrl K</kbd>
          </button>
          <ThemePicker />
        </header>
        {search && <CommandPalette destinations={[...items, ...actions]} onClose={() => setSearch(false)} />}
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
              return <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={cx('flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm', on ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100')}><NavIcon href={n.href} />{n.label}</Link>;
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {aside}
            <ThemePicker />
            <span className="hidden text-sm text-slate-600 md:inline">{user.fullName}</span>
            <button className="text-sm text-slate-500 hover:text-slate-800" onClick={async () => { await logout(); router.replace('/login'); }}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
