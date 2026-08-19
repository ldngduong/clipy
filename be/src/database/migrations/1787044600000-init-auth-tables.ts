import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAuthTables1787044600000 implements MigrationInterface {
  name = 'InitAuthTables1787044600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" character varying NOT NULL,
        "password_hash" character varying,
        "google_id" character varying,
        "display_name" character varying NOT NULL DEFAULT '',
        "avatar_url" character varying,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_email" UNIQUE ("email"),
        CONSTRAINT "uq_users_google_id" UNIQUE ("google_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_hash" character varying NOT NULL,
        "jti" character varying NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_refresh_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_refresh_tokens_jti" ON "refresh_tokens" ("jti")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}