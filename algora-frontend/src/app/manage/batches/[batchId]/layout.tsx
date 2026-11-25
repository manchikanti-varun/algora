'use client';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { cx, ErrorState, fmtDate, Notice, PageHeader, PageSkeleton, StatusBadge } from '@/components/ui';
import { BatchCtx } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import type { Batch } from '@/components/manage/types';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { batchId } = useParams<{ batchId: string }>();
  const path = usePathname();
  const b = useApi<Batch>(`/batches/${batchId}`);
  if (b.error) return <ErrorState message={b.error} retry={b.reload} />;
  if (!b.data) return <PageSkeleton />;
  const base = `/manage/batches/${batchId}`;
  const tabs = [['', 'Overview'], ['/courses', 'Courses'], ['/visibility', 'Chapter visibility'], ['/students', 'Students'], ['/analytics', 'Analytics'], ['/settings', 'Settings']];
  return (
    <BatchCtx.Provider value={{ batch: b.data, reload: b.reload }}>
      <PageHeader back={{ href: '/manage/batches', label: 'Batches' }} title={<span className="flex items-center gap-3">{b.data.name}<StatusBadge status={b.data.status} /></span>}
        subtitle={[b.data.college, b.data.startDate && `${fmtDate(b.data.startDate)} – ${fmtDate(b.data.endDate)}`].filter(Boolean).join(' · ') || undefined} />
      {b.data.status === 'ARCHIVED' && <div className="mb-4"><Notice tone="warn">This batch is archived and read-only. Change its status in Settings to edit it.</Notice></div>}
      <nav className="mb-6 border-b border-slate-200" aria-label="Batch sections">
        <div className="-mb-px flex gap-4 overflow-x-auto">
          {tabs.map(([href, label]) => {
            const on = href === '' ? path === base : path.startsWith(base + href);
            return <Link key={href} href={base + href} aria-current={on ? 'page' : undefined} className={cx('whitespace-nowrap border-b-2 px-1 pb-2.5 text-sm font-medium', on ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>{label}</Link>;
          })}
        </div>
      </nav>
      {children}
    </BatchCtx.Provider>
  );
}
