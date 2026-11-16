'use client';
import Link from 'next/link';
import { useAuth } from '@/features/auth/provider';
import { Brand, ThemeToggle } from '@/components/layout/header';
import { SignOutButtons } from '@/features/auth/sign-out';
export function StudentShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  if (auth.error)
    return (
      <main className="student-container" role="alert">
        <h1>Session unavailable</h1>
        <p>{auth.error.message}</p>
        <Link href="/login">Return to sign in</Link>
      </main>
    );
  if (auth.loading || !auth.user)
    return (
      <main className="student-container" role="status">
        Verifying your session…
      </main>
    );
  if (auth.user.role !== 'STUDENT')
    return (
      <main className="student-container">
        <Link href={auth.destination ?? '/login'}>
          Return to your workspace
        </Link>
      </main>
    );
  return (
    <div className="student-layout">
      <header className="student-top">
        <Brand />
        <nav aria-label="Student navigation">
          <Link href="/student/courses">My courses</Link>
          <Link href="/student/batches">My batches</Link>
          <Link href="/student/attendance">My attendance</Link>
          <Link href="/student/coding-accounts">Coding Accounts</Link>
          <Link href="/student/progress">My Progress</Link>
          <Link href="/student/profile">Profile</Link>
          <Link href="/student/my-qr">My QR</Link>
          <Link href="/request-admin-access">Request Admin access</Link>
        </nav>
        <ThemeToggle />
      </header>
      <main id="main" className="student-container">
        <span className="eyebrow">YOUR ALGORA IDENTITY</span>
        <h1>{title}</h1>
        <p className="student-intro">{description}</p>
        {children}
        <footer className="student-footer">
          <SignOutButtons />
        </footer>
      </main>
    </div>
  );
}
