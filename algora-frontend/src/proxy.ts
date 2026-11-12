import { NextResponse, type NextRequest } from 'next/server';

// This is a development preview switch, not an authentication boundary.
export function proxy(request: NextRequest) {
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

export const config = { matcher: '/preview/:path*' };
