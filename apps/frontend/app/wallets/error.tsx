'use client';

export default function WalletsError({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <p className="error">Не вдалося завантажити dashboard.</p>
      <button onClick={reset}>Спробувати ще раз</button>
    </main>
  );
}
