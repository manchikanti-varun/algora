import { PageHeader } from '@/components/ui';
import { RequestList } from '@/components/student/RequestList';

export default function Page() {
  return (
    <>
      <PageHeader title="Requests" subtitle="Review profile and LeetCode account changes from students in your scope." />
      <RequestList management />
    </>
  );
}
