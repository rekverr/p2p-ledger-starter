import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyBffRequest } from '@/app/api/bff/proxy';

describe('frontend BFF proxy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the JWT in an httpOnly cookie and forwards it as bearer auth', async () => {
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ id: 'wallet-1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const request = new NextRequest('http://frontend/api/bff/wallets', {
      headers: { cookie: 'accessToken=signed.jwt.value' },
    });

    const response = await proxyBffRequest(request, ['wallets']);

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledWith(
      'http://localhost:3004/bff/wallets',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer signed.jwt.value',
        }),
      }),
    );
  });

  it('rejects protected calls when the auth cookie is absent', async () => {
    const upstreamFetch = vi.spyOn(globalThis, 'fetch');
    const request = new NextRequest('http://frontend/api/bff/wallets');

    const response = await proxyBffRequest(request, ['wallets']);

    expect(response.status).toBe(401);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('rejects a cross-site financial mutation before forwarding it', async () => {
    const upstreamFetch = vi.spyOn(globalThis, 'fetch');
    const request = new NextRequest('http://frontend/api/bff/transfers', {
      method: 'POST',
      headers: {
        cookie: 'accessToken=signed.jwt.value',
        origin: 'https://attacker.example',
      },
      body: '{}',
    });

    const response = await proxyBffRequest(request, ['transfers']);

    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
