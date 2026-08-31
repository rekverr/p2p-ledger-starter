import { UpstreamService } from '../src/upstream.service';

describe('UpstreamService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('forwards Authorization and Idempotency-Key without changing the body', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'transfer-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new UpstreamService();

    await expect(
      service.request('payments', '/transfers', {
        method: 'POST',
        authorization: 'Bearer access-token',
        idempotencyKey: 'logical-operation',
        body: { amount: 10 },
      }),
    ).resolves.toEqual({ id: 'transfer-1' });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://payments-service:3002/transfers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer access-token',
          'idempotency-key': 'logical-operation',
        }),
        body: JSON.stringify({ amount: 10 }),
      }),
    );
  });
});
