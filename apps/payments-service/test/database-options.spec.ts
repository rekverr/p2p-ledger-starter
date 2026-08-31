import { getPaymentsDatabaseOptions } from '../src/database/payments-database.options';

describe('payments database boundary', () => {
  it('uses only payments-owned database configuration', () => {
    process.env.PAYMENTS_DATABASE_HOST = 'payments-db';
    process.env.PAYMENTS_DATABASE_NAME = 'payments';

    expect(getPaymentsDatabaseOptions()).toMatchObject({
      host: 'payments-db',
      database: 'payments',
      synchronize: false,
      migrationsRun: true,
    });
  });
});
