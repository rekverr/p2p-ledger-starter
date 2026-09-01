import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PaymentsOutboxService } from '../messaging/outbox.service';
import {
  assertTransferTransition,
  TransferStatus,
} from './domain/transfer-status';
import { Transfer } from './entities/transfer.entity';
import {
  LEDGER_GATEWAY,
  LedgerCommandError,
  LedgerGateway,
} from './ledger.gateway';
import { MetricsService } from '../observability/metrics.service';
import { TransferPolicyService } from './transfer-policy.service';

const TERMINAL_STATUSES = [TransferStatus.Completed, TransferStatus.Failed];

class SagaLeaseLostError extends Error {}

@Injectable()
export class TransferSagaService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(TransferSagaService.name);

  constructor(
    @InjectRepository(Transfer)
    private readonly transfers: Repository<Transfer>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(LEDGER_GATEWAY) private readonly ledger: LedgerGateway,
    private readonly outbox: PaymentsOutboxService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly policy?: TransferPolicyService,
  ) {}

  async run(transferId: string, now = new Date()): Promise<void> {
    const leaseOwner = randomUUID();
    let transfer = await this.claim(transferId, leaseOwner, now);
    if (!transfer) return;

    for (let step = 0; step < 8; step += 1) {
      if (TERMINAL_STATUSES.includes(transfer.status)) return;
      try {
        if (transfer.status === TransferStatus.Pending) {
          transfer = await this.transitionClaimed(
            transfer,
            leaseOwner,
            TransferStatus.Validating,
            { retryCount: 0, nextRetryAt: null },
          );
          continue;
        }

        if (transfer.status === TransferStatus.Validating) {
          const current = transfer;
          this.policy?.validate(current, now);
          if (!transfer.receiverWalletId) {
            const validation = await this.measureStep(
              'validate',
              current,
              () => this.ledger.validate(current),
            );
            transfer = await this.updateClaimed(transfer, leaseOwner, {
              receiverWalletId: validation.receiverWalletId,
              retryCount: 0,
              nextRetryAt: null,
              failureCode: null,
              failureMessage: null,
            });
          }
          if (!transfer.holdMayExist) {
            transfer = await this.updateClaimed(transfer, leaseOwner, {
              holdMayExist: true,
              lastAttemptAt: new Date(),
            });
          }
          const holding = transfer;
          await this.measureStep('place_hold', holding, () =>
            this.ledger.placeHold(holding),
          );
          transfer = await this.transitionClaimed(
            transfer,
            leaseOwner,
            TransferStatus.FundsHeld,
            { retryCount: 0, nextRetryAt: null, lastAttemptAt: new Date() },
          );
          continue;
        }

        if (transfer.status === TransferStatus.FundsHeld) {
          transfer = await this.transitionClaimed(
            transfer,
            leaseOwner,
            TransferStatus.Processing,
            { retryCount: 0, nextRetryAt: null },
          );
          continue;
        }

        if (transfer.status === TransferStatus.Processing) {
          const processing = transfer;
          await this.measureStep('settle', processing, () =>
            this.ledger.settle(processing),
          );
          await this.complete(transfer, leaseOwner);
          return;
        }

        if (transfer.status === TransferStatus.Compensating) {
          const compensating = transfer;
          const released = await this.measureStep('compensate_release', compensating, () =>
            this.ledger.release(compensating),
          );
          this.metrics?.compensations.inc({ outcome: released.outcome });
          if (released.outcome === 'already_settled') {
            await this.complete(transfer, leaseOwner);
          } else {
            await this.fail(transfer, leaseOwner);
          }
          return;
        }
      } catch (error: unknown) {
        if (error instanceof SagaLeaseLostError) return;
        const outcome = await this.handleFailure(transfer, leaseOwner, error, now);
        if (outcome === 'stop') return;
        transfer = outcome;
      }
    }
    await this.scheduleRetry(
      transfer,
      leaseOwner,
      new LedgerCommandError(
        'Saga step budget exhausted',
        'retryable',
        'SAGA_STEP_BUDGET_EXHAUSTED',
        true,
      ),
      now,
    );
  }

  async recoverDue(now = new Date(), limit = 50): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT id FROM transfers
       WHERE status NOT IN ('Completed', 'Failed')
         AND (next_retry_at IS NULL OR next_retry_at <= $1)
         AND (lease_until IS NULL OR lease_until < $1)
       ORDER BY COALESCE(next_retry_at, created_at), created_at
       LIMIT $2`,
      [now, limit],
    )) as Array<{ id: string }>;
    for (const { id } of rows) await this.run(id, now);
    return rows.length;
  }

  onApplicationBootstrap(): void {
    if (process.env.TRANSFER_RECOVERY_ENABLED === 'false') return;
    const interval = Number(process.env.TRANSFER_RECOVERY_INTERVAL_MS ?? 1000);
    this.timer = setInterval(() => this.triggerRecovery(), interval);
    this.timer.unref();
    this.triggerRecovery();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private triggerRecovery(): void {
    if (this.running) return;
    this.running = true;
    void this.recoverDue()
      .catch((error: unknown) =>
        this.logger.error('Transfer recovery failed', this.errorMessage(error)),
      )
      .finally(() => {
        this.running = false;
      });
  }

  private async handleFailure(
    transfer: Transfer,
    leaseOwner: string,
    error: unknown,
    now: Date,
  ): Promise<'stop' | Transfer> {
    const failure = this.asLedgerError(error);
    if (transfer.status === TransferStatus.Compensating) {
      await this.scheduleRetry(transfer, leaseOwner, failure, now);
      return 'stop';
    }

    const nextAttempt = transfer.retryCount + 1;
    const maxAttempts = Number(process.env.SAGA_MAX_STEP_ATTEMPTS ?? 3);
    if (failure.kind === 'retryable' && nextAttempt < maxAttempts) {
      await this.scheduleRetry(transfer, leaseOwner, failure, now);
      return 'stop';
    }

    if (transfer.holdMayExist) {
      return this.transitionClaimed(
        transfer,
        leaseOwner,
        TransferStatus.Compensating,
        {
          retryCount: 0,
          nextRetryAt: null,
          failureCode: failure.code,
          failureMessage: failure.message,
        },
      );
    }

    await this.fail(transfer, leaseOwner, failure);
    return 'stop';
  }

  private async scheduleRetry(
    transfer: Transfer,
    leaseOwner: string,
    failure: LedgerCommandError,
    now: Date,
  ): Promise<void> {
    const retryCount = transfer.retryCount + 1;
    this.metrics?.sagaRetries.inc({ step: this.metricStep(transfer.status) });
    this.logger.warn({
      event: 'saga_retry_scheduled',
      transferId: transfer.id,
      step: this.metricStep(transfer.status),
      retryCount,
      failureCode: failure.code,
    });
    const base = Number(process.env.SAGA_RETRY_BASE_MS ?? 1000);
    const delay = Math.min(base * 2 ** (retryCount - 1), 60_000);
    await this.updateClaimed(transfer, leaseOwner, {
      retryCount,
      nextRetryAt: new Date(now.getTime() + delay),
      lastAttemptAt: now,
      failureCode: failure.code,
      failureMessage: failure.message,
      leaseOwner: null,
      leaseUntil: null,
    });
  }

  private async complete(transfer: Transfer, leaseOwner: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const completed = await this.transitionUsingManager(
        manager,
        transfer,
        leaseOwner,
        TransferStatus.Completed,
        {
          retryCount: 0,
          nextRetryAt: null,
          failureCode: null,
          failureMessage: null,
          leaseOwner: null,
          leaseUntil: null,
          lastAttemptAt: new Date(),
        },
      );
      await this.outbox.enqueueTransferCompleted(completed, manager);
      await this.outbox.enqueueSplitSharePaid(completed, manager);
    });
    this.metrics?.transferOutcomes.inc({ outcome: 'completed' });
    this.metrics?.sagaDuration.observe(
      { outcome: 'completed' },
      Math.max(0, (Date.now() - transfer.createdAt.getTime()) / 1000),
    );
    this.logger.log({
      event: 'transfer_completed',
      transferId: transfer.id,
    });
  }

  private async fail(
    transfer: Transfer,
    leaseOwner: string,
    failure?: LedgerCommandError,
  ): Promise<void> {
    await this.transitionClaimed(
      transfer,
      leaseOwner,
      TransferStatus.Failed,
      {
        nextRetryAt: null,
        failureCode: failure?.code ?? transfer.failureCode,
        failureMessage: failure?.message ?? transfer.failureMessage,
        leaseOwner: null,
        leaseUntil: null,
        lastAttemptAt: new Date(),
      },
    );
    this.metrics?.transferOutcomes.inc({ outcome: 'failed' });
    this.metrics?.sagaDuration.observe(
      { outcome: 'failed' },
      Math.max(0, (Date.now() - transfer.createdAt.getTime()) / 1000),
    );
    this.logger.warn({
      event: 'transfer_failed',
      transferId: transfer.id,
      failureCode: failure?.code ?? transfer.failureCode,
    });
  }

  private async transitionClaimed(
    transfer: Transfer,
    leaseOwner: string,
    next: TransferStatus,
    patch: Partial<Transfer>,
  ): Promise<Transfer> {
    return this.dataSource.transaction((manager) =>
      this.transitionUsingManager(manager, transfer, leaseOwner, next, patch),
    );
  }

  private async transitionUsingManager(
    manager: EntityManager,
    transfer: Transfer,
    leaseOwner: string,
    next: TransferStatus,
    patch: Partial<Transfer>,
  ): Promise<Transfer> {
    assertTransferTransition(transfer.status, next);
    const result = await manager.getRepository(Transfer).update(
      {
        id: transfer.id,
        status: transfer.status,
        version: transfer.version,
        leaseOwner,
      },
      { ...patch, status: next, version: () => '"version" + 1' },
    );
    if (result.affected !== 1) throw new SagaLeaseLostError('Saga lease was lost');
    return manager.getRepository(Transfer).findOneByOrFail({ id: transfer.id });
  }

  private async updateClaimed(
    transfer: Transfer,
    leaseOwner: string,
    patch: Partial<Transfer>,
  ): Promise<Transfer> {
    const result = await this.transfers.update(
      { id: transfer.id, version: transfer.version, leaseOwner },
      { ...patch, version: () => '"version" + 1' },
    );
    if (result.affected !== 1) throw new SagaLeaseLostError('Saga lease was lost');
    return this.transfers.findOneByOrFail({ id: transfer.id });
  }

  private async claim(
    transferId: string,
    leaseOwner: string,
    now: Date,
  ): Promise<Transfer | null> {
    const leaseUntil = new Date(
      now.getTime() + Number(process.env.SAGA_LEASE_MS ?? 30_000),
    );
    const raw = (await this.dataSource.query(
      `WITH candidate AS (
         SELECT id FROM transfers
         WHERE id = $1
           AND status NOT IN ('Completed', 'Failed')
           AND (next_retry_at IS NULL OR next_retry_at <= $4)
           AND (lease_until IS NULL OR lease_until < $4)
         FOR UPDATE SKIP LOCKED
       )
       UPDATE transfers t
       SET lease_owner = $2, lease_until = $3
       FROM candidate c
       WHERE t.id = c.id
       RETURNING t.id`,
      [transferId, leaseOwner, leaseUntil, now],
    )) as Array<{ id: string }>;
    if (raw.length === 0) return null;
    return this.transfers.findOneByOrFail({ id: transferId });
  }

  private asLedgerError(error: unknown): LedgerCommandError {
    return error instanceof LedgerCommandError
      ? error
      : new LedgerCommandError(
          this.errorMessage(error),
          'retryable',
          'UNEXPECTED_SAGA_ERROR',
          true,
        );
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  }

  private async measureStep<T>(
    step: string,
    transfer: Transfer,
    operation: () => Promise<T>,
  ): Promise<T> {
    const started = process.hrtime.bigint();
    return trace.getTracer('payments-service').startActiveSpan(
      `saga.${step}`,
      { attributes: { 'transfer.id': transfer.id, 'saga.step': step } },
      async (span) => {
        let outcome = 'success';
        try {
          return await operation();
        } catch (error: unknown) {
          outcome = 'error';
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        } finally {
          this.metrics?.sagaStepDuration.observe(
            { step, outcome },
            Number(process.hrtime.bigint() - started) / 1_000_000_000,
          );
          span.end();
        }
      },
    );
  }

  private metricStep(status: TransferStatus): string {
    switch (status) {
      case TransferStatus.Validating:
        return 'validate_or_hold';
      case TransferStatus.Processing:
        return 'settle';
      case TransferStatus.Compensating:
        return 'compensate';
      default:
        return 'transition';
    }
  }
}
