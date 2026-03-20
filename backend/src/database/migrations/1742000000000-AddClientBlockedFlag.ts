import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientBlockedFlag1742000000000 implements MigrationInterface {
    name = 'AddClientBlockedFlag1742000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "clients"
            ADD COLUMN IF NOT EXISTS "is_blocked" boolean NOT NULL DEFAULT false
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "clients"
            DROP COLUMN IF EXISTS "is_blocked"
        `);
    }
}
