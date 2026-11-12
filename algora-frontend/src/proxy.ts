import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  verifyBackend,
  sessionCookieName,
} from './features/auth/backend-verification';
import { meSchema, userSchema } from './features/auth/contracts';

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith('/preview')) {
    const role = /^\/(student|admin|super-admin)(?:\/|$)/.exec(pathname)?.[1];
    const token = request.cookies.get(sessionCookieName())?.value;
    if (
      [
        '/student/register',
        '/student/profile',
        '/student/my-qr',
        '/student/courses',
        '/student/batches',
      ].includes(pathname)
    ) {
      const result = await verifyBackend(token, '/auth/me', meSchema);
      if (!result.ok)
        return NextResponse.redirect(new URL(result.destination, request.url));
      const user = result.data.user;
      if (user.role !== 'STUDENT')
        return NextResponse.redirect(
          new URL(result.data.destination, request.url),
        );
      const registered = !['NOT_STARTED', 'INCOMPLETE'].includes(
        user.registrationStatus,
      );
      if (pathname === '/student/register' && registered)
        return NextResponse.redirect(new URL('/student/profile', request.url));
      if (pathname !== '/student/register' && !registered)
        return NextResponse.redirect(new URL('/student/register', request.url));
      return NextResponse.next();
    }
    if (role) {
      const result = await verifyBackend(
        token,
        '/auth/access/' + role,
        z.object({ authorized: z.literal(true), user: userSchema }),
      );
      return result.ok
        ? NextResponse.next()
        : NextResponse.redirect(new URL(result.destination, request.url));
    }
    const result = await verifyBackend(token, '/auth/me', meSchema);
    if (pathname === '/request-admin-access') {
      if (!result.ok)
        return NextResponse.redirect(
          new URL(
            result.destination === '/login'
              ? '/login?intent=admin-access'
              : result.destination,
            request.url,
          ),
        );
      return result.data.user.role === 'STUDENT'
        ? NextResponse.next()
        : NextResponse.redirect(new URL(result.data.destination, request.url));
    }
    if (!result.ok)
      return NextResponse.redirect(new URL(result.destination, request.url));
    return result.data.destination === pathname
      ? NextResponse.next()
      : NextResponse.redirect(new URL(result.data.destination, request.url));
  }
  const validPath = /^\/preview\/(student|admin|super-admin)\/?$/.test(
    request.nextUrl.pathname,
  );
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.ENABLE_PREVIEW_ROUTES !== 'true' ||
    !validPath
  ) {
    return new NextResponse('Page not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/preview/:path*',
    '/student/:path*',
    '/admin/:path*',
    '/super-admin/:path*',
    '/registration-required',
    '/account-pending',
    '/request-admin-access',
  ],
};
