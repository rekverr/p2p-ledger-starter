import { NextRequest, NextResponse } from 'next/server';
import { isTrustedMutationOrigin } from '../../request-security';

export async function POST(request: NextRequest) {
  if (!isTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: 'Untrusted request origin' }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set('accessToken', '', { httpOnly: true, path: '/', maxAge: 0 });
  response.cookies.set('refreshToken', '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
