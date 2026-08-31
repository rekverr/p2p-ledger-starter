import { NextRequest, NextResponse } from 'next/server';
import { gatewayAuthFetch } from '@/lib/api';
import { isTrustedMutationOrigin } from '../../request-security';

export async function POST(req: NextRequest) {
  if (!isTrustedMutationOrigin(req)) {
    return NextResponse.json({ error: 'Untrusted request origin' }, { status: 403 });
  }
  const body = await req.json();
  try {
    const tokens = await gatewayAuthFetch<{
      accessToken: string;
      refreshToken: string;
    }>('/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const res = NextResponse.json({ ok: true });
    const cookie = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
    };
    res.cookies.set('accessToken', tokens.accessToken, cookie);
    res.cookies.set('refreshToken', tokens.refreshToken, cookie);
    return res;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
