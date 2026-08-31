'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSplitBill } from '@/app/split-bills/actions';

interface ParticipantInput {
  userId: string;
  share: string;
}

export function CreateSplitBillForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'equal' | 'custom'>('equal');
  const [total, setTotal] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [deadline, setDeadline] = useState('');
  const [participants, setParticipants] = useState<ParticipantInput[]>([
    { userId: '', share: '' },
    { userId: '', share: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(index: number, patch: Partial<ParticipantInput>) {
    setParticipants((current) =>
      current.map((participant, position) =>
        position === index ? { ...participant, ...patch } : participant,
      ),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const bill = await createSplitBill({
        total,
        currency: currency.toUpperCase(),
        mode,
        participants: participants.map((participant) => ({
          userId: participant.userId,
          ...(mode === 'custom' ? { share: participant.share } : {}),
        })),
        ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
      });
      router.push(`/split-bills/${bill.id}`);
      router.refresh();
    } catch (current: unknown) {
      setError(current instanceof Error ? current.message : 'Помилка створення');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Створити split</h2>
      <label>Тип
        <select value={mode} onChange={(event) => setMode(event.target.value as 'equal' | 'custom')}>
          <option value="equal">Equal</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label>Total
        <input value={total} onChange={(event) => setTotal(event.target.value)} placeholder="30.00" pattern="[0-9]+[.][0-9]{2}" required />
      </label>
      <label>Currency
        <input value={currency} onChange={(event) => setCurrency(event.target.value)} pattern="[A-Za-z]{3}" required />
      </label>
      <label>Deadline (optional)
        <input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
      </label>
      {participants.map((participant, index) => (
        <div className="grid" key={index}>
          <label>Participant user ID
            <input value={participant.userId} onChange={(event) => update(index, { userId: event.target.value })} required />
          </label>
          {mode === 'custom' && (
            <label>Share
              <input value={participant.share} onChange={(event) => update(index, { share: event.target.value })} pattern="[0-9]+[.][0-9]{2}" required />
            </label>
          )}
        </div>
      ))}
      <button type="button" onClick={() => setParticipants((current) => [...current, { userId: '', share: '' }])}>+ Participant</button>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>{submitting ? 'Створення…' : 'Створити'}</button>
    </form>
  );
}
