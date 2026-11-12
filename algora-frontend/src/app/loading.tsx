import { Skeleton } from '@/components/shared/states';
export default function Loading() {
  return (
    <main id="main" className="wrap section">
      <Skeleton />
      <Skeleton />
    </main>
  );
}
