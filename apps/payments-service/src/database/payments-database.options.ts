import { DataSourceOptions } from 'typeorm';
import { PaymentOutboxMessage } from './entities/outbox-message.entity';
import { PaymentProcessedMessage } from './entities/processed-message.entity';
import { CreatePaymentsMessagingInfrastructure1725001000000 } from './migrations/1725001000000-CreatePaymentsMessagingInfrastructure';
import { CreateTransfers1725001001000 } from './migrations/1725001001000-CreateTransfers';
import { Transfer } from '../transfers/entities/transfer.entity';
import { CreateTransferSaga1725001002000 } from './migrations/1725001002000-CreateTransferSaga';
import { CreateSplitBills1725001003000 } from './migrations/1725001003000-CreateSplitBills';
import { SplitBill } from '../split-bills/entities/split-bill.entity';
import { SplitBillShare } from '../split-bills/entities/split-bill-share.entity';
import { SplitBillReminder } from '../split-bills/entities/split-bill-reminder.entity';

export const paymentsEntities = [
  PaymentOutboxMessage,
  PaymentProcessedMessage,
  Transfer,
  SplitBill,
  SplitBillShare,
  SplitBillReminder,
];
export const paymentsMigrations = [
  CreatePaymentsMessagingInfrastructure1725001000000,
  CreateTransfers1725001001000,
  CreateTransferSaga1725001002000,
  CreateSplitBills1725001003000,
];

export function getPaymentsDatabaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.PAYMENTS_DATABASE_HOST,
    port: Number(process.env.PAYMENTS_DATABASE_PORT ?? 5432),
    username: process.env.PAYMENTS_DATABASE_USER,
    password: process.env.PAYMENTS_DATABASE_PASSWORD,
    database: process.env.PAYMENTS_DATABASE_NAME,
    entities: paymentsEntities,
    migrations: paymentsMigrations,
    migrationsRun: true,
    synchronize: false,
  };
}
