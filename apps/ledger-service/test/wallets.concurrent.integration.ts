import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LedgerMaintenanceService } from '../src/admin/ledger-maintenance.service';
import { User } from '../src/auth/entities/user.entity';
import { ledgerEntities, ledgerMigrations } from '../src/database/ledger-database.options';
import { EventStoreService } from '../src/event-store/event-store.service';
import { OutboxMessage } from '../src/messaging/entities/outbox-message.entity';
import { MessagePublisher } from '../src/messaging/message-publisher';
import { OutboxService } from '../src/messaging/outbox.service';
import { WalletAggregate } from '../src/wallets/domain/wallet.aggregate';
import { WalletBalanceProjection } from '../src/wallets/entities/wallet-balance-projection.entity';
import { Wallet } from '../src/wallets/entities/wallet.entity';
import { LedgerTransferSettlement } from '../src/wallets/entities/ledger-transfer-settlement.entity';
import { WalletsService, WalletView } from '../src/wallets/wallets.service';

jest.setTimeout(30_000);

describe('WalletsService PostgreSQL concurrency', () => {
  let dataSource: DataSource;
  let users: Repository<User>;
  let service: WalletsService;
  let eventStore: EventStoreService;
  let maintenance: LedgerMaintenanceService;
  let outbox: OutboxService;
  let publisher: jest.Mocked<MessagePublisher>;
  let userSequence = 0;

  beforeAll(async () => {
    const database = process.env.TEST_DATABASE_NAME ?? 'ledger_concurrency_test';
    if (!database.endsWith('_test')) throw new Error('Tests require a dedicated *_test database');
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.TEST_DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.TEST_DATABASE_PORT ?? 55432),
      username: process.env.TEST_DATABASE_USER ?? 'ledger_test',
      password: process.env.TEST_DATABASE_PASSWORD ?? 'ledger_test',
      database,
      entities: ledgerEntities,
      migrations: ledgerMigrations,
      migrationsRun: true,
      synchronize: false,
      dropSchema: true,
    });
    await dataSource.initialize();
    users = dataSource.getRepository(User);
    eventStore = new EventStoreService(dataSource);
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    outbox = new OutboxService(dataSource, publisher);
    service = new WalletsService(
      dataSource.getRepository(Wallet),
      dataSource.getRepository(WalletBalanceProjection),
      dataSource.getRepository(User),
      dataSource.getRepository(LedgerTransferSettlement),
      dataSource,
      eventStore,
      outbox,
    );
    maintenance = new LedgerMaintenanceService(dataSource, eventStore);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    userSequence = 0;
    publisher.publish.mockReset().mockResolvedValue(undefined);
    await dataSource.query(
      'TRUNCATE ledger_transfer_settlements, integration_outbox, ledger_events, wallet_balance_projection, wallets, users CASCADE',
    );
  });

  async function createWallet(balance = 100): Promise<{ owner: User; wallet: WalletView }> {
    const owner = await users.save(
      users.create({
        email: `owner-${++userSequence}@example.com`,
        passwordHash: 'not-used',
        refreshTokenHash: null,
        role: 'user',
      }),
    );
    let wallet = await service.getOrCreateForUser(owner.id);
    if (balance > 0) wallet = await service.deposit(wallet.id, owner.id, balance);
    return { owner, wallet };
  }

  it('supports normal withdrawal and rejects insufficient funds', async () => {
    const { owner, wallet } = await createWallet();
    await expect(service.withdraw(wallet.id, owner.id, 25)).resolves.toMatchObject({ balance: '75.00' });
    await expect(service.withdraw(wallet.id, owner.id, 76)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({ balance: '75.00' });
  });

  it('allows only one of two withdrawals that each require most of the balance', async () => {
    const { owner, wallet } = await createWallet();
    const attempts = await Promise.allSettled([
      service.withdraw(wallet.id, owner.id, 80),
      service.withdraw(wallet.id, owner.id, 80),
    ]);
    const successful = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<WalletView> => attempt.status === 'fulfilled',
    );
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    );
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({ balance: '20.00' });
  });

  it('caps many concurrent withdrawals at the event-derived balance', async () => {
    const { owner, wallet } = await createWallet();
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => service.withdraw(wallet.id, owner.id, 30)),
    );
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(3);
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({ balance: '10.00' });
  });

  it('reports a repeatable 100-request double-spend load scenario', async () => {
    const startingBalance = 1000;
    const amount = 100;
    const concurrency = 100;
    const expectedMaximumSuccesses = startingBalance / amount;
    const { owner, wallet } = await createWallet(startingBalance);
    const startedAt = performance.now();

    const attempts = await Promise.allSettled(
      Array.from({ length: concurrency }, () =>
        service.withdraw(wallet.id, owner.id, amount),
      ),
    );

    const durationMs = Math.round(performance.now() - startedAt);
    const successful = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<WalletView> =>
        attempt.status === 'fulfilled',
    );
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    );
    expect(successful.length).toBeLessThanOrEqual(expectedMaximumSuccesses);
    expect(rejected).toHaveLength(concurrency - successful.length);
    expect(rejected.every(({ reason }) => reason instanceof BadRequestException)).toBe(true);

    const finalWallet = await service.getById(wallet.id, owner.id);
    const expectedFinalBalance = startingBalance - successful.length * amount;
    expect(finalWallet).toMatchObject({
      balance: expectedFinalBalance.toFixed(2),
      held: '0.00',
      available: expectedFinalBalance.toFixed(2),
    });
    expect(Number(finalWallet.available)).toBeGreaterThanOrEqual(0);

    const events = await eventStore.loadStream(wallet.id);
    const withdrawals = events.filter(
      ({ eventType }) => eventType === 'WithdrawalCompleted',
    );
    expect(withdrawals).toHaveLength(successful.length);
    expect(new Set(events.map(({ eventId }) => eventId)).size).toBe(events.length);
    expect(events.map(({ streamVersion }) => streamVersion)).toEqual(
      events.map((_, index) => index + 1),
    );
    await expect(maintenance.reconcileWallet(wallet.id)).resolves.toMatchObject({
      consistent: true,
    });
    await expect(maintenance.reconcileGlobal()).resolves.toMatchObject({
      balanced: true,
      invalidTransactionEventIds: [],
    });

    process.stdout.write(
      `${JSON.stringify({
        event: 'double_spend_load_report',
        startingBalance: startingBalance.toFixed(2),
        concurrency,
        attempts: concurrency,
        amount: amount.toFixed(2),
        expectedMaximumSuccesses,
        actualSuccesses: successful.length,
        finalBalance: finalWallet.balance,
        finalHeld: finalWallet.held,
        finalAvailable: finalWallet.available,
        reconciliation: true,
        durationMs,
      })}\n`,
    );
  });

  it('does not lose concurrent deposits', async () => {
    const { owner, wallet } = await createWallet();
    await Promise.all(Array.from({ length: 10 }, () => service.deposit(wallet.id, owner.id, 10)));
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({ balance: '200.00' });
  });

  it('keeps projection equal to event-derived aggregate state', async () => {
    const { owner, wallet } = await createWallet();
    await service.deposit(wallet.id, owner.id, 12.34);
    await service.withdraw(wallet.id, owner.id, 7.89);

    const aggregate = WalletAggregate.rehydrate(
      wallet.id,
      await eventStore.loadStream(wallet.id),
    );
    const projection = await dataSource
      .getRepository(WalletBalanceProjection)
      .findOneByOrFail({ walletId: wallet.id });

    expect(projection.balanceMinor).toBe(aggregate.balanceMinor.toString());
    expect(projection.heldMinor).toBe(aggregate.heldMinor.toString());
    expect(projection.availableMinor).toBe(aggregate.availableMinor.toString());
    expect(projection.streamVersion).toBe(aggregate.version);
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({
      balance: '104.45',
    });
  });

  it('places a hold once and excludes it from available funds', async () => {
    const { owner, wallet } = await createWallet();
    const holdId = randomUUID();

    await expect(service.placeHold(wallet.id, owner.id, holdId, 60)).resolves.toMatchObject({
      balance: '100.00',
      held: '60.00',
      available: '40.00',
    });
    const eventCount = (await eventStore.loadStream(wallet.id)).length;
    await expect(service.placeHold(wallet.id, owner.id, holdId, 60)).resolves.toMatchObject({
      held: '60.00',
      available: '40.00',
    });
    expect(await eventStore.loadStream(wallet.id)).toHaveLength(eventCount);
    await expect(service.placeHold(wallet.id, owner.id, randomUUID(), 40.01)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.withdraw(wallet.id, owner.id, 40.01)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('coalesces simultaneous duplicate hold commands into one effect', async () => {
    const { owner, wallet } = await createWallet();
    const holdId = randomUUID();

    const results = await Promise.all([
      service.placeHold(wallet.id, owner.id, holdId, 30),
      service.placeHold(wallet.id, owner.id, holdId, 30),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ held: '30.00', available: '70.00' });
    expect(results[1]).toMatchObject({ held: '30.00', available: '70.00' });
    expect(
      (await eventStore.loadStream(wallet.id)).filter(
        ({ eventType }) => eventType === 'FundsHeld',
      ),
    ).toHaveLength(1);
  });

  it('prevents overspending through concurrent holds', async () => {
    const { owner, wallet } = await createWallet();
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.placeHold(wallet.id, owner.id, randomUUID(), 30),
      ),
    );

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(3);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(7);
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({
      balance: '100.00',
      held: '90.00',
      available: '10.00',
    });
  });

  it('releases a hold idempotently', async () => {
    const { owner, wallet } = await createWallet();
    const holdId = randomUUID();
    await service.placeHold(wallet.id, owner.id, holdId, 25);
    await expect(service.releaseHold(wallet.id, owner.id, holdId)).resolves.toMatchObject({
      balance: '100.00',
      held: '0.00',
      available: '100.00',
    });
    const eventCount = (await eventStore.loadStream(wallet.id)).length;
    await service.releaseHold(wallet.id, owner.id, holdId);
    expect(await eventStore.loadStream(wallet.id)).toHaveLength(eventCount);
  });

  it('settles a hold exactly once and keeps the journal balanced', async () => {
    const { owner, wallet } = await createWallet();
    const holdId = randomUUID();
    await service.placeHold(wallet.id, owner.id, holdId, 25);
    await expect(service.consumeHold(wallet.id, owner.id, holdId)).resolves.toMatchObject({
      balance: '75.00',
      held: '0.00',
      available: '75.00',
    });
    const eventCount = (await eventStore.loadStream(wallet.id)).length;
    await service.consumeHold(wallet.id, owner.id, holdId);
    expect(await eventStore.loadStream(wallet.id)).toHaveLength(eventCount);
    await expect(maintenance.reconcileGlobal()).resolves.toMatchObject({ balanced: true });
  });

  it('atomically settles an idempotent transfer between two wallets', async () => {
    const sender = await createWallet(100);
    const receiver = await createWallet(0);
    const transferId = randomUUID();
    const validation = await service.validateTransfer({
      transferId,
      senderUserId: sender.owner.id,
      senderWalletId: sender.wallet.id,
      receiverReference: receiver.owner.email,
      amount: 40,
      currency: 'USD',
    });
    expect(validation.receiverWalletId).toBe(receiver.wallet.id);
    await service.placeTransferHold(transferId, {
      senderUserId: sender.owner.id,
      senderWalletId: sender.wallet.id,
      amount: 40,
    });

    const command = {
      senderUserId: sender.owner.id,
      senderWalletId: sender.wallet.id,
      receiverWalletId: receiver.wallet.id,
      amount: 40,
      currency: 'USD',
    };
    await Promise.all([
      service.settleTransfer(transferId, command),
      service.settleTransfer(transferId, command),
    ]);

    await expect(
      service.getById(sender.wallet.id, sender.owner.id),
    ).resolves.toMatchObject({ balance: '60.00', held: '0.00' });
    await expect(
      service.getById(receiver.wallet.id, receiver.owner.id),
    ).resolves.toMatchObject({ balance: '40.00', held: '0.00' });
    await expect(
      dataSource.getRepository(LedgerTransferSettlement).count(),
    ).resolves.toBe(1);
    await expect(
      service.releaseTransferHold(transferId, {
        senderUserId: sender.owner.id,
        senderWalletId: sender.wallet.id,
      }),
    ).resolves.toEqual({ outcome: 'already_settled' });
    await expect(maintenance.reconcileGlobal()).resolves.toMatchObject({
      balanced: true,
    });
  });

  it('releases a transfer hold repeatedly without losing money', async () => {
    const { owner, wallet } = await createWallet(100);
    const transferId = randomUUID();
    const command = { senderUserId: owner.id, senderWalletId: wallet.id };
    await service.placeTransferHold(transferId, { ...command, amount: 35 });

    await expect(service.releaseTransferHold(transferId, command)).resolves.toEqual({
      outcome: 'released',
    });
    await expect(service.releaseTransferHold(transferId, command)).resolves.toEqual({
      outcome: 'released',
    });
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({
      balance: '100.00',
      held: '0.00',
      available: '100.00',
    });
  });

  it('rebuilds the balance projection from the event stream', async () => {
    const { owner, wallet } = await createWallet();
    await service.placeHold(wallet.id, owner.id, randomUUID(), 20);
    await service.withdraw(wallet.id, owner.id, 35);
    await dataSource
      .getRepository(WalletBalanceProjection)
      .delete({ walletId: wallet.id });

    const rebuilt = await service.rebuildBalanceProjection(wallet.id);

    expect(rebuilt.balanceMinor).toBe('6500');
    expect(rebuilt.heldMinor).toBe('2000');
    expect(rebuilt.availableMinor).toBe('4500');
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({
      balance: '65.00',
      held: '20.00',
      available: '45.00',
    });
  });

  it('detects projection corruption and deterministically rebuilds all wallets', async () => {
    const { wallet } = await createWallet();
    await dataSource.query(
      `UPDATE wallet_balance_projection
       SET balance_minor = '9999', held_minor = '0', available_minor = '9999'
       WHERE wallet_id = $1`,
      [wallet.id],
    );

    await expect(maintenance.reconcileWallet(wallet.id)).resolves.toMatchObject({
      consistent: false,
      eventDerived: { total: '100.00', held: '0.00', available: '100.00' },
      projection: { total: '99.99', held: '0.00', available: '99.99' },
    });
    await expect(maintenance.rebuildAllBalanceProjections()).resolves.toEqual({
      rebuiltWallets: 1,
    });
    await expect(maintenance.reconcileWallet(wallet.id)).resolves.toMatchObject({
      consistent: true,
    });
  });

  it('reconciles the global debit-credit invariant for a period', async () => {
    const { owner, wallet } = await createWallet();
    const holdId = randomUUID();
    await service.deposit(wallet.id, owner.id, 10);
    await service.placeHold(wallet.id, owner.id, holdId, 20);
    await service.consumeHold(wallet.id, owner.id, holdId);
    await service.withdraw(wallet.id, owner.id, 5);

    await expect(
      maintenance.reconcileGlobal('2020-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z'),
    ).resolves.toMatchObject({
      transactionCount: 4,
      creditsMinor: '13500',
      debitsMinor: '13500',
      balanced: true,
    });
    const log = await maintenance.walletEventLog(wallet.id);
    expect(log.map(({ streamVersion }) => streamVersion)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reports an unbalanced journal event instead of hiding reconciliation failure', async () => {
    const { wallet } = await createWallet();
    const corruptEventId = randomUUID();
    await eventStore.append({
      streamId: wallet.id,
      aggregateType: 'Wallet',
      expectedVersion: 2,
      events: [
        {
          eventId: corruptEventId,
          eventType: 'MoneyDeposited',
          schemaVersion: 1,
          payload: {
            transactionId: randomUUID(),
            postings: [
              { accountId: `wallet:${wallet.id}`, amountMinor: '100' },
              { accountId: 'system:external', amountMinor: '-99' },
            ],
          },
        },
      ],
    });

    await expect(maintenance.reconcileGlobal()).resolves.toMatchObject({
      invalidTransactionEventIds: [corruptEventId],
      balanced: false,
    });
  });

  it('preserves owner-scoped authorization', async () => {
    const { wallet } = await createWallet();
    const other = await users.save(users.create({
      email: 'other@example.com', passwordHash: 'not-used', refreshTokenHash: null, role: 'user',
    }));
    await expect(service.withdraw(wallet.id, other.id, 10)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getById(wallet.id, other.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists domain event and outbox message in the same transaction', async () => {
    const { owner, wallet } = await createWallet(0);
    const before = await eventStore.loadStream(wallet.id);
    const failingOutbox = {
      enqueueWalletEvents: jest.fn().mockRejectedValue(new Error('outbox unavailable')),
    } as unknown as OutboxService;
    const failingService = new WalletsService(
      dataSource.getRepository(Wallet),
      dataSource.getRepository(WalletBalanceProjection),
      dataSource.getRepository(User),
      dataSource.getRepository(LedgerTransferSettlement),
      dataSource,
      eventStore,
      failingOutbox,
    );

    await expect(failingService.deposit(wallet.id, owner.id, 10)).rejects.toThrow(
      'outbox unavailable',
    );
    expect(await eventStore.loadStream(wallet.id)).toHaveLength(before.length);
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({
      balance: '0.00',
    });

    const storedEvents = await eventStore.loadStream(wallet.id);
    const messages = await dataSource.getRepository(OutboxMessage).find();
    expect(messages.map(({ eventId }) => eventId).sort()).toEqual(
      storedEvents.map(({ eventId }) => eventId).sort(),
    );
  });

  it('retries failed outbox publication and marks it only after confirmation', async () => {
    const { wallet } = await createWallet(0);
    publisher.publish
      .mockRejectedValueOnce(new Error('broker unavailable'))
      .mockResolvedValueOnce(undefined);
    const firstAttemptAt = new Date(Date.now() + 100);

    await expect(outbox.publishBatch(firstAttemptAt)).resolves.toBe(1);
    let message = await dataSource.getRepository(OutboxMessage).findOneByOrFail({
      eventId: (await eventStore.loadStream(wallet.id))[0].eventId,
    });
    expect(message).toMatchObject({ attempts: 1, publishedAt: null });
    expect(message.lastError).toContain('broker unavailable');

    await expect(
      outbox.publishBatch(new Date(firstAttemptAt.getTime() + 1001)),
    ).resolves.toBe(1);
    message = await dataSource.getRepository(OutboxMessage).findOneByOrFail({
      eventId: message.eventId,
    });
    expect(message.publishedAt).toBeInstanceOf(Date);
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });
});
