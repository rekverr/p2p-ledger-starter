'use client';

import { useCallback, useState } from 'react';
import { Dashboard } from '@/lib/types';
import { LiveRefresh } from './live-refresh';
import { formatMoney } from '@/lib/money';

export function WalletDashboard({ initial }: { initial: Dashboard }) {
  const [dashboard, setDashboard] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/bff/dashboard', { cache: 'no-store' });
      if (!response.ok) throw new Error('Dashboard synchronization failed');
      setDashboard((await response.json()) as Dashboard);
      setError(null);
    } catch (current: unknown) {
      setError(current instanceof Error ? current.message : 'Sync failed');
    }
  }, []);

  return (
    <main className="page">
      <div className="page-header">
        <div><p className="eyebrow">Overview</p><h1>Your wallets</h1></div>
        <a className="button-link" href="/transfers/new">New transfer</a>
      </div>
      <LiveRefresh onRefresh={refresh} />
      {error && <p className="error">{error}</p>}
      {dashboard.wallets.length === 0 ? (
        <p className="card">You do not have any wallets yet.</p>
      ) : (
        <section className="grid" aria-label="Wallets">
          {dashboard.wallets.map((wallet) => (
            <article className="card" key={wallet.id}>
              <p className="eyebrow">{wallet.currency} wallet</p>
              <p className="balance">{formatMoney(wallet.balance, wallet.currency)}</p>
              <dl className="wallet-stats">
                <div><dt>Available</dt><dd>{formatMoney(wallet.available, wallet.currency)}</dd></div>
                <div><dt>On hold</dt><dd>{formatMoney(wallet.held, wallet.currency)}</dd></div>
              </dl>
              <code className="wallet-id">{wallet.id}</code>
            </article>
          ))}
        </section>
      )}
      <section style={{ marginTop: 28 }}>
        <h2>Recent activity</h2>
        {dashboard.activity.items.length === 0 ? (
          <p className="muted">There is no recent activity yet.</p>
        ) : (
          <ul>
            {dashboard.activity.items.slice(0, 5).map((item) => (
              <li key={item.id}>{item.eventType.replaceAll('.', ' · ')}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
