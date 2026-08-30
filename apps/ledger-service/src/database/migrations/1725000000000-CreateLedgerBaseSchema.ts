import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class CreateLedgerBaseSchema1725000000000
  implements MigrationInterface
{
  name = 'CreateLedgerBaseSchema1725000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    if (!(await queryRunner.hasTable('users'))) {
      await queryRunner.createTable(
        new Table({
          name: 'users',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              default: 'gen_random_uuid()',
              primaryKeyConstraintName: 'PK_users',
            },
            { name: 'email', type: 'varchar' },
            { name: 'passwordHash', type: 'varchar' },
            { name: 'refreshTokenHash', type: 'varchar', isNullable: true },
            { name: 'role', type: 'varchar', default: "'user'" },
          ],
          uniques: [
            new TableUnique({ name: 'UQ_users_email', columnNames: ['email'] }),
          ],
        }),
      );
    }

    if (!(await queryRunner.hasTable('wallets'))) {
      await queryRunner.createTable(
        new Table({
          name: 'wallets',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              default: 'gen_random_uuid()',
              primaryKeyConstraintName: 'PK_wallets',
            },
            { name: 'ownerId', type: 'uuid' },
            { name: 'currency', type: 'varchar', default: "'USD'" },
            {
              name: 'balance',
              type: 'numeric',
              precision: 18,
              scale: 2,
              default: '0',
            },
          ],
        }),
      );
      await queryRunner.createForeignKey(
        'wallets',
        new TableForeignKey({
          name: 'FK_wallets_owner',
          columnNames: ['ownerId'],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'NO ACTION',
        }),
      );
      await queryRunner.createIndex(
        'wallets',
        new TableIndex({
          name: 'UQ_wallets_owner_currency',
          columnNames: ['ownerId', 'currency'],
          isUnique: true,
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('wallets')) {
      await queryRunner.dropTable('wallets');
    }
    if (await queryRunner.hasTable('users')) {
      await queryRunner.dropTable('users');
    }
  }
}
