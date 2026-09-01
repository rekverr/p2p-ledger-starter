'use client';

import { useState } from 'react';

export function AdminInspector() {
  const [walletId, setWalletId] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [view, setView] = useState<'events' | 'wallet' | 'global' | 'traces' | null>(null);
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
    setView(path === 'traces' ? 'traces' : path.endsWith('/events') ? 'events' : path.includes('wallets/') ? 'wallet' : 'global');
  }

  return (
    <main className="page">
      <div className="page-header"><div><p className="eyebrow">Operations</p><h1>Ledger control room</h1></div><span className="status">Admin only</span></div>
      <section className="card">
        <label>Wallet ID
          <input value={walletId} onChange={(event) => setWalletId(event.target.value)} />
        </label>
        <div className="button-row">
          <button disabled={!walletId} onClick={() => void inspect(`wallets/${walletId}/events`)}>Event log</button>
          <button disabled={!walletId} onClick={() => void inspect(`wallets/${walletId}/reconciliation`)}>Reconcile wallet</button>
          <button onClick={() => void inspect('reconciliation/global')}>Global reconciliation</button>
          <button onClick={() => void inspect('traces')}>Recent traces</button>
        </div>
      </section>
      <p className="muted">
        Distributed traces:{' '}
        <a
          href={process.env.NEXT_PUBLIC_JAEGER_URL ?? 'http://localhost:16686'}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open Jaeger
        </a>
      </p>
      {error && <p className="error">{error}</p>}
      {result !== null && <AdminResult view={view} result={result} />}
    </main>
  );
}

function AdminResult({ view, result }: { view: 'events' | 'wallet' | 'global' | 'traces' | null; result: unknown }) {
  if (view === 'traces' && Array.isArray(result)) {
    return (
      <section className="card table-wrap"><h2>Recent payments traces</h2><table>
        <thead><tr><th>Started</th><th>Operation</th><th>Status</th><th>Duration</th><th>Saga steps</th><th>Transfer</th><th>Trace ID</th></tr></thead>
        <tbody>{result.map((value) => {
          const trace = value as Record<string, unknown>;
          return <tr key={String(trace.traceId)}>
            <td>{trace.startedAt ? new Date(String(trace.startedAt)).toLocaleString() : '—'}</td>
            <td>{String(trace.operation)}</td>
            <td><span className={trace.status === 'OK' ? 'badge-pass' : 'badge-fail'}>{String(trace.status)}</span></td>
            <td>{String(trace.durationMs)} ms · {String(trace.spanCount)} spans</td>
            <td>{Array.isArray(trace.sagaSteps) && trace.sagaSteps.length > 0
              ? trace.sagaSteps.map((step) => {
                const value = step as Record<string, unknown>;
                return `${String(value.step)} ${String(value.durationMs)} ms`;
              }).join(' · ')
              : '—'}</td>
            <td><code>{String(trace.transferId ?? '—')}</code></td>
            <td><code>{String(trace.traceId)}</code></td>
          </tr>;
        })}</tbody>
      </table></section>
    );
  }
  if (view === 'events' && Array.isArray(result)) {
    return (
      <section className="card table-wrap"><h2>Chronological event log</h2><table>
        <thead><tr><th>Time</th><th>Event</th><th>Amount / status</th><th>Version</th><th>Event ID</th><th>Correlation</th><th>Payload</th></tr></thead>
        <tbody>{result.map((value) => {
          const event = value as Record<string, unknown>;
          return <tr key={String(event.eventId)}>
            <td>{new Date(String(event.createdAt)).toLocaleString()}</td>
            <td><span className="status">{String(event.eventType)}</span></td>
            <td>{eventSummary(event.payload)}</td>
            <td>{String(event.streamVersion)} / schema {String(event.schemaVersion)}</td>
            <td><code>{String(event.eventId)}</code></td>
            <td><code>{String(event.correlationId ?? '—')}</code></td>
            <td><details><summary>View</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></td>
          </tr>;
        })}</tbody>
      </table></section>
    );
  }
  if (typeof result === 'object' && result !== null) {
    const data = result as Record<string, unknown>;
    const pass = Boolean(data.consistent ?? data.balanced);
    return (
      <section className="card">
        <div className="page-header"><h2>Reconciliation</h2><span className={pass ? 'badge-pass' : 'badge-fail'}>{pass ? 'PASS' : 'FAIL'}</span></div>
        {'debitsMinor' in data && <p>Debits: <strong>{String(data.debitsMinor)}</strong> · Credits: <strong>{String(data.creditsMinor)}</strong></p>}
        {'from' in data && <p className="muted">Range: {String(data.from)} — {String(data.to)}</p>}
        {'eventDerived' in data && <div className="grid"><div><h3>Event-derived</h3><pre>{JSON.stringify(data.eventDerived, null, 2)}</pre></div><div><h3>Projection</h3><pre>{JSON.stringify(data.projection, null, 2)}</pre></div></div>}
      </section>
    );
  }
  return <section className="card">No structured result.</section>;
}

function eventSummary(value: unknown) {
  if (typeof value !== 'object' || value === null) return '—';
  const payload = value as Record<string, unknown>;
  const amount = payload.amount ?? payload.amountMinor;
  const currency = payload.currency ?? payload.currencyCode;
  const status = payload.status ?? payload.outcome;
  return [amount !== undefined ? `${String(amount)}${currency ? ` ${String(currency)}` : ''}` : null, status]
    .filter(Boolean)
    .join(' · ') || '—';
}
