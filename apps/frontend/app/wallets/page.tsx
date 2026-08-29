import { ledgerFetch } from '@/lib/api';

// Server Component: список гаманців вантажиться на сервері при рендері
// сторінки. Наступні оновлення балансу (після додавання переказів) мають
// приходити вже по WebSocket на клієнті — це ще не реалізовано, дивись ТЗ.
export default async function WalletsPage() {
  let wallets: { id: string; currency: string; balance: string }[] = [];
  let loadError: string | null = null;

  try {
    wallets = await ledgerFetch('/wallets');
  } catch (err) {
    loadError = (err as Error).message;
  }

  return (
    <main style={{ maxWidth: 480, margin: '80px auto' }}>
      <h1>Мої гаманці</h1>
      {loadError && <p style={{ color: 'crimson' }}>{loadError}</p>}
      {!loadError && wallets.length === 0 && <p>Гаманців поки немає.</p>}
      <ul>
        {wallets.map((w) => (
          <li key={w.id}>
            {w.currency}: {w.balance}
          </li>
        ))}
      </ul>
      <p style={{ color: '#666' }}>
        Форма переказу, split-рахунки та admin-екран ще не реалізовані —
        дивись ТЗ, розділ 4.2.
      </p>
    </main>
  );
}
