import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, EntitySchema, Repository } from 'typeorm';
import { User } from '../src/auth/entities/user.entity';
import { Wallet } from '../src/wallets/entities/wallet.entity';
import { WalletsService } from '../src/wallets/wallets.service';

jest.setTimeout(30_000);

const TestUserSchema = new EntitySchema<User>({
  name: 'User',
  target: User,
  tableName: 'users',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    email: { type: 'varchar', unique: true },
    passwordHash: { type: 'varchar' },
    refreshTokenHash: { type: 'varchar', nullable: true },
    role: { type: 'varchar', default: 'user' },
  },
});

const TestWalletSchema = new EntitySchema<Wallet>({
  name: 'Wallet',
  target: Wallet,
  tableName: 'wallets',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    ownerId: { type: 'uuid' },
    currency: { type: 'varchar', default: 'USD' },
    balance: { type: 'numeric', precision: 18, scale: 2, default: 0 },
  },
  indices: [
    {
      name: 'UQ_wallets_owner_currency',
      columns: ['ownerId', 'currency'],
      unique: true,
    },
  ],
});

describe('WalletsService PostgreSQL concurrency', () => {
  let dataSource: DataSource;
  let users: Repository<User>;
  let wallets: Repository<Wallet>;
  let service: WalletsService;
  let userSequence = 0;

  beforeAll(async () => {
    const database =
      process.env.TEST_DATABASE_NAME ?? 'ledger_concurrency_test';
    if (!database.endsWith('_test')) {
      throw new Error('Concurrency tests require a dedicated *_test database');
    }

    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.TEST_DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.TEST_DATABASE_PORT ?? 55432),
      username: process.env.TEST_DATABASE_USER ?? 'ledger_test',
      password: process.env.TEST_DATABASE_PASSWORD ?? 'ledger_test',
      database,
      entities: [TestUserSchema, TestWalletSchema],
      synchronize: true,
      dropSchema: true,
    });
    await dataSource.initialize();

    users = dataSource.getRepository(User);
    wallets = dataSource.getRepository(Wallet);
    service = new WalletsService(wallets, dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    userSequence = 0;
    await wallets.createQueryBuilder().delete().execute();
    await users.createQueryBuilder().delete().execute();
  });

  async function createWallet(balance = '100.00') {
    const owner = await users.save(
      users.create({
        email: `owner-${++userSequence}@example.com`,
        passwordHash: 'not-used-in-this-test',
        refreshTokenHash: null,
        role: 'user',
      }),
    );
    const wallet = await wallets.save(
      wallets.create({ ownerId: owner.id, currency: 'USD', balance }),
    );
    return { owner, wallet };
  }

  it('supports a normal withdrawal', async () => {
    const { owner, wallet } = await createWallet();

    await expect(service.withdraw(wallet.id, owner.id, 25)).resolves.toMatchObject({
      balance: '75.00',
    });
    await expect(wallets.findOneByOrFail({ id: wallet.id })).resolves.toMatchObject({
      balance: '75.00',
    });
  });

  it('rejects a withdrawal that exceeds the available balance', async () => {
    const { owner, wallet } = await createWallet();

    await expect(service.withdraw(wallet.id, owner.id, 101)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(wallets.findOneByOrFail({ id: wallet.id })).resolves.toMatchObject({
      balance: '100.00',
    });
  });

  it('allows only one of two concurrent withdrawals that each require most of the balance', async () => {
    const { owner, wallet } = await createWallet();

    const attempts = await Promise.allSettled([
      service.withdraw(wallet.id, owner.id, 80),
      service.withdraw(wallet.id, owner.id, 80),
    ]);
    const successful = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Wallet> =>
        attempt.status === 'fulfilled',
    );
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    );
    const persisted = await wallets.findOneByOrFail({ id: wallet.id });

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
    expect(successful.length * 80).toBeLessThanOrEqual(100);
    expect(persisted.balance).toBe('20.00');
  });

  it('caps many concurrent withdrawals at the spendable balance', async () => {
    const { owner, wallet } = await createWallet();

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.withdraw(wallet.id, owner.id, 30),
      ),
    );
    const successful = attempts.filter(
      (attempt) => attempt.status === 'fulfilled',
    );
    const persisted = await wallets.findOneByOrFail({ id: wallet.id });
    const successfullyWithdrawn = successful.length * 30;

    expect(successful).toHaveLength(3);
    expect(successfullyWithdrawn).toBeLessThanOrEqual(100);
    expect(Number(persisted.balance)).toBe(100 - successfullyWithdrawn);
    expect(persisted.balance).toBe('10.00');
  });

  it('does not lose concurrent deposits', async () => {
    const { owner, wallet } = await createWallet();

    await Promise.all(
      Array.from({ length: 10 }, () => service.deposit(wallet.id, owner.id, 10)),
    );
    await expect(wallets.findOneByOrFail({ id: wallet.id })).resolves.toMatchObject({
      balance: '200.00',
    });
  });

  it('preserves owner-scoped authorization during withdrawal', async () => {
    const { wallet } = await createWallet();
    const differentUser = await users.save(
      users.create({
        email: 'different-user@example.com',
        passwordHash: 'not-used-in-this-test',
        refreshTokenHash: null,
        role: 'user',
      }),
    );

    await expect(
      service.withdraw(wallet.id, differentUser.id, 10),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(wallets.findOneByOrFail({ id: wallet.id })).resolves.toMatchObject({
      balance: '100.00',
    });
  });
});
