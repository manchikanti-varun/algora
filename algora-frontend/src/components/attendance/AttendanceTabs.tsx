'use client';
import { LinkTabs } from '@/components/ui';

/** Contextual navigation shared by every attendance destination. */
export function AttendanceTabs() {
  return (
    <LinkTabs label="Attendance sections" items={[
      { href: '/manage/attendance', label: 'Overview', exact: true },
      { href: '/manage/attendance/sessions', label: 'Sessions' },
      { href: '/manage/attendance/register', label: 'Register' },
      { href: '/manage/attendance/analytics', label: 'Analytics' },
      { href: '/manage/attendance/students', label: 'Students' },
    ]} />
  );
}
