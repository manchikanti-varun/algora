'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet, healthSchema } from '@/lib/api/client';
export function HealthIndicator() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiGet('/health', healthSchema, signal),
    refetchInterval: 30000,
  });
  return (
    <button
      className="health"
      onClick={() => void query.refetch()}
      title="HTTP liveness only. Click to refresh."
      aria-label="Refresh backend connectivity"
    >
      <span
        className={
          query.isPending
            ? 'dot pending'
            : query.isError
              ? 'dot offline'
              : 'dot'
        }
      />
      <span role="status">
        {query.isPending
          ? 'Checking backend'
          : query.isError
            ? 'Backend unreachable'
            : 'Backend connected'}
      </span>
    </button>
  );
}
