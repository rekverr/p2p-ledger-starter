import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexActivityFeedQueries1725002001000
  implements MigrationInterface
{
  name = 'IndexActivityFeedQueries1725002001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_activity_feed_user_type_created"
      ON activity_feed (user_id, event_type, created_at, id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'activity_feed',
      'IDX_activity_feed_user_type_created',
    );
  }
}
