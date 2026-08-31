import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationsPersistence1725002000000
  implements MigrationInterface
{
  name = 'CreateNotificationsPersistence1725002000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(`
      CREATE TABLE processed_messages (
        event_id uuid PRIMARY KEY,
        consumer varchar(150) NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE activity_feed (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL UNIQUE,
        user_id uuid NULL,
        event_type varchar(200) NOT NULL,
        aggregate_id varchar(100) NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_activity_feed_user_created"
      ON activity_feed (user_id, created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('activity_feed');
    await queryRunner.dropTable('processed_messages');
  }
}
