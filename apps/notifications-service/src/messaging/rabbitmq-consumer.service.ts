import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Channel, ChannelModel, ConsumeMessage, connect } from 'amqplib';
import { ActivityFeedService } from '../activity/activity-feed.service';
import { InboxService } from './inbox.service';
import { parseIntegrationEvent } from './integration-event';

@Injectable()
export class RabbitMqConsumerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private connection?: ChannelModel;
  private channel?: Channel;

  constructor(
    private readonly inbox: InboxService,
    private readonly activities: ActivityFeedService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.BROKER_CONSUMER_ENABLED === 'false') return;
    this.connection = await connect(
      process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq:5672',
    );
    this.channel = await this.connection.createChannel();
    const exchange = process.env.RABBITMQ_EXCHANGE ?? 'p2p.domain-events';
    const queue = process.env.RABBITMQ_QUEUE ?? 'notifications.domain-events.v1';
    const deadLetterExchange = `${exchange}.dead-letter`;
    const deadLetterQueue = `${queue}.dead-letter`;
    await this.channel.assertExchange(exchange, 'topic', { durable: true });
    await this.channel.assertExchange(deadLetterExchange, 'topic', { durable: true });
    await this.channel.assertQueue(deadLetterQueue, { durable: true });
    await this.channel.bindQueue(deadLetterQueue, deadLetterExchange, '#');
    await this.channel.assertQueue(queue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': deadLetterExchange },
    });
    await this.channel.bindQueue(queue, exchange, 'ledger.#');
    await this.channel.prefetch(Number(process.env.RABBITMQ_PREFETCH ?? 20));
    await this.channel.consume(queue, (message) => void this.consume(message), {
      noAck: false,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  private async consume(message: ConsumeMessage | null): Promise<void> {
    if (!message || !this.channel) return;
    let event;
    try {
      event = parseIntegrationEvent(
        JSON.parse(message.content.toString('utf8')) as unknown,
      );
    } catch {
      this.channel.nack(message, false, false);
      return;
    }
    try {
      await this.inbox.process(
        'notifications.activity-feed.v1',
        event,
        (manager, current) => this.activities.record(manager, current),
      );
      this.channel.ack(message);
    } catch {
      this.channel.nack(message, false, true);
    }
  }
}
