import { NextRequest, NextResponse } from 'next/server';
import { ledgerFetch } from '@/lib/api';

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const tokens = await ledgerFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const res = NextResponse.json({ ok: true });
    res.cookies.set('accessToken', tokens.accessToken, { httpOnly: true, path: '/' });
    res.cookies.set('refreshToken', tokens.refreshToken, { httpOnly: true, path: '/' });
    return res;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
