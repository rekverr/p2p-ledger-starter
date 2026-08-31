import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ActivityFeedService } from '../src/activity/activity-feed.service';
import { ActivityFeedItem } from '../src/database/entities/activity-feed-item.entity';
import { ProcessedMessage } from '../src/database/entities/processed-message.entity';
import {
  notificationsEntities,
  notificationsMigrations,
} from '../src/database/notifications-database.options';
import { InboxService } from '../src/messaging/inbox.service';
import { IntegrationEventEnvelope } from '../src/messaging/integration-event';

jest.setTimeout(30_000);

describe('notifications durable inbox', () => {
  let dataSource: DataSource;
  let activities: ActivityFeedService;

  beforeAll(async () => {
    const database = process.env.TEST_NOTIFICATIONS_DATABASE_NAME ?? 'notifications_persistence_test';
    if (!database.endsWith('_test')) throw new Error('Tests require a dedicated *_test database');
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.TEST_NOTIFICATIONS_DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.TEST_NOTIFICATIONS_DATABASE_PORT ?? 55434),
      username: process.env.TEST_NOTIFICATIONS_DATABASE_USER ?? 'notifications_test',
      password: process.env.TEST_NOTIFICATIONS_DATABASE_PASSWORD ?? 'notifications_test',
      database,
      entities: notificationsEntities,
      migrations: notificationsMigrations,
      migrationsRun: true,
      synchronize: false,
      dropSchema: true,
    });
    await dataSource.initialize();
    activities = new ActivityFeedService();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE activity_feed, processed_messages');
  });

  function event(): IntegrationEventEnvelope {
    return {
      eventId: randomUUID(),
      eventType: 'ledger.wallet.MoneyDeposited',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: 'ledger-service',
      correlationId: randomUUID(),
      traceId: null,
      aggregate: { type: 'Wallet', id: randomUUID(), version: 2 },
      payload: { ownerId: randomUUID(), amountMinor: '1000' },
    };
  }

  it('persists the dedupe marker and side effect atomically', async () => {
    const inbox = new InboxService(dataSource);
    const message = event();

    await expect(
      inbox.process('notifications.activity-feed.v1', message, () =>
        Promise.reject(new Error('activity write failed')),
      ),
    ).rejects.toThrow('activity write failed');
    await expect(
      dataSource.getRepository(ProcessedMessage).countBy({ eventId: message.eventId }),
    ).resolves.toBe(0);

    await expect(
      inbox.process('notifications.activity-feed.v1', message, (manager, current) =>
        activities.record(manager, current),
      ),
    ).resolves.toBe(true);
  });

  it('ignores duplicate delivery even after the consumer service is recreated', async () => {
    const message = event();
    const firstProcess = new InboxService(dataSource);
    await firstProcess.process(
      'notifications.activity-feed.v1',
      message,
      (manager, current) => activities.record(manager, current),
    );

    const afterRestart = new InboxService(dataSource);
    const duplicateHandler = jest.fn().mockResolvedValue(undefined);
    await expect(
      afterRestart.process(
        'notifications.activity-feed.v1',
        message,
        duplicateHandler,
      ),
    ).resolves.toBe(false);

    expect(duplicateHandler).not.toHaveBeenCalled();
    await expect(
      dataSource.getRepository(ActivityFeedItem).countBy({ eventId: message.eventId }),
    ).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ProcessedMessage).countBy({ eventId: message.eventId }),
    ).resolves.toBe(1);
  });

  it('attributes a transfer completion event to the authenticated sender', async () => {
    const senderUserId = randomUUID();
    const message: IntegrationEventEnvelope = {
      ...event(),
      eventType: 'payments.transfer.Completed',
      producer: 'payments-service',
      aggregate: { type: 'Transfer', id: randomUUID(), version: 5 },
      payload: {
        senderUserId,
        senderWalletId: randomUUID(),
        receiverWalletId: randomUUID(),
        amountMinor: '4000',
        currency: 'USD',
        status: 'Completed',
      },
    };
    await new InboxService(dataSource).process(
      'notifications.activity-feed.v1',
      message,
      (manager, current) => activities.record(manager, current),
    );

    await expect(
      dataSource.getRepository(ActivityFeedItem).findOneByOrFail({
        eventId: message.eventId,
      }),
    ).resolves.toMatchObject({ userId: senderUserId });
  });

  it('contains no ledger or payments persistence tables', async () => {
    const tables = (await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )) as Array<{ tablename: string }>;
    expect(tables.map(({ tablename }) => tablename)).toEqual([
      'activity_feed',
      'migrations',
      'processed_messages',
    ]);
  });
});
