'use client';
import { StudentShell } from '@/components/Shell';
import { SyncButton, SyncProvider } from '@/components/student/SyncProvider';
import { useAuth } from '@/lib/auth';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const nav = [
    { href: '/student/dashboard', label: 'Dashboard' }, { href: '/student/courses', label: 'Courses' }, { href: '/student/progress', label: 'Progress' },
    { href: '/student/leaderboard', label: 'Leaderboard' }, { href: '/student/profile', label: 'Profile' },
  ];
  // The sync provider is only mounted for students, so management users never call student endpoints.
  if (user?.role !== 'STUDENT') return <StudentShell nav={nav}>{children}</StudentShell>;
  return <SyncProvider><StudentShell nav={nav} aside={<SyncButton />}>{children}</StudentShell></SyncProvider>;
}
