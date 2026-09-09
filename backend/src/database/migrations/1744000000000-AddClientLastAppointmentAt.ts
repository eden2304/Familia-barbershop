import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientLastAppointmentAt1744000000000 implements MigrationInterface {
    name = 'AddClientLastAppointmentAt1744000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "clients"
            ADD COLUMN IF NOT EXISTS "last_appointment_at" timestamptz
        `);

        // Seed from whatever appointment history currently exists; only move forward.
        await queryRunner.query(`
            UPDATE "clients" c
            SET "last_appointment_at" = sub.max_start
            FROM (
                SELECT client_id, MAX(starts_at) AS max_start
                FROM "appointments"
                WHERE client_id IS NOT NULL
                GROUP BY client_id
            ) sub
            WHERE sub.client_id = c.id
              AND (c."last_appointment_at" IS NULL OR sub.max_start > c."last_appointment_at")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "clients"
            DROP COLUMN IF EXISTS "last_appointment_at"
        `);
    }
}
