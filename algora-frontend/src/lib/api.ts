export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public retryAfterMs?: number) {
    super(message);
  }
}

let csrfToken: string | null = null;
let generation = 0;
const pending = new Map<string, Promise<unknown>>();
const cache = new Map<string, { value: unknown; expires: number }>();

function invalidateReads() {
  generation++;
  cache.clear();
  pending.clear();
}
export const setCsrfToken = (t: string | null) => {
  if (t !== csrfToken) invalidateReads();
  csrfToken = t;
};
export function cachedApiValue<T>(path: string): T | undefined {
  const entry = cache.get(path);
  return entry && entry.expires > Date.now() ? entry.value as T : undefined;
}
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

const credentialPaths = new Set(['/auth/google', '/auth/register/student', '/trainer-requests']);

async function request(path: string, init: { method?: string; body?: unknown; raw?: boolean } = {}) {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken && !(method === 'POST' && credentialPaths.has(path))) headers['x-csrf-token'] = csrfToken;
  return fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}

async function fail(res: Response, revision: number): Promise<never> {
  const data = await res.json().catch(() => ({}));
  const e = data?.error ?? {};
  if (revision === generation && res.status === 401 && path401(res)) onUnauthorized?.();
  const retryAfter = res.headers.get('retry-after');
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
  const message = res.status === 429 && !data?.reason
    ? 'We’re receiving a lot of requests. Please try again in a moment.'
    : e.message ?? 'Something went wrong. Please try again.';
  throw new ApiError(res.status, e.code ?? 'ERROR', message, e.details ?? data, Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : undefined);
}
const path401 = (res: Response) => !res.url.endsWith('/auth/me') && !res.url.includes('/auth/google');

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; cache?: boolean } = {}): Promise<T> {
  const read = !init.method || init.method === 'GET';
  const key = `${init.cache ? 'cached' : 'fresh'}:${path}`;
  const inFlight = read && pending.get(key);
  if (inFlight) return inFlight as Promise<T>;
  const revision = generation;
  const result = (async () => {
    const res = await request(path, init);
    if (!res.ok) return fail(res, revision);
    if (!read) invalidateReads();
    if (res.status === 204) return undefined as T;
    const value = await res.json() as T;
    if (read && init.cache && revision === generation) {
      cache.delete(path);
      cache.set(path, { value, expires: Date.now() + 15_000 });
      if (cache.size > 64) cache.delete(cache.keys().next().value!);
    }
    return value;
  })();
  if (read) pending.set(key, result);
  try {
    return await result;
  } finally {
    if (pending.get(key) === result) pending.delete(key);
  }
}

/** Download a CSV (or any file) through the authenticated proxy. */
export async function download(path: string) {
  const revision = generation;
  const res = await request(path);
  if (!res.ok) return fail(res, revision);
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
