'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  Building2,
  CheckCheck,
  LayoutDashboard,
  Menu,
  ShieldCheck,
  Users,
  X,
  ScrollText,
} from 'lucide-react';
import { Brand, ThemeToggle } from './header';
import { Button } from '@/components/ui/button';
import { RouteGuard } from '@/features/auth/route-guard';
import { SignOutButtons } from '@/features/auth/sign-out';
import type { Role } from '@/features/auth/contracts';
export function AdministrationShell({
  role,
  active,
  title,
  description,
  children,
}: {
  role: Role;
  active: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const nav =
    role === 'SUPER_ADMIN'
      ? [
          { label: 'Overview', href: '/super-admin', icon: LayoutDashboard },
          { label: 'Courses', href: '/super-admin/courses', icon: Building2 },
          {
            label: 'Problems',
            href: '/super-admin/problems',
            icon: ScrollText,
          },
          { label: 'Batches', href: '/super-admin/batches', icon: Users },
          {
            label: 'Coding Progress',
            href: '/super-admin/progress',
            icon: CheckCheck,
          },
          {
            label: 'Progress Reports',
            href: '/super-admin/progress-reports',
            icon: ScrollText,
          },
          {
            label: 'Attendance',
            href: '/super-admin/attendance',
            icon: CheckCheck,
          },
          {
            label: 'Reconciliation',
            href: '/super-admin/reconciliation',
            icon: ScrollText,
          },
          { label: 'Colleges', href: '/super-admin/colleges', icon: Building2 },
          { label: 'Students', href: '/super-admin/students', icon: Users },
          {
            label: 'Admin Approvals',
            href: '/super-admin/approvals',
            icon: CheckCheck,
          },
          {
            label: 'Admin Management',
            href: '/super-admin/admins',
            icon: Users,
          },
          { label: 'Audit Logs', href: '/super-admin/audit', icon: ScrollText },
        ]
      : [
          { label: 'Overview', href: '/admin', icon: LayoutDashboard },
          { label: 'Courses', href: '/admin/courses', icon: Building2 },
          { label: 'Problems', href: '/admin/problems', icon: ScrollText },
          { label: 'Batches', href: '/admin/batches', icon: Users },
          {
            label: 'Coding Progress',
            href: '/admin/progress',
            icon: CheckCheck,
          },
          {
            label: 'Progress Reports',
            href: '/admin/progress-reports',
            icon: ScrollText,
          },
          { label: 'Attendance', href: '/admin/attendance', icon: CheckCheck },
          { label: 'Students', href: '/admin/students', icon: Users },
        ];
  return (
    <RouteGuard role={role}>
      <div className="dashboard">
        <aside className={open ? 'sidebar sidebar-open' : 'sidebar'}>
          <div className="sidebar-brand">
            <Brand />
            <Button
              className="mobile-close"
              variant="ghost"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>
          <span className="eyebrow">
            {role === 'SUPER_ADMIN'
              ? 'PLATFORM ADMINISTRATION'
              : 'YOUR COLLEGE WORKSPACE'}
          </span>
          <nav aria-label="Administration navigation">
            {nav.map((item) => (
              <Link
                className={active === item.label ? 'active' : ''}
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active === item.label ? 'page' : undefined}
              >
                <item.icon size={17} />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="auth-trust">
              <ShieldCheck size={15} /> Permission-checked workspace
            </div>
            <SignOutButtons />
          </div>
        </aside>
        <div className="dashboard-main">
          <header className="dashboard-header">
            <Button
              variant="ghost"
              className="mobile-close"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </Button>
            <span>Administration / {active}</span>
            <ThemeToggle />
          </header>
          <main id="main" className="dashboard-content">
            <div className="dashboard-title">
              <div>
                <span className="eyebrow">ALGORA / WHERE LOGIC GROWS</span>
                <h1>{title}</h1>
                <p>{description}</p>
              </div>
            </div>
            {children}
          </main>
        </div>
      </div>
    </RouteGuard>
  );
}
