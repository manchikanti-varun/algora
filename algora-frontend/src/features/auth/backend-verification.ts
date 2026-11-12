// Shared server transport: Express remains the only authentication authority.
import { z } from 'zod';
export const sessionCookieName = () =>
  process.env.NODE_ENV === 'production'
    ? '__Host-algora_session'
    : 'algora_session';
type Verification<T> =
  { ok: true; data: T } | { ok: false; destination: string };
export async function verifyBackend<T>(
  token: string | undefined,
  path: string,
  schema: z.ZodType<T>,
): Promise<Verification<T>> {
  const denied = (destination: string): Verification<T> => ({
    ok: false,
    destination,
  });
  if (!token) return denied('/login');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    return denied('/login?reason=session-expired');
  let response: Response;
  try {
    const base = z
      .url()
      .parse(
        process.env.BACKEND_API_BASE_URL ??
          (process.env.NODE_ENV === 'production'
            ? undefined
            : 'http://localhost:5000/api/v1'),
      )
      .replace(/\/$/, '');
    response = await fetch(base + path, {
      headers: { Cookie: sessionCookieName() + '=' + token },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return denied('/login?error=unavailable');
  }
  if (response.status === 401) return denied('/login?reason=session-expired');
  if (response.status >= 500) return denied('/login?error=unavailable');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return denied('/login?error=unavailable');
  }
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ code: z.string() }) })
      .safeParse(body);
    const code = error.success ? error.data.error.code : '';
    return denied(
      code === 'ACCOUNT_SUSPENDED'
        ? '/account-suspended'
        : code === 'ACCOUNT_PENDING'
          ? '/account-pending'
          : code === 'REGISTRATION_REQUIRED'
            ? '/registration-required'
            : '/unauthorized',
    );
  }
  const parsed = z
    .object({ success: z.literal(true), data: schema })
    .safeParse(body);
  return parsed.success
    ? { ok: true, data: parsed.data.data }
    : denied('/login?error=unavailable');
}
