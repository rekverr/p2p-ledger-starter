import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/app-shell';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/wallets',
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

describe('authoritative application shell', () => {
  it('hides admin navigation from a normal authenticated user', () => {
    render(<AppShell principal={{ userId: 'u1', email: 'user@example.com', role: 'user' }} />);
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows admin navigation only for the verified admin principal', () => {
    render(<AppShell principal={{ userId: 'a1', email: 'admin@example.com', role: 'admin' }} />);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('logs out through the same-origin cookie-clearing endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    render(<AppShell principal={{ userId: 'u1', email: 'user@example.com', role: 'user' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' }));
  });
});
