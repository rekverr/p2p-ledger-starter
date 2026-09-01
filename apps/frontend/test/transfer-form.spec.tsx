import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransferForm } from '@/components/transfer-form';

vi.mock('@/components/live-refresh', () => ({
  LiveRefresh: () => <p>live</p>,
}));

describe('TransferForm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the same Idempotency-Key when retrying a failed logical submission', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'stable-transfer-key' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'temporary failure' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <TransferForm
        wallets={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            ownerId: '22222222-2222-4222-8222-222222222222',
            currency: 'USD',
            balance: '100.00',
            held: '0.00',
            available: '100.00',
          },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/recipient email/i), {
      target: { value: 'receiver@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '10.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send transfer' }));
    await screen.findByText('temporary failure');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).headers)).toEqual([
      expect.objectContaining({ 'Idempotency-Key': 'stable-transfer-key' }),
      expect.objectContaining({ 'Idempotency-Key': 'stable-transfer-key' }),
    ]);
  });
});
