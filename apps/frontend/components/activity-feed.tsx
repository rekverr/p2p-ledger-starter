'use client';

import { useCallback, useState } from 'react';
import { ActivityPage } from '@/lib/types';
import { LiveRefresh } from './live-refresh';
import { formatMoney } from '@/lib/money';

export function ActivityFeed({ initial }: { initial: ActivityPage }) {
  const [page, setPage] = useState(initial);
  const [eventType, setEventType] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string, append = false) => {
    const query = new URLSearchParams({ limit: '20' });
    if (eventType) query.set('eventType', eventType);
    if (cursor) query.set('cursor', cursor);
    try {
      const response = await fetch(`/api/bff/activity?${query}`, { cache: 'no-store' });
      const next = (await response.json()) as ActivityPage & { message?: string };
      if (!response.ok) throw new Error(next.message ?? 'Activity unavailable');
      setPage((current) => ({
        items: append ? [...current.items, ...next.items] : next.items,
        nextCursor: next.nextCursor,
      }));
      setError(null);
    } catch (current: unknown) {
      setError(current instanceof Error ? current.message : 'Activity unavailable');
    }
  }, [eventType]);

  return (
    <main className="page">
      <h1>Activity</h1>
      <LiveRefresh onRefresh={() => load()} />
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          Event type
          <input
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
            placeholder="payments.transfer.Completed"
          />
        </label>
        <button type="submit">Apply filter</button>
      </form>
      {error && <p className="error">{error}</p>}
      {page.items.length === 0 ? (
        <p className="card">No activity matches this filter.</p>
      ) : (
        <ul>
          {page.items.map((item) => (
            <li className="card" key={item.id} style={{ marginBottom: 10 }}>
              <strong>{item.eventType}</strong><br />
              <ActivityDetails payload={item.payload} />
              <span className="muted">{new Date(item.createdAt).toLocaleString('uk-UA')}</span>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor && (
        <button onClick={() => void load(page.nextCursor ?? undefined, true)}>
          Load more
        </button>
      )}
    </main>
  );
}

function ActivityDetails({ payload }: { payload: Record<string, unknown> }) {
  const nested = typeof payload.payload === 'object' && payload.payload !== null
    ? payload.payload as Record<string, unknown>
    : payload;
  const amount = nested.destinationAmount ?? nested.amount;
  const currency = nested.destinationCurrency ?? nested.currency;
  const counterpart = nested.receiverReference ?? nested.senderUserId;
  const status = nested.status;
  if (amount === undefined && counterpart === undefined && status === undefined) return null;
  return (
    <p className="activity-details">
      {amount !== undefined && currency !== undefined ? formatMoney(String(amount), String(currency)) : null}
      {counterpart !== undefined ? ` · counterparty ${String(counterpart)}` : null}
      {status !== undefined ? ` · ${String(status)}` : null}
    </p>
  );
}
