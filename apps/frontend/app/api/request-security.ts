import { NextRequest } from 'next/server';

export function isTrustedMutationOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const expected = process.env.FRONTEND_ORIGIN ?? request.nextUrl.origin;
  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}
