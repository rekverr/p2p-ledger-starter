import { DataSourceOptions } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { CreateLedgerBaseSchema1725000000000 } from './migrations/1725000000000-CreateLedgerBaseSchema';
import { CreateLedgerEvents1725000001000 } from './migrations/1725000001000-CreateLedgerEvents';
import { EventSourceWalletBalances1725000002000 } from './migrations/1725000002000-EventSourceWalletBalances';
import { AddHeldBalanceProjection1725000003000 } from './migrations/1725000003000-AddHeldBalanceProjection';
import { CreateIntegrationOutbox1725000004000 } from './migrations/1725000004000-CreateIntegrationOutbox';
import { StoredEvent } from '../event-store/entities/stored-event.entity';
import { OutboxMessage } from '../messaging/entities/outbox-message.entity';
import { WalletBalanceProjection } from '../wallets/entities/wallet-balance-projection.entity';
import { Wallet } from '../wallets/entities/wallet.entity';

export const ledgerEntities = [
  User,
  Wallet,
  StoredEvent,
  WalletBalanceProjection,
  OutboxMessage,
];
export const ledgerMigrations = [
  CreateLedgerBaseSchema1725000000000,
  CreateLedgerEvents1725000001000,
  EventSourceWalletBalances1725000002000,
  AddHeldBalanceProjection1725000003000,
  CreateIntegrationOutbox1725000004000,
];

export function getLedgerDatabaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    entities: ledgerEntities,
    migrations: ledgerMigrations,
    migrationsRun: true,
    synchronize: false,
  };
}
