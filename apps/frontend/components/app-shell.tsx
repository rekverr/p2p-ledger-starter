'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Principal } from '@/lib/types';

const links = [
  ['/wallets', 'Wallets'],
  ['/transfers/new', 'Transfer'],
  ['/split-bills', 'Split bills'],
  ['/activity', 'Activity'],
] as const;

export function AppShell({ principal }: { principal: Principal | null }) {
  const pathname = usePathname();
  const router = useRouter();
  if (!principal) return null;

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="app-header">
      <nav className="app-nav" aria-label="Primary navigation">
        <Link className="brand" href="/wallets">Northstar</Link>
        <div className="nav-links">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname.startsWith(href) ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
          {principal.role === 'admin' && (
            <Link href="/admin" aria-current={pathname.startsWith('/admin') ? 'page' : undefined}>
              Admin
            </Link>
          )}
        </div>
        <div className="account">
          <span title={principal.email}>{principal.email}</span>
          <button className="button-secondary" type="button" onClick={logout}>Logout</button>
        </div>
      </nav>
    </header>
  );
}
