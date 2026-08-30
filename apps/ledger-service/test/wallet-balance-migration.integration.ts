import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ledgerEntities, ledgerMigrations } from '../src/database/ledger-database.options';

jest.setTimeout(30_000);

describe('legacy wallet balance migration', () => {
  let dataSource: DataSource;

  function options(migrations: typeof ledgerMigrations, dropSchema: boolean) {
    return {
      type: 'postgres' as const,
      host: process.env.TEST_DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.TEST_DATABASE_PORT ?? 55432),
      username: process.env.TEST_DATABASE_USER ?? 'ledger_test',
      password: process.env.TEST_DATABASE_PASSWORD ?? 'ledger_test',
      database: process.env.TEST_DATABASE_NAME ?? 'ledger_concurrency_test',
      entities: ledgerEntities,
      migrations,
      migrationsRun: true,
      synchronize: false,
      dropSchema,
    };
  }

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('converts legacy balance to immutable balanced events and projection', async () => {
    const database = process.env.TEST_DATABASE_NAME ?? 'ledger_concurrency_test';
    if (!database.endsWith('_test')) throw new Error('Tests require a dedicated *_test database');

    dataSource = new DataSource(options(ledgerMigrations.slice(0, 2), true));
    await dataSource.initialize();
    const userId = randomUUID();
    const walletId = randomUUID();
    await dataSource.query(
      'INSERT INTO users (id, email, "passwordHash", role) VALUES ($1, $2, $3, $4)',
      [userId, 'legacy@example.com', 'not-used', 'user'],
    );
    await dataSource.query(
      'INSERT INTO wallets (id, "ownerId", currency, balance) VALUES ($1, $2, $3, $4)',
      [walletId, userId, 'USD', '42.35'],
    );
    await dataSource.destroy();

    dataSource = new DataSource(options(ledgerMigrations, false));
    await dataSource.initialize();

    const columns = (await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'wallets'`,
    )) as Array<{ column_name: string }>;
    const events = (await dataSource.query(
      'SELECT event_type, stream_version, payload FROM ledger_events WHERE stream_id = $1 ORDER BY stream_version',
      [walletId],
    )) as Array<{ event_type: string; stream_version: number; payload: { postings?: Array<{ amountMinor: string }> } }>;
    const [projection] = (await dataSource.query(
      `SELECT balance_minor, held_minor, available_minor, stream_version
       FROM wallet_balance_projection WHERE wallet_id = $1`,
      [walletId],
    )) as Array<{
      balance_minor: string;
      held_minor: string;
      available_minor: string;
      stream_version: number;
    }>;

    expect(columns.map(({ column_name }) => column_name)).not.toContain('balance');
    expect(events.map(({ event_type }) => event_type)).toEqual(['WalletCreated', 'MoneyDeposited']);
    expect(events[1].payload.postings?.map(({ amountMinor }) => amountMinor)).toEqual(['4235', '-4235']);
    expect(projection).toEqual({
      balance_minor: '4235',
      held_minor: '0',
      available_minor: '4235',
      stream_version: 2,
    });
  });
});
