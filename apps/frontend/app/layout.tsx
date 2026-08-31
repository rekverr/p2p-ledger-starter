import './globals.css';

export const metadata = {
  title: 'P2P Ledger — starter',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk">
      <body>
        <nav aria-label="Основна навігація">
          <a href="/wallets">Гаманці</a>
          <a href="/transfers/new">Переказ</a>
          <a href="/split-bills">Split bills</a>
          <a href="/activity">Активність</a>
          <a href="/admin">Admin</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
