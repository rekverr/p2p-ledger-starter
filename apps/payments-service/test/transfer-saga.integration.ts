import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  paymentsEntities,
  paymentsMigrations,
} from '../src/database/payments-database.options';
import { PaymentsOutboxService } from '../src/messaging/outbox.service';
import { MessagePublisher } from '../src/messaging/message-publisher';
import { TransferStatus } from '../src/transfers/domain/transfer-status';
import { Transfer } from '../src/transfers/entities/transfer.entity';
import {
  LedgerCommandError,
  LedgerGateway,
} from '../src/transfers/ledger.gateway';
import { TransferSagaService } from '../src/transfers/transfer-saga.service';
import { TransfersService } from '../src/transfers/transfers.service';

jest.setTimeout(30_000);

class FakeLedger implements LedgerGateway {
  readonly senderWalletId = randomUUID();
  readonly receiverWalletId = randomUUID();
  senderBalanceMinor = 10_000n;
  receiverBalanceMinor = 0n;
  monetaryEffects = 0;
  releaseCalls = 0;
  validateFailures: LedgerCommandError[] = [];
  settleFailures: LedgerCommandError[] = [];
  releaseFailures: LedgerCommandError[] = [];
  timeoutPlaceHold = false;
  settleFailureAppliesEffect = false;
  private readonly holds = new Map<string, bigint>();
  private readonly settled = new Set<string>();

  async validate(): Promise<{ receiverWalletId: string }> {
    const failure = this.validateFailures.shift();
    if (failure) throw failure;
    return { receiverWalletId: this.receiverWalletId };
  }

  async placeHold(transfer: Transfer): Promise<void> {
    const amount = BigInt(transfer.amountMinor);
    const existing = this.holds.get(transfer.id);
    if (existing !== undefined && existing !== amount) {
      throw new Error('hold conflict');
    }
    if (existing === undefined) {
      if (amount > this.senderBalanceMinor) {
        throw new LedgerCommandError(
          'insufficient funds',
          'terminal',
          'INSUFFICIENT_FUNDS',
          false,
        );
      }
      this.holds.set(transfer.id, amount);
    }
    if (this.timeoutPlaceHold) {
      throw retryable('LEDGER_TIMEOUT');
    }
  }

  async settle(transfer: Transfer): Promise<void> {
    const failure = this.settleFailures.shift();
    if (failure && this.settleFailureAppliesEffect) {
      this.applySettlement(transfer);
    }
    if (failure) throw failure;
    this.applySettlement(transfer);
  }

  private applySettlement(transfer: Transfer): void {
    if (this.settled.has(transfer.id)) return;
    const held = this.holds.get(transfer.id);
    if (held === undefined) throw new Error('hold missing');
    this.senderBalanceMinor -= held;
    this.receiverBalanceMinor += held;
    this.holds.delete(transfer.id);
    this.settled.add(transfer.id);
    this.monetaryEffects += 1;
  }

  async release(
    transfer: Transfer,
  ): Promise<{ outcome: 'released' | 'already_settled' }> {
    this.releaseCalls += 1;
    const failure = this.releaseFailures.shift();
    if (failure) throw failure;
    if (this.settled.has(transfer.id)) return { outcome: 'already_settled' };
    this.holds.delete(transfer.id);
    return { outcome: 'released' };
  }

  heldMinor(transferId: string): bigint {
    return this.holds.get(transferId) ?? 0n;
  }
}

function retryable(code: string): LedgerCommandError {
  return new LedgerCommandError(code, 'retryable', code, true);
}

function terminal(code: string): LedgerCommandError {
  return new LedgerCommandError(code, 'terminal', code, false);
}

