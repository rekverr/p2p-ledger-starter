'use client';

export default function WalletsError({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <p className="error">Dashboard could not be loaded.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
