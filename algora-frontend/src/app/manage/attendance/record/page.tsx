'use client';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { AttendanceTabs } from '@/components/attendance/AttendanceTabs';
import { RecordAttendance } from '@/components/attendance/RecordAttendance';
import { useApi } from '@/hooks/useApi';

export default function Page() {
  const params = useSearchParams();
  const batchId = params.get('batchId') ?? undefined;
  const batch = useApi<{ _id: string; name: string }>(batchId ? `/batches/${batchId}` : null);
  const batchName = batch.data?.name;
  return (
    <div className="space-y-6">
      <PageHeader title="Record attendance" subtitle="Upload the roll numbers exported by your QR scanner, review the result, then confirm."
        breadcrumbs={[{ label: 'Attendance', href: '/manage/attendance' }, { label: 'Record attendance' }]} />
      <AttendanceTabs />
      <RecordAttendance batchId={batchId} batchName={batchName} />
    </div>
  );
}
