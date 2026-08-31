import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Server, Socket } from 'socket.io';
import { IntegrationEventEnvelope } from '../messaging/integration-event';

interface AccessTokenPayload {
  sub?: unknown;
  email?: unknown;
  role?: unknown;
}

type AuthenticatedSocket = Socket & {
  data: { userId?: string };
};

@WebSocketGateway({
  namespace: '/activity',
  cors: { origin: socketOriginAllowed, credentials: true },
})
export class ActivityRealtimeGateway
  implements OnGatewayInit, OnGatewayConnection
{
  @WebSocketServer()
  private server: Namespace;

  constructor(private readonly jwt: JwtService) {}

  afterInit(server: Server | Namespace): void {
    server.use((socket: AuthenticatedSocket, next) => {
      try {
        socket.data.userId = this.authenticate(socket);
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    if (!client.data.userId) {
      client.disconnect(true);
      return;
    }
    await client.join(this.room(client.data.userId));
  }

  emitToUser(userId: string, event: IntegrationEventEnvelope): void {
    this.server.to(this.room(userId)).emit('activity', {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      aggregate: event.aggregate,
      payload: event.payload,
    });
  }

  private authenticate(socket: AuthenticatedSocket): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT verification is not configured');
    const header = socket.handshake.headers.authorization;
    const cookieToken = this.readCookie(
      socket.handshake.headers.cookie,
      'accessToken',
    );
    const token =
      header?.match(/^Bearer\s+(.+)$/i)?.[1] ??
      cookieToken;
    if (!token) throw new Error('Access token is required');
    const payload = this.jwt.verify<AccessTokenPayload>(token, { secret });
    if (typeof payload.sub !== 'string') throw new Error('Invalid principal');
    return payload.sub;
  }

  private room(userId: string): string {
    return `user:${userId}`;
  }

  private readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const [key, ...value] = part.trim().split('=');
      if (key === name && value.length > 0) {
        return decodeURIComponent(value.join('='));
      }
    }
    return undefined;
  }
}

function socketOriginAllowed(
  origin: string | undefined,
  callback: (error: Error | null, allowed?: boolean) => void,
): void {
  if (!origin) {
    callback(null, true);
    return;
  }
  const allowed = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) callback(null, true);
  else callback(new Error('Origin not allowed'));
}
