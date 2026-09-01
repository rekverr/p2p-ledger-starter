'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export function LiveRefresh({ onRefresh }: { onRefresh: () => void | Promise<void> }) {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    let connectedOnce = false;
    const socket = io(
      `${process.env.NEXT_PUBLIC_NOTIFICATIONS_WS_URL ?? 'http://localhost:3003'}/activity`,
      { withCredentials: true, reconnection: true },
    );
    socket.on('connect', () => {
      setState('connected');
      if (connectedOnce) void onRefresh();
      connectedOnce = true;
    });
    socket.io.on('reconnect_attempt', () => setState('reconnecting'));
    socket.on('disconnect', () => setState(navigator.onLine ? 'reconnecting' : 'offline'));
    socket.on('connect_error', () => setState(navigator.onLine ? 'reconnecting' : 'offline'));
    socket.on('activity', () => void onRefresh());
    const online = () => {
      setState('reconnecting');
      socket.connect();
      void onRefresh();
    };
    const offline = () => setState('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      socket.disconnect();
    };
  }, [onRefresh]);

  return (
    <p className={state === 'connected' ? 'muted' : 'offline'} role="status">
      Live: {state === 'connected' ? 'connected' : state}
    </p>
  );
}
