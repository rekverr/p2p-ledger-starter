'use client';

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <h1>Something went wrong</h1>
      <p className="error">Authoritative state could not be loaded.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
