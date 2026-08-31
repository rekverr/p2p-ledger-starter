import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIntegrationOutbox1725000004000 implements MigrationInterface {
  name = 'CreateIntegrationOutbox1725000004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE integration_outbox (
        event_id uuid PRIMARY KEY,
        routing_key varchar(200) NOT NULL,
        event jsonb NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        available_at timestamptz NOT NULL,
        locked_until timestamptz NULL,
        lock_id uuid NULL,
        published_at timestamptz NULL,
        last_error text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_integration_outbox_attempts" CHECK (attempts >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_integration_outbox_pending"
      ON integration_outbox (available_at, published_at)
      WHERE published_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('integration_outbox');
  }
}
