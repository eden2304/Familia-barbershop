import { MigrationInterface, QueryRunner } from 'typeorm';

// Personal login PIN on the client record. Idempotent: ClientPinService also ensures
// these columns on startup, so running this after that (or twice) is a no-op.
export class AddClientPin1748000000000 implements MigrationInterface {
    name = 'AddClientPin1748000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "clients"
                ADD COLUMN IF NOT EXISTS "pin_hash" text NULL,
                ADD COLUMN IF NOT EXISTS "pin_length" smallint NULL,
                ADD COLUMN IF NOT EXISTS "pin_failed_attempts" integer NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS "pin_locked_until" TIMESTAMPTZ NULL,
                ADD COLUMN IF NOT EXISTS "pin_updated_at" TIMESTAMPTZ NULL;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "clients"
                DROP COLUMN IF EXISTS "pin_updated_at",
                DROP COLUMN IF EXISTS "pin_locked_until",
                DROP COLUMN IF EXISTS "pin_failed_attempts",
                DROP COLUMN IF EXISTS "pin_length",
                DROP COLUMN IF EXISTS "pin_hash";
        `);
    }
}
