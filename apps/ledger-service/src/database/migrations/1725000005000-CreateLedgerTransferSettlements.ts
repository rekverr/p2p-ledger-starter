import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLedgerTransferSettlements1725000005000
  implements MigrationInterface
{
  name = 'CreateLedgerTransferSettlements1725000005000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ledger_transfer_settlements (
        transfer_id uuid PRIMARY KEY,
        sender_wallet_id uuid NOT NULL,
        receiver_wallet_id uuid NOT NULL,
        amount_minor bigint NOT NULL,
        currency varchar(3) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ledger_transfer_settlements_sender"
          FOREIGN KEY (sender_wallet_id) REFERENCES wallets(id),
        CONSTRAINT "FK_ledger_transfer_settlements_receiver"
          FOREIGN KEY (receiver_wallet_id) REFERENCES wallets(id),
        CONSTRAINT "CHK_ledger_transfer_settlements_amount"
          CHECK (amount_minor > 0),
        CONSTRAINT "CHK_ledger_transfer_settlements_distinct_wallets"
          CHECK (sender_wallet_id <> receiver_wallet_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_ledger_transfer_settlements_wallets"
      ON ledger_transfer_settlements (sender_wallet_id, receiver_wallet_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ledger_transfer_settlements');
  }
}
