import { notFound, redirect } from 'next/navigation';
import { BffError, bffFetch } from '@/lib/api';
import { AdminInspector } from '@/components/admin-inspector';

export default async function AdminPage() {
  try {
    await bffFetch<{ allowed: true }>('/admin/access');
  } catch (error: unknown) {
    if (error instanceof BffError && error.status === 401) redirect('/login');
    if (error instanceof BffError && error.status === 403) notFound();
    throw error;
  }
  return <AdminInspector />;
}
