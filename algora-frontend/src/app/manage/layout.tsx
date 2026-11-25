import { ManageShell } from '@/components/Shell';
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ManageShell nav={[
      { section: 'Overview', items: [{ href: '/manage/dashboard', label: 'Dashboard' }] },
      { section: 'Teaching', items: [
        { href: '/manage/batches', label: 'Batches' }, { href: '/manage/courses', label: 'Courses' },
        { href: '/manage/students', label: 'Students' }, { href: '/manage/leaderboards', label: 'Leaderboards' },
      ] },
      { section: 'Insights', items: [{ href: '/manage/analytics', label: 'Analytics' }, { href: '/manage/reports', label: 'Reports' }] },
      { section: 'Administration', items: [
        { href: '/manage/trainers', label: 'Trainers', roles: ['SUPER_ADMIN'] }, { href: '/manage/colleges', label: 'Colleges', roles: ['SUPER_ADMIN'] },
        { href: '/manage/settings', label: 'Scoring', roles: ['SUPER_ADMIN'] }, { href: '/manage/integration', label: 'Integration health', roles: ['SUPER_ADMIN'] },
        { href: '/manage/audit', label: 'Audit log', roles: ['SUPER_ADMIN'] },
      ] },
    ]}>{children}</ManageShell>
  );
}
