import { NextRequest, NextResponse } from 'next/server';
import { gatewayBffUrl } from '@/lib/api';
import { isTrustedMutationOrigin } from '../request-security';

export async function proxyBffRequest(
  request: NextRequest,
  segments: string[],
): Promise<NextResponse> {
  if (
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    !isTrustedMutationOrigin(request)
  ) {
    return NextResponse.json({ message: 'Untrusted request origin' }, { status: 403 });
  }
  let accessToken = request.cookies.get('accessToken')?.value;
  let refreshed: { accessToken: string; refreshToken: string } | null = null;
  if (!accessToken) {
    refreshed = await refreshTokens(request.cookies.get('refreshToken')?.value);
    if (!refreshed) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    accessToken = refreshed.accessToken;
  }
  const path = `/${segments.map(encodeURIComponent).join('/')}`;
  const idempotencyKey = request.headers.get('idempotency-key');
  const requestBody =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.text();
  const call = (token: string) => fetch(
    `${gatewayBffUrl(path)}${request.nextUrl.search}`,
    {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': request.headers.get('content-type') ?? 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: requestBody,
      cache: 'no-store',
    },
  );
  let upstream = await call(accessToken);
  if (upstream.status === 401) {
    refreshed = await refreshTokens(request.cookies.get('refreshToken')?.value);
    if (refreshed) {
      accessToken = refreshed.accessToken;
      upstream = await call(accessToken);
    }
  }
  const upstreamBody = await upstream.text();
  const response = new NextResponse(upstreamBody || null, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') ?? 'application/json',
    },
  });
  if (refreshed) setTokenCookies(response, refreshed);
  if (upstream.status === 401 && !refreshed) clearTokenCookies(response);
  return response;
}

async function refreshTokens(refreshToken: string | undefined) {
  if (!refreshToken) return null;
  const gateway = process.env.GATEWAY_SERVICE_URL ?? 'http://localhost:3004';
  const response = await fetch(`${gateway}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json() as Promise<{ accessToken: string; refreshToken: string }>;
}

function setTokenCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
) {
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  };
  response.cookies.set('accessToken', tokens.accessToken, options);
  response.cookies.set('refreshToken', tokens.refreshToken, options);
}

function clearTokenCookies(response: NextResponse) {
  response.cookies.set('accessToken', '', { httpOnly: true, path: '/', maxAge: 0 });
  response.cookies.set('refreshToken', '', { httpOnly: true, path: '/', maxAge: 0 });
}
