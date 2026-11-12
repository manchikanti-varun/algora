'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Menu, X, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { Brand, ThemeToggle } from '@/components/layout/header';
import { navigation, type PreviewRole } from '@/config/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/states';
import { type PublicUser, type Role } from './contracts';
import { RouteGuard } from './route-guard';
import { SignOutButtons } from './sign-out';
export function Workspace({ role, user }: { role: Role; user: PublicUser }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('Overview');
  const key: PreviewRole =
    role === 'SUPER_ADMIN'
      ? 'super-admin'
      : role === 'ADMIN'
        ? 'admin'
        : 'student';
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
          <span className="eyebrow">{key.replaceAll('-', ' ')} WORKSPACE</span>
          <nav aria-label="Workspace navigation">
            {role === 'STUDENT' && (
              <>
                <Link href="/student/profile">My profile</Link>
                <Link href="/student/my-qr">My QR</Link>
              </>
            )}
            {navigation[key]
              .filter(
                (item) =>
                  role !== 'STUDENT' || !['Profile', 'My QR'].includes(item),
              )
              .map((item) => (
                <button
                  key={item}
                  className={active === item ? 'active' : ''}
                  aria-current={active === item ? 'page' : undefined}
                  onClick={() => {
                    setActive(item);
                    setOpen(false);
                  }}
                >
                  <LayoutDashboard size={17} />
                  {item}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <p>Securely signed in with Google.</p>
            <SignOutButtons />
          </div>
        </aside>
        <div className="dashboard-main">
          <header className="dashboard-header">
            <Button
              className="mobile-close"
              variant="ghost"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </Button>
            <span>Workspace / {active}</span>
            <ThemeToggle />
          </header>
          <main id="main" className="dashboard-content">
            <div className="preview-banner">
              <ShieldCheck size={18} /> Identity and workspace access verified
              by Algora.
            </div>
            <div className="dashboard-title">
              <div>
                <span className="eyebrow">WHERE LOGIC GROWS</span>
                <h1>Welcome, {user.displayName}.</h1>
                <p>
                  Your account is active. This workspace is ready for its next
                  chapter.
                </p>
              </div>
            </div>
            <Card>
              <EmptyState
                title={
                  active === 'Overview'
                    ? 'A secure foundation for what’s next'
                    : active + ' is coming later'
                }
                description="Your student identity, profile and permanent QR are available through the navigation. Courses, batches and enrollment will be introduced in later phases."
              />
            </Card>
          </main>
        </div>
      </div>
    </RouteGuard>
  );
}
