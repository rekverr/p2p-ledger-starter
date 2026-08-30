import { MigrationInterface, QueryRunner, TableCheck, TableColumn } from 'typeorm';

export class AddHeldBalanceProjection1725000003000 implements MigrationInterface {
  name = 'AddHeldBalanceProjection1725000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('wallet_balance_projection', [
      new TableColumn({ name: 'held_minor', type: 'bigint', default: '0' }),
      new TableColumn({ name: 'available_minor', type: 'bigint', default: '0' }),
    ]);
    await queryRunner.query(`
      UPDATE wallet_balance_projection SET available_minor = balance_minor
    `);
    await queryRunner.changeColumn(
      'wallet_balance_projection',
      'held_minor',
      new TableColumn({ name: 'held_minor', type: 'bigint' }),
    );
    await queryRunner.changeColumn(
      'wallet_balance_projection',
      'available_minor',
      new TableColumn({ name: 'available_minor', type: 'bigint' }),
    );
    await queryRunner.createCheckConstraint(
      'wallet_balance_projection',
      new TableCheck({
        name: 'CHK_wallet_balance_projection_held_non_negative',
        expression: '"held_minor" >= 0',
      }),
    );
    await queryRunner.createCheckConstraint(
      'wallet_balance_projection',
      new TableCheck({
        name: 'CHK_wallet_balance_projection_available_non_negative',
        expression: '"available_minor" >= 0',
      }),
    );
    await queryRunner.createCheckConstraint(
      'wallet_balance_projection',
      new TableCheck({
        name: 'CHK_wallet_balance_projection_formula',
        expression: '"available_minor" = "balance_minor" - "held_minor"',
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('wallet_balance_projection', 'available_minor');
    await queryRunner.dropColumn('wallet_balance_projection', 'held_minor');
  }
}
