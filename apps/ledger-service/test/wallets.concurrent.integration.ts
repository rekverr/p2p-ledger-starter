import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { User } from '../src/auth/entities/user.entity';
import { ledgerEntities, ledgerMigrations } from '../src/database/ledger-database.options';
import { EventStoreService } from '../src/event-store/event-store.service';
import { WalletAggregate } from '../src/wallets/domain/wallet.aggregate';
import { WalletBalanceProjection } from '../src/wallets/entities/wallet-balance-projection.entity';
import { Wallet } from '../src/wallets/entities/wallet.entity';
import { WalletsService, WalletView } from '../src/wallets/wallets.service';

jest.setTimeout(30_000);

describe('WalletsService PostgreSQL concurrency', () => {
  let dataSource: DataSource;
  let users: Repository<User>;
  let service: WalletsService;
  let eventStore: EventStoreService;
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
    service = new WalletsService(
      dataSource.getRepository(Wallet),
      dataSource.getRepository(WalletBalanceProjection),
      dataSource,
      eventStore,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    userSequence = 0;
    await dataSource.query(
      'TRUNCATE ledger_events, wallet_balance_projection, wallets, users CASCADE',
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
    expect(projection.streamVersion).toBe(aggregate.version);
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({
      balance: '104.45',
    });
  });

  it('rebuilds the balance projection from the event stream', async () => {
    const { owner, wallet } = await createWallet();
    await service.withdraw(wallet.id, owner.id, 35);
    await dataSource
      .getRepository(WalletBalanceProjection)
      .delete({ walletId: wallet.id });

    const rebuilt = await service.rebuildBalanceProjection(wallet.id);

    expect(rebuilt.balanceMinor).toBe('6500');
    await expect(service.getById(wallet.id, owner.id)).resolves.toMatchObject({
      balance: '65.00',
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
});
