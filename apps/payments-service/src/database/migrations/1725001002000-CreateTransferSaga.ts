import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransferSaga1725001002000 implements MigrationInterface {
  name = 'CreateTransferSaga1725001002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE transfers
        ADD COLUMN receiver_wallet_id uuid NULL,
        ADD COLUMN hold_may_exist boolean NOT NULL DEFAULT false,
        ADD COLUMN last_attempt_at timestamptz NULL,
        ADD COLUMN lease_owner uuid NULL,
        ADD COLUMN lease_until timestamptz NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_transfers_recovery"
      ON transfers (next_retry_at, lease_until)
      WHERE status NOT IN ('Completed', 'Failed')
    `);
    await queryRunner.query(`
      ALTER TABLE integration_outbox
        ADD COLUMN locked_until timestamptz NULL,
        ADD COLUMN lock_id uuid NULL,
        ADD COLUMN last_error text NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE integration_outbox
        DROP COLUMN last_error,
        DROP COLUMN lock_id,
        DROP COLUMN locked_until
    `);
    await queryRunner.dropIndex('transfers', 'IDX_transfers_recovery');
    await queryRunner.query(`
      ALTER TABLE transfers
        DROP COLUMN lease_until,
        DROP COLUMN lease_owner,
        DROP COLUMN last_attempt_at,
        DROP COLUMN hold_may_exist,
        DROP COLUMN receiver_wallet_id
    `);
  }
}
