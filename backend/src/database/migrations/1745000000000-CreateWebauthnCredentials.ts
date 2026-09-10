import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebauthnCredentials1745000000000 implements MigrationInterface {
    name = 'CreateWebauthnCredentials1745000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // gen_random_uuid() is built into Postgres 13+ — no extension needed.
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
                "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                "client_id" integer NOT NULL,
                "credential_id" text NOT NULL,
                "public_key" text NOT NULL,
                "counter" bigint NOT NULL DEFAULT 0,
                "transports" character varying(128),
                "device_label" character varying(120),
                "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "last_used_at" TIMESTAMPTZ,
                CONSTRAINT "fk_webauthn_credentials_client"
                    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE
            );
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "uq_webauthn_credentials_credential_id"
            ON "webauthn_credentials" ("credential_id");
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_webauthn_credentials_client_id"
            ON "webauthn_credentials" ("client_id");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_webauthn_credentials_client_id";`);
        await queryRunner.query(`DROP INDEX IF EXISTS "uq_webauthn_credentials_credential_id";`);
        await queryRunner.query(`DROP TABLE IF EXISTS "webauthn_credentials";`);
    }
}
