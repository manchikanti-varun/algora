import { MANAGE_NAV, ManageShell } from '@/components/Shell';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ManageShell nav={MANAGE_NAV}>{children}</ManageShell>;
}
