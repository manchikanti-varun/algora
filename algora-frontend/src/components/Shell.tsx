'use client';
import Link from 'next/link';
import {
  Activity, BookOpen, ChartNoAxesCombined, FileChartColumn, GraduationCap, History, House, LayoutDashboard, LibraryBig, LogOut, Menu as MenuIcon,
  PanelLeftClose, PanelLeftOpen, School, Search, SlidersHorizontal, Trophy, UserRound, UserRoundCog, UsersRound, X, type LucideIcon,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useAuth, type Role, type SessionUser } from '@/lib/auth';
import { cx, EmptyState, Menu, PageSkeleton, type MenuItem } from './ui';
import { themeMenuItems, useTheme } from './ThemePicker';
import { CommandPalette } from './manage/CommandPalette';

export interface NavItem { href: string; label: string; icon: LucideIcon; roles?: Role[]; match?: string[] }
export interface NavSection { section: string; items: NavItem[] }

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
const isActive = (path: string, item: NavItem, home: string) =>
  path === item.href || (item.href !== home && path.startsWith(item.href + '/')) || !!item.match?.some((m) => path.startsWith(m));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const roleLabel = (u: SessionUser) => (u.role === 'SUPER_ADMIN' ? 'Super Admin' : u.role === 'TRAINER' ? 'Trainer' : 'Student');

const Logo = ({ href, collapsed, dark }: { href: string; collapsed?: boolean; dark?: boolean }) => (
  <Link href={href} aria-label="Algora home" className={cx('flex items-center gap-2 font-semibold tracking-tight', dark ? 'text-white' : 'text-fg')}>
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-[13px] font-bold text-white">A</span>
    <span className={cx('text-[15px]', collapsed && 'lg:sr-only')}>Algora</span>
  </Link>
);

