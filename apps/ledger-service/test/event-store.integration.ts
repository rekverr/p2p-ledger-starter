import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { ledgerEntities, ledgerMigrations } from '../src/database/ledger-database.options';
import { StoredEvent } from '../src/event-store/entities/stored-event.entity';
import {
  DuplicateEventIdError,
  ExpectedStreamVersionError,
} from '../src/event-store/event-store.errors';
import { EventStoreService } from '../src/event-store/event-store.service';
import { EventData, JsonObject } from '../src/event-store/event-store.types';

jest.setTimeout(30_000);

describe('PostgreSQL EventStore', () => {
  let dataSource: DataSource;
  let eventRepository: Repository<StoredEvent>;
  let eventStore: EventStoreService;

  beforeAll(async () => {
    const database = process.env.TEST_DATABASE_NAME ?? 'ledger_concurrency_test';
    if (!database.endsWith('_test')) {
      throw new Error('Event Store tests require a dedicated *_test database');
    }

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
    eventRepository = dataSource.getRepository(StoredEvent);
    eventStore = new EventStoreService(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await eventRepository.query('TRUNCATE TABLE ledger_events');
  });

  function event(
    eventType: string,
    payload: JsonObject,
    eventId = randomUUID(),
  ): EventData {
    return {
      eventId,
      eventType,
      schemaVersion: 1,
      payload,
      metadata: { source: 'event-store-integration-test' },
      correlationId: 'correlation-123',
      traceId: 'trace-123',
    };
  }

  it('runs the checked-in schema migrations', async () => {
    const migrations = (await dataSource.query(
      'SELECT name FROM migrations ORDER BY id ASC',
    )) as Array<{ name: string }>;

    expect(migrations.map(({ name }) => name)).toEqual([
      'CreateLedgerBaseSchema1725000000000',
      'CreateLedgerEvents1725000001000',
      'EventSourceWalletBalances1725000002000',
      'AddHeldBalanceProjection1725000003000',
      'CreateIntegrationOutbox1725000004000',
    ]);
  });

  it('appends the first event at stream version 1', async () => {
    const streamId = randomUUID();

    const appended = await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [event('WalletOpened', { currency: 'USD' })],
    });

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      streamId,
      aggregateType: 'Wallet',
      eventType: 'WalletOpened',
      schemaVersion: 1,
      streamVersion: 1,
      payload: { currency: 'USD' },
      metadata: { source: 'event-store-integration-test' },
      correlationId: 'correlation-123',
      traceId: 'trace-123',
    });
    expect(appended[0].createdAt).toBeInstanceOf(Date);
  });

  it('loads a stream ordered by stream version', async () => {
    const streamId = randomUUID();
    await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [
        event('WalletOpened', { ordinal: 1 }),
        event('MoneyDeposited', { ordinal: 2 }),
        event('MoneyWithdrawn', { ordinal: 3 }),
      ],
    });

    const loaded = await eventStore.loadStream(streamId);

    expect(loaded.map(({ streamVersion }) => streamVersion)).toEqual([1, 2, 3]);
    expect(loaded.map(({ eventType }) => eventType)).toEqual([
      'WalletOpened',
      'MoneyDeposited',
      'MoneyWithdrawn',
    ]);
  });

  it('appends at the next expected stream version', async () => {
    const streamId = randomUUID();
    await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [event('WalletOpened', { currency: 'USD' })],
    });

    const appended = await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 1,
      events: [event('MoneyDeposited', { amount: '25.00' })],
    });

    expect(appended[0].streamVersion).toBe(2);
    await expect(eventStore.loadStream(streamId)).resolves.toHaveLength(2);
  });

  it('rejects a globally duplicate event ID and rolls back the whole batch', async () => {
    const duplicateEventId = randomUUID();
    await eventStore.append({
      streamId: randomUUID(),
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [event('WalletOpened', { currency: 'USD' }, duplicateEventId)],
    });
    const secondStreamId = randomUUID();

    await expect(
      eventStore.append({
        streamId: secondStreamId,
        aggregateType: 'Wallet',
        expectedVersion: 0,
        events: [
          event('WalletOpened', { currency: 'EUR' }),
          event('MoneyDeposited', { amount: '10.00' }, duplicateEventId),
        ],
      }),
    ).rejects.toBeInstanceOf(DuplicateEventIdError);
    await expect(eventStore.loadStream(secondStreamId)).resolves.toEqual([]);
  });

  it('rejects a stale expected stream version', async () => {
    const streamId = randomUUID();
    await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [event('WalletOpened', { currency: 'USD' })],
    });

    await expect(
      eventStore.append({
        streamId,
        aggregateType: 'Wallet',
        expectedVersion: 0,
        events: [event('MoneyDeposited', { amount: '10.00' })],
      }),
    ).rejects.toMatchObject({
      name: ExpectedStreamVersionError.name,
      expectedVersion: 0,
      actualVersion: 1,
    });
    await expect(eventStore.loadStream(streamId)).resolves.toHaveLength(1);
  });

  it('enforces unique stream version at the database boundary', async () => {
    const streamId = randomUUID();
    await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [event('WalletOpened', { currency: 'USD' })],
    });

    await expect(
      eventRepository.insert(
        eventRepository.create({
          eventId: randomUUID(),
          streamId,
          aggregateType: 'Wallet',
          eventType: 'MoneyDeposited',
          schemaVersion: 1,
          streamVersion: 1,
          payload: { amount: '10.00' },
          metadata: {},
          correlationId: null,
          traceId: null,
        }),
      ),
    ).rejects.toMatchObject({
      driverError: expect.objectContaining({
        constraint: 'UQ_ledger_events_stream_version',
      }),
    });
    await expect(eventStore.loadStream(streamId)).resolves.toHaveLength(1);
  });

  it('allows only one concurrent append for the same expected version', async () => {
    const streamId = randomUUID();
    await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [event('WalletOpened', { currency: 'USD' })],
    });

    const attempts = await Promise.allSettled([
      eventStore.append({
        streamId,
        aggregateType: 'Wallet',
        expectedVersion: 1,
        events: [event('MoneyDeposited', { command: 'A', amount: '10.00' })],
      }),
      eventStore.append({
        streamId,
        aggregateType: 'Wallet',
        expectedVersion: 1,
        events: [event('MoneyDeposited', { command: 'B', amount: '20.00' })],
      }),
    ]);
    const fulfilled = attempts.filter(({ status }) => status === 'fulfilled');
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ExpectedStreamVersionError);
    await expect(eventStore.loadStream(streamId)).resolves.toHaveLength(2);
  });

  it('replays persisted payload without losing its shape or schema version', async () => {
    const streamId = randomUUID();
    await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [
        event('WalletOpened', { currency: 'USD', labels: ['primary', 'cash'] }),
        {
          ...event('MoneyDeposited', {
            amount: '12.34',
            details: { method: 'bank', confirmed: true },
          }),
          schemaVersion: 2,
        },
      ],
    });

    const replayed = await eventStore.replay(
      streamId,
      { types: [] as string[], payloads: [] as unknown[], schemaVersions: [] as number[] },
      (state, storedEvent) => ({
        types: [...state.types, storedEvent.eventType],
        payloads: [...state.payloads, storedEvent.payload],
        schemaVersions: [...state.schemaVersions, storedEvent.schemaVersion],
      }),
    );

    expect(replayed).toEqual({
      types: ['WalletOpened', 'MoneyDeposited'],
      payloads: [
        { currency: 'USD', labels: ['primary', 'cash'] },
        {
          amount: '12.34',
          details: { method: 'bank', confirmed: true },
        },
      ],
      schemaVersions: [1, 2],
    });
  });

  it('does not mutate historical events when appending', async () => {
    const streamId = randomUUID();
    const [historical] = await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [event('WalletOpened', { currency: 'USD' })],
    });
    const snapshot = {
      ...historical,
      payload: structuredClone(historical.payload),
      metadata: structuredClone(historical.metadata),
    };

    await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 1,
      events: [event('MoneyDeposited', { amount: '5.00' })],
    });
    const [reloaded] = await eventStore.loadStream(streamId);

    expect(reloaded).toEqual(snapshot);
  });

  it('rejects direct UPDATE and DELETE attempts at the database boundary', async () => {
    const streamId = randomUUID();
    const [stored] = await eventStore.append({
      streamId,
      aggregateType: 'Wallet',
      expectedVersion: 0,
      events: [event('WalletOpened', { currency: 'USD' })],
    });

    await expect(
      eventRepository.update({ eventId: stored.eventId }, { eventType: 'Changed' }),
    ).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: '55000' }),
    });
    await expect(
      eventRepository.delete({ eventId: stored.eventId }),
    ).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: '55000' }),
    });
    await expect(eventStore.loadStream(streamId)).resolves.toMatchObject([
      { eventType: 'WalletOpened', streamVersion: 1 },
    ]);
  });
});
