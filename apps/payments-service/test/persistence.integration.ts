import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  paymentsEntities,
  paymentsMigrations,
} from '../src/database/payments-database.options';
import { PaymentOutboxMessage } from '../src/database/entities/outbox-message.entity';

jest.setTimeout(30_000);

describe('payments-service persistence boundary', () => {
  let dataSource: DataSource;

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
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('owns only payments messaging persistence and no foreign service tables', async () => {
    const tables = (await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )) as Array<{ tablename: string }>;

    expect(tables.map(({ tablename }) => tablename)).toEqual([
      'integration_outbox',
      'migrations',
      'processed_messages',
    ]);
    expect(paymentsEntities.map(({ name }) => name)).toEqual([
      'PaymentOutboxMessage',
      'PaymentProcessedMessage',
    ]);
  });

  it('rolls an outbox record back with its local transaction', async () => {
    const eventId = randomUUID();
    await expect(
      dataSource.transaction(async (manager) => {
        await manager.getRepository(PaymentOutboxMessage).insert({
          eventId,
          routingKey: 'payments.transfer.created.v1',
          event: { eventId, schemaVersion: 1 },
          attempts: 0,
          availableAt: new Date(),
          publishedAt: null,
        });
        throw new Error('local state write failed');
      }),
    ).rejects.toThrow('local state write failed');

    await expect(
      dataSource.getRepository(PaymentOutboxMessage).findOneBy({ eventId }),
    ).resolves.toBeNull();
  });
});
