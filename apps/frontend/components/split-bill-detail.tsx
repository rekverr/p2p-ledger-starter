'use client';

import { useCallback, useRef, useState } from 'react';
import { LogicalSubmission } from '@/lib/idempotency';
import { Principal, SplitBill, Wallet } from '@/lib/types';
import { LiveRefresh } from './live-refresh';

export function SplitBillDetail({
  initial,
  wallets,
  me,
}: {
  initial: SplitBill;
  wallets: Wallet[];
  me: Principal;
}) {
  const [bill, setBill] = useState(initial);
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const submissions = useRef(new Map<string, LogicalSubmission>());

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/bff/split-bills/${initial.id}`, { cache: 'no-store' });
    if (response.ok) setBill((await response.json()) as SplitBill);
  }, [initial.id]);

  async function pay(shareId: string) {
    let logical = submissions.current.get(shareId);
    if (!logical) {
      logical = new LogicalSubmission();
      submissions.current.set(shareId, logical);
    }
    const attempt = logical.begin();
    if (!attempt.accepted) return;
    setPaying(true);
    setError(null);
    try {
      const response = await fetch(`/api/bff/split-bills/${bill.id}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key },
        body: JSON.stringify({ fromWalletId: walletId }),
      });
      const body = (await response.json()) as { bill?: SplitBill; message?: string };
      if (!response.ok || !body.bill) throw new Error(body.message ?? 'Share не оплачено');
      setBill(body.bill);
    } catch (current: unknown) {
      setError(current instanceof Error ? current.message : 'Payment failed');
    } finally {
      logical.finish();
      setPaying(false);
    }
  }

  return (
    <main className="page">
      <h1>Split bill</h1>
      <p><strong>{bill.total} {bill.currency}</strong> <span className="status">{bill.status}</span></p>
      {bill.deadline && <p className="muted">Deadline: {new Date(bill.deadline).toLocaleString('uk-UA')}</p>}
      <LiveRefresh onRefresh={refresh} />
      {error && <p className="error">{error}</p>}
      {wallets.length > 0 && (
        <label style={{ marginBottom: 18 }}>Гаманець для своєї share
          <select value={walletId} onChange={(event) => setWalletId(event.target.value)}>
            {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.currency} · {wallet.available}</option>)}
          </select>
        </label>
      )}
      <section className="grid">
        {bill.shares.map((share) => {
          const own = share.participantUserId === me.userId;
          return (
            <article className="card" key={share.id}>
              <code>{share.participantUserId}</code>
              <p>{share.amount} {bill.currency}</p>
              <p className="status">{share.paymentStatus}</p>
              {own && share.paymentStatus !== 'Paid' && wallets.length > 0 && (
                <button disabled={paying} onClick={() => void pay(share.id)}>
                  {error ? 'Повторити той самий payment' : 'Оплатити свою share'}
                </button>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
