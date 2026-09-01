import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  paymentsEntities,
  paymentsMigrations,
} from '../src/database/payments-database.options';
import { CreateTransferDto } from '../src/transfers/dto/create-transfer.dto';
import { TransferStatus } from '../src/transfers/domain/transfer-status';
import { Transfer } from '../src/transfers/entities/transfer.entity';
import { TransfersService } from '../src/transfers/transfers.service';

jest.setTimeout(30_000);

describe('durable transfer creation and idempotency', () => {
  let dataSource: DataSource;
  let service: TransfersService;
  const senderUserId = randomUUID();
  const dto: CreateTransferDto = {
    fromWalletId: randomUUID(),
    toWalletIdentifier: 'receiver@example.com',
    amount: 10.25,
    currency: 'USD',
  };

  beforeAll(async () => {
    const database = process.env.TEST_PAYMENTS_DATABASE_NAME ?? 'payments_persistence_test';
    if (!database.endsWith('_test')) throw new Error('Tests require a dedicated *_test database');
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
    service = new TransfersService(dataSource.getRepository(Transfer), dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE transfers');
  });

  it('creates the first durable pending transfer', async () => {
    const created = await service.create(dto, 'first-request', senderUserId);

    expect(created).toMatchObject({
      senderUserId,
      senderWalletId: dto.fromWalletId,
      receiverReference: dto.toWalletIdentifier,
      amount: '10.25',
      currency: 'USD',
      status: TransferStatus.Pending,
      idempotencyKey: 'first-request',
      retryCount: 0,
    });
    const stored = await dataSource.getRepository(Transfer).findOneByOrFail({
      id: created.id,
    });
    expect(stored.amountMinor).toBe('1025');
    expect(stored.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).toMatchObject({
      destinationCurrency: 'USD',
      destinationAmountMinor: '1025',
      fxRateNumerator: '1000000',
      fxRateDenominator: '1000000',
    });
  });

  it('persists a deterministic cross-currency quote and includes target currency in idempotency', async () => {
    const created = await service.create(
      { ...dto, amount: 100, targetCurrency: 'EUR' },
      'fx-key',
      senderUserId,
    );
    expect(created).toMatchObject({
      amount: '100.00',
      currency: 'USD',
      destinationAmount: '92.00',
      destinationCurrency: 'EUR',
      fxRate: '0.91996320',
    });
    const stored = await dataSource.getRepository(Transfer).findOneByOrFail({ id: created.id });
    expect(stored.fxQuotedAt).toBeInstanceOf(Date);
    await expect(
      service.create({ ...dto, amount: 100, targetCurrency: 'UAH' }, 'fx-key', senderUserId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the same logical transfer for a sequential duplicate', async () => {
    const first = await service.create(dto, 'sequential-key', senderUserId);
    const repeated = await service.create(dto, 'sequential-key', senderUserId);

    expect(repeated).toEqual(first);
    await expect(dataSource.getRepository(Transfer).count()).resolves.toBe(1);
  });

  it('creates exactly one transfer for concurrent same-key requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.create(dto, 'concurrent-key', senderUserId),
      ),
    );

    expect(new Set(results.map(({ id }) => id))).toEqual(
      new Set([results[0].id]),
    );
    await expect(dataSource.getRepository(Transfer).count()).resolves.toBe(1);
  });

  it('rejects reuse of a key with a conflicting canonical payload', async () => {
    await service.create(dto, 'conflicting-key', senderUserId);

    await expect(
      service.create({ ...dto, amount: 11.25 }, 'conflicting-key', senderUserId),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(dataSource.getRepository(Transfer).count()).resolves.toBe(1);
  });

  it('requires Idempotency-Key', async () => {
    await expect(service.create(dto, undefined, senderUserId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create(dto, '   ', senderUserId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(dataSource.getRepository(Transfer).count()).resolves.toBe(0);
  });

  it('preserves idempotency after the service instance is recreated', async () => {
    const first = await service.create(dto, 'restart-key', senderUserId);
    const restarted = new TransfersService(
      dataSource.getRepository(Transfer),
      dataSource,
    );

    await expect(
      restarted.create(dto, 'restart-key', senderUserId),
    ).resolves.toEqual(first);
    await expect(dataSource.getRepository(Transfer).count()).resolves.toBe(1);
  });

  it('rejects invalid state transitions without changing durable state', async () => {
    const created = await service.create(dto, 'state-key', senderUserId);
    await expect(
      service.transition(created.id, TransferStatus.Validating),
    ).resolves.toMatchObject({ status: TransferStatus.Validating, version: 2 });

    await expect(
      service.transition(created.id, TransferStatus.Completed),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      dataSource.getRepository(Transfer).findOneByOrFail({ id: created.id }),
    ).resolves.toMatchObject({ status: TransferStatus.Validating, version: 2 });
  });

  it('scopes idempotency and reads to the authenticated sender', async () => {
    const first = await service.create(dto, 'shared-key', senderUserId);
    const otherUserId = randomUUID();
    const second = await service.create(dto, 'shared-key', otherUserId);

    expect(second.id).not.toBe(first.id);
    await expect(service.getStatus(first.id, otherUserId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
