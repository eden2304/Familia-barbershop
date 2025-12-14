import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberOptions1728000000000 implements MigrationInterface {
    name = 'AddMemberOptions1728000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "is_member" boolean NOT NULL DEFAULT false;
  END IF;

  IF to_regclass('public.blocked_times') IS NOT NULL THEN
    ALTER TABLE "blocked_times" ADD COLUMN IF NOT EXISTS "members_only" boolean NOT NULL DEFAULT false;
  END IF;
END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.blocked_times') IS NOT NULL THEN
    ALTER TABLE "blocked_times" DROP COLUMN IF EXISTS "members_only";
  END IF;

  IF to_regclass('public.clients') IS NOT NULL THEN
    ALTER TABLE "clients" DROP COLUMN IF EXISTS "is_member";
  END IF;
END $$;
        `);
    }
}
