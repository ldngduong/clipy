import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanColumn1787044600002 implements MigrationInterface {
  name = 'AddPlanColumn1787044600002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "plan" character varying NOT NULL DEFAULT 'free'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "plan"`);
  }
}