import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { ActivityRealtimeGateway } from '../src/realtime/activity-realtime.gateway';
import { IntegrationEventEnvelope } from '../src/messaging/integration-event';

describe('authenticated activity WebSocket', () => {
  let app: INestApplication;
  let gateway: ActivityRealtimeGateway;
  let jwt: JwtService;
  let url: string;
  const clients: Socket[] = [];
  const secret = 'websocket-test-secret';
  const originalSecret = process.env.JWT_ACCESS_SECRET;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = secret;
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [ActivityRealtimeGateway],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}/activity`;
    gateway = moduleRef.get(ActivityRealtimeGateway);
    jwt = moduleRef.get(JwtService);
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
  });

  afterAll(async () => {
    if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalSecret;
    await app.close();
  });

  it('rejects an unauthenticated socket during the handshake', async () => {
    const client = socket();
    const error = await new Promise<Error>((resolve) => {
      client.once('connect_error', resolve);
      client.connect();
    });

    expect(error.message).toBe('unauthorized');
    expect(client.connected).toBe(false);
  });

  it('emits activity only to the room derived from the authenticated user', async () => {
    const first = socket(token('user-a'));
    const second = socket(token('user-b'));
    await Promise.all([connected(first), connected(second)]);
    let leaked = false;
    second.on('activity', () => {
      leaked = true;
    });
    const received = new Promise<Record<string, unknown>>((resolve) =>
      first.once('activity', resolve),
    );
    const event = integrationEvent('user-a');

    gateway.emitToUser('user-a', event);

    await expect(received).resolves.toMatchObject({
      eventId: event.eventId,
      eventType: event.eventType,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(leaked).toBe(false);
  });

  function socket(accessToken?: string): Socket {
    const client = io(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: accessToken ? { token: accessToken } : {},
    });
    clients.push(client);
    return client;
  }

  function token(userId: string): string {
    return jwt.sign(
      { sub: userId, email: `${userId}@example.com`, role: 'user' },
      { secret },
    );
  }
});

function connected(client: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
    client.connect();
  });
}

function integrationEvent(userId: string): IntegrationEventEnvelope {
  return {
    eventId: 'b3c34a63-528d-4a44-91cc-599a34422ed0',
    eventType: 'ledger.wallet.MoneyDeposited',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    producer: 'ledger-service',
    correlationId: null,
    traceId: null,
    aggregate: {
      type: 'Wallet',
      id: 'a3c34a63-528d-4a44-91cc-599a34422ed0',
      version: 2,
    },
    payload: { ownerId: userId, amountMinor: '1000' },
  };
}
