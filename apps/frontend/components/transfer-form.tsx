'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LogicalSubmission } from '@/lib/idempotency';
import { Transfer, Wallet } from '@/lib/types';
import { LiveRefresh } from './live-refresh';

const terminal = new Set(['Completed', 'Failed']);

export function TransferForm({ wallets }: { wallets: Wallet[] }) {
  const logical = useRef(new LogicalSubmission());
  const [fromWalletId, setFromWalletId] = useState(wallets[0].id);
  const selected = wallets.find(({ id }) => id === fromWalletId) ?? wallets[0];
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('');
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!transfer || terminal.has(transfer.status)) return;
    const response = await fetch(`/api/bff/transfers/${transfer.id}`, {
      cache: 'no-store',
    });
    if (response.ok) setTransfer((await response.json()) as Transfer);
  }, [transfer]);

  useEffect(() => {
    if (!transfer || terminal.has(transfer.status)) return;
    const timer = window.setInterval(() => void refreshStatus(), 1500);
    return () => window.clearInterval(timer);
  }, [refreshStatus, transfer]);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const attempt = logical.current.begin();
    if (!attempt.accepted) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/bff/transfers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.key,
        },
        body: JSON.stringify({
          fromWalletId,
          toWalletIdentifier: receiver,
          amount: Number(amount),
          currency: selected.currency,
        }),
      });
      const body = (await response.json()) as Transfer & { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Переказ не створено');
      setTransfer(body);
    } catch (current: unknown) {
      setError(current instanceof Error ? current.message : 'Помилка переказу');
    } finally {
      logical.current.finish();
      setSubmitting(false);
    }
  }

  function newTransfer() {
    logical.current.reset();
    setTransfer(null);
    setReceiver('');
    setAmount('');
    setError(null);
  }

  return (
    <>
      <LiveRefresh onRefresh={refreshStatus} />
      <form className="card" onSubmit={submit}>
        <label>
          З гаманця
          <select value={fromWalletId} onChange={(event) => setFromWalletId(event.target.value)}>
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.currency} · доступно {wallet.available}
              </option>
            ))}
          </select>
        </label>
        <label>
          Email або wallet ID отримувача
          <input value={receiver} onChange={(event) => setReceiver(event.target.value)} required />
        </label>
        <label>
          Сума ({selected.currency})
          <input
            inputMode="decimal"
            pattern="[0-9]+([.][0-9]{1,2})?"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Обробка…' : error ? 'Повторити той самий запит' : 'Переказати'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {transfer && (
        <section className={transfer.status === 'Completed' ? 'success' : 'card'}>
          <h2>Статус saga</h2>
          <p className="status">{transfer.status}</p>
          <p>{transfer.amount} {transfer.currency} → {transfer.receiverReference}</p>
          {transfer.failureMessage && <p className="error">{transfer.failureMessage}</p>}
          {terminal.has(transfer.status) && <button onClick={newTransfer}>Новий переказ</button>}
        </section>
      )}
    </>
  );
}
