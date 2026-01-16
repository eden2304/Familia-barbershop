import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminSyncFixes1730000000000 implements MigrationInterface {
    name = 'AdminSyncFixes1730000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.appointments') IS NOT NULL THEN
    ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'booked';
    ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "note" text;
    ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "recurring_id" int;
  END IF;
END $$;
        `);

        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.recurring_appointments') IS NULL THEN
    CREATE TABLE "recurring_appointments" (
      "id" SERIAL PRIMARY KEY,
      "client_id" int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      "service_id" int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      "weekday" int NOT NULL,
      "start_time" varchar(8) NOT NULL,
      "interval_weeks" int NOT NULL DEFAULT 1,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;
        `);

        await queryRunner.query(`
CREATE UNIQUE INDEX IF NOT EXISTS "ux_recurring_unique"
ON "recurring_appointments" ("client_id", "service_id", "weekday", "start_time");
        `);

        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.appointments') IS NOT NULL THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "fk_appointments_recurring"
      FOREIGN KEY ("recurring_id") REFERENCES "recurring_appointments"("id")
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
        `);

        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.waiting_list') IS NOT NULL THEN
    ALTER TABLE "waiting_list" ADD COLUMN IF NOT EXISTS "client_name" varchar(200);
    ALTER TABLE "waiting_list" ADD COLUMN IF NOT EXISTS "phone" varchar(20);
    ALTER TABLE "waiting_list" ADD COLUMN IF NOT EXISTS "desired_starts_at" timestamptz;
    ALTER TABLE "waiting_list" ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now();
    ALTER TABLE "waiting_list" ALTER COLUMN "status" SET DEFAULT 'waiting';
  END IF;
END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.waiting_list') IS NOT NULL THEN
    ALTER TABLE "waiting_list" DROP COLUMN IF EXISTS "desired_starts_at";
    ALTER TABLE "waiting_list" DROP COLUMN IF EXISTS "phone";
    ALTER TABLE "waiting_list" DROP COLUMN IF EXISTS "client_name";
    ALTER TABLE "waiting_list" DROP COLUMN IF EXISTS "created_at";
  END IF;
END $$;
        `);

        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.appointments') IS NOT NULL THEN
    ALTER TABLE "appointments" DROP COLUMN IF EXISTS "recurring_id";
    ALTER TABLE "appointments" DROP COLUMN IF EXISTS "note";
    ALTER TABLE "appointments" DROP COLUMN IF EXISTS "status";
  END IF;
END $$;
        `);

        await queryRunner.query(`DROP INDEX IF EXISTS "ux_recurring_unique";`);
        await queryRunner.query(`DROP TABLE IF EXISTS "recurring_appointments";`);
    }
}