describe('persisted transfer saga', () => {
  let dataSource: DataSource;
  let transfers: TransfersService;
  let saga: TransferSagaService;
  let ledger: FakeLedger;
  let outbox: PaymentsOutboxService;
  let publisher: jest.Mocked<MessagePublisher>;
  const senderUserId = randomUUID();
  const originalEnvironment = { ...process.env };

  beforeAll(async () => {
    process.env.SAGA_MAX_STEP_ATTEMPTS = '3';
    process.env.SAGA_RETRY_BASE_MS = '10';
    const database =
      process.env.TEST_PAYMENTS_DATABASE_NAME ?? 'payments_persistence_test';
    if (!database.endsWith('_test')) {
      throw new Error('Tests require a dedicated *_test database');
    }
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.TEST_PAYMENTS_DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.TEST_PAYMENTS_DATABASE_PORT ?? 55433),
      username: process.env.TEST_PAYMENTS_DATABASE_USER ?? 'payments_test',
      password: process.env.TEST_PAYMENTS_DATABASE_PASSWORD ?? 'payments_test',
      database,
      entities: paymentsEntities,
      migrations: paymentsMigrations,
      migrationsRun: true,
      synchronize: false,
      dropSchema: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    process.env = originalEnvironment;
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE integration_outbox, transfers');
    ledger = new FakeLedger();
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    outbox = new PaymentsOutboxService(dataSource, publisher);
    transfers = new TransfersService(
      dataSource.getRepository(Transfer),
      dataSource,
    );
    saga = new TransferSagaService(
      dataSource.getRepository(Transfer),
      dataSource,
      ledger,
      outbox,
    );
  });

  async function create(key = randomUUID()): Promise<Transfer> {
    const view = await transfers.create(
      {
        fromWalletId: ledger.senderWalletId,
        toWalletIdentifier: 'receiver@example.com',
        amount: 40,
        currency: 'USD',
      },
      key,
      senderUserId,
    );
    return dataSource.getRepository(Transfer).findOneByOrFail({ id: view.id });
  }

  it('completes a transfer once and persists a completion outbox event', async () => {
    const transfer = await create();

    await saga.run(transfer.id);

    await expect(statusOf(transfer.id)).resolves.toBe(TransferStatus.Completed);
    expect(ledger.senderBalanceMinor).toBe(6_000n);
    expect(ledger.receiverBalanceMinor).toBe(4_000n);
    expect(ledger.monetaryEffects).toBe(1);
    const messages = await dataSource.query(
      'SELECT routing_key, event FROM integration_outbox',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      routing_key: 'payments.transfer.completed.v1',
    });
    await expect(outbox.publishBatch()).resolves.toBe(1);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const published = await dataSource.query(
      'SELECT published_at FROM integration_outbox',
    );
    expect(published[0].published_at).toBeInstanceOf(Date);
  });

  it('releases the hold and fails without losing money after settlement failure', async () => {
    const transfer = await create();
    ledger.settleFailures.push(terminal('RECEIVER_REJECTED'));

    await saga.run(transfer.id);

    await expect(statusOf(transfer.id)).resolves.toBe(TransferStatus.Failed);
    expect(ledger.heldMinor(transfer.id)).toBe(0n);
    expect(ledger.senderBalanceMinor).toBe(10_000n);
    expect(ledger.receiverBalanceMinor).toBe(0n);
    expect(ledger.releaseCalls).toBe(1);

    await saga.run(transfer.id);
    await saga.run(transfer.id);
    await expect(statusOf(transfer.id)).resolves.toBe(TransferStatus.Failed);
    expect(ledger.releaseCalls).toBe(1);
    expect(ledger.monetaryEffects).toBe(0);
    expect(ledger.heldMinor(transfer.id)).toBe(0n);
    expect(ledger.senderBalanceMinor).toBe(10_000n);
    expect(ledger.receiverBalanceMinor).toBe(0n);
  });

  it('recovers a temporary ledger failure from persisted retry state', async () => {
    const transfer = await create();
    ledger.validateFailures.push(retryable('LEDGER_UNAVAILABLE'));
    const startedAt = new Date('2026-01-01T00:00:00.000Z');

    await saga.run(transfer.id, startedAt);
    await expect(statusOf(transfer.id)).resolves.toBe(TransferStatus.Validating);
    await expect(
      dataSource.getRepository(Transfer).findOneByOrFail({ id: transfer.id }),
    ).resolves.toMatchObject({
      retryCount: 1,
      failureCode: 'LEDGER_UNAVAILABLE',
      holdMayExist: false,
    });
    expect(ledger.senderBalanceMinor).toBe(10_000n);
    expect(ledger.receiverBalanceMinor).toBe(0n);

    await saga.recoverDue(new Date(startedAt.getTime() + 100), 10);
    await expect(statusOf(transfer.id)).resolves.toBe(TransferStatus.Completed);
    expect(ledger.monetaryEffects).toBe(1);
  });

  it('makes duplicate saga delivery financially harmless', async () => {
    const transfer = await create();
    const competingWorker = new TransferSagaService(
      dataSource.getRepository(Transfer),
      dataSource,
      ledger,
      outbox,
    );
    await Promise.all([saga.run(transfer.id), competingWorker.run(transfer.id)]);
    await saga.run(transfer.id);
    await saga.run(transfer.id);

    expect(ledger.monetaryEffects).toBe(1);
    expect(ledger.senderBalanceMinor).toBe(6_000n);
    await expect(
      dataSource.query('SELECT * FROM integration_outbox'),
    ).resolves.toHaveLength(1);
  });

  it('moves repeated ambiguous hold timeouts through retry to compensation', async () => {
    const transfer = await create();
    ledger.timeoutPlaceHold = true;
    const startedAt = new Date('2026-01-01T00:00:00.000Z');

    await saga.run(transfer.id, startedAt);
    await saga.run(transfer.id, new Date(startedAt.getTime() + 100));
    await saga.run(transfer.id, new Date(startedAt.getTime() + 1000));

    await expect(statusOf(transfer.id)).resolves.toBe(TransferStatus.Failed);
    expect(ledger.releaseCalls).toBe(1);
    expect(ledger.heldMinor(transfer.id)).toBe(0n);
    expect(ledger.senderBalanceMinor).toBe(10_000n);
  });

  it('finishes completed when settlement committed but every response timed out', async () => {
    const transfer = await create();
    ledger.settleFailureAppliesEffect = true;
    ledger.settleFailures.push(
      retryable('LEDGER_TIMEOUT'),
      retryable('LEDGER_TIMEOUT'),
      retryable('LEDGER_TIMEOUT'),
    );
    const startedAt = new Date('2026-01-01T00:00:00.000Z');

    await saga.run(transfer.id, startedAt);
    await saga.run(transfer.id, new Date(startedAt.getTime() + 100));
    await saga.run(transfer.id, new Date(startedAt.getTime() + 1000));

    await expect(statusOf(transfer.id)).resolves.toBe(TransferStatus.Completed);
    expect(ledger.monetaryEffects).toBe(1);
    expect(ledger.senderBalanceMinor).toBe(6_000n);
    expect(ledger.receiverBalanceMinor).toBe(4_000n);
  });

  it('retries compensation and repeated recovery remains harmless', async () => {
    const transfer = await create();
    ledger.settleFailures.push(terminal('SETTLEMENT_REJECTED'));
    ledger.releaseFailures.push(retryable('LEDGER_UNAVAILABLE'));
    const startedAt = new Date('2026-01-01T00:00:00.000Z');

    await saga.run(transfer.id, startedAt);
    await expect(statusOf(transfer.id)).resolves.toBe(
      TransferStatus.Compensating,
    );
    expect(ledger.heldMinor(transfer.id)).toBe(4_000n);

    await saga.recoverDue(new Date(startedAt.getTime() + 100), 10);
    await saga.recoverDue(new Date(startedAt.getTime() + 200), 10);
    await expect(statusOf(transfer.id)).resolves.toBe(TransferStatus.Failed);
    expect(ledger.heldMinor(transfer.id)).toBe(0n);
    expect(ledger.senderBalanceMinor).toBe(10_000n);
  });

  it('continues after a process restart using only persisted saga state', async () => {
    const transfer = await create();
    ledger.validateFailures.push(retryable('LEDGER_UNAVAILABLE'));
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    await saga.run(transfer.id, startedAt);

    const restarted = new TransferSagaService(
      dataSource.getRepository(Transfer),
      dataSource,
      ledger,
      outbox,
    );
    await restarted.recoverDue(new Date(startedAt.getTime() + 100), 10);

    await expect(statusOf(transfer.id)).resolves.toBe(TransferStatus.Completed);
    expect(ledger.monetaryEffects).toBe(1);
  });

  async function statusOf(id: string): Promise<TransferStatus> {
    return (await dataSource.getRepository(Transfer).findOneByOrFail({ id })).status;
  }
});
