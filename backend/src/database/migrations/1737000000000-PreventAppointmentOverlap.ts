import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventAppointmentOverlap1737000000000 implements MigrationInterface {
    name = 'PreventAppointmentOverlap1737000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist;`);

        await queryRunner.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status VARCHAR(16);`);
        await queryRunner.query(`UPDATE appointments SET status = 'booked' WHERE status IS NULL OR btrim(status) = '';`);
        await queryRunner.query(`ALTER TABLE appointments ALTER COLUMN status SET DEFAULT 'booked';`);

        await queryRunner.query(`
            ALTER TABLE appointments
            DROP CONSTRAINT IF EXISTS chk_appointments_active_requires_end;
        `);
        await queryRunner.query(`
            ALTER TABLE appointments
            ADD CONSTRAINT chk_appointments_active_requires_end
            CHECK (
                status NOT IN ('booked', 'completed', 'blocked')
                OR (ends_at IS NOT NULL AND ends_at > starts_at)
            );
        `);

        await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_appointments_starts_at ON appointments(starts_at);`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_appointments_ends_at ON appointments(ends_at);`);

        await queryRunner.query(`
            ALTER TABLE appointments
            DROP CONSTRAINT IF EXISTS appointments_no_overlap_active;
        `);

        await queryRunner.query(`
            ALTER TABLE appointments
            ADD CONSTRAINT appointments_no_overlap_active
            EXCLUDE USING gist (
                tstzrange(starts_at, ends_at, '[)') WITH &&
            )
            WHERE (status IN ('booked', 'completed', 'blocked'));
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap_active;`);
        await queryRunner.query(`DROP INDEX IF EXISTS idx_appointments_ends_at;`);
        await queryRunner.query(`DROP INDEX IF EXISTS idx_appointments_starts_at;`);
        await queryRunner.query(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_appointments_active_requires_end;`);
        await queryRunner.query(`ALTER TABLE appointments DROP COLUMN IF EXISTS status;`);
    }
}
