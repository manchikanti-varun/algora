'use client';
import { StudentShell } from '@/components/Shell';
import { SyncProvider, UpdateProgress } from '@/components/student/SyncProvider';
import { useAuth } from '@/lib/auth';
export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // The sync provider is only mounted for students, so management users never call student endpoints.
  if (user?.role !== 'STUDENT') return <StudentShell>{children}</StudentShell>;
  return <SyncProvider><StudentShell aside={<UpdateProgress />}>{children}</StudentShell></SyncProvider>;
}
