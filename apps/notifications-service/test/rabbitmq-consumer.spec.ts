import { EventEmitter } from 'events';
import { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { ActivityFeedService } from '../src/activity/activity-feed.service';
import { BrokerConnector } from '../src/messaging/broker-connector';
import { InboxService } from '../src/messaging/inbox.service';
import { RabbitMqConsumerService } from '../src/messaging/rabbitmq-consumer.service';
import { ActivityRealtimeGateway } from '../src/realtime/activity-realtime.gateway';

describe('RabbitMqConsumerService', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('emits once after durable processing and suppresses duplicate delivery', async () => {
    const channel = fakeChannel();
    const connection = fakeConnection(channel.value);
    const inbox = {
      process: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    } as unknown as InboxService;
    const activities = {
      record: jest.fn(),
      userIdFor: jest.fn().mockReturnValue('user-1'),
    } as unknown as ActivityFeedService;
    const realtime = {
      emitToUser: jest.fn(),
    } as unknown as ActivityRealtimeGateway;
    const connector: BrokerConnector = {
      connect: jest.fn().mockResolvedValue(connection.value),
    };
    const consumer = new RabbitMqConsumerService(
      inbox,
      activities,
      realtime,
      connector,
    );
    await consumer.onApplicationBootstrap();

    channel.deliver(message());
    await waitFor(() => channel.ack.mock.calls.length === 1);
    channel.deliver(message());
    await waitFor(() => channel.ack.mock.calls.length === 2);

    expect(inbox.process).toHaveBeenCalledTimes(2);
    expect(realtime.emitToUser).toHaveBeenCalledTimes(1);
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ eventType: 'payments.transfer.Completed' }),
    );
    await consumer.onApplicationShutdown();
  });

  it('reconnects and restores the durable queue consumer after broker restart', async () => {
    process.env.RABBITMQ_RECONNECT_BASE_MS = '1';
    process.env.RABBITMQ_RECONNECT_MAX_MS = '2';
    const firstChannel = fakeChannel();
    const secondChannel = fakeChannel();
    const first = fakeConnection(firstChannel.value);
    const second = fakeConnection(secondChannel.value);
    const connector = {
      connect: jest
        .fn()
        .mockResolvedValueOnce(first.value)
        .mockResolvedValueOnce(second.value),
    };
    const consumer = new RabbitMqConsumerService(
      { process: jest.fn() } as unknown as InboxService,
      { record: jest.fn(), userIdFor: jest.fn() } as unknown as ActivityFeedService,
      { emitToUser: jest.fn() } as unknown as ActivityRealtimeGateway,
      connector,
    );
    await consumer.onApplicationBootstrap();

    first.emitter.emit('close');
    await waitFor(() => connector.connect.mock.calls.length === 2);

    expect(secondChannel.consume).toHaveBeenCalledTimes(1);
    expect(secondChannel.bindQueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'payments.#',
    );
    await consumer.onApplicationShutdown();
  });
});

function fakeConnection(channel: Channel) {
  const emitter = new EventEmitter();
  const value = Object.assign(emitter, {
    createChannel: jest.fn().mockResolvedValue(channel),
    close: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ChannelModel;
  return { emitter, value };
}

function fakeChannel() {
  let delivery: ((message: ConsumeMessage | null) => void) | undefined;
  const ack = jest.fn();
  const value = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue({ queue: 'queue' }),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    prefetch: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockImplementation(
      async (
        _queue: string,
        handler: (message: ConsumeMessage | null) => void,
      ) => {
        delivery = handler;
        return { consumerTag: 'consumer' };
      },
    ),
    ack,
    nack: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return {
    ...value,
    value: value as unknown as Channel,
    deliver: (next: ConsumeMessage) => {
      if (!delivery) throw new Error('Consumer was not configured');
      delivery(next);
    },
  };
}

function message(): ConsumeMessage {
  return {
    content: Buffer.from(
      JSON.stringify({
        eventId: 'b3c34a63-528d-4a44-91cc-599a34422ed0',
        eventType: 'payments.transfer.Completed',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        producer: 'payments-service',
        correlationId: null,
        traceId: null,
        aggregate: {
          type: 'Transfer',
          id: 'a3c34a63-528d-4a44-91cc-599a34422ed0',
          version: 5,
        },
        payload: { senderUserId: 'user-1' },
      }),
    ),
  } as ConsumeMessage;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
