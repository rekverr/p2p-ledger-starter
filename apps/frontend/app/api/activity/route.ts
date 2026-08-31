import { NextRequest } from 'next/server';
import { proxyBffRequest } from '../bff/proxy';

export function GET(request: NextRequest) {
  return proxyBffRequest(request, ['activity']);
}
