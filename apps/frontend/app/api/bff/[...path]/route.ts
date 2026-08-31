import { NextRequest } from 'next/server';
import { proxyBffRequest } from '../proxy';

interface RouteContext {
  params: { path: string[] };
}

export function GET(request: NextRequest, context: RouteContext) {
  return proxyBffRequest(request, context.params.path);
}

export function POST(request: NextRequest, context: RouteContext) {
  return proxyBffRequest(request, context.params.path);
}
