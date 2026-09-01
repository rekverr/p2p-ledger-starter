import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SplitBillDetail } from '@/components/split-bill-detail';
import { SplitBill } from '@/lib/types';

vi.mock('@/components/live-refresh', () => ({ LiveRefresh: () => <p>live</p> }));

describe('SplitBillDetail', () => {
  it('offers payment only for the principal own share through the BFF', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'share-logical-key' });
    const bill: SplitBill = {
      id: '11111111-1111-4111-8111-111111111111',
      creatorUserId: '22222222-2222-4222-8222-222222222222',
      creatorReference: 'creator@example.com',
      total: '20.00',
      currency: 'USD',
      deadline: null,
      status: 'Pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      shares: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          participantUserId: '44444444-4444-4444-8444-444444444444',
          amount: '10.00',
          paymentStatus: 'Unpaid',
          transferId: null,
          transferStatus: null,
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          participantUserId: '66666666-6666-4666-8666-666666666666',
          amount: '10.00',
          paymentStatus: 'Unpaid',
          transferId: null,
          transferStatus: null,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ bill: { ...bill, status: 'PartiallyPaid' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <SplitBillDetail
        initial={bill}
        me={{
          userId: '44444444-4444-4444-8444-444444444444',
          email: 'participant@example.com',
          role: 'user',
        }}
        wallets={[
          {
            id: '77777777-7777-4777-8777-777777777777',
            ownerId: '44444444-4444-4444-8444-444444444444',
            currency: 'USD',
            balance: '50.00',
            held: '0.00',
            available: '50.00',
          },
        ]}
      />,
    );

    expect(screen.getAllByRole('button', { name: /Pay your share/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Pay your share/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bff/split-bills/11111111-1111-4111-8111-111111111111/shares/33333333-3333-4333-8333-333333333333/pay',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': 'share-logical-key',
        }),
      }),
    );
  });
});
