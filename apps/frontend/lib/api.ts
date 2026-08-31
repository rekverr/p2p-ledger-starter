import { cookies } from 'next/headers';

const GATEWAY_URL = process.env.GATEWAY_SERVICE_URL ?? 'http://localhost:3004';

export class BffError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function gatewayAuthFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(`${GATEWAY_URL}/auth${path}`, init);
}

export async function bffFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = cookies().get('accessToken')?.value;
  if (!accessToken) throw new BffError(401, 'Authentication required');
  return request<T>(`${GATEWAY_URL}/bff${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

export function gatewayBffUrl(path: string): string {
  return `${GATEWAY_URL}/bff${path}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const text = await response.text();
  const payload = text ? safeJson(text) : null;
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String(payload.message)
        : `BFF returned HTTP ${response.status}`;
    throw new BffError(response.status, message);
  }
  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}