/** Account menu: identity, profile (students), theme and sign out. */
function AccountMenu({ user, extra = [], onSignOut }: { user: SessionUser; extra?: MenuItem[]; onSignOut: () => void }) {
  const theme = useTheme();
  return (
    <Menu label="Account menu" nameFromLabel variant="ghost" size="sm" align="end"
      button={<span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-fg ring-1 ring-accent-line">{initials(user.fullName)}</span>}
      header={<div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{user.fullName}</p><p className="truncate text-xs text-fg-subtle">{user.email}</p><p className="mt-0.5 text-xs text-fg-subtle">{roleLabel(user)}{user.trainerId ? ` · ${user.trainerId}` : ''}</p></div>}
      items={[...extra, ...(extra.length ? ['separator' as const] : []), ...themeMenuItems(theme), 'separator', { label: 'Sign out', icon: <LogOut size={15} aria-hidden />, onSelect: onSignOut }]} />
  );
}

// ---------------------------------------------------------------------------------------------------------------- manage
const COLLAPSE_KEY = 'algora.sidebarCollapsed';
export function ManageShell({ nav, children }: { nav: NavSection[]; children: ReactNode }) {
  const ok = useGuard(['SUPER_ADMIN', 'TRAINER'], '/trainer/login');
  const { user, logout } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Read once on the client; the shell renders a skeleton on the server, so there is no hydration difference.
  const [collapsed, setCollapsed] = useState(() => { try { return typeof window !== 'undefined' && localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const [search, setSearch] = useState(false);
  const toggleCollapsed = () => setCollapsed((v) => { try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); } catch { /* ignore */ } return !v; });
  useEffect(() => {
    if (!ok) return;
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault(); setSearch((value) => !value);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [ok]);
  if (!ok || !user) return <div className="mx-auto max-w-6xl p-8"><PageSkeleton /></div>;
  const home = '/manage/dashboard';
  const sections = nav.map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(user.role)) })).filter((s) => s.items.length);
  const items = sections.flatMap((s) => s.items);
  const current = items.find((i) => isActive(path, i, home));
  // A route that exists in the navigation for another role only (for example a trainer typing an admin URL).
  const forbidden = nav.flatMap((s) => s.items).find((i) => i.roles && !i.roles.includes(user.role) && isActive(path, i, home));
  const actions = [
    ...(user.canManageCourses ? [{ href: '/manage/courses/new', label: 'Create course' }] : []),
    { href: '/manage/batches/new', label: 'Create batch' },
  ];
  const signOut = async () => { await logout(); router.replace('/trainer/login'); };
  const narrow = collapsed && !open;
  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className={cx('mb-5 flex items-center justify-between px-2', narrow && 'lg:justify-center lg:px-0')}>
        <Logo href={home} collapsed={narrow} dark />
        {open && <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="grid h-8 w-8 place-items-center rounded-md text-nav-fg hover:bg-nav-hover lg:hidden"><X size={17} /></button>}
      </div>
      <div className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1">
        {sections.map((s) => (
          <div key={s.section}>
            <p className={cx('mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-nav-fg-muted', narrow && 'lg:sr-only')}>{s.section}</p>
            <ul className="space-y-0.5">
              {s.items.map((i) => {
                const on = isActive(path, i, home);
                return (
                  <li key={i.href}>
                    <Link href={i.href} onClick={() => setOpen(false)} aria-current={on ? 'page' : undefined} title={narrow ? i.label : undefined}
                      className={cx('flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors', narrow && 'lg:justify-center lg:px-0',
                        on ? 'bg-nav-active font-medium text-white' : 'text-nav-fg hover:bg-nav-hover hover:text-white')}>
                      <i.icon size={16} className="shrink-0" aria-hidden /><span className={cx('truncate', narrow && 'lg:sr-only')}>{i.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-white/10 pt-3">
        <div className={cx('mb-2 flex items-center gap-2 px-2', narrow && 'lg:hidden')}>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white">{initials(user.fullName)}</span>
          <div className="min-w-0 text-xs"><p className="truncate font-medium text-white">{user.fullName}</p><p className="truncate text-nav-fg-muted">{roleLabel(user)}</p></div>
        </div>
        <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cx('hidden h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-nav-fg hover:bg-nav-hover hover:text-white lg:flex', narrow && 'justify-center px-0')}>
          {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}<span className={cx(narrow && 'sr-only')}>Collapse</span>
        </button>
      </div>
    </nav>
  );
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <a href="#main" className="sr-only z-[70] rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <aside className={cx('fixed inset-y-0 left-0 z-30 hidden bg-nav px-3 py-4 lg:block', collapsed ? 'w-16' : 'w-60')}>{sidebar}</aside>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="animate-fade-in absolute inset-0 bg-black/50" onClick={() => setOpen(false)} /><aside className="animate-slide-up absolute inset-y-0 left-0 w-64 bg-nav px-3 py-4">{sidebar}</aside></div>}
      <div className={cx(collapsed ? 'lg:pl-16' : 'lg:pl-60')}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur sm:px-4 lg:px-6">
          <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-hover lg:hidden" aria-label="Open navigation"><MenuIcon size={18} /></button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-muted">{current?.label ?? ''}</span>
          <button type="button" aria-keyshortcuts="Meta+K Control+K" onClick={() => setSearch(true)}
            className="flex h-8 items-center gap-2 rounded-md border border-line bg-subtle px-2.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg sm:w-64">
            <Search size={15} aria-hidden /><span className="hidden flex-1 text-left sm:inline">Search…</span><span className="sr-only sm:hidden">Search</span>
            <kbd className="hidden rounded border border-line bg-surface px-1.5 font-mono text-[11px] text-fg-subtle sm:inline">⌘K</kbd>
          </button>
          <AccountMenu user={user} onSignOut={signOut} />
        </header>
        {search && <CommandPalette destinations={[...items.map((i) => ({ href: i.href, label: i.label })), ...actions]} onClose={() => setSearch(false)} />}
        <main id="main" className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Suspense fallback={<PageSkeleton />}>
            {forbidden ? <EmptyState title="This page is not available" body={`${forbidden.label} is managed by the Super Admin.`} action={<Link className="text-sm font-medium text-accent-fg hover:underline" href={home}>Go to Overview</Link>} /> : children}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- student
export const STUDENT_NAV: NavItem[] = [
  { href: '/student/dashboard', label: 'Home', icon: House },
  { href: '/student/courses', label: 'My Learning', icon: BookOpen, match: ['/student/chapters'] },
  { href: '/student/progress', label: 'Progress', icon: ChartNoAxesCombined },
  { href: '/student/leaderboard', label: 'Leaderboard', icon: Trophy },
];
export function StudentShell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const ok = useGuard(['STUDENT'], '/login');
  const { user, logout } = useAuth();
  const path = usePathname();
  const router = useRouter();
  if (!ok || !user) return <div className="mx-auto max-w-5xl p-8"><PageSkeleton /></div>;
  const home = '/student/dashboard';
  const signOut = async () => { await logout(); router.replace('/login'); };
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <a href="#main" className="sr-only z-[70] rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
          <Logo href={home} />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {STUDENT_NAV.map((n) => {
              const on = isActive(path, n, home);
              return <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined}
                className={cx('flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors', on ? 'bg-subtle font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}>
                <n.icon size={15} aria-hidden />{n.label}</Link>;
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            {aside}
            <AccountMenu user={user} onSignOut={signOut} extra={[{ label: 'Profile and account', href: '/student/profile', icon: <UserRound size={15} aria-hidden /> }]} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 md:pb-10 md:pt-8">
        <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
      </main>
      {/* Phones and small tablets: bottom tab bar, every destination visible without scrolling. */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-4">
          {STUDENT_NAV.map((n) => {
            const on = isActive(path, n, home);
            return <li key={n.href}><Link href={n.href} aria-current={on ? 'page' : undefined}
              className={cx('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', on ? 'text-accent-fg' : 'text-fg-muted')}>
              <n.icon size={19} aria-hidden />{n.label}</Link></li>;
          })}
        </ul>
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- management navigation
export const MANAGE_NAV: NavSection[] = [
  { section: 'Workspace', items: [
    { href: '/manage/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/manage/batches', label: 'Batches', icon: UsersRound },
    { href: '/manage/courses', label: 'Courses', icon: BookOpen },
    { href: '/manage/problem-library', label: 'Problem Library', icon: LibraryBig },
  ] },
  { section: 'People', items: [
    { href: '/manage/students', label: 'Students', icon: GraduationCap },
    { href: '/manage/trainers', label: 'Trainers', icon: UserRoundCog, roles: ['SUPER_ADMIN'] },
    { href: '/manage/colleges', label: 'Colleges', icon: School, roles: ['SUPER_ADMIN'] },
  ] },
  { section: 'Insights', items: [
    { href: '/manage/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
    { href: '/manage/leaderboards', label: 'Leaderboards', icon: Trophy },
    { href: '/manage/reports', label: 'Reports', icon: FileChartColumn },
  ] },
  { section: 'Settings', items: [
    { href: '/manage/settings', label: 'Scoring', icon: SlidersHorizontal, roles: ['SUPER_ADMIN'] },
    { href: '/manage/integration', label: 'Integrations', icon: Activity, roles: ['SUPER_ADMIN'] },
    { href: '/manage/audit', label: 'Audit Logs', icon: History, roles: ['SUPER_ADMIN'] },
  ] },
];
