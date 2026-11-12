import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { meSchema, type Role, userSchema } from './contracts';
import { verifyBackend, sessionCookieName } from './backend-verification';
export async function verifiedBackend<T>(path: string, schema: z.ZodType<T>) {
  const store = await cookies();
  const result = await verifyBackend(
    store.get(sessionCookieName())?.value,
    path,
    schema,
  );
  if (!result.ok) redirect(result.destination);
  return result.data;
}
export const requireWorkspace = cache(async (role: Role) => {
  const path = role === 'SUPER_ADMIN' ? 'super-admin' : role.toLowerCase();
  return verifiedBackend(
    '/auth/access/' + path,
    z.object({ authorized: z.literal(true), user: userSchema }),
  );
});
export const requireSession = cache(() =>
  verifiedBackend('/auth/me', meSchema),
);
