import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceRequiredClientNames1726221100000 implements MigrationInterface {
    name = 'EnforceRequiredClientNames1726221100000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    ALTER TABLE "clients" ALTER COLUMN "first_name" DROP DEFAULT;
    ALTER TABLE "clients" ALTER COLUMN "last_name" DROP DEFAULT;

    UPDATE "clients" SET "first_name" = '' WHERE "first_name" IS NULL;
    UPDATE "clients" SET "last_name"  = '' WHERE "last_name"  IS NULL;

    ALTER TABLE "clients" ALTER COLUMN "first_name" SET NOT NULL;
    ALTER TABLE "clients" ALTER COLUMN "last_name"  SET NOT NULL;
  END IF;
END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    ALTER TABLE "clients" ALTER COLUMN "last_name"  DROP NOT NULL;
    ALTER TABLE "clients" ALTER COLUMN "first_name" DROP NOT NULL;
  END IF;
END $$;
        `);
    }
}
