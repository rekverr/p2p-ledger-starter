import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { StoredEvent } from '../event-store/entities/stored-event.entity';
import { JsonObject } from '../event-store/event-store.types';
import { Wallet } from '../wallets/entities/wallet.entity';
import { OutboxMessage } from './entities/outbox-message.entity';
import { IntegrationEventEnvelope, walletRoutingKey } from './integration-event';
import { MESSAGE_PUBLISHER, MessagePublisher } from './message-publisher';
import {
  activeTraceId,
  captureTraceCarrier,
} from '../observability/propagation';
import { MetricsService } from '../observability/metrics.service';

const DEFAULT_BATCH_SIZE = 50;
const LOCK_DURATION_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

@Injectable()
export class OutboxService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async enqueueWalletEvents(
    events: StoredEvent[],
    wallet: Wallet,
    manager: EntityManager,
  ): Promise<void> {
    const outbox = manager.getRepository(OutboxMessage);
    await outbox.insert(
      events.map((event) => {
        const carrier = captureTraceCarrier();
        const envelope: IntegrationEventEnvelope = {
          eventId: event.eventId,
          eventType: `ledger.wallet.${event.eventType}`,
          schemaVersion: 1,
          occurredAt: event.createdAt.toISOString(),
          producer: 'ledger-service',
          correlationId: event.correlationId,
          traceId: activeTraceId() ?? event.traceId,
          ...carrier,
          aggregate: {
            type: event.aggregateType,
            id: event.streamId,
            version: event.streamVersion,
          },
          payload: {
            ownerId: wallet.ownerId,
            currency: wallet.currency,
            domainEventType: event.eventType,
            domainSchemaVersion: event.schemaVersion,
            data: event.payload as JsonObject,
          },
        };
        return outbox.create({
          eventId: event.eventId,
          routingKey: walletRoutingKey(event.eventType, envelope.schemaVersion),
          event: envelope,
          attempts: 0,
          availableAt: event.createdAt,
          lockedUntil: null,
          lockId: null,
          publishedAt: null,
          lastError: null,
        });
      }),
    );
  }

  async publishBatch(now = new Date(), batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    const claimed = await this.claim(now, batchSize);
    for (const message of claimed) {
      if (!message.lockId) throw new Error(`Claimed outbox message ${message.eventId} has no lock`);
      const lockId = message.lockId;
      try {
        await this.publisher.publish(
          message.routingKey,
          message.event as IntegrationEventEnvelope,
        );
        await this.dataSource.getRepository(OutboxMessage).update(
          { eventId: message.eventId, lockId },
          {
            publishedAt: new Date(),
            lockedUntil: null,
            lockId: null,
            lastError: null,
          },
        );
      } catch (error: unknown) {
        const attempts = message.attempts + 1;
        const backoff = Math.min(2 ** (attempts - 1) * 1000, MAX_BACKOFF_MS);
        await this.dataSource.getRepository(OutboxMessage).update(
          { eventId: message.eventId, lockId },
          {
            attempts,
            availableAt: new Date(now.getTime() + backoff),
            lockedUntil: null,
            lockId: null,
            lastError: this.errorMessage(error),
          },
        );
      }
    }
    await this.updateBacklogMetric();
    return claimed.length;
  }

  onApplicationBootstrap(): void {
    if (process.env.OUTBOX_PUBLISHER_ENABLED === 'false') return;
    const interval = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000);
    this.timer = setInterval(() => this.triggerPoll(), interval);
    this.timer.unref();
    this.triggerPoll();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.publishBatch();
    } finally {
      this.running = false;
    }
  }

  private triggerPoll(): void {
    void this.poll().catch((error: unknown) => {
      this.logger.error('Outbox poll failed', this.errorMessage(error));
    });
  }

  private claim(now: Date, batchSize: number): Promise<OutboxMessage[]> {
    const lockId = randomUUID();
    const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
    return this.dataSource.transaction(async (manager) => {
      const result = (await manager.query(
        `WITH candidates AS (
           SELECT event_id
           FROM integration_outbox
           WHERE published_at IS NULL
             AND available_at <= $1
             AND (locked_until IS NULL OR locked_until < $1)
           ORDER BY created_at, event_id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE integration_outbox o
         SET lock_id = $3, locked_until = $4
         FROM candidates c
         WHERE o.event_id = c.event_id
         RETURNING o.*`,
        [now, batchSize, lockId, lockedUntil],
      )) as Array<unknown>;
      const rows = (Array.isArray(result[0]) ? result[0] : result) as Array<
        Record<string, unknown>
      >;
      return rows.map((row) => manager.getRepository(OutboxMessage).create({
        eventId: String(row.event_id),
        routingKey: String(row.routing_key),
        event: row.event as IntegrationEventEnvelope,
        attempts: Number(row.attempts),
        availableAt: new Date(String(row.available_at)),
        lockedUntil: new Date(String(row.locked_until)),
        lockId: String(row.lock_id),
        publishedAt: row.published_at ? new Date(String(row.published_at)) : null,
        lastError: typeof row.last_error === 'string' ? row.last_error : null,
        createdAt: new Date(String(row.created_at)),
      }));
    });
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  }

  private async updateBacklogMetric(): Promise<void> {
    if (!this.metrics) return;
    try {
      const count = await this.dataSource.getRepository(OutboxMessage).count({
        where: { publishedAt: IsNull() },
      });
      this.metrics.outboxBacklog.set(count);
    } catch (error: unknown) {
      this.logger.warn('Could not update outbox backlog metric', this.errorMessage(error));
    }
  }
}
