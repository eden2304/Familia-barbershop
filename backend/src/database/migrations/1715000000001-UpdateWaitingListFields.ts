import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateWaitingListFields1715000000001 implements MigrationInterface {
    name = 'UpdateWaitingListFields1715000000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE waiting_list
                ADD COLUMN IF NOT EXISTS client_name VARCHAR(200),
                ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
                ADD COLUMN IF NOT EXISTS desired_date DATE,
                ADD COLUMN IF NOT EXISTS desired_time VARCHAR(5),
                ADD COLUMN IF NOT EXISTS is_club_member BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        `);

        await queryRunner.query(`
            UPDATE waiting_list
            SET desired_date = COALESCE(desired_date, date),
                desired_time = COALESCE(desired_time, time)
            WHERE date IS NOT NULL OR time IS NOT NULL;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE waiting_list
                DROP COLUMN IF EXISTS created_at,
                DROP COLUMN IF EXISTS is_club_member,
                DROP COLUMN IF EXISTS desired_time,
                DROP COLUMN IF EXISTS desired_date,
                DROP COLUMN IF EXISTS phone,
                DROP COLUMN IF EXISTS client_name;
        `);
    }
}
