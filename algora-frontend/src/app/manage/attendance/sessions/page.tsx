'use client';
import { Plus } from 'lucide-react';
import { ButtonLink, Card, EmptyState, ErrorState, InlineSelect, PageHeader, Pagination, PageSkeleton, SearchInput } from '@/components/ui';
import { AttendanceScopeFilters, type AttendanceScope } from '@/components/attendance/AttendanceFilters';
import { AttendanceTabs } from '@/components/attendance/AttendanceTabs';
import { SessionsTable } from '@/components/attendance/SessionsTable';
import { useDebouncedUrlText } from '@/components/manage/Filters';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { qs } from '@/lib/api';
import type { SessionSummary } from '@/lib/attendance';

type State = AttendanceScope & { status: string; q: string; page: string; sort: string; dir: string };
const PAGE = 25;

export default function Page() {
  const [state, set] = useUrlState<State>({ batchId: '', collegeId: '', from: '', to: '', sessionType: '', status: '', q: '', page: '', sort: '', dir: '' });
  const data = useApi<{ items: SessionSummary[]; total: number; page: number; pageSize: number }>(`/attendance/sessions${qs({ ...state, pageSize: PAGE, page: state.page || 1 })}`);
  const sort = state.sort ? { key: state.sort as 'date' | 'eligible' | 'present' | 'absent', dir: (state.dir === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc' } : undefined;
  const onSort = (key: string) => set({ sort: key, dir: state.sort === key && state.dir !== 'asc' ? 'asc' : 'desc', page: '' });
  const [text, setText] = useDebouncedUrlText(state.q, (q) => set({ q }));
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance sessions" subtitle="Every recorded session, with drafts and cancellations."
        actions={<ButtonLink href={`/manage/attendance/record${state.batchId ? `?batchId=${state.batchId}` : ''}`} icon={<Plus size={16} aria-hidden />}>Record attendance</ButtonLink>} />
      <AttendanceTabs />
      <AttendanceScopeFilters value={state} onChange={(patch) => set({ ...patch, page: '' })} onClear={() => set({ batchId: '', collegeId: '', from: '', to: '', sessionType: '', status: '', q: '', page: '' })}
        extra={<>
          <SearchInput value={text} onChange={setText} placeholder="Search batch" label="Search batch name" />
          <InlineSelect label="Session status" value={state.status} onChange={(status) => set({ status, page: '' })}
            options={[{ value: '', label: 'All statuses' }, { value: 'FINALIZED', label: 'Finalized' }, { value: 'DRAFT', label: 'Draft' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
        </>} />
      {data.error ? <ErrorState message={data.error} retry={data.reload} /> : !data.data ? <PageSkeleton /> : (
        <Card flush>
          <SessionsTable sessions={data.data.items} showBatch sort={sort} onSort={onSort} empty={
            <EmptyState title="No sessions match these filters" body="Change the filters or record attendance for a batch." />
          } />
          <Pagination page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={(page) => set({ page: String(page) })} />
        </Card>
      )}
    </div>
  );
}
