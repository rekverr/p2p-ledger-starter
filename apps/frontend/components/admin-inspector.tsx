'use client';

import { useState } from 'react';

export function AdminInspector() {
  const [walletId, setWalletId] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function inspect(path: string) {
    setError(null);
    const response = await fetch(`/api/bff/admin/${path}`, { cache: 'no-store' });
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      setError(
        typeof body === 'object' && body !== null && 'message' in body
          ? String(body.message)
          : 'Admin query failed',
      );
      return;
    }
    setResult(body);
  }

  return (
    <main className="page">
      <h1>Admin inspection</h1>
      <section className="card">
        <label>Wallet ID
          <input value={walletId} onChange={(event) => setWalletId(event.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button disabled={!walletId} onClick={() => void inspect(`wallets/${walletId}/events`)}>Event log</button>
          <button disabled={!walletId} onClick={() => void inspect(`wallets/${walletId}/reconciliation`)}>Reconcile wallet</button>
          <button onClick={() => void inspect('reconciliation/global')}>Global reconciliation</button>
        </div>
      </section>
      <p className="muted">
        Distributed traces:{' '}
        <a
          href={process.env.NEXT_PUBLIC_JAEGER_URL ?? 'http://localhost:16686'}
          target="_blank"
          rel="noreferrer noopener"
        >
          відкрити Jaeger
        </a>
      </p>
      {error && <p className="error">{error}</p>}
      {result !== null && <pre className="card" style={{ overflow: 'auto' }}>{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}
