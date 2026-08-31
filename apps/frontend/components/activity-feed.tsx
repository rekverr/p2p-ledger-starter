'use client';

import { useCallback, useState } from 'react';
import { ActivityPage } from '@/lib/types';
import { LiveRefresh } from './live-refresh';

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
      <h1>Активність</h1>
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
        <button type="submit">Фільтрувати</button>
      </form>
      {error && <p className="error">{error}</p>}
      {page.items.length === 0 ? (
        <p className="card">Подій за цим фільтром немає.</p>
      ) : (
        <ul>
          {page.items.map((item) => (
            <li className="card" key={item.id} style={{ marginBottom: 10 }}>
              <strong>{item.eventType}</strong><br />
              <span className="muted">{new Date(item.createdAt).toLocaleString('uk-UA')}</span>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor && (
        <button onClick={() => void load(page.nextCursor ?? undefined, true)}>
          Завантажити ще
        </button>
      )}
    </main>
  );
}
