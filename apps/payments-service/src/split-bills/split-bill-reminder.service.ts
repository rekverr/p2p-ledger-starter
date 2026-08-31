import { randomUUID } from 'crypto';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaymentsOutboxService } from '../messaging/outbox.service';
import { TransferStatus } from '../transfers/domain/transfer-status';
import { SplitBillShare } from './entities/split-bill-share.entity';

@Injectable()
export class SplitBillReminderService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(SplitBillReminderService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly outbox: PaymentsOutboxService,
  ) {}

  async detectAndEnqueue(now = new Date(), limit = 100): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const candidates = (await manager.query(
        `SELECT s.id
         FROM split_bill_shares s
         JOIN split_bills b ON b.id = s.bill_id
         LEFT JOIN transfers t ON t.split_bill_share_id = s.id
         LEFT JOIN split_bill_reminders r
           ON r.share_id = s.id AND r.kind = 'overdue'
         WHERE b.deadline IS NOT NULL
           AND b.deadline <= $1
           AND (t.id IS NULL OR t.status = $2)
           AND r.id IS NULL
         ORDER BY b.deadline, s.id
         FOR UPDATE OF s SKIP LOCKED
         LIMIT $3`,
        [now, TransferStatus.Failed, limit],
      )) as Array<{ id: string }>;
      let created = 0;
      for (const candidate of candidates) {
        const share = await manager.getRepository(SplitBillShare).findOne({
          where: { id: candidate.id },
          relations: { bill: true },
        });
        if (!share) continue;
        const reminderId = randomUUID();
        const eventId = randomUUID();
        const inserted = (await manager.query(
          `INSERT INTO split_bill_reminders (id, share_id, kind, event_id)
           VALUES ($1, $2, 'overdue', $3)
           ON CONFLICT (share_id, kind) DO NOTHING
           RETURNING id`,
          [reminderId, share.id, eventId],
        )) as Array<{ id: string }>;
        if (inserted.length === 0) continue;
        await this.outbox.enqueueOverdueReminder(
          manager,
          eventId,
          share.bill,
          share,
        );
        created += 1;
      }
      return created;
    });
  }

  onApplicationBootstrap(): void {
    if (process.env.SPLIT_BILL_REMINDERS_ENABLED === 'false') return;
    const interval = Number(
      process.env.SPLIT_BILL_REMINDER_INTERVAL_MS ?? 60_000,
    );
    this.timer = setInterval(() => this.trigger(), interval);
    this.timer.unref();
    this.trigger();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private trigger(): void {
    if (this.running) return;
    this.running = true;
    const batchSize = Number(
      process.env.SPLIT_BILL_REMINDER_BATCH_SIZE ?? 100,
    );
    void this.detectAndEnqueue(new Date(), batchSize)
      .catch((error: unknown) =>
        this.logger.error(
          'Split bill reminder scan failed',
          error instanceof Error ? error.message : String(error),
        ),
      )
      .finally(() => {
        this.running = false;
      });
  }
}
