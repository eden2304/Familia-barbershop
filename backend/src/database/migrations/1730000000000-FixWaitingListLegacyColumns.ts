import { MigrationInterface, QueryRunner } from "typeorm";

export class FixWaitingListLegacyColumns1730000000000 implements MigrationInterface {
    name = 'FixWaitingListLegacyColumns1730000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE waiting_list
            SET desired_date = COALESCE(desired_date, date),
                desired_time = COALESCE(desired_time, time)
            WHERE desired_date IS NULL
               OR desired_time IS NULL;
        `);

        await queryRunner.query(`
            ALTER TABLE waiting_list
                DROP COLUMN IF EXISTS date,
                DROP COLUMN IF EXISTS time;
        `);

        await queryRunner.query(`
            ALTER TABLE waiting_list
                ALTER COLUMN client_id DROP NOT NULL;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE waiting_list
                ADD COLUMN IF NOT EXISTS date DATE,
                ADD COLUMN IF NOT EXISTS time VARCHAR(5);
        `);

        await queryRunner.query(`
            UPDATE waiting_list
            SET date = COALESCE(date, desired_date),
                time = COALESCE(time, desired_time)
            WHERE date IS NULL
               OR time IS NULL;
        `);

        await queryRunner.query(`
            ALTER TABLE waiting_list
                ALTER COLUMN date SET NOT NULL,
                ALTER COLUMN time SET NOT NULL;
        `);

        await queryRunner.query(`
            ALTER TABLE waiting_list
                ALTER COLUMN client_id SET NOT NULL;
        `);
    }
}
