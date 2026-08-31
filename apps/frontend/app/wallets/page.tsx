import { redirect } from 'next/navigation';
import { BffError, bffFetch } from '@/lib/api';
import { Dashboard } from '@/lib/types';
import { WalletDashboard } from '@/components/wallet-dashboard';

export default async function WalletsPage() {
  let dashboard: Dashboard;
  try {
    dashboard = await bffFetch<Dashboard>('/dashboard');
  } catch (error: unknown) {
    if (error instanceof BffError && error.status === 401) redirect('/login');
    throw error;
  }
  return <WalletDashboard initial={dashboard} />;
}
