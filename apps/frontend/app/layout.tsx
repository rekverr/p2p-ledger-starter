import './globals.css';
import { AppShell } from '@/components/app-shell';
import { bffFetch } from '@/lib/api';
import { Principal } from '@/lib/types';

export const metadata = {
  title: 'P2P Ledger — starter',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let principal: Principal | null = null;
  try {
    principal = await bffFetch<Principal>('/me');
  } catch {
    principal = null;
  }
  return (
    <html lang="uk">
      <body>
        <AppShell principal={principal} />
        {children}
      </body>
    </html>
  );
}
