export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => { csrfToken = t; };
let onUnauthorized: (() => void) | null = null;
/** Called when a request returns 401 (expired or revoked session). */
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

type Query = Record<string, string | number | boolean | undefined | null>;
export const qs = (q?: Query) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function request(path: string, init: { method?: string; body?: unknown; raw?: boolean } = {}) {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  return fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}

async function fail(res: Response): Promise<never> {
  const data = await res.json().catch(() => ({}));
  const e = data?.error ?? {};
  if (res.status === 401 && path401(res)) onUnauthorized?.();
  throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? (res.status === 429 ? 'Too many requests' : 'Request failed'), e.details ?? data);
}
const path401 = (res: Response) => !res.url.endsWith('/auth/me') && !res.url.includes('/auth/google');

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await request(path, init);
  if (res.status === 204) return undefined as T;
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

/** Download a CSV (or any file) through the authenticated proxy. */
export async function download(path: string) {
  const res = await request(path);
  if (!res.ok) return fail(res);
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export.csv';
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const errorMessage = (e: unknown) => {
  if (e instanceof ApiError) {
    const d = e.details;
    if (Array.isArray(d) && d.length && typeof d[0] === 'object' && d[0] && 'message' in d[0]) return `${e.message}: ${d.map((x: { path: string; message: string }) => `${x.path ? x.path + ' ' : ''}${x.message}`).join('; ')}`;
    return e.message;
  }
  return 'Something went wrong';
};
