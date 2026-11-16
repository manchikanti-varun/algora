'use client';
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import { apiGet, apiMutate, ApiError } from '@/lib/api/client';
export function useAdministration<T>(
  path: string,
  schema: z.ZodType<T>,
  enabled = true,
  preservePrevious = false,
) {
  return useQuery({
    queryKey: ['administration', path],
    queryFn: ({ signal }) => apiGet(path, schema, signal),
    enabled,
    placeholderData: preservePrevious ? keepPreviousData : undefined,
    retry: false,
    staleTime: 10000,
  });
}
export function useCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: {
      path: string;
      method?: 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
    }) =>
      apiMutate(
        command.path,
        command.method ?? 'POST',
        z.unknown(),
        command.body,
      ),
    onSuccess: async () => {
      toast.success('Changes saved');
      await client.invalidateQueries({ queryKey: ['administration'] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'The operation could not be completed',
      );
      void client.invalidateQueries({ queryKey: ['administration'] });
    },
  });
}
export function listPath(
  path: string,
  query: {
    page: number;
    search?: string;
    status?: string;
    sort?: string;
    direction?: string;
    from?: string;
    to?: string;
    action?: string;
  },
) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: '10',
  });
  for (const [key, value] of Object.entries(query))
    if (key !== 'page' && value) params.set(key, String(value));
  return path + '?' + params.toString();
}
