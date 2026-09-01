import { redirect } from 'next/navigation';
import { BffError, bffFetch } from '@/lib/api';
import { SplitBill } from '@/lib/types';
import { CreateSplitBillForm } from '@/components/create-split-bill-form';

export default async function SplitBillsPage() {
  let bills: SplitBill[];
  try {
    bills = await bffFetch<SplitBill[]>('/split-bills');
  } catch (error: unknown) {
    if (error instanceof BffError && error.status === 401) redirect('/login');
    throw error;
  }
  return (
    <main className="page">
      <h1>Split bills</h1>
      <CreateSplitBillForm />
      <h2 style={{ marginTop: 32 }}>My split bills</h2>
      {bills.length === 0 ? (
        <p className="card">You do not have any split bills yet.</p>
      ) : (
        <section className="grid">
          {bills.map((bill) => (
            <a className="card" href={`/split-bills/${bill.id}`} key={bill.id}>
              <strong>{bill.total} {bill.currency}</strong>
              <p className="status">{bill.status}</p>
              <p className="muted">{bill.shares.length} shares</p>
            </a>
          ))}
        </section>
      )}
    </main>
  );
}
