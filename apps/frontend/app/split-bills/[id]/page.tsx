import { redirect } from 'next/navigation';
import { BffError, bffFetch } from '@/lib/api';
import { Principal, SplitBill, Wallet } from '@/lib/types';
import { SplitBillDetail } from '@/components/split-bill-detail';

export default async function SplitBillPage({ params }: { params: { id: string } }) {
  try {
    const [bill, wallets, me] = await Promise.all([
      bffFetch<SplitBill>(`/split-bills/${params.id}`),
      bffFetch<Wallet[]>('/wallets'),
      bffFetch<Principal>('/me'),
    ]);
    return <SplitBillDetail initial={bill} wallets={wallets} me={me} />;
  } catch (error: unknown) {
    if (error instanceof BffError && error.status === 401) redirect('/login');
    throw error;
  }
}
