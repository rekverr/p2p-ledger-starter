import { NextRequest, NextResponse } from 'next/server';
import { notificationsFetch } from '@/lib/api';

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get('accessToken')?.value;
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const query = request.nextUrl.search;
    const page = await notificationsFetch(`/activity${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return NextResponse.json(page);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Activity unavailable' },
      { status: 502 },
    );
  }
}
