import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableForeignKey,
} from 'typeorm';

export class EventSourceWalletBalances1725000002000
  implements MigrationInterface
{
  name = 'EventSourceWalletBalances1725000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('wallet_balance_projection'))) {
      await queryRunner.createTable(
        new Table({
          name: 'wallet_balance_projection',
          columns: [
            { name: 'wallet_id', type: 'uuid', isPrimary: true },
            { name: 'balance_minor', type: 'bigint' },
            { name: 'stream_version', type: 'integer' },
            { name: 'updated_at', type: 'timestamptz', default: 'now()' },
          ],
          checks: [
            new TableCheck({
              name: 'CHK_wallet_balance_projection_non_negative',
              expression: '"balance_minor" >= 0',
            }),
            new TableCheck({
              name: 'CHK_wallet_balance_projection_stream_version',
              expression: '"stream_version" > 0',
            }),
          ],
        }),
      );
      await queryRunner.createForeignKey(
        'wallet_balance_projection',
        new TableForeignKey({
          name: 'FK_wallet_balance_projection_wallet',
          columnNames: ['wallet_id'],
          referencedTableName: 'wallets',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }

    if (await queryRunner.hasColumn('wallets', 'balance')) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM wallets WHERE balance < 0) THEN
            RAISE EXCEPTION 'Cannot migrate a wallet with negative legacy balance';
          END IF;
        END $$
      `);
      await queryRunner.query(`
        INSERT INTO ledger_events (
          event_id, stream_id, aggregate_type, event_type, schema_version,
          stream_version, payload, metadata, correlation_id, trace_id
        )
        SELECT
          gen_random_uuid(), w.id, 'Wallet', 'WalletCreated', 1, 1,
          jsonb_build_object('ownerId', w."ownerId", 'currency', w.currency),
          jsonb_build_object('source', 'legacy-balance-migration'), NULL, NULL
        FROM wallets w
        WHERE NOT EXISTS (
          SELECT 1 FROM ledger_events e WHERE e.stream_id = w.id
        )
      `);
      await queryRunner.query(`
        INSERT INTO ledger_events (
          event_id, stream_id, aggregate_type, event_type, schema_version,
          stream_version, payload, metadata, correlation_id, trace_id
        )
        SELECT
          gen_random_uuid(), w.id, 'Wallet', 'MoneyDeposited', 1, 2,
          jsonb_build_object(
            'transactionId', gen_random_uuid(),
            'postings', jsonb_build_array(
              jsonb_build_object(
                'accountId', 'wallet:' || w.id,
                'amountMinor', (round(w.balance * 100)::bigint)::text
              ),
              jsonb_build_object(
                'accountId', 'system:external',
                'amountMinor', (-round(w.balance * 100)::bigint)::text
              )
            )
          ),
          jsonb_build_object('source', 'legacy-balance-migration'), NULL, NULL
        FROM wallets w
        WHERE w.balance > 0
          AND (SELECT count(*) FROM ledger_events e WHERE e.stream_id = w.id) = 1
          AND EXISTS (
            SELECT 1 FROM ledger_events e
            WHERE e.stream_id = w.id
              AND e.event_type = 'WalletCreated'
              AND e.metadata->>'source' = 'legacy-balance-migration'
          )
      `);
    }

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM ledger_events e
          JOIN wallets w ON w.id = e.stream_id
          WHERE e.aggregate_type <> 'Wallet'
             OR e.event_type NOT IN (
               'WalletCreated', 'MoneyDeposited', 'WithdrawalCompleted'
             )
        ) THEN
          RAISE EXCEPTION 'Unsupported existing event in a wallet stream';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT e.event_id
          FROM ledger_events e
          JOIN wallets w ON w.id = e.stream_id
          CROSS JOIN LATERAL jsonb_array_elements(e.payload->'postings') posting
          WHERE e.event_type IN ('MoneyDeposited', 'WithdrawalCompleted')
          GROUP BY e.event_id
          HAVING count(*) < 2
             OR sum((posting->>'amountMinor')::bigint) <> 0
        ) THEN
          RAISE EXCEPTION 'Existing wallet event contains unbalanced postings';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      INSERT INTO wallet_balance_projection (
        wallet_id, balance_minor, stream_version, updated_at
      )
      SELECT
        w.id,
        COALESCE((
          SELECT sum((posting->>'amountMinor')::bigint)
          FROM ledger_events e
          CROSS JOIN LATERAL jsonb_array_elements(e.payload->'postings') posting
          WHERE e.stream_id = w.id
            AND e.event_type IN ('MoneyDeposited', 'WithdrawalCompleted')
            AND posting->>'accountId' = 'wallet:' || w.id
        ), 0),
        (SELECT max(e.stream_version) FROM ledger_events e WHERE e.stream_id = w.id),
        now()
      FROM wallets w
      ON CONFLICT (wallet_id) DO UPDATE SET
        balance_minor = EXCLUDED.balance_minor,
        stream_version = EXCLUDED.stream_version,
        updated_at = EXCLUDED.updated_at
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM wallet_balance_projection WHERE balance_minor < 0
        ) THEN
          RAISE EXCEPTION 'Migrated events produce a negative wallet balance';
        END IF;
      END $$
    `);

    if (await queryRunner.hasColumn('wallets', 'balance')) {
      await queryRunner.dropColumn('wallets', 'balance');
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('wallets', 'balance'))) {
      await queryRunner.query(
        'ALTER TABLE wallets ADD COLUMN balance numeric(18,2) NOT NULL DEFAULT 0',
      );
      await queryRunner.query(`
        UPDATE wallets w
        SET balance = p.balance_minor::numeric / 100
        FROM wallet_balance_projection p
        WHERE p.wallet_id = w.id
      `);
    }
    if (await queryRunner.hasTable('wallet_balance_projection')) {
      await queryRunner.dropTable('wallet_balance_projection');
    }
  }
}
