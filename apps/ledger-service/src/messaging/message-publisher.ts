import { once } from 'events';
import {
  ChannelModel,
  ConfirmChannel,
  Options,
  connect,
} from 'amqplib';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { context, SpanKind, trace } from '@opentelemetry/api';
import { IntegrationEventEnvelope } from './integration-event';
import {
  captureTraceCarrier,
  extractTraceContext,
} from '../observability/propagation';

export const MESSAGE_PUBLISHER = Symbol('MESSAGE_PUBLISHER');

export interface MessagePublisher {
  publish(
    routingKey: string,
    event: IntegrationEventEnvelope,
  ): Promise<void>;
}

@Injectable()
export class RabbitMqMessagePublisher
  implements MessagePublisher, OnApplicationShutdown
{
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;

  async publish(
    routingKey: string,
    event: IntegrationEventEnvelope,
  ): Promise<void> {
    const parent = extractTraceContext({
      traceparent: event.traceparent,
      tracestate: event.tracestate,
    });
    return context.with(parent, async () => {
      const span = trace.getTracer('ledger-service').startSpan(
        'rabbitmq publish',
        {
          kind: SpanKind.PRODUCER,
          attributes: {
            'messaging.system': 'rabbitmq',
            'messaging.destination.name': this.exchange,
            'messaging.rabbitmq.routing_key': routingKey,
            'messaging.operation.type': 'publish',
          },
        },
        context.active(),
      );
      try {
        await context.with(trace.setSpan(context.active(), span), () =>
          this.publishWithinSpan(routingKey, event),
        );
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async publishWithinSpan(
    routingKey: string,
    event: IntegrationEventEnvelope,
  ): Promise<void> {
    const channel = await this.getChannel();
    const carrier = captureTraceCarrier();
    const options: Options.Publish = {
      persistent: true,
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      messageId: event.eventId,
      type: event.eventType,
      timestamp: Date.parse(event.occurredAt),
      headers: {
        schemaVersion: event.schemaVersion,
        correlationId: event.correlationId,
        traceId: event.traceId,
        traceparent: carrier.traceparent ?? event.traceparent,
        tracestate: carrier.tracestate ?? event.tracestate,
      },
    };
    try {
      const accepted = channel.publish(
        this.exchange,
        routingKey,
        Buffer.from(JSON.stringify(event)),
        options,
      );
      if (!accepted) await once(channel, 'drain');
      await channel.waitForConfirms();
    } catch (error: unknown) {
      await this.resetConnection();
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.resetConnection();
  }

  private async getChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    this.connection = await connect(
      process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq:5672',
    );
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
    return this.channel;
  }

  private get exchange(): string {
    return process.env.RABBITMQ_EXCHANGE ?? 'p2p.domain-events';
  }

  private async resetConnection(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }
}
