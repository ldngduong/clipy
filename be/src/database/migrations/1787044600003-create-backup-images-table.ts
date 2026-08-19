import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBackupImagesTable1787044600003 implements MigrationInterface {
  name = 'CreateBackupImagesTable1787044600003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "backup_images" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "sha256" character varying NOT NULL,
        "object_key" character varying NOT NULL,
        "size_bytes" bigint NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_backup_images_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_backup_images_user_sha" ON "backup_images" ("user_id", "sha256")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_backup_images_object_key" ON "backup_images" ("object_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "backup_images"`);
  }
}