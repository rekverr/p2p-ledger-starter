'use client';

import { useCallback, useState } from 'react';
import { Dashboard } from '@/lib/types';
import { LiveRefresh } from './live-refresh';

export function WalletDashboard({ initial }: { initial: Dashboard }) {
  const [dashboard, setDashboard] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/bff/dashboard', { cache: 'no-store' });
      if (!response.ok) throw new Error('Не вдалося синхронізувати dashboard');
      setDashboard((await response.json()) as Dashboard);
      setError(null);
    } catch (current: unknown) {
      setError(current instanceof Error ? current.message : 'Sync failed');
    }
  }, []);

  return (
    <main className="page">
      <h1>Мої гаманці</h1>
      <p className="muted">{dashboard.me.email}</p>
      <LiveRefresh onRefresh={refresh} />
      {error && <p className="error">{error}</p>}
      {dashboard.wallets.length === 0 ? (
        <p className="card">Гаманців поки немає.</p>
      ) : (
        <section className="grid" aria-label="Гаманці">
          {dashboard.wallets.map((wallet) => (
            <article className="card" key={wallet.id}>
              <h2>{wallet.currency}</h2>
              <p><strong>Баланс:</strong> {wallet.balance}</p>
              <p><strong>Доступно:</strong> {wallet.available}</p>
              <p><strong>У hold:</strong> {wallet.held}</p>
              <code>{wallet.id}</code>
            </article>
          ))}
        </section>
      )}
      <section style={{ marginTop: 28 }}>
        <h2>Останні події</h2>
        {dashboard.activity.items.length === 0 ? (
          <p className="muted">Активності ще немає.</p>
        ) : (
          <ul>
            {dashboard.activity.items.slice(0, 5).map((item) => (
              <li key={item.id}>{item.eventType}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
