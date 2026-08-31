import { redirect } from 'next/navigation';
import { BffError, bffFetch } from '@/lib/api';
import { Wallet } from '@/lib/types';
import { TransferForm } from '@/components/transfer-form';

export default async function NewTransferPage() {
  let wallets: Wallet[];
  try {
    wallets = await bffFetch<Wallet[]>('/wallets');
  } catch (error: unknown) {
    if (error instanceof BffError && error.status === 401) redirect('/login');
    throw error;
  }
  return (
    <main className="page">
      <h1>Новий переказ</h1>
      {wallets.length === 0 ? (
        <p className="card">Спочатку потрібен гаманець.</p>
      ) : (
        <TransferForm wallets={wallets} />
      )}
    </main>
  );
}
