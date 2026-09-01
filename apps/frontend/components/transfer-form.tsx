'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LogicalSubmission } from '@/lib/idempotency';
import { Transfer, Wallet } from '@/lib/types';
import { LiveRefresh } from './live-refresh';
import { formatMoney } from '@/lib/money';

const terminal = new Set(['Completed', 'Failed']);

export function TransferForm({ wallets }: { wallets: Wallet[] }) {
  const logical = useRef(new LogicalSubmission());
  const [fromWalletId, setFromWalletId] = useState(wallets[0].id);
  const selected = wallets.find(({ id }) => id === fromWalletId) ?? wallets[0];
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('');
  const [targetCurrency, setTargetCurrency] = useState(selected.currency);
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
          targetCurrency,
        }),
      });
      const body = (await response.json()) as Transfer & { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Transfer could not be created');
      setTransfer(body);
    } catch (current: unknown) {
      setError(current instanceof Error ? current.message : 'Transfer failed');
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
    setTargetCurrency(selected.currency);
    setError(null);
  }

  return (
    <>
      <LiveRefresh onRefresh={refreshStatus} />
      <form className="card form-card" onSubmit={submit}>
        <div><p className="eyebrow">Secure payment</p><h2>Transfer details</h2></div>
        <label>
          From wallet
          <select value={fromWalletId} onChange={(event) => setFromWalletId(event.target.value)}>
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.currency} · available {wallet.available}
              </option>
            ))}
          </select>
        </label>
        <label>
          Recipient currency
          <select value={targetCurrency} onChange={(event) => setTargetCurrency(event.target.value)}>
            {['USD', 'EUR', 'UAH'].map((currency) => <option key={currency}>{currency}</option>)}
          </select>
        </label>
        <label>
          Recipient email or wallet ID
          <input value={receiver} onChange={(event) => setReceiver(event.target.value)} required />
        </label>
        <label>
          Amount ({selected.currency})
          <input
            inputMode="decimal"
            pattern="[0-9]+([.][0-9]{1,2})?"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Processing…' : error ? 'Retry the same request' : 'Send transfer'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {transfer && (
        <section className={transfer.status === 'Completed' ? 'success' : 'card'}>
          <p className="eyebrow">Transfer progress</p>
          <h2>{statusLabel(transfer.status)}</h2>
          <ol className="progress-list">
            {['Transfer created', 'Checking transfer', 'Funds reserved', 'Processing', 'Completed'].map((label, index) => (
              <li key={label} className={index <= statusStep(transfer.status) ? 'complete' : ''}>{label}</li>
            ))}
          </ol>
          <p>You send: <strong>{formatMoney(transfer.amount, transfer.currency)}</strong></p>
          <p>Recipient receives: <strong>{formatMoney(transfer.destinationAmount, transfer.destinationCurrency)}</strong></p>
          <p className="muted">Locked rate: 1 {transfer.currency} = {transfer.fxRate} {transfer.destinationCurrency}</p>
          {transfer.failureMessage && <p className="error">{transfer.failureMessage}</p>}
          {terminal.has(transfer.status) && <button onClick={newTransfer}>New transfer</button>}
        </section>
      )}
    </>
  );
}

function statusStep(status: Transfer['status']): number {
  return { Pending: 0, Validating: 1, FundsHeld: 2, Processing: 3, Completed: 4, Compensating: 3, Failed: 1 }[status];
}

function statusLabel(status: Transfer['status']): string {
  return {
    Pending: 'Transfer created', Validating: 'Checking transfer', FundsHeld: 'Funds reserved',
    Processing: 'Processing transfer', Completed: 'Transfer completed',
    Compensating: 'Releasing reserved funds', Failed: 'Transfer could not be completed',
  }[status];
}
