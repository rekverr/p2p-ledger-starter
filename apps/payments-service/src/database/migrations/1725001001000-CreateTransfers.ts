import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransfers1725001001000 implements MigrationInterface {
  name = 'CreateTransfers1725001001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE transfers (
        id uuid PRIMARY KEY,
        sender_user_id uuid NOT NULL,
        sender_wallet_id uuid NOT NULL,
        receiver_reference varchar(320) NOT NULL,
        amount_minor bigint NOT NULL,
        currency varchar(3) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'Pending',
        idempotency_key varchar(200) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        failure_code varchar(100) NULL,
        failure_message text NULL,
        retry_count integer NOT NULL DEFAULT 0,
        next_retry_at timestamptz NULL,
        version integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_transfers_sender_idempotency"
          UNIQUE (sender_user_id, idempotency_key),
        CONSTRAINT "CHK_transfers_amount_positive" CHECK (amount_minor > 0),
        CONSTRAINT "CHK_transfers_retry_count" CHECK (retry_count >= 0),
        CONSTRAINT "CHK_transfers_status" CHECK (
          status IN (
            'Pending', 'Validating', 'FundsHeld', 'Processing',
            'Completed', 'Compensating', 'Failed'
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_transfers_sender_created"
      ON transfers (sender_user_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_transfers_status_retry"
      ON transfers (status, next_retry_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('transfers');
  }
}
