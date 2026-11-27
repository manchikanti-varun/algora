'use client';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { Combobox, ErrorState, fmtDate, LinkTabs, Notice, PageHeader, PageSkeleton, StatusBadge } from '@/components/ui';
import { BatchCtx } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { useTrackRecent } from '@/hooks/useRecent';
import { loadBatches } from '@/lib/options';
import type { Batch } from '@/components/manage/types';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { batchId } = useParams<{ batchId: string }>();
  const path = usePathname();
  const router = useRouter();
  const b = useApi<Batch>(`/batches/${batchId}`);
  const base = `/manage/batches/${batchId}`;
  useTrackRecent(b.data ? { href: base, label: b.data.name, kind: 'Batch' } : null);
  if (b.error) return <ErrorState message={b.error} retry={b.reload} />;
  if (!b.data) return <PageSkeleton />;
  const batch = b.data;
  const sub = path.startsWith(base) ? path.slice(base.length) : '';
  const tabs = [
    { href: base, label: 'Overview', exact: true }, { href: `${base}/courses`, label: 'Courses' }, { href: `${base}/visibility`, label: 'Chapter Access' },
    { href: `${base}/students`, label: 'Students' }, { href: `${base}/attendance`, label: 'Attendance' }, { href: `${base}/analytics`, label: 'Analytics' }, { href: `${base}/settings`, label: 'Settings' },
  ];
  const subtitle = [batch.college, batch.startDate && `${fmtDate(batch.startDate)} – ${fmtDate(batch.endDate)}`].filter(Boolean).join(' · ') || undefined;
  return (
    <BatchCtx.Provider value={{ batch, reload: b.reload }}>
      <PageHeader title={batch.name} meta={<StatusBadge status={batch.status} />} subtitle={subtitle}
        breadcrumbs={[{ label: 'Batches', href: '/manage/batches' }, { label: batch.name }]}
        actions={<Combobox label="Switch batch" value={batch._id} selectedLabel={batch.name} load={loadBatches} className="w-56 max-w-full"
          onChange={(id) => { if (id && id !== batch._id) router.push(`/manage/batches/${id}${sub}`); }} />} />
      {batch.status === 'ARCHIVED' && <div className="mb-4"><Notice tone="warn">This batch is archived and read-only. Change its status in Settings to edit it.</Notice></div>}
      <LinkTabs label="Batch sections" items={tabs} />
      {children}
    </BatchCtx.Provider>
  );
}
