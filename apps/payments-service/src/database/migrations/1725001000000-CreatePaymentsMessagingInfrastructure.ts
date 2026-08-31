import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentsMessagingInfrastructure1725001000000
  implements MigrationInterface
{
  name = 'CreatePaymentsMessagingInfrastructure1725001000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(`
      CREATE TABLE integration_outbox (
        event_id uuid PRIMARY KEY,
        routing_key varchar(200) NOT NULL,
        event jsonb NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        available_at timestamptz NOT NULL,
        published_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_payments_outbox_attempts" CHECK (attempts >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_payments_outbox_pending"
      ON integration_outbox (available_at) WHERE published_at IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE processed_messages (
        event_id uuid PRIMARY KEY,
        consumer varchar(150) NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('processed_messages');
    await queryRunner.dropTable('integration_outbox');
  }
}
