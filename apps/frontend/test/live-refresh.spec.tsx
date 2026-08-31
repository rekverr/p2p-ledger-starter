import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveRefresh } from '@/components/live-refresh';

const handlers = new Map<string, () => void>();
const managerHandlers = new Map<string, () => void>();
const socket = {
  on: vi.fn((name: string, handler: () => void) => {
    handlers.set(name, handler);
    return socket;
  }),
  io: {
    on: vi.fn((name: string, handler: () => void) => {
      managerHandlers.set(name, handler);
    }),
  },
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({ io: () => socket }));

describe('LiveRefresh', () => {
  it('shows reconnect state and re-fetches authoritative state after reconnect', () => {
    const refresh = vi.fn();
    render(<LiveRefresh onRefresh={refresh} />);
    act(() => handlers.get('connect')?.());
    expect(screen.getByRole('status')).toHaveTextContent('підключено');
    act(() => managerHandlers.get('reconnect_attempt')?.());
    expect(screen.getByRole('status')).toHaveTextContent('reconnecting');
    act(() => handlers.get('connect')?.());
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => handlers.get('activity')?.());
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
