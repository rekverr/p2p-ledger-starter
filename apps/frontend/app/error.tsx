'use client';

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <h1>Щось пішло не так</h1>
      <p className="error">Не вдалося отримати authoritative state.</p>
      <button onClick={reset}>Спробувати ще раз</button>
    </main>
  );
}
