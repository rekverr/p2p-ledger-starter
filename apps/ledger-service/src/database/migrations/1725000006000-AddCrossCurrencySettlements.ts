import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCrossCurrencySettlements1725000006000
  implements MigrationInterface
{
  name = 'AddCrossCurrencySettlements1725000006000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ledger_transfer_settlements
        ADD COLUMN destination_amount_minor bigint,
        ADD COLUMN destination_currency varchar(3)
    `);
    await queryRunner.query(`
      UPDATE ledger_transfer_settlements SET
        destination_amount_minor = amount_minor,
        destination_currency = currency
    `);
    await queryRunner.query(`
      ALTER TABLE ledger_transfer_settlements
        ALTER COLUMN destination_amount_minor SET NOT NULL,
        ALTER COLUMN destination_currency SET NOT NULL,
        ADD CONSTRAINT "CHK_ledger_transfer_destination_amount"
          CHECK (destination_amount_minor > 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ledger_transfer_settlements
        DROP CONSTRAINT "CHK_ledger_transfer_destination_amount",
        DROP COLUMN destination_currency,
        DROP COLUMN destination_amount_minor
    `);
  }
}
