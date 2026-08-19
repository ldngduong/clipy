import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
} from 'typeorm';

export class CreatePaddleTables1787044600004 implements MigrationInterface {
  name = 'CreatePaddleTables1787044600004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'paddle_customers',
        columns: [
          {
            name: 'customer_id',
            type: 'varchar',
            isPrimary: true,
          },
          {
            name: 'email',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'paddle_customers',
      new TableIndex({
        name: 'idx_paddle_customers_email',
        columnNames: ['email'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'paddle_subscriptions',
        columns: [
          {
            name: 'subscription_id',
            type: 'varchar',
            isPrimary: true,
          },
          {
            name: 'customer_id',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'price_id',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'product_id',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'scheduled_change',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'paddle_subscriptions',
      new TableIndex({
        name: 'idx_paddle_subscriptions_customer',
        columnNames: ['customer_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('paddle_subscriptions', true);
    await queryRunner.dropTable('paddle_customers', true);
  }
}