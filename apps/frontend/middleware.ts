import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get('accessToken')?.value;
  if (accessToken && !isExpired(accessToken)) return NextResponse.next();

  const refreshToken = request.cookies.get('refreshToken')?.value;
  if (!refreshToken) return loginRedirect(request);
  const gateway = process.env.GATEWAY_SERVICE_URL ?? 'http://localhost:3004';
  try {
    const refreshed = await fetch(`${gateway}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!refreshed.ok) return loginRedirect(request, true);
    const tokens = (await refreshed.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    // Redirect once so the Server Component receives the rotated cookie on its
    // new request; this avoids an auth redirect loop and token exposure to JS.
    const response = NextResponse.redirect(request.nextUrl);
    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
    };
    response.cookies.set('accessToken', tokens.accessToken, options);
    response.cookies.set('refreshToken', tokens.refreshToken, options);
    return response;
  } catch {
    return loginRedirect(request, true);
  }
}

function isExpired(token: string): boolean {
  try {
    const encoded = token.split('.')[1];
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(normalized)) as { exp?: unknown };
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now() + 5_000;
  } catch {
    return true;
  }
}

function loginRedirect(request: NextRequest, clear = false): NextResponse {
  const url = new URL('/login', request.url);
  url.searchParams.set('next', request.nextUrl.pathname);
  const response = NextResponse.redirect(url);
  if (clear) {
    response.cookies.set('accessToken', '', { httpOnly: true, path: '/', maxAge: 0 });
    response.cookies.set('refreshToken', '', { httpOnly: true, path: '/', maxAge: 0 });
  }
  return response;
}

export const config = {
  matcher: [
    '/wallets/:path*',
    '/transfers/:path*',
    '/split-bills/:path*',
    '/activity/:path*',
    '/admin/:path*',
  ],
};
