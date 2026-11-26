'use client';
import { useRouter } from 'next/navigation';
import { Card, PageHeader, useToast } from '@/components/ui';
import { BatchForm } from '@/components/manage/BatchForm';
import { api, errorMessage } from '@/lib/api';

export default function Page() {
  const router = useRouter(); const toast = useToast();
  return (
    <div className="max-w-2xl">
      <PageHeader title="New batch" breadcrumbs={[{ label: 'Batches', href: '/manage/batches' }, { label: 'New batch' }]}
        subtitle="A batch does not need a course. Assign courses after creating it." />
      <Card><BatchForm submitLabel="Create batch" onSubmit={async (b) => {
        try { const r = await api<{ _id: string }>('/batches', { method: 'POST', body: b }); toast.success('Batch created'); router.push(`/manage/batches/${r._id}`); }
        catch (e) { throw new Error(errorMessage(e)); }
      }} /></Card>
    </div>
  );
}
