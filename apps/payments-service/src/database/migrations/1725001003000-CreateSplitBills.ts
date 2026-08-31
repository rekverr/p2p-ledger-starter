import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSplitBills1725001003000 implements MigrationInterface {
  name = 'CreateSplitBills1725001003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE split_bills (
        id uuid PRIMARY KEY,
        creator_user_id uuid NOT NULL,
        creator_reference varchar(320) NOT NULL,
        total_minor bigint NOT NULL,
        currency varchar(3) NOT NULL,
        deadline timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_split_bills_total_positive" CHECK (total_minor > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_split_bills_creator_created"
      ON split_bills (creator_user_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_split_bills_deadline"
      ON split_bills (deadline) WHERE deadline IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE split_bill_shares (
        id uuid PRIMARY KEY,
        bill_id uuid NOT NULL,
        participant_user_id uuid NOT NULL,
        amount_minor bigint NOT NULL,
        position integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_split_bill_shares_amount_positive" CHECK (amount_minor > 0),
        CONSTRAINT "CHK_split_bill_shares_position" CHECK (position >= 0),
        CONSTRAINT "UQ_split_bill_participant" UNIQUE (bill_id, participant_user_id),
        CONSTRAINT "UQ_split_bill_share_position" UNIQUE (bill_id, position),
        CONSTRAINT "FK_split_bill_shares_bill"
          FOREIGN KEY (bill_id) REFERENCES split_bills(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_split_bill_shares_participant"
      ON split_bill_shares (participant_user_id, created_at)
    `);
    await queryRunner.query(`
      ALTER TABLE transfers
        ADD COLUMN split_bill_share_id uuid NULL,
        ADD CONSTRAINT "UQ_transfers_split_bill_share" UNIQUE (split_bill_share_id),
        ADD CONSTRAINT "FK_transfers_split_bill_share"
          FOREIGN KEY (split_bill_share_id) REFERENCES split_bill_shares(id)
          ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE TABLE split_bill_reminders (
        id uuid PRIMARY KEY,
        share_id uuid NOT NULL,
        kind varchar(30) NOT NULL,
        event_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_split_bill_reminder_share_kind" UNIQUE (share_id, kind),
        CONSTRAINT "UQ_split_bill_reminder_event" UNIQUE (event_id),
        CONSTRAINT "FK_split_bill_reminders_share"
          FOREIGN KEY (share_id) REFERENCES split_bill_shares(id) ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE split_bill_reminders');
    await queryRunner.query(`
      ALTER TABLE transfers
        DROP CONSTRAINT "FK_transfers_split_bill_share",
        DROP CONSTRAINT "UQ_transfers_split_bill_share",
        DROP COLUMN split_bill_share_id
    `);
    await queryRunner.query('DROP TABLE split_bill_shares');
    await queryRunner.query('DROP TABLE split_bills');
  }
}
