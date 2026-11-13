import { env } from '@/config/env';
import { z } from 'zod';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    csrfToken?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const timeoutMs =
    /\/attendance.*\/(?:open|finalize|refresh|export|reports)(?:\?|$)/.test(
      path,
    )
      ? 60000
      : 8000;
  let response: Response;
  try {
    response = await fetch(
      env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, '') + path,
      {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
        credentials: 'include',
        cache: 'no-store',
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
          ...(options.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Backend is unreachable');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'Backend returned an invalid response',
    );
  }
  if (!response.ok) {
    const parsed = z
      .object({
        error: z.object({
          code: z.string(),
          message: z.string(),
          requestId: z.string().optional(),
        }),
      })
      .safeParse(body);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'HTTP_ERROR',
      parsed.success ? parsed.data.error.message : 'Request failed',
      parsed.success ? parsed.data.error.requestId : undefined,
    );
  }
  const parsed = z
    .object({ success: z.literal(true), data: schema })
    .safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'Unexpected backend response',
    );
  return parsed.data.data;
}
export const healthSchema = z.object({
  service: z.literal('algora-backend'),
  status: z.literal('ok'),
});
export const apiGet = <T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
) => apiRequest(path, schema, signal);
export async function apiPost<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
) {
  return apiMutate(path, 'POST', schema, body);
}
export async function apiMutate<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  schema: z.ZodType<T>,
  body?: unknown,
) {
  const { csrfToken } = await apiGet(
    '/auth/csrf',
    z.object({ csrfToken: z.string() }),
  );
  return apiRequest(path, schema, undefined, { method, csrfToken, body });
}
