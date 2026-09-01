import { redirect } from 'next/navigation';
import { BffError, bffFetch } from '@/lib/api';
import { AdminInspector } from '@/components/admin-inspector';

export default async function AdminPage() {
  try {
    await bffFetch<{ allowed: true }>('/admin/access');
  } catch (error: unknown) {
    if (error instanceof BffError && error.status === 401) redirect('/login');
    if (error instanceof BffError && error.status === 403) {
      return (
        <main className="page narrow-page">
          <section className="error-state" role="alert">
            <p className="eyebrow">403 · Access denied</p>
            <h1>Admin access required</h1>
            <p>Your authenticated account does not have the administrator role.</p>
            <a className="button-link" href="/wallets">Return to wallets</a>
          </section>
        </main>
      );
    }
    throw error;
  }
  return <AdminInspector />;
}
