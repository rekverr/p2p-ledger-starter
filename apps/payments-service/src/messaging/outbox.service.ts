import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PaymentOutboxMessage } from '../database/entities/outbox-message.entity';
import { Transfer } from '../transfers/entities/transfer.entity';
import { PaymentIntegrationEvent } from './integration-event';
import { MESSAGE_PUBLISHER, MessagePublisher } from './message-publisher';

const LOCK_DURATION_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

@Injectable()
export class PaymentsOutboxService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(PaymentsOutboxService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
  ) {}

  async enqueueTransferCompleted(
    transfer: Transfer,
    manager: EntityManager,
  ): Promise<void> {
    if (!transfer.receiverWalletId) {
      throw new Error('Completed transfer is missing receiver wallet');
    }
    const occurredAt = new Date();
    const event: PaymentIntegrationEvent = {
      eventId: randomUUID(),
      eventType: 'payments.transfer.Completed',
      schemaVersion: 1,
      occurredAt: occurredAt.toISOString(),
      producer: 'payments-service',
      correlationId: transfer.id,
      traceId: null,
      aggregate: {
        type: 'Transfer',
        id: transfer.id,
        version: transfer.version,
      },
      payload: {
        senderUserId: transfer.senderUserId,
        senderWalletId: transfer.senderWalletId,
        receiverWalletId: transfer.receiverWalletId,
        amountMinor: transfer.amountMinor,
        currency: transfer.currency,
        status: 'Completed',
      },
    };
    await manager.getRepository(PaymentOutboxMessage).insert({
      eventId: event.eventId,
      routingKey: 'payments.transfer.completed.v1',
      event,
      attempts: 0,
      availableAt: occurredAt,
      lockedUntil: null,
      lockId: null,
      publishedAt: null,
      lastError: null,
    });
  }

  async publishBatch(now = new Date(), batchSize = 50): Promise<number> {
    const claimed = await this.claim(now, batchSize);
    for (const message of claimed) {
      if (!message.lockId) throw new Error('Claimed outbox message has no lock');
      const lockId = message.lockId;
      try {
        await this.publisher.publish(
          message.routingKey,
          message.event as PaymentIntegrationEvent,
        );
        await this.dataSource.getRepository(PaymentOutboxMessage).update(
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
        await this.dataSource.getRepository(PaymentOutboxMessage).update(
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

  private triggerPoll(): void {
    if (this.running) return;
    this.running = true;
    void this.publishBatch()
      .catch((error: unknown) =>
        this.logger.error('Payments outbox poll failed', this.errorMessage(error)),
      )
      .finally(() => {
        this.running = false;
      });
  }

  private claim(now: Date, batchSize: number): Promise<PaymentOutboxMessage[]> {
    const lockId = randomUUID();
    const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
    return this.dataSource.transaction(async (manager) => {
      const raw = (await manager.query(
        `WITH candidates AS (
           SELECT event_id FROM integration_outbox
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
      const rows = (Array.isArray(raw[0]) ? raw[0] : raw) as Array<
        Record<string, unknown>
      >;
      return rows.map((row) =>
        manager.getRepository(PaymentOutboxMessage).create({
          eventId: String(row.event_id),
          routingKey: String(row.routing_key),
          event: row.event as object,
          attempts: Number(row.attempts),
          availableAt: new Date(String(row.available_at)),
          lockedUntil: new Date(String(row.locked_until)),
          lockId: String(row.lock_id),
          publishedAt: row.published_at
            ? new Date(String(row.published_at))
            : null,
          lastError:
            typeof row.last_error === 'string' ? row.last_error : null,
          createdAt: new Date(String(row.created_at)),
        }),
      );
    });
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  }
}
