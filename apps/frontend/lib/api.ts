const LEDGER_URL = process.env.LEDGER_SERVICE_URL ?? 'http://localhost:3001';

export async function ledgerFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${LEDGER_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ledger API ${res.status}: ${body}`);
  }
  return res.json();
}
