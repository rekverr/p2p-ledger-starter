import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { ActivityFeedService } from '../activity/activity-feed.service';
import { ActivityRealtimeGateway } from '../realtime/activity-realtime.gateway';
import { BROKER_CONNECTOR, BrokerConnector } from './broker-connector';
import { InboxService } from './inbox.service';
import { parseIntegrationEvent } from './integration-event';

@Injectable()
export class RabbitMqConsumerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private connection?: ChannelModel;
  private channel?: Channel;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private connecting = false;
  private stopped = false;
  private readonly logger = new Logger(RabbitMqConsumerService.name);

  constructor(
    private readonly inbox: InboxService,
    private readonly activities: ActivityFeedService,
    private readonly realtime: ActivityRealtimeGateway,
    @Inject(BROKER_CONNECTOR) private readonly connector: BrokerConnector,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.BROKER_CONSUMER_ENABLED === 'false') return;
    this.stopped = false;
    await this.connectOrSchedule();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }

  private async connectOrSchedule(): Promise<void> {
    if (this.stopped || this.connecting || this.connection) return;
    this.connecting = true;
    try {
      const connection = await this.connector.connect(
        process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq:5672',
      );
      if (this.stopped) {
        await connection.close();
        return;
      }
      this.connection = connection;
      connection.once('close', () => this.handleDisconnect());
      connection.on('error', (error: Error) => {
        this.logger.warn(`RabbitMQ connection error: ${error.message}`);
      });
      this.channel = await connection.createChannel();
      await this.configure(this.channel);
      this.reconnectAttempt = 0;
      this.logger.log('RabbitMQ consumer connected');
    } catch (error: unknown) {
      this.logger.warn(`RabbitMQ connect failed: ${this.errorMessage(error)}`);
      const failedConnection = this.connection;
      this.connection = undefined;
      this.channel = undefined;
      await failedConnection?.close().catch(() => undefined);
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private async configure(channel: Channel): Promise<void> {
    const exchange = process.env.RABBITMQ_EXCHANGE ?? 'p2p.domain-events';
    const queue = process.env.RABBITMQ_QUEUE ?? 'notifications.domain-events.v1';
    const deadLetterExchange = `${exchange}.dead-letter`;
    const deadLetterQueue = `${queue}.dead-letter`;
    await channel.assertExchange(exchange, 'topic', { durable: true });
    await channel.assertExchange(deadLetterExchange, 'topic', { durable: true });
    await channel.assertQueue(deadLetterQueue, { durable: true });
    await channel.bindQueue(deadLetterQueue, deadLetterExchange, '#');
    await channel.assertQueue(queue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': deadLetterExchange },
    });
    await channel.bindQueue(queue, exchange, 'ledger.#');
    await channel.bindQueue(queue, exchange, 'payments.#');
    await channel.prefetch(Number(process.env.RABBITMQ_PREFETCH ?? 20));
    await channel.consume(queue, (message) => void this.consume(message), {
      noAck: false,
    });
  }

  private handleDisconnect(): void {
    this.connection = undefined;
    this.channel = undefined;
    if (!this.stopped) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const base = Number(process.env.RABBITMQ_RECONNECT_BASE_MS ?? 500);
    const maximum = Number(process.env.RABBITMQ_RECONNECT_MAX_MS ?? 30_000);
    const delay = Math.min(base * 2 ** (this.reconnectAttempt - 1), maximum);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectOrSchedule();
    }, delay);
    this.reconnectTimer.unref();
  }

  private async consume(message: ConsumeMessage | null): Promise<void> {
    const channel = this.channel;
    if (!message || !channel) return;
    let event;
    try {
      event = parseIntegrationEvent(
        JSON.parse(message.content.toString('utf8')) as unknown,
      );
    } catch {
      channel.nack(message, false, false);
      return;
    }
    try {
      const processed = await this.inbox.process(
        'notifications.activity-feed.v1',
        event,
        (manager, current) => this.activities.record(manager, current),
      );
      if (processed) {
        const userId = this.activities.userIdFor(event);
        if (userId) this.realtime.emitToUser(userId, event);
      }
      channel.ack(message);
    } catch {
      channel.nack(message, false, true);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
