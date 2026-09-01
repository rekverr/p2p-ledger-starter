import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransferFxQuote1725001004000 implements MigrationInterface {
  name = 'AddTransferFxQuote1725001004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE transfers
        ADD COLUMN destination_currency varchar(3),
        ADD COLUMN destination_amount_minor bigint,
        ADD COLUMN fx_rate_numerator bigint,
        ADD COLUMN fx_rate_denominator bigint,
        ADD COLUMN fx_display_rate varchar(40),
        ADD COLUMN fx_quoted_at timestamptz,
        ADD COLUMN fx_expires_at timestamptz
    `);
    await queryRunner.query(`
      UPDATE transfers SET
        destination_currency = currency,
        destination_amount_minor = amount_minor,
        fx_rate_numerator = 1,
        fx_rate_denominator = 1,
        fx_display_rate = '1.00000000',
        fx_quoted_at = created_at,
        fx_expires_at = created_at + interval '100 years'
    `);
    await queryRunner.query(`
      ALTER TABLE transfers
        ALTER COLUMN destination_currency SET NOT NULL,
        ALTER COLUMN destination_amount_minor SET NOT NULL,
        ALTER COLUMN fx_rate_numerator SET NOT NULL,
        ALTER COLUMN fx_rate_denominator SET NOT NULL,
        ALTER COLUMN fx_display_rate SET NOT NULL,
        ALTER COLUMN fx_quoted_at SET NOT NULL,
        ALTER COLUMN fx_expires_at SET NOT NULL,
        ADD CONSTRAINT "CHK_transfers_destination_amount_positive"
          CHECK (destination_amount_minor > 0),
        ADD CONSTRAINT "CHK_transfers_fx_rate_positive"
          CHECK (fx_rate_numerator > 0 AND fx_rate_denominator > 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE transfers
        DROP CONSTRAINT "CHK_transfers_fx_rate_positive",
        DROP CONSTRAINT "CHK_transfers_destination_amount_positive",
        DROP COLUMN fx_expires_at,
        DROP COLUMN fx_quoted_at,
        DROP COLUMN fx_display_rate,
        DROP COLUMN fx_rate_denominator,
        DROP COLUMN fx_rate_numerator,
        DROP COLUMN destination_amount_minor,
        DROP COLUMN destination_currency
    `);
  }
}
