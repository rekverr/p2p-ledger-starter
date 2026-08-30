import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class CreateLedgerEvents1725000001000 implements MigrationInterface {
  name = 'CreateLedgerEvents1725000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('ledger_events'))) {
      await queryRunner.createTable(
        new Table({
          name: 'ledger_events',
          columns: [
            {
              name: 'event_id',
              type: 'uuid',
              isPrimary: true,
              primaryKeyConstraintName: 'PK_ledger_events',
            },
            { name: 'stream_id', type: 'uuid' },
            { name: 'aggregate_type', type: 'varchar', length: '100' },
            { name: 'event_type', type: 'varchar', length: '150' },
            { name: 'schema_version', type: 'integer' },
            { name: 'stream_version', type: 'integer' },
            { name: 'payload', type: 'jsonb' },
            { name: 'metadata', type: 'jsonb' },
            {
              name: 'correlation_id',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            {
              name: 'trace_id',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            {
              name: 'created_at',
              type: 'timestamptz',
              default: 'now()',
            },
          ],
          uniques: [
            new TableUnique({
              name: 'UQ_ledger_events_stream_version',
              columnNames: ['stream_id', 'stream_version'],
            }),
          ],
          checks: [
            new TableCheck({
              name: 'CHK_ledger_events_stream_version',
              expression: '"stream_version" > 0',
            }),
            new TableCheck({
              name: 'CHK_ledger_events_schema_version',
              expression: '"schema_version" > 0',
            }),
          ],
        }),
      );
      await queryRunner.createIndex(
        'ledger_events',
        new TableIndex({
          name: 'IDX_ledger_events_type_created_at',
          columnNames: ['event_type', 'created_at'],
        }),
      );
    }

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_ledger_event_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ledger_events is append-only'
          USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS ledger_events_append_only ON ledger_events
    `);
    await queryRunner.query(`
      CREATE TRIGGER ledger_events_append_only
      BEFORE UPDATE OR DELETE ON ledger_events
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_event_mutation()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('ledger_events')) {
      await queryRunner.query(`
        DROP TRIGGER IF EXISTS ledger_events_append_only ON ledger_events
      `);
      await queryRunner.dropTable('ledger_events');
    }
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS reject_ledger_event_mutation()',
    );
  }
}
