import { NextRequest, NextResponse } from 'next/server';
import { gatewayBffUrl } from '@/lib/api';

export async function proxyBffRequest(
  request: NextRequest,
  segments: string[],
): Promise<NextResponse> {
  const accessToken = request.cookies.get('accessToken')?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  const path = `/${segments.map(encodeURIComponent).join('/')}`;
  const idempotencyKey = request.headers.get('idempotency-key');
  const upstream = await fetch(
    `${gatewayBffUrl(path)}${request.nextUrl.search}`,
    {
      method: request.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': request.headers.get('content-type') ?? 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.text(),
      cache: 'no-store',
    },
  );
  const body = await upstream.text();
  return new NextResponse(body || null, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}
